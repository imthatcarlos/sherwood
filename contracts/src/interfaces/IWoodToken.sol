// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IWoodToken — Shared interface for WoodToken and MockWoodToken
/// @notice Both production (LayerZero OFT) and test (simple ERC20) tokens implement this.
interface IWoodToken is IERC20 {
    /// @notice Mint tokens, capped at MAX_SUPPLY. Returns actual amount minted.
    function mint(address to, uint256 amount) external returns (uint256 minted);

    /// @notice Returns remaining mintable tokens before hitting the cap.
    function totalMintable() external view returns (uint256);
}
