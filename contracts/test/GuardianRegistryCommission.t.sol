// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {GuardianRegistry} from "../src/GuardianRegistry.sol";
import {IGuardianRegistry} from "../src/interfaces/IGuardianRegistry.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";

/// @title GuardianRegistryCommission — V1.5 Phase 3, Task 3.1
/// @notice Covers setCommission + bounds + raise-rate limit + Trace224 history.
contract GuardianRegistryCommissionTest is Test {
    GuardianRegistry registry;
    ERC20Mock wood;

    address owner = makeAddr("owner");
    address governor = makeAddr("governor");
    address factory = makeAddr("factory");
    address delegate_ = makeAddr("delegate");

    uint256 constant COOL_DOWN = 7 days;
    uint256 constant EPOCH_DURATION = 7 days;

    function setUp() public {
        wood = new ERC20Mock("WOOD", "WOOD", 18);
        GuardianRegistry impl = new GuardianRegistry();
        bytes memory initData = abi.encodeCall(
            GuardianRegistry.initialize,
            (owner, governor, factory, address(wood), 10_000e18, 10_000e18, COOL_DOWN, 24 hours, 3000)
        );
        registry = GuardianRegistry(address(new ERC1967Proxy(address(impl), initData)));
    }

    function test_setCommission_happyPath() public {
        vm.prank(delegate_);
        registry.setCommission(1000); // 10%
        assertEq(registry.commissionOf(delegate_), 1000);
    }

    function test_setCommission_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IGuardianRegistry.CommissionSet(delegate_, 0, 1500);
        vm.prank(delegate_);
        registry.setCommission(1500);
    }

    function test_setCommission_exceedsMaxReverts() public {
        vm.expectRevert(IGuardianRegistry.CommissionExceedsMax.selector);
        vm.prank(delegate_);
        registry.setCommission(6000); // > MAX_COMMISSION_BPS (5000)
    }

    function test_setCommission_raiseRateLimit_sameEpochReverts() public {
        vm.prank(delegate_);
        registry.setCommission(1000);

        vm.expectRevert(IGuardianRegistry.CommissionRaiseExceedsLimit.selector);
        vm.prank(delegate_);
        registry.setCommission(2000); // raise > 500 bps in same epoch
    }

    function test_setCommission_raiseRateLimit_smallRaiseAllowed() public {
        vm.prank(delegate_);
        registry.setCommission(1000);

        vm.prank(delegate_);
        registry.setCommission(1400); // 400 bps raise — below limit
        assertEq(registry.commissionOf(delegate_), 1400);
    }

    function test_setCommission_raiseRateLimit_nextEpochAllowed() public {
        vm.prank(delegate_);
        registry.setCommission(1000);

        vm.warp(vm.getBlockTimestamp() + EPOCH_DURATION);
        vm.prank(delegate_);
        registry.setCommission(1500); // raise by 500 in new epoch — allowed
        assertEq(registry.commissionOf(delegate_), 1500);
    }

    function test_setCommission_decreaseUnbounded() public {
        vm.prank(delegate_);
        registry.setCommission(5000); // max
        vm.prank(delegate_);
        registry.setCommission(0); // free to lower all the way
        assertEq(registry.commissionOf(delegate_), 0);
    }

    function test_setCommission_noOpOnSameValue() public {
        vm.prank(delegate_);
        registry.setCommission(1000);

        // Setting the same value again should be a silent no-op (no event,
        // no checkpoint mutation, no raise-limit tripwire).
        vm.recordLogs();
        vm.prank(delegate_);
        registry.setCommission(1000);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_commissionAt_returnsHistoricalValue() public {
        vm.prank(delegate_);
        registry.setCommission(500);
        uint256 t1 = vm.getBlockTimestamp();

        vm.warp(vm.getBlockTimestamp() + EPOCH_DURATION);
        vm.prank(delegate_);
        registry.setCommission(1000);
        uint256 t2 = vm.getBlockTimestamp();

        vm.warp(vm.getBlockTimestamp() + 1);

        assertEq(registry.commissionAt(delegate_, t1), 500, "rate at t1 = 500");
        assertEq(registry.commissionAt(delegate_, t2), 1000, "rate at t2 = 1000");
    }

    function test_commissionAt_zeroForUnsetDelegate() public view {
        assertEq(registry.commissionAt(delegate_, vm.getBlockTimestamp()), 0);
    }

    function test_setCommission_cumulativeRaiseLimitBlocksChaining() public {
        // First-ever set (rate announcement): 300. No rate limit.
        // Baseline for this epoch seeded to 300.
        vm.prank(delegate_);
        registry.setCommission(300);

        // Same-epoch raise 300 → 800 (= 300 + 500 cap). OK.
        vm.prank(delegate_);
        registry.setCommission(800);

        // Same-epoch raise 800 → 900. Baseline is still 300 (seeded on first
        // set, NOT updated on subsequent raises). Cap = 800. 900 > 800 → revert.
        vm.expectRevert(IGuardianRegistry.CommissionRaiseExceedsLimit.selector);
        vm.prank(delegate_);
        registry.setCommission(900);

        // After epoch rollover, baseline re-anchors to pre-epoch rate (800).
        // Cap = 1300. 1300 exact passes.
        vm.warp(vm.getBlockTimestamp() + EPOCH_DURATION);
        vm.prank(delegate_);
        registry.setCommission(1300);
        assertEq(registry.commissionOf(delegate_), 1300);
    }

    function test_setCommission_decreaseThenRaise_capRemainsFromEpochStart() public {
        vm.prank(delegate_);
        registry.setCommission(400); // rate at start of next epoch check

        vm.warp(vm.getBlockTimestamp() + EPOCH_DURATION);
        // New epoch: rate-at-epoch-start = 400. Cap = 900.
        vm.prank(delegate_);
        registry.setCommission(0); // decrease to 0 (allowed, unbounded)
        // Raising back to 800 < 900 is within cap.
        vm.prank(delegate_);
        registry.setCommission(800);
        // But going above 900 reverts.
        vm.expectRevert(IGuardianRegistry.CommissionRaiseExceedsLimit.selector);
        vm.prank(delegate_);
        registry.setCommission(901);
    }
}
