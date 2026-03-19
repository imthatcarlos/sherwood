// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IMToken
 * @notice Minimal Compound/Moonwell cToken-style interface for supply & redeem.
 */
interface IMToken {
    /// @notice Supply `mintAmount` of underlying and receive mTokens.
    /// @return 0 on success, otherwise an error code.
    function mint(uint256 mintAmount) external returns (uint256);

    /// @notice Redeem `redeemAmount` of underlying from the protocol.
    /// @return 0 on success, otherwise an error code.
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /// @notice Returns the mToken balance of `owner`.
    function balanceOf(address owner) external view returns (uint256);

    /// @notice Returns the current exchange rate (scaled by 1e18).
    function exchangeRateCurrent() external returns (uint256);
}
