// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MoonwellUSDCStrategy} from "../src/strategies/MoonwellUSDCStrategy.sol";

// ==================== MOCKS ====================

/// @dev Minimal ERC-20 mock with public mint.
contract MockERC20 is Test {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Mock mToken that simulates Compound/Moonwell mint/redeem.
contract MockMToken {
    MockERC20 public underlying;
    mapping(address => uint256) public balanceOf;
    bool public shouldFailMint;
    bool public shouldFailRedeem;

    constructor(address _underlying) {
        underlying = MockERC20(_underlying);
    }

    function setFailMint(bool fail) external {
        shouldFailMint = fail;
    }

    function setFailRedeem(bool fail) external {
        shouldFailRedeem = fail;
    }

    function mint(uint256 mintAmount) external returns (uint256) {
        if (shouldFailMint) return 1; // non-zero = error
        // Pull underlying from caller (vault context via delegatecall)
        underlying.transferFrom(msg.sender, address(this), mintAmount);
        // Mint 1:1 mTokens for simplicity
        balanceOf[msg.sender] += mintAmount;
        return 0;
    }

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        if (shouldFailRedeem) return 1;
        require(balanceOf[msg.sender] >= redeemAmount, "insufficient mTokens");
        balanceOf[msg.sender] -= redeemAmount;
        underlying.transfer(msg.sender, redeemAmount);
        return 0;
    }
}

/// @dev Mock comptroller for enterMarkets.
contract MockComptroller {
    bool public shouldFail;

    function setFail(bool fail) external {
        shouldFail = fail;
    }

    function enterMarkets(address[] calldata) external view returns (uint256[] memory errors) {
        errors = new uint256[](1);
        errors[0] = shouldFail ? 1 : 0;
    }
}

// ==================== VAULT HARNESS ====================

/// @dev Mimics the vault: holds tokens, delegatecalls into the strategy.
contract VaultHarness {
    function execute(address target, bytes memory data) external returns (bytes memory) {
        (bool success, bytes memory returnData) = target.delegatecall(data);
        if (!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
        return returnData;
    }

    // Accept ETH if needed
    receive() external payable {}
}

// ==================== TESTS ====================

contract MoonwellUSDCStrategyTest is Test {
    MoonwellUSDCStrategy strategy;
    VaultHarness vault;
    MockERC20 usdc;
    MockMToken mToken;
    MockComptroller comptroller;

    function setUp() public {
        strategy = new MoonwellUSDCStrategy();
        vault = new VaultHarness();
        usdc = new MockERC20();
        mToken = new MockMToken(address(usdc));
        comptroller = new MockComptroller();

        // Fund the vault with 10,000 USDC
        usdc.mint(address(vault), 10_000e6);
    }

    // ── Supply tests ──

    function test_supplyToMoonwell() public {
        uint256 amount = 5_000e6;

        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), amount, true)
            )
        );

        // USDC moved from vault to mToken
        assertEq(usdc.balanceOf(address(vault)), 5_000e6, "vault should have 5k remaining");
        assertEq(usdc.balanceOf(address(mToken)), 5_000e6, "mToken should hold 5k");

        // Vault received mTokens (1:1 in mock)
        assertEq(mToken.balanceOf(address(vault)), 5_000e6, "vault should have mTokens");
    }

    function test_supplyToMoonwell_noEnterMarket() public {
        uint256 amount = 1_000e6;

        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), amount, false)
            )
        );

        assertEq(usdc.balanceOf(address(vault)), 9_000e6);
        assertEq(mToken.balanceOf(address(vault)), 1_000e6);
    }

    function test_supplyToMoonwell_revertOnZeroAmount() public {
        vm.expectRevert(MoonwellUSDCStrategy.ZeroAmount.selector);
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell, (address(usdc), address(mToken), address(comptroller), 0, false)
            )
        );
    }

    function test_supplyToMoonwell_revertOnMintFail() public {
        mToken.setFailMint(true);

        vm.expectRevert(abi.encodeWithSelector(MoonwellUSDCStrategy.MintFailed.selector, 1));
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), 1_000e6, false)
            )
        );
    }

    function test_supplyToMoonwell_revertOnEnterMarketFail() public {
        comptroller.setFail(true);

        vm.expectRevert(abi.encodeWithSelector(MoonwellUSDCStrategy.EnterMarketFailed.selector, 1));
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), 1_000e6, true)
            )
        );
    }

    // ── Withdraw tests ──

    function test_withdrawFromMoonwell() public {
        // First supply
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), 5_000e6, true)
            )
        );

        // Now withdraw
        vault.execute(
            address(strategy), abi.encodeCall(MoonwellUSDCStrategy.withdrawFromMoonwell, (address(mToken), 5_000e6))
        );

        // All USDC back in vault
        assertEq(usdc.balanceOf(address(vault)), 10_000e6, "vault should have full balance back");
        assertEq(mToken.balanceOf(address(vault)), 0, "vault should have 0 mTokens");
    }

    function test_withdrawFromMoonwell_revertOnZeroAmount() public {
        vm.expectRevert(MoonwellUSDCStrategy.ZeroAmount.selector);
        vault.execute(
            address(strategy), abi.encodeCall(MoonwellUSDCStrategy.withdrawFromMoonwell, (address(mToken), 0))
        );
    }

    function test_withdrawFromMoonwell_revertOnRedeemFail() public {
        // Supply first so vault has mTokens
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), 1_000e6, false)
            )
        );

        mToken.setFailRedeem(true);

        vm.expectRevert(abi.encodeWithSelector(MoonwellUSDCStrategy.RedeemFailed.selector, 1));
        vault.execute(
            address(strategy), abi.encodeCall(MoonwellUSDCStrategy.withdrawFromMoonwell, (address(mToken), 1_000e6))
        );
    }

    // ── Round-trip test ──

    function test_fullRoundTrip() public {
        uint256 startBalance = usdc.balanceOf(address(vault));

        // Supply all
        vault.execute(
            address(strategy),
            abi.encodeCall(
                MoonwellUSDCStrategy.supplyToMoonwell,
                (address(usdc), address(mToken), address(comptroller), startBalance, true)
            )
        );

        assertEq(usdc.balanceOf(address(vault)), 0);

        // Withdraw all
        vault.execute(
            address(strategy),
            abi.encodeCall(MoonwellUSDCStrategy.withdrawFromMoonwell, (address(mToken), startBalance))
        );

        assertEq(usdc.balanceOf(address(vault)), startBalance, "full round-trip should restore balance");
    }
}
