// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {IHyperliquidPerpStrategy} from "../interfaces/IHyperliquidPerpStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HyperliquidPerpStrategy
 * @notice Custodial/bridge strategy for Hyperliquid perpetual trading.
 *
 *   USDC is pulled from the vault and approved for a keeper. The keeper
 *   transfers the USDC, trades on Hyperliquid off-chain, then returns
 *   funds via keeperDeposit(). On settlement the USDC is pushed back
 *   to the vault.
 *
 *   Batch calls from governor:
 *     Execute: [USDC.approve(strategy, depositAmount), strategy.execute()]
 *     Settle:  [strategy.settle()]
 *
 *   Tunable params (updatable by proposer between execution and settlement):
 *     - minReturnAmount: minimum USDC to accept on settlement (slippage)
 */
contract HyperliquidPerpStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ── Events ──
    event StrategyFunded(address indexed keeper, uint256 amount);
    event KeeperSettled(uint256 returnAmount);

    // ── Errors ──
    error InvalidAmount();
    error NotKeeper();


    // ── Storage (per-clone) ──
    address public keeper;
    address public asset;
    uint256 public depositAmount;
    uint256 public minReturnAmount;
    bool public keeperDeposited;
    bool public keeperSettled;

    /// @inheritdoc IStrategy
    function name() external pure returns (string memory) {
        return "Hyperliquid Perp";
    }

    /// @notice Decode: (address keeper, address asset, uint256 depositAmount, uint256 minReturnAmount)
    function _initialize(bytes calldata data) internal override {
        (address keeper_, address asset_, uint256 depositAmount_, uint256 minReturnAmount_) =
            abi.decode(data, (address, address, uint256, uint256));
        if (keeper_ == address(0) || asset_ == address(0)) revert ZeroAddress();
        if (depositAmount_ == 0) revert InvalidAmount();

        keeper = keeper_;
        asset = asset_;
        depositAmount = depositAmount_;
        minReturnAmount = minReturnAmount_;
    }

    /// @notice Pull USDC from vault, approve keeper to transferFrom
    function _execute() internal override {
        // Pull tokens from vault (vault must have approved us first via batch call)
        _pullFromVault(asset, depositAmount);

        // Approve keeper to transferFrom the USDC
        IERC20(asset).forceApprove(keeper, depositAmount);

        emit StrategyFunded(keeper, depositAmount);
    }

    /// @notice Settle: verify funds returned, push all back to vault
    /// @dev The vault owner can trigger emergency settlement even if keeper hasn't
    ///      returned funds. In that case the minReturnAmount check is skipped.
    ///      Normal settlement (keeperSettled == true) enforces minReturnAmount.
    function _settle() internal override {
        if (keeperSettled) {
            // Normal path: keeper has returned funds, enforce minimum
            uint256 balance = IERC20(asset).balanceOf(address(this));
            if (balance < minReturnAmount) revert InvalidAmount();
        }
        // Emergency path: vault owner calls settle() through the vault even though
        // keeper hasn't returned funds. We skip minReturnAmount check and return
        // whatever balance remains (could be zero if keeper took all funds).

        // Push everything back to the vault
        _pushAllToVault(asset);
    }

    /// @notice Called by the keeper to deposit USDC back after trading on Hyperliquid
    /// @param amount The amount of USDC being returned
    function keeperDeposit(uint256 amount) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (amount == 0) revert InvalidAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        keeperDeposited = true;
        keeperSettled = true;

        emit KeeperSettled(amount);
    }

    /// @notice Update params: (uint256 newMinReturnAmount)
    /// @dev Pass 0 to keep current value. Only proposer, only while Executed.
    function _updateParams(bytes calldata data) internal override {
        uint256 newMinReturnAmount = abi.decode(data, (uint256));
        if (newMinReturnAmount > 0) minReturnAmount = newMinReturnAmount;
    }
}
