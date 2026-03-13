// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mock Moonwell mToken for testing
contract MockMToken is ERC20 {
    address public underlying_;
    uint256 public borrowBalance;
    uint256 public exchangeRateStored_;
    bool public shouldFail;

    constructor(address underlying__, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        underlying_ = underlying__;
        exchangeRateStored_ = 1e18; // 1:1 initially
    }

    function underlying() external view returns (address) {
        return underlying_;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        if (shouldFail) return 1;
        IERC20(underlying_).transferFrom(msg.sender, address(this), mintAmount);
        _mint(msg.sender, mintAmount); // 1:1 for simplicity
        return 0;
    }

    function borrow(uint256 borrowAmount) external returns (uint256) {
        if (shouldFail) return 1;
        // Transfer underlying to borrower
        IERC20(underlying_).transfer(msg.sender, borrowAmount);
        borrowBalance += borrowAmount;
        return 0;
    }

    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        if (shouldFail) return 1;
        IERC20(underlying_).transferFrom(msg.sender, address(this), repayAmount);
        borrowBalance -= repayAmount;
        return 0;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        if (shouldFail) return 1;
        _burn(msg.sender, redeemAmount); // 1:1
        IERC20(underlying_).transfer(msg.sender, redeemAmount);
        return 0;
    }

    function borrowBalanceCurrent(address) external view returns (uint256) {
        return borrowBalance;
    }

    function getAccountSnapshot(address account)
        external
        view
        returns (uint256 err, uint256 mTokenBalance, uint256 borrowBal, uint256 exchangeRate)
    {
        return (0, balanceOf(account), borrowBalance, exchangeRateStored_);
    }

    // Test helpers
    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    function fundUnderlying(uint256 amount) external {
        // For borrow liquidity — caller must have transferred underlying here
    }
}
