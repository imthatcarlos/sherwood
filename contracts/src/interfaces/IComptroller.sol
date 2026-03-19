// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IComptroller
 * @notice Minimal Compound/Moonwell comptroller interface for entering markets.
 */
interface IComptroller {
    /// @notice Enter the given markets (enable as collateral).
    /// @param mTokens The list of mToken addresses to enter.
    /// @return Per-market error codes (0 = success).
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);
}
