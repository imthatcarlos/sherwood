// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {IHyperliquidPerpStrategy} from "../interfaces/IHyperliquidPerpStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {L1Write, TimeInForce, NO_CLOID} from "../hyperliquid/L1Write.sol";

/**
 * @title HyperliquidPerpStrategy
 * @notice On-chain perpetual trading strategy using HyperEVM precompiles.
 *
 *   USDC is pulled from the vault and transferred to perp margin via
 *   L1Write.sendUsdClassTransfer(). The proposer then triggers trades
 *   (open long, close position, update stop loss) via updateParams().
 *   On settlement, any open position is closed and funds are returned
 *   to the vault.
 *
 *   NO off-chain keeper — all actions go through HyperCore precompiles.
 */
contract HyperliquidPerpStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ── Events ──
    event PositionOpened(uint32 asset, bool isBuy, uint64 limitPx, uint64 sz, uint32 leverage);
    event PositionClosed(uint32 asset, uint64 limitPx, uint64 sz);
    event StopLossUpdated(uint64 triggerPx);
    event FundsParked(uint256 amount);

    // ── Errors ──
    error InvalidAmount();
    error InvalidAction();
    error NoOpenPosition();

    // ── Action types ──
    uint8 constant ACTION_UPDATE_MIN_RETURN = 0;
    uint8 constant ACTION_OPEN_LONG = 1;
    uint8 constant ACTION_CLOSE_POSITION = 2;
    uint8 constant ACTION_UPDATE_STOP_LOSS = 3;

    // ── Storage (per-clone) ──
    IERC20 public asset;
    uint256 public depositAmount;
    uint256 public minReturnAmount;
    uint32 public perpAssetIndex;
    uint32 public leverage;
    bool public positionOpen;
    uint64 public stopLossOrderId;
    uint64 public entryOrderId;

    /// @inheritdoc IStrategy
    function name() external pure returns (string memory) {
        return "Hyperliquid Perp";
    }

    /// @notice Decode: (address asset, uint256 depositAmount, uint256 minReturnAmount, uint32 perpAssetIndex, uint32 leverage)
    function _initialize(bytes calldata data) internal override {
        (
            address asset_,
            uint256 depositAmount_,
            uint256 minReturnAmount_,
            uint32 perpAssetIndex_,
            uint32 leverage_
        ) = abi.decode(data, (address, uint256, uint256, uint32, uint32));

        if (asset_ == address(0)) revert ZeroAddress();
        if (depositAmount_ == 0) revert InvalidAmount();

        asset = IERC20(asset_);
        depositAmount = depositAmount_;
        minReturnAmount = minReturnAmount_;
        perpAssetIndex = perpAssetIndex_;
        leverage = leverage_;
    }

    /// @notice Pull USDC from vault, transfer to perp margin via precompile
    function _execute() internal override {
        _pullFromVault(address(asset), depositAmount);

        // Transfer USDC to perp margin via HyperCore precompile
        // Amount is in raw HyperCore units (6 decimals for USDC)
        uint64 ntl = uint64(depositAmount);
        L1Write.sendUsdClassTransfer(ntl, true);

        emit FundsParked(depositAmount);
    }

    /// @notice Proposer-driven trading actions via precompiles
    /// @dev Decode format depends on action type:
    ///   action=0: (uint8 action, uint256 newMinReturn)
    ///   action=1: (uint8 action, uint64 limitPx, uint64 sz, uint64 stopLossPx, uint64 stopLossSz)
    ///   action=2: (uint8 action, uint64 limitPx, uint64 sz)
    ///   action=3: (uint8 action, uint64 triggerPx, uint64 sz)
    function _updateParams(bytes calldata data) internal override {
        uint8 action = uint8(bytes1(data[:1]));

        if (action == ACTION_UPDATE_MIN_RETURN) {
            (, uint256 newMinReturn) = abi.decode(data, (uint8, uint256));
            minReturnAmount = newMinReturn;
        } else if (action == ACTION_OPEN_LONG) {
            (, uint64 limitPx, uint64 sz, uint64 stopLossPx, uint64 stopLossSz) =
                abi.decode(data, (uint8, uint64, uint64, uint64, uint64));

            // Place IOC buy order (market-like)
            L1Write.sendLimitOrder(
                perpAssetIndex,
                true, // isBuy
                limitPx,
                sz,
                false, // not reduceOnly
                TimeInForce.Ioc,
                NO_CLOID
            );

            // Place GTC stop loss order (reduce-only sell)
            L1Write.sendLimitOrder(
                perpAssetIndex,
                false, // isSell
                stopLossPx,
                stopLossSz,
                true, // reduceOnly
                TimeInForce.Gtc,
                NO_CLOID
            );

            positionOpen = true;

            emit PositionOpened(perpAssetIndex, true, limitPx, sz, leverage);
            emit StopLossUpdated(stopLossPx);
        } else if (action == ACTION_CLOSE_POSITION) {
            if (!positionOpen) revert NoOpenPosition();

            (, uint64 limitPx, uint64 sz) = abi.decode(data, (uint8, uint64, uint64));

            // Cancel existing stop loss if we have one
            if (stopLossOrderId != 0) {
                L1Write.sendCancelOrderByOid(perpAssetIndex, stopLossOrderId);
                stopLossOrderId = 0;
            }

            // Place reduce-only IOC sell to close position
            L1Write.sendLimitOrder(
                perpAssetIndex,
                false, // isSell
                limitPx,
                sz,
                true, // reduceOnly
                TimeInForce.Ioc,
                NO_CLOID
            );

            positionOpen = false;

            emit PositionClosed(perpAssetIndex, limitPx, sz);
        } else if (action == ACTION_UPDATE_STOP_LOSS) {
            if (!positionOpen) revert NoOpenPosition();

            (, uint64 triggerPx, uint64 sz) = abi.decode(data, (uint8, uint64, uint64));

            // Cancel old stop loss
            if (stopLossOrderId != 0) {
                L1Write.sendCancelOrderByOid(perpAssetIndex, stopLossOrderId);
            }

            // Place new GTC stop loss (reduce-only sell)
            L1Write.sendLimitOrder(
                perpAssetIndex,
                false, // isSell
                triggerPx,
                sz,
                true, // reduceOnly
                TimeInForce.Gtc,
                NO_CLOID
            );

            emit StopLossUpdated(triggerPx);
        } else {
            revert InvalidAction();
        }
    }

    /// @notice Close any open position and return funds to vault
    function _settle() internal override {
        // If position is still open, force close with IOC sell
        if (positionOpen) {
            // Use max uint64 price for sell (will fill at market)
            // The caller should close the position before settling ideally,
            // but this is a safety net using a very low sell price to ensure fill
            L1Write.sendLimitOrder(
                perpAssetIndex,
                false, // isSell
                1, // minimum price to ensure fill as IOC
                type(uint64).max, // max size to close full position
                true, // reduceOnly
                TimeInForce.Ioc,
                NO_CLOID
            );

            // Cancel stop loss if present
            if (stopLossOrderId != 0) {
                L1Write.sendCancelOrderByOid(perpAssetIndex, stopLossOrderId);
                stopLossOrderId = 0;
            }

            positionOpen = false;
        }

        // Transfer USD from perp margin back to spot
        // Use max uint64 to sweep all available margin
        L1Write.sendUsdClassTransfer(type(uint64).max, false);

        // Push all USDC back to the vault
        _pushAllToVault(address(asset));
    }
}
