// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IStrategy} from "./IStrategy.sol";

/**
 * @title IHyperliquidPerpStrategy
 * @notice Interface for the Hyperliquid perpetual trading strategy.
 *         A custodial/bridge strategy where USDC is sent to a keeper
 *         who trades on Hyperliquid off-chain, then returns funds.
 */
interface IHyperliquidPerpStrategy is IStrategy {
    /// @notice Emitted when the strategy funds the keeper
    event StrategyFunded(address indexed keeper, uint256 amount);

    /// @notice Emitted when the keeper returns funds after trading
    event KeeperSettled(uint256 returnAmount);

    /// @notice Called by the keeper to deposit USDC back after trading
    /// @param amount The amount of USDC being returned
    function keeperDeposit(uint256 amount) external;

    /// @notice The keeper address authorized to trade on Hyperliquid
    function keeper() external view returns (address);

    /// @notice The asset (USDC) used for trading
    function asset() external view returns (address);

    /// @notice The amount deposited to the keeper
    function depositAmount() external view returns (uint256);

    /// @notice The minimum amount that must be returned on settlement
    function minReturnAmount() external view returns (uint256);

    /// @notice Whether the keeper has deposited funds back
    function keeperSettled() external view returns (bool);
}
