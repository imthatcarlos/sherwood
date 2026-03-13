// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal interface for Moonwell mToken (Compound fork)
interface IMToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function borrow(uint256 borrowAmount) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function underlying() external view returns (address);
}

/// @notice Minimal interface for Moonwell Comptroller
interface IComptroller {
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);
}

/**
 * @title MoonwellStrategy
 * @notice Strategy contract for Moonwell lending protocol on Base.
 *         Agents deposit collateral, borrow, manage positions, and repay.
 *         Each successful cycle builds on-chain credit history via EAS attestations.
 */
contract MoonwellStrategy {
    using SafeERC20 for IERC20;

    /// @notice The Moonwell Comptroller on Base
    IComptroller public immutable comptroller;

    /// @notice The vault that owns this strategy
    address public immutable vault;

    event CollateralDeposited(address indexed mToken, uint256 amount);
    event Borrowed(address indexed mToken, uint256 amount);
    event Repaid(address indexed mToken, uint256 amount);
    event CollateralWithdrawn(address indexed mToken, uint256 amount);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(address vault_, address comptroller_) {
        require(vault_ != address(0), "Invalid vault");
        require(comptroller_ != address(0), "Invalid comptroller");
        vault = vault_;
        comptroller = IComptroller(comptroller_);
    }

    /// @notice Deposit collateral into a Moonwell market
    /// @param mToken The mToken market to deposit into
    /// @param amount Amount of underlying to deposit
    function depositCollateral(address mToken, uint256 amount) external onlyVault {
        address underlying = IMToken(mToken).underlying();

        // Transfer from vault
        IERC20(underlying).safeTransferFrom(vault, address(this), amount);

        // Approve and mint mTokens
        IERC20(underlying).approve(mToken, amount);
        uint256 err = IMToken(mToken).mint(amount);
        require(err == 0, "Mint failed");

        // Enter market to use as collateral
        address[] memory markets = new address[](1);
        markets[0] = mToken;
        comptroller.enterMarkets(markets);

        emit CollateralDeposited(mToken, amount);
    }

    /// @notice Borrow from a Moonwell market
    /// @param mToken The mToken market to borrow from
    /// @param amount Amount of underlying to borrow
    function borrow(address mToken, uint256 amount) external onlyVault {
        uint256 err = IMToken(mToken).borrow(amount);
        require(err == 0, "Borrow failed");

        // Send borrowed funds back to vault
        address underlying = IMToken(mToken).underlying();
        IERC20(underlying).safeTransfer(vault, amount);

        emit Borrowed(mToken, amount);
    }

    /// @notice Repay a borrow position
    /// @param mToken The mToken market to repay
    /// @param amount Amount to repay (use type(uint256).max for full repay)
    function repay(address mToken, uint256 amount) external onlyVault {
        address underlying = IMToken(mToken).underlying();

        // Get actual borrow balance if repaying max
        uint256 repayAmount = amount;
        if (amount == type(uint256).max) {
            repayAmount = IMToken(mToken).borrowBalanceCurrent(address(this));
        }

        // Transfer from vault and repay
        IERC20(underlying).safeTransferFrom(vault, address(this), repayAmount);
        IERC20(underlying).approve(mToken, repayAmount);

        uint256 err = IMToken(mToken).repayBorrow(repayAmount);
        require(err == 0, "Repay failed");

        emit Repaid(mToken, repayAmount);
    }

    /// @notice Withdraw collateral from a Moonwell market
    /// @param mToken The mToken market to withdraw from
    /// @param amount Amount of underlying to withdraw
    function withdrawCollateral(address mToken, uint256 amount) external onlyVault {
        uint256 err = IMToken(mToken).redeemUnderlying(amount);
        require(err == 0, "Redeem failed");

        // Send withdrawn funds back to vault
        address underlying = IMToken(mToken).underlying();
        IERC20(underlying).safeTransfer(vault, amount);

        emit CollateralWithdrawn(mToken, amount);
    }
}
