// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWOOD - Simple ERC20 mock for testnet market-maker testing
contract MockWOOD is ERC20 {
    address public owner;

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_) ERC20(name_, symbol_) {
        owner = msg.sender;
        _mint(msg.sender, initialSupply_);
    }

    /// @notice Open mint for testnet use
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "only owner");
        _mint(to, amount);
    }
}
