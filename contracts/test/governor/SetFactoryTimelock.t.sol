// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";

import {SyndicateGovernor} from "../../src/SyndicateGovernor.sol";
import {ISyndicateGovernor} from "../../src/interfaces/ISyndicateGovernor.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockRegistryMinimal} from "../mocks/MockRegistryMinimal.sol";

/// @title SetFactoryTimelock.t
/// @notice Covers G-M4: setFactory is no longer owner-instant. Routes through
///         the GovernorParameters timelock so factory rotation shares the same
///         queue / finalize / cancel lifecycle as protocolFeeRecipient (G-C5).
contract SetFactoryTimelockTest is Test {
    SyndicateGovernor public governor;
    MockRegistryMinimal public guardianRegistry;

    address public owner = makeAddr("owner");
    address public factory1 = makeAddr("factory1");
    address public factory2 = makeAddr("factory2");
    address public random = makeAddr("random");

    uint256 constant VOTING_PERIOD = 1 days;
    uint256 constant EXECUTION_WINDOW = 1 days;
    uint256 constant VETO_THRESHOLD_BPS = 4000;
    uint256 constant MAX_PERF_FEE_BPS = 3000;
    uint256 constant COOLDOWN_PERIOD = 1 days;
    uint256 constant PARAM_CHANGE_DELAY = 1 days;

    function setUp() public {
        guardianRegistry = new MockRegistryMinimal();

        SyndicateGovernor govImpl = new SyndicateGovernor();
        bytes memory govInit = abi.encodeCall(
            SyndicateGovernor.initialize,
            (
                ISyndicateGovernor.InitParams({
                    owner: owner,
                    votingPeriod: VOTING_PERIOD,
                    executionWindow: EXECUTION_WINDOW,
                    vetoThresholdBps: VETO_THRESHOLD_BPS,
                    maxPerformanceFeeBps: MAX_PERF_FEE_BPS,
                    cooldownPeriod: COOLDOWN_PERIOD,
                    collaborationWindow: 48 hours,
                    maxCoProposers: 5,
                    minStrategyDuration: 1 hours,
                    maxStrategyDuration: 30 days,
                    parameterChangeDelay: PARAM_CHANGE_DELAY,
                    protocolFeeBps: 0,
                    protocolFeeRecipient: address(0)
                }),
                address(guardianRegistry)
            )
        );
        governor = SyndicateGovernor(address(new ERC1967Proxy(address(govImpl), govInit)));
    }

    function _paramKey() internal view returns (bytes32) {
        return governor.PARAM_FACTORY();
    }

    // ── Tests ──

    /// @notice setFactory must queue, not apply instantly.
    function test_setFactory_queues_notInstant() public {
        assertEq(governor.factory(), address(0));

        vm.prank(owner);
        governor.setFactory(factory1);

        // Live factory unchanged — only queued.
        assertEq(governor.factory(), address(0));

        ISyndicateGovernor.PendingChange memory pending = governor.getPendingChange(_paramKey());
        assertTrue(pending.exists);
        assertEq(pending.newValue, uint256(uint160(factory1)));
        assertEq(pending.effectiveAt, block.timestamp + PARAM_CHANGE_DELAY);
    }

    /// @notice After the delay elapses, finalize applies the new factory.
    function test_setFactory_finalizesAfterDelay() public {
        vm.startPrank(owner);
        governor.setFactory(factory1);

        vm.warp(block.timestamp + PARAM_CHANGE_DELAY + 1);

        governor.finalizeParameterChange(_paramKey());
        vm.stopPrank();

        assertEq(governor.factory(), factory1);

        ISyndicateGovernor.PendingChange memory pending = governor.getPendingChange(_paramKey());
        assertFalse(pending.exists);
    }

    /// @notice Finalizing before the delay elapses must revert.
    function test_setFactory_revertsBeforeDelay() public {
        bytes32 key = _paramKey();
        vm.startPrank(owner);
        governor.setFactory(factory1);

        vm.warp(block.timestamp + PARAM_CHANGE_DELAY - 1);

        vm.expectRevert(ISyndicateGovernor.ChangeNotReady.selector);
        governor.finalizeParameterChange(key);
        vm.stopPrank();

        assertEq(governor.factory(), address(0));
    }

    /// @notice Owner can cancel a pending factory change at any time.
    function test_setFactory_cancelable() public {
        vm.startPrank(owner);
        governor.setFactory(factory1);

        governor.cancelParameterChange(_paramKey());
        vm.stopPrank();

        assertEq(governor.factory(), address(0));
        ISyndicateGovernor.PendingChange memory pending = governor.getPendingChange(_paramKey());
        assertFalse(pending.exists);

        // Can now queue a fresh change.
        vm.prank(owner);
        governor.setFactory(factory2);
        pending = governor.getPendingChange(_paramKey());
        assertTrue(pending.exists);
        assertEq(pending.newValue, uint256(uint160(factory2)));
    }

    /// @notice Queueing a zero-address factory must revert.
    function test_setFactory_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ISyndicateGovernor.ZeroAddress.selector);
        governor.setFactory(address(0));
    }

    /// @notice Queueing while a change is already pending must revert.
    function test_setFactory_revertsIfAlreadyPending() public {
        vm.startPrank(owner);
        governor.setFactory(factory1);

        vm.expectRevert(ISyndicateGovernor.ChangeAlreadyPending.selector);
        governor.setFactory(factory2);
        vm.stopPrank();
    }

    /// @notice Non-owner cannot queue a factory change.
    function test_setFactory_revertsIfNotOwner() public {
        vm.prank(random);
        vm.expectRevert();
        governor.setFactory(factory1);
    }
}
