// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {ICToken} from "../interfaces/ICToken.sol";
import {IMamoStrategyFactory, IMamoERC20Strategy} from "../interfaces/IMamoStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Extended Compound/Moonwell cToken methods needed for borrow/repay and rate reads.
///         The minimal `ICToken` interface in `interfaces/ICToken.sol` only covers supply.
interface ICTokenExt {
    function borrow(uint256 borrowAmount) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function underlying() external view returns (address);
    function supplyRatePerTimestamp() external view returns (uint256);
    function borrowRatePerTimestamp() external view returns (uint256);
}

/// @notice Moonwell Comptroller subset: market entry + liquidity check.
interface IComptroller {
    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);
    function getAccountLiquidity(address account)
        external
        view
        returns (uint256 err, uint256 liquidity, uint256 shortfall);
}

/**
 * @title MoonwellCbBTCLoopMamoStrategy
 * @notice Three-leg leveraged yield loop on Base:
 *           1. Supply cbBTC to Moonwell (earn supply APY, enable as collateral)
 *           2. Borrow USDC from Moonwell against the cbBTC collateral
 *           3. Deposit the borrowed USDC into a Mamo USDC strategy for yield
 *
 *         Net yield = cbBTC supply APY + (Mamo USDC APY − Moonwell USDC borrow APR)
 *                     × (USDC borrowed / cbBTC value)
 *
 *         This is an agent-authored bespoke strategy for a specific playbook —
 *         it is not part of the Sherwood strategy template catalog. It is
 *         deployed ad-hoc per proposal from an off-chain script.
 *
 *   Execute batch (from governor):
 *     [cbBTC.approve(strategy, supplyAmount), strategy.execute()]
 *
 *   Settle batch (from governor):
 *     [strategy.settle()]
 *
 *   No tunable params — v1 is strictly init-time configured.
 */
contract MoonwellCbBTCLoopMamoStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ── Errors ──
    error InvalidAmount();
    error MintFailed();
    error EnterMarketsFailed();
    error BorrowFailed();
    error RepayFailed();
    error RedeemFailed();
    error CreateMamoStrategyFailed();
    error DepositFailed();
    error UnderlyingMismatch();
    error InsufficientMamoReturn(uint256 got, uint256 needed);
    error NoTunableParams();

    // ── Initialization parameters ──
    struct InitParams {
        address cbBTC;
        address usdc;
        address mCbBTC;
        address mUSDC;
        address comptroller;
        address mamoFactory;
        uint256 supplyAmount;
        uint256 borrowAmount;
        uint256 minRedeemAmount;
    }

    // ── Storage (per-clone) ──
    address public cbBTC;
    address public usdc;
    address public mCbBTC;
    address public mUSDC;
    address public comptroller;
    address public mamoFactory;
    address public mamoStrategy; // set on _execute

    uint256 public supplyAmount;
    uint256 public borrowAmount;
    uint256 public minRedeemAmount;

    /// @inheritdoc IStrategy
    function name() external pure returns (string memory) {
        return "Moonwell cbBTC Mamo Loop";
    }

    // ── Initialization ──

    /// @notice Decode: InitParams struct
    function _initialize(bytes calldata data) internal override {
        InitParams memory p = abi.decode(data, (InitParams));

        if (
            p.cbBTC == address(0) || p.usdc == address(0) || p.mCbBTC == address(0) || p.mUSDC == address(0)
                || p.comptroller == address(0) || p.mamoFactory == address(0)
        ) revert ZeroAddress();
        if (p.supplyAmount == 0 || p.borrowAmount == 0 || p.minRedeemAmount == 0) revert InvalidAmount();

        // Sanity: the cTokens must reference the expected underlyings.
        if (ICTokenExt(p.mCbBTC).underlying() != p.cbBTC) revert UnderlyingMismatch();
        if (ICTokenExt(p.mUSDC).underlying() != p.usdc) revert UnderlyingMismatch();

        cbBTC = p.cbBTC;
        usdc = p.usdc;
        mCbBTC = p.mCbBTC;
        mUSDC = p.mUSDC;
        comptroller = p.comptroller;
        mamoFactory = p.mamoFactory;
        supplyAmount = p.supplyAmount;
        borrowAmount = p.borrowAmount;
        minRedeemAmount = p.minRedeemAmount;
    }

    // ── Execute ──

    /// @notice cbBTC → Moonwell supply → enterMarkets → Moonwell USDC borrow → Mamo deposit
    function _execute() internal override {
        // 1. Pull cbBTC from vault
        _pullFromVault(cbBTC, supplyAmount);

        // 2. Supply to Moonwell (mint mCbBTC)
        IERC20(cbBTC).forceApprove(mCbBTC, supplyAmount);
        if (ICToken(mCbBTC).mint(supplyAmount) != 0) revert MintFailed();

        // 3. Enable mCbBTC as collateral
        address[] memory markets = new address[](1);
        markets[0] = mCbBTC;
        uint256[] memory errs = IComptroller(comptroller).enterMarkets(markets);
        if (errs.length == 0 || errs[0] != 0) revert EnterMarketsFailed();

        // 4. Borrow USDC from Moonwell
        if (ICTokenExt(mUSDC).borrow(borrowAmount) != 0) revert BorrowFailed();

        // 5. Create a Mamo strategy instance owned by this contract
        address mamoStrategy_ = IMamoStrategyFactory(mamoFactory).createStrategyForUser(address(this));
        if (mamoStrategy_ == address(0)) revert CreateMamoStrategyFailed();
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(mamoStrategy_)
        }
        if (codeSize == 0) revert CreateMamoStrategyFailed();
        mamoStrategy = mamoStrategy_;

        // 6. Deposit borrowed USDC into the Mamo strategy
        IERC20(usdc).forceApprove(mamoStrategy_, borrowAmount);
        uint256 balanceBefore = IERC20(usdc).balanceOf(address(this));
        IMamoERC20Strategy(mamoStrategy_).deposit(borrowAmount);
        uint256 balanceAfter = IERC20(usdc).balanceOf(address(this));
        if (balanceBefore - balanceAfter < borrowAmount) revert DepositFailed();
    }

    // ── Settle ──

    /// @notice Withdraw Mamo → repay Moonwell debt → redeem cbBTC collateral → return to vault
    function _settle() internal override {
        // 1. Withdraw everything from Mamo (principal + mamo yield)
        IMamoERC20Strategy(mamoStrategy).withdrawAll();

        // 2. Accrue Moonwell interest and read the current debt (mutator, not view)
        uint256 debt = ICTokenExt(mUSDC).borrowBalanceCurrent(address(this));

        // 3. Repay debt. If Mamo yield didn't cover accrued borrow interest,
        //    revert loudly rather than leaving a residual debt on the vault.
        uint256 usdcHeld = IERC20(usdc).balanceOf(address(this));
        if (usdcHeld < debt) revert InsufficientMamoReturn(usdcHeld, debt);
        if (debt > 0) {
            IERC20(usdc).forceApprove(mUSDC, debt);
            if (ICTokenExt(mUSDC).repayBorrow(debt) != 0) revert RepayFailed();
        }

        // 4. Redeem all cbBTC collateral
        uint256 mTokenBal = ICToken(mCbBTC).balanceOf(address(this));
        if (mTokenBal > 0) {
            if (ICToken(mCbBTC).redeem(mTokenBal) != 0) revert RedeemFailed();
        }

        // 5. Enforce minimum return
        uint256 cbBTCBal = IERC20(cbBTC).balanceOf(address(this));
        if (cbBTCBal < minRedeemAmount) revert InvalidAmount();

        // 6. Push cbBTC back to the vault.
        //    Any USDC dust (overshoot of Mamo yield vs. debt) is intentionally
        //    left in the strategy contract for rescueERC20 — v1 does not
        //    auto-swap it back to cbBTC.
        _pushAllToVault(cbBTC);
    }

    // ── Params ──

    /// @inheritdoc BaseStrategy
    function _updateParams(bytes calldata) internal pure override {
        revert NoTunableParams();
    }

    // ── Views ──

    /// @notice Yield breakdown for dashboard consumption.
    /// @dev All three values are 1e18-scaled per-year rates (approximate APR, not APY).
    ///      Moonwell exposes per-timestamp rates, scaled here by seconds/year.
    ///      `mamoUsdcApy` is returned as 0 for v1 — the frontend can source it
    ///      off-chain from Mamo's own surface.
    function getYieldInfo()
        external
        view
        returns (uint256 cbBTCSupplyApy, uint256 usdcBorrowApr, uint256 mamoUsdcApy, int256 netApyBps)
    {
        uint256 secondsPerYear = 365 days;
        cbBTCSupplyApy = ICTokenExt(mCbBTC).supplyRatePerTimestamp() * secondsPerYear;
        usdcBorrowApr = ICTokenExt(mUSDC).borrowRatePerTimestamp() * secondsPerYear;
        mamoUsdcApy = 0;

        // Net requires all three legs. Since mamoUsdcApy is 0 on-chain (Mamo
        // has no cheap view), return 0 and let the frontend compute the real net
        // once it sources the Mamo APY off-chain.
        netApyBps = 0;
    }
}
