// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWETH - Simple ERC20 mock with WETH-like interface for testnet
contract MockWETH is ERC20 {
    address public owner;

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_) ERC20(name_, symbol_) {
        owner = msg.sender;
        _mint(msg.sender, initialSupply_);
    }

    /// @notice Open mint for testnet use
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice WETH-like deposit (no-op, just mints equivalent)
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /// @notice WETH-like withdraw (no-op)
    function withdraw(uint256) external {
        // no-op for testnet
    }

    /// @notice Accept ETH
    receive() external payable {}
}
