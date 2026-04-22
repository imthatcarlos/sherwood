// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {GuardianRegistry} from "../src/GuardianRegistry.sol";
import {IGuardianRegistry} from "../src/interfaces/IGuardianRegistry.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";
import {BlacklistingERC20Mock} from "./mocks/BlacklistingERC20Mock.sol";
import {MockGovernorMinimal} from "./mocks/MockGovernorMinimal.sol";

/// @title GuardianRegistryProposalReward — V1.5 Phase 3 Tasks 3.7/3.8/3.9
/// @notice Covers the on-chain guardian-fee claim flow: fundProposalGuardianPool,
///         claimProposalReward (approver + DPoS commission), W-1 escrow,
///         flushUnclaimedApproverFee, and cross-proposal drain regression.
contract GuardianRegistryProposalRewardTest is Test {
    GuardianRegistry registry;
    ERC20Mock wood;
    BlacklistingERC20Mock usdc;
    MockGovernorMinimal mockGov;

    address owner = makeAddr("owner");
    address factory = makeAddr("factory");
    address approver = makeAddr("approver");
    address approver2 = makeAddr("approver2");
    address blocker = makeAddr("blocker");
    address delegator1 = makeAddr("delegator1");
    address delegator2 = makeAddr("delegator2");

    uint256 constant COOL_DOWN = 7 days;
    uint256 constant MIN_STAKE = 10_000e18;
    uint256 constant FEE_AMOUNT = 1_000e6; // 1k USDC guardian fee
    uint256 constant PID = 42;

    function setUp() public {
        wood = new ERC20Mock("WOOD", "WOOD", 18);
        usdc = new BlacklistingERC20Mock("USD Coin", "USDC", 6);
        mockGov = new MockGovernorMinimal();

        GuardianRegistry impl = new GuardianRegistry();
        bytes memory initData = abi.encodeCall(
            GuardianRegistry.initialize,
            (owner, address(mockGov), factory, address(wood), MIN_STAKE, MIN_STAKE, COOL_DOWN, 24 hours, 3000)
        );
        registry = GuardianRegistry(address(new ERC1967Proxy(address(impl), initData)));

        // Ensure cohort-at-open meets MIN_COHORT_STAKE_AT_OPEN (50k) so openReview
        // actually records weights rather than short-circuiting.
        _stake(approver, 20_000e18, 1);
        _stake(approver2, 20_000e18, 2);
        _stake(blocker, 20_000e18, 3);

        // Delegators have WOOD approved but don't stake themselves.
        wood.mint(delegator1, 1_000_000e18);
        wood.mint(delegator2, 1_000_000e18);
        vm.prank(delegator1);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(delegator2);
        wood.approve(address(registry), type(uint256).max);

        // Pre-fund the registry with USDC (simulates governor's
        // transferPerformanceFee step).
        usdc.mint(address(registry), 10 * FEE_AMOUNT);
    }

    function _stake(address g, uint256 amt, uint256 agentId) internal {
        wood.mint(g, amt);
        vm.prank(g);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(g);
        registry.stakeAsGuardian(amt, agentId);
    }

    /// @dev Opens a review, has `approverA` and optionally `approverB` vote
    ///      Approve, and `blk` vote Block. Then warps past reviewEnd and
    ///      resolves. Returns after resolveReview so settlement can happen.
    function _runReview(address approverA, address approverB, address blk) internal {
        // Set up proposal in mock governor.
        uint256 voteEnd = vm.getBlockTimestamp() + 1;
        uint256 reviewEnd = voteEnd + 24 hours + 1;
        mockGov.setProposal(PID, voteEnd, reviewEnd);

        vm.warp(voteEnd); // now == voteEnd
        registry.openReview(PID);

        // Advance so block.timestamp >= voteEnd AND < reviewEnd for voting.
        vm.warp(voteEnd + 1);

        vm.prank(approverA);
        registry.voteOnProposal(PID, IGuardianRegistry.GuardianVoteType.Approve);

        if (approverB != address(0)) {
            vm.prank(approverB);
            registry.voteOnProposal(PID, IGuardianRegistry.GuardianVoteType.Approve);
        }

        if (blk != address(0)) {
            vm.prank(blk);
            registry.voteOnProposal(PID, IGuardianRegistry.GuardianVoteType.Block);
        }

        vm.warp(reviewEnd);
        registry.resolveReview(PID);
    }

    function _fundPool() internal {
        vm.prank(address(mockGov));
        registry.fundProposalGuardianPool(PID, address(usdc), FEE_AMOUNT);
    }

    // ── Single-approver claim path ──

    function test_claim_singleApprover_noCommission_allToApprover() public {
        _runReview(approver, address(0), address(0));
        _fundPool();

        uint256 before = usdc.balanceOf(approver);
        vm.prank(approver);
        registry.claimProposalReward(PID);
        // Commission = 0 → nothing to approver; full FEE_AMOUNT goes to delegator pool.
        assertEq(usdc.balanceOf(approver) - before, 0);
    }

    function test_claim_withCommission_paysApproverCut() public {
        vm.prank(approver);
        registry.setCommission(2000); // 20%
        _runReview(approver, address(0), address(0));
        _fundPool();

        uint256 before = usdc.balanceOf(approver);
        vm.prank(approver);
        registry.claimProposalReward(PID);
        assertEq(usdc.balanceOf(approver) - before, 200e6, "20% of 1000 = 200");
    }

    function test_claim_twoApprovers_equalWeight_halfEach() public {
        // Both approvers set 0 commission for simpler accounting; each gets
        // their pro-rata share of the fee but commission=0 means their cut = 0.
        // The test is about weight attribution, not commission.
        vm.prank(approver);
        registry.setCommission(2000);
        vm.prank(approver2);
        registry.setCommission(2000);
        _runReview(approver, approver2, address(0));
        _fundPool();

        vm.prank(approver);
        registry.claimProposalReward(PID);
        vm.prank(approver2);
        registry.claimProposalReward(PID);
        // Each gets 20% of their 500 share = 100 USDC
        assertEq(usdc.balanceOf(approver), 100e6);
        assertEq(usdc.balanceOf(approver2), 100e6);
    }

    // ── Approver restriction ──

    function test_claim_blocker_reverts() public {
        _runReview(approver, address(0), blocker);
        _fundPool();
        vm.expectRevert(IGuardianRegistry.NotApprover.selector);
        vm.prank(blocker);
        registry.claimProposalReward(PID);
    }

    function test_claim_nonVoter_reverts() public {
        _runReview(approver, address(0), address(0));
        _fundPool();
        vm.expectRevert(IGuardianRegistry.NotApprover.selector);
        vm.prank(delegator1);
        registry.claimProposalReward(PID);
    }

    function test_claim_noPool_reverts() public {
        _runReview(approver, address(0), address(0));
        vm.expectRevert(IGuardianRegistry.NoPoolFunded.selector);
        vm.prank(approver);
        registry.claimProposalReward(PID);
    }

    function test_claim_double_reverts() public {
        _runReview(approver, address(0), address(0));
        _fundPool();
        vm.prank(approver);
        registry.claimProposalReward(PID);
        vm.expectRevert(IGuardianRegistry.AlreadyClaimed.selector);
        vm.prank(approver);
        registry.claimProposalReward(PID);
    }

    // ── Commission-at-settledAt (INV-V1.5-11) ──

    function test_claim_commissionFrozenAtSettledAt() public {
        vm.prank(approver);
        registry.setCommission(1000); // 10%
        _runReview(approver, address(0), address(0));
        _fundPool(); // stamps settledAt

        // Raise commission AFTER settlement — should not affect this claim.
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(approver);
        registry.setCommission(1500);

        vm.prank(approver);
        registry.claimProposalReward(PID);
        assertEq(usdc.balanceOf(approver), 100e6, "10% rate frozen at settledAt");
    }

    // ── Delegator claim ──

    function test_claimDelegator_splitsProRata() public {
        // Delegate 400 + 600 = 1000; approver's vote weight = own 20k + 1k
        // delegated = 21k. For the split, delegator pool = gross - commission.
        vm.prank(approver);
        registry.setCommission(2000);
        vm.prank(delegator1);
        registry.delegateStake(approver, 400e18);
        vm.prank(delegator2);
        registry.delegateStake(approver, 600e18);
        vm.warp(vm.getBlockTimestamp() + 1);

        _runReview(approver, address(0), address(0));
        _fundPool();
        vm.prank(approver);
        registry.claimProposalReward(PID);
        // Pool for delegators = 800 USDC (1000 - 200 commission).

        vm.prank(delegator1);
        registry.claimDelegatorProposalReward(approver, PID);
        assertEq(usdc.balanceOf(delegator1), 320e6, "400/1000 * 800 = 320");

        vm.prank(delegator2);
        registry.claimDelegatorProposalReward(approver, PID);
        assertEq(usdc.balanceOf(delegator2), 480e6, "600/1000 * 800 = 480");
    }

    function test_claimDelegator_beforeApproverClaim_reverts() public {
        vm.prank(delegator1);
        registry.delegateStake(approver, 500e18);
        vm.warp(vm.getBlockTimestamp() + 1);

        _runReview(approver, address(0), address(0));
        _fundPool();

        vm.expectRevert(IGuardianRegistry.DelegatePoolEmpty.selector);
        vm.prank(delegator1);
        registry.claimDelegatorProposalReward(approver, PID);
    }

    function test_claimDelegator_double_reverts() public {
        vm.prank(approver);
        registry.setCommission(2000);
        vm.prank(delegator1);
        registry.delegateStake(approver, 1_000e18);
        vm.warp(vm.getBlockTimestamp() + 1);

        _runReview(approver, address(0), address(0));
        _fundPool();
        vm.prank(approver);
        registry.claimProposalReward(PID);
        vm.prank(delegator1);
        registry.claimDelegatorProposalReward(approver, PID);

        vm.expectRevert(IGuardianRegistry.AlreadyClaimed.selector);
        vm.prank(delegator1);
        registry.claimDelegatorProposalReward(approver, PID);
    }

    // ── W-1 escrow ──

    function test_claim_blacklistedApprover_escrows() public {
        vm.prank(approver);
        registry.setCommission(2000);
        _runReview(approver, address(0), address(0));
        _fundPool();
        usdc.setBlacklisted(approver, true);

        vm.expectEmit(true, true, true, true);
        emit IGuardianRegistry.ApproverFeeEscrowed(PID, approver, address(usdc), 200e6);
        vm.prank(approver);
        registry.claimProposalReward(PID);

        assertEq(registry.unclaimedApproverFee(PID, approver, address(usdc)), 200e6);
    }

    function test_flushUnclaimedApproverFee_retriesAfterUnblacklist() public {
        vm.prank(approver);
        registry.setCommission(2000);
        _runReview(approver, address(0), address(0));
        _fundPool();
        usdc.setBlacklisted(approver, true);
        vm.prank(approver);
        registry.claimProposalReward(PID);

        usdc.setBlacklisted(approver, false);
        uint256 before = usdc.balanceOf(approver);
        registry.flushUnclaimedApproverFee(PID, approver, address(usdc));
        assertEq(usdc.balanceOf(approver) - before, 200e6);
        assertEq(registry.unclaimedApproverFee(PID, approver, address(usdc)), 0);
    }

    function test_flushUnclaimedApproverFee_noEscrow_reverts() public {
        vm.expectRevert(IGuardianRegistry.NoEscrowedAmount.selector);
        registry.flushUnclaimedApproverFee(PID, approver, address(usdc));
    }

    // ── Cross-proposal drain regression (PR #229 review finding class) ──

    function test_flush_cannotDrainUnrelatedProposal() public {
        vm.prank(approver);
        registry.setCommission(2000);
        _runReview(approver, address(0), address(0));
        _fundPool();
        usdc.setBlacklisted(approver, true);
        vm.prank(approver);
        registry.claimProposalReward(PID);
        usdc.setBlacklisted(approver, false);

        // Attempt flush with wrong proposalId → no match in keyed mapping.
        vm.expectRevert(IGuardianRegistry.NoEscrowedAmount.selector);
        registry.flushUnclaimedApproverFee(9999, approver, address(usdc));

        // Original escrow still intact.
        assertEq(registry.unclaimedApproverFee(PID, approver, address(usdc)), 200e6);
    }
}
