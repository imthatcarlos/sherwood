// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMToken} from "../interfaces/IMToken.sol";
import {IComptroller} from "../interfaces/IComptroller.sol";

/**
 * @title MoonwellUSDCStrategy
 * @author Sherwood
 * @notice Stateless strategy executor for supplying/withdrawing USDC on Moonwell.
 *
 * @dev This contract is designed to be called via `delegatecall` from the
 *      SyndicateVault (through `executeGovernorBatch`). Because execution
 *      happens in the vault's storage context, all token approvals, transfers,
 *      and mToken positions belong to the vault — not this contract.
 *
 *      **IMPORTANT**: This contract has NO storage variables. It is fully
 *      stateless so that delegatecall is safe and cannot corrupt vault storage.
 *
 *      Usage flow (governor proposal):
 *        Execute phase  → calls[0] = delegatecall supplyToMoonwell(...)
 *        Settle phase   → calls[splitIndex] = delegatecall withdrawFromMoonwell(...)
 *
 *      The governor's settlement enforces `balanceAfter >= capitalSnapshot`,
 *      ensuring depositors never lose principal from a strategy.
 */
contract MoonwellUSDCStrategy {
    using SafeERC20 for IERC20;

    // ==================== ERRORS ====================

    error ZeroAmount();
    error MintFailed(uint256 errorCode);
    error RedeemFailed(uint256 errorCode);
    error EnterMarketFailed(uint256 errorCode);

    // ==================== EVENTS ====================

    event SuppliedToMoonwell(address indexed asset, address indexed mToken, uint256 amount);
    event WithdrawnFromMoonwell(address indexed mToken, uint256 amount);

    // ==================== STRATEGY FUNCTIONS ====================

    /**
     * @notice Supply `amount` of `asset` to the Moonwell market represented by `mToken`.
     * @dev Must be called via delegatecall from the vault. The vault's asset balance
     *      is approved to the mToken, which pulls the tokens during `mint()`.
     *
     * @param asset       The underlying ERC-20 (e.g. USDC).
     * @param mToken      The Moonwell mToken market (e.g. mUSDC).
     * @param comptroller The Moonwell comptroller (for entering the market).
     * @param amount      Amount of underlying to supply.
     * @param enterMarket If true, call `comptroller.enterMarkets` for this mToken.
     *                    Set to true on first supply, false on subsequent ones.
     */
    function supplyToMoonwell(address asset, address mToken, address comptroller, uint256 amount, bool enterMarket)
        external
    {
        if (amount == 0) revert ZeroAmount();

        // Optionally enter the market (enables mToken as collateral)
        if (enterMarket) {
            address[] memory markets = new address[](1);
            markets[0] = mToken;
            uint256[] memory errors = IComptroller(comptroller).enterMarkets(markets);
            if (errors[0] != 0) revert EnterMarketFailed(errors[0]);
        }

        // Approve mToken to pull underlying from vault (this contract context = vault via delegatecall)
        IERC20(asset).forceApprove(mToken, amount);

        // Supply to Moonwell — mToken.mint pulls `amount` of underlying, mints mTokens to caller (vault)
        uint256 err = IMToken(mToken).mint(amount);
        if (err != 0) revert MintFailed(err);

        emit SuppliedToMoonwell(asset, mToken, amount);
    }

    /**
     * @notice Withdraw `amount` of underlying from the Moonwell market.
     * @dev Must be called via delegatecall from the vault. The vault already
     *      holds mToken positions from a prior `supplyToMoonwell` call.
     *      `redeemUnderlying` burns the equivalent mTokens and returns underlying.
     *
     * @param mToken The Moonwell mToken market.
     * @param amount Amount of underlying to withdraw.
     */
    function withdrawFromMoonwell(address mToken, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 err = IMToken(mToken).redeemUnderlying(amount);
        if (err != 0) revert RedeemFailed(err);

        emit WithdrawnFromMoonwell(mToken, amount);
    }
}
