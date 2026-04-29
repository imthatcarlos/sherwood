// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";

import {SyndicateGovernor} from "../../src/SyndicateGovernor.sol";
import {ISyndicateGovernor} from "../../src/interfaces/ISyndicateGovernor.sol";
import {SyndicateVault} from "../../src/SyndicateVault.sol";
import {ISyndicateVault} from "../../src/interfaces/ISyndicateVault.sol";
import {GuardianRegistry} from "../../src/GuardianRegistry.sol";
import {IGuardianRegistry} from "../../src/interfaces/IGuardianRegistry.sol";
import {BatchExecutorLib} from "../../src/BatchExecutorLib.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockAgentRegistry} from "../mocks/MockAgentRegistry.sol";

/// @title EmergencyReviewBoundaryTest
/// @notice Boundary regression + invariant tests for the governor↔registry
///         emergency-review state machine.
///
///         Origin: PR #247 review surfaced a race where a normally-settled
///         proposal would leave the registry's `EmergencyReview` struct
///         stranded (`_finishSettlement` cleared the governor-side hash but
///         not the registry side). With the post-PR #247 `state == Executed`
///         guards on `cancelEmergencySettle` / `finalizeEmergencySettle`,
///         the owner could no longer drain the stranded review themselves
///         and the permissionless `resolveEmergencyReview` would slash the
///         owner's WOOD bond after `er.reviewEnd` — for a proposal that
///         settled correctly via the normal path.
///
///         These tests pin the boundary properties:
///
///           BOUNDARY-1 — `proposal.state == Settled` ⇒ no open registry
///                        emergency review. Asserts cross-contract state
///                        consistency on the happy + adversarial paths.
///           BOUNDARY-2 — A normal `settleProposal` cannot be observed
///                        followed by an owner slash on the same proposal.
///           BOUNDARY-3 — `vault.redemptionsLocked()` mirrors the governor's
///                        active-proposal pointer through the full lifecycle
///                        (Pending → Approved → Executed → Settled), and
///                        across emergency settle.
///
///         Setup mirrors `GovernorEmergency.t.sol` 1:1 (real registry +
///         governor proxies, real vault, two guardians staked above the
///         block-quorum threshold).
contract EmergencyReviewBoundaryTest is Test {
    SyndicateGovernor public governor;
    SyndicateVault public vault;
    GuardianRegistry public registry;
    BatchExecutorLib public executorLib;
    ERC20Mock public usdc;
    ERC20Mock public wood;
    ERC20Mock public targetToken;
    MockAgentRegistry public agentRegistry;

    address public owner = makeAddr("owner");
    address public agent = makeAddr("agent");
    address public lp1 = makeAddr("lp1");
    address public lp2 = makeAddr("lp2");
    address public random = makeAddr("random");
    address public guardianA = makeAddr("guardianA");
    address public guardianB = makeAddr("guardianB");
    address public factoryEoa;

    uint256 public agentNftId;

    uint256 constant VOTING_PERIOD = 1 days;
    uint256 constant EXECUTION_WINDOW = 1 days;
    uint256 constant VETO_THRESHOLD_BPS = 4000;
    uint256 constant MAX_PERF_FEE_BPS = 3000;
    uint256 constant COOLDOWN_PERIOD = 1 days;

    uint256 constant MIN_GUARDIAN_STAKE = 10_000e18;
    uint256 constant MIN_OWNER_STAKE = 10_000e18;
    uint256 constant REVIEW_PERIOD = 24 hours;
    uint256 constant BLOCK_QUORUM_BPS = 3000;
    uint256 constant GUARDIAN_STAKE = 30_000e18;

    function setUp() public {
        factoryEoa = address(this);

        usdc = new ERC20Mock("USD Coin", "USDC", 6);
        wood = new ERC20Mock("WOOD", "WOOD", 18);
        targetToken = new ERC20Mock("Target", "TGT", 18);
        executorLib = new BatchExecutorLib();
        agentRegistry = new MockAgentRegistry();
        agentNftId = agentRegistry.mint(agent);

        SyndicateVault vaultImpl = new SyndicateVault();
        bytes memory vaultInit = abi.encodeCall(
            SyndicateVault.initialize,
            (ISyndicateVault.InitParams({
                    asset: address(usdc),
                    name: "Sherwood Vault",
                    symbol: "swUSDC",
                    owner: owner,
                    executorImpl: address(executorLib),
                    openDeposits: true,
                    agentRegistry: address(agentRegistry),
                    managementFeeBps: 0
                }))
        );
        vault = SyndicateVault(payable(address(new ERC1967Proxy(address(vaultImpl), vaultInit))));

        vm.prank(owner);
        vault.registerAgent(agentNftId, agent);

        uint256 baseNonce = vm.getNonce(address(this));
        address predictedRegistryProxy = vm.computeCreateAddress(address(this), baseNonce + 3);

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
                    protocolFeeBps: 0,
                    protocolFeeRecipient: address(0),
                    guardianFeeBps: 0
                }),
                predictedRegistryProxy
            )
        );
        governor = SyndicateGovernor(address(new ERC1967Proxy(address(govImpl), govInit)));

        vm.prank(owner);
        governor.addVault(address(vault));

        GuardianRegistry regImpl = new GuardianRegistry();
        bytes memory regInit = abi.encodeCall(
            GuardianRegistry.initialize,
            (
                owner,
                address(governor),
                factoryEoa,
                address(wood),
                MIN_GUARDIAN_STAKE,
                MIN_OWNER_STAKE,
                7 days,
                REVIEW_PERIOD,
                BLOCK_QUORUM_BPS
            )
        );
        registry = GuardianRegistry(address(new ERC1967Proxy(address(regImpl), regInit)));
        require(address(registry) == predictedRegistryProxy, "registry addr mismatch");

        usdc.mint(lp1, 100_000e6);
        usdc.mint(lp2, 100_000e6);
        vm.startPrank(lp1);
        usdc.approve(address(vault), 60_000e6);
        vault.deposit(60_000e6, lp1);
        vm.stopPrank();
        vm.startPrank(lp2);
        usdc.approve(address(vault), 40_000e6);
        vault.deposit(40_000e6, lp2);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 1);

        wood.mint(owner, 100_000e18);
        wood.mint(guardianA, 100_000e18);
        wood.mint(guardianB, 100_000e18);

        vm.prank(owner);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(owner);
        registry.prepareOwnerStake(MIN_OWNER_STAKE);
        vm.prank(factoryEoa);
        registry.bindOwnerStake(owner, address(vault));

        vm.prank(guardianA);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(guardianA);
        registry.stakeAsGuardian(GUARDIAN_STAKE, 1);

        vm.prank(guardianB);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(guardianB);
        registry.stakeAsGuardian(GUARDIAN_STAKE, 2);
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────

    function _emptyCoProposers() internal pure returns (ISyndicateGovernor.CoProposer[] memory) {
        return new ISyndicateGovernor.CoProposer[](0);
    }

    function _execCalls() internal view returns (BatchExecutorLib.Call[] memory) {
        BatchExecutorLib.Call[] memory calls = new BatchExecutorLib.Call[](1);
        calls[0] = BatchExecutorLib.Call({
            target: address(usdc), data: abi.encodeCall(usdc.approve, (address(targetToken), 50_000e6)), value: 0
        });
        return calls;
    }

    function _settleCalls() internal view returns (BatchExecutorLib.Call[] memory) {
        BatchExecutorLib.Call[] memory calls = new BatchExecutorLib.Call[](1);
        calls[0] = BatchExecutorLib.Call({
            target: address(usdc), data: abi.encodeCall(usdc.approve, (address(targetToken), 0)), value: 0
        });
        return calls;
    }

    function _customCalls() internal view returns (BatchExecutorLib.Call[] memory) {
        BatchExecutorLib.Call[] memory calls = new BatchExecutorLib.Call[](1);
        calls[0] = BatchExecutorLib.Call({
            target: address(usdc), data: abi.encodeCall(usdc.approve, (address(targetToken), 0)), value: 0
        });
        return calls;
    }

    function _createExecutedProposal(uint256 duration) internal returns (uint256 proposalId) {
        vm.prank(agent);
        proposalId = governor.propose(
            address(vault), "ipfs://emergency", 1000, duration, _execCalls(), _settleCalls(), _emptyCoProposers()
        );
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(lp1);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);
        vm.prank(lp2);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);
        vm.warp(vm.getBlockTimestamp() + VOTING_PERIOD + 1);
        registry.openReview(proposalId);
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        governor.executeProposal(proposalId);
    }

    // ──────────────────────────────────────────────────────────────
    // BOUNDARY-1 — Settled ⇒ no open registry emergency review
    // ──────────────────────────────────────────────────────────────

    /// @notice Regression for the PR #247 finding: a normal `settleProposal`
    ///         landing while an emergency review is open must close the
    ///         registry-side review. Otherwise the orphaned review remains
    ///         resolvable via the permissionless `resolveEmergencyReview`
    ///         path and slashes the owner.
    function test_settledProposal_clearsRegistryEmergencyReview() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        // Owner opens emergency settle (registry review opens, calldata hash
        // committed locally on governor).
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        // Third party drives the proposal through the normal settle path
        // before the review window closes. The pre-committed settlementCalls
        // run; proposal flips to `Settled`.
        vm.prank(random);
        governor.settleProposal(pid);

        assertEq(
            uint256(governor.getProposal(pid).state),
            uint256(ISyndicateGovernor.ProposalState.Settled),
            "BOUNDARY-1: proposal should be Settled"
        );

        // Warp to / past the registry's review end and try to resolve. With the
        // fix in place, `cancelEmergencyReview` zeroed `er.reviewEnd` during
        // `_finishSettlement`, so `resolveEmergencyReview` reverts with
        // `ReviewNotReadyForResolve` (reviewEnd == 0). Without the fix,
        // resolveEmergencyReview would proceed and slash on the stranded review.
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);

        vm.expectRevert(IGuardianRegistry.ReviewNotReadyForResolve.selector);
        registry.resolveEmergencyReview(pid);
    }

    // ──────────────────────────────────────────────────────────────
    // BOUNDARY-2 — Normal settle never produces an owner slash
    // ──────────────────────────────────────────────────────────────

    /// @notice The full attack the PR #247 finding describes: owner opens
    ///         emergency, guardians reach block quorum, but a third party
    ///         races a normal `settleProposal` in before the review window
    ///         closes. Post-fix, `resolveEmergencyReview` cannot slash
    ///         because the review was cancelled atomically with settlement.
    ///         Pre-fix, this test fails: `registry.ownerStake(vault)` drops
    ///         to zero after `resolveEmergencyReview`.
    function test_normalSettleAfterEmergency_doesNotSlashOwner() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        // Both guardians block — total 60k WOOD ≥ 30% of own+delegated denom.
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid);
        vm.prank(guardianB);
        registry.voteBlockEmergencySettle(pid);

        uint256 ownerStakeBefore = registry.ownerStake(address(vault));
        assertEq(ownerStakeBefore, MIN_OWNER_STAKE, "BOUNDARY-2: pre-condition - owner bonded");

        // Race the normal settle in.
        vm.prank(random);
        governor.settleProposal(pid);
        assertEq(
            uint256(governor.getProposal(pid).state),
            uint256(ISyndicateGovernor.ProposalState.Settled),
            "BOUNDARY-2: proposal should be Settled"
        );

        // Wait past review end. Anyone may try to resolve. With the fix the
        // registry's review was cancelled atomically with settlement, so the
        // resolve reverts. Without the fix, resolve commits the slash.
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);

        vm.expectRevert(IGuardianRegistry.ReviewNotReadyForResolve.selector);
        registry.resolveEmergencyReview(pid);

        assertEq(
            registry.ownerStake(address(vault)),
            MIN_OWNER_STAKE,
            "BOUNDARY-2: owner stake intact after normal settle following emergency open"
        );
        assertTrue(registry.hasOwnerStake(address(vault)), "BOUNDARY-2: hasOwnerStake true");
    }

    // ──────────────────────────────────────────────────────────────
    // BOUNDARY-3 — `vault.redemptionsLocked()` mirrors active proposal
    // ──────────────────────────────────────────────────────────────

    /// @notice `redemptionsLocked()` reads `governor.getActiveProposal(vault) != 0`.
    ///         The two views must agree across the full lifecycle. Pinning
    ///         this as a regression catches any future refactor that decouples
    ///         the lock predicate from the active-proposal pointer.
    function test_redemptionLock_mirrorsActiveProposal_normalLifecycle() public {
        // Pre-propose: no active proposal, redemptions open.
        assertEq(governor.getActiveProposal(address(vault)), 0, "pre-propose: no active");
        assertFalse(vault.redemptionsLocked(), "pre-propose: redemptions open");

        uint256 pid = _createExecutedProposal(7 days);

        // Executed: active pointer set, redemptions locked.
        assertEq(governor.getActiveProposal(address(vault)), pid, "executed: pointer set");
        assertTrue(vault.redemptionsLocked(), "executed: redemptions locked");

        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(random);
        governor.settleProposal(pid);

        // Settled: pointer cleared, redemptions open.
        assertEq(governor.getActiveProposal(address(vault)), 0, "settled: pointer cleared");
        assertFalse(vault.redemptionsLocked(), "settled: redemptions open");
    }

    /// @notice Same boundary across the emergency settle path. The pointer
    ///         and lock must agree at every transition the emergency path
    ///         exposes.
    function test_redemptionLock_mirrorsActiveProposal_emergencyLifecycle() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        assertTrue(vault.redemptionsLocked(), "pre-emergency: locked");
        assertEq(governor.getActiveProposal(address(vault)), pid, "pre-emergency: active");

        // Open emergency — proposal stays Executed, lock unchanged.
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        assertTrue(vault.redemptionsLocked(), "post-open: still locked");
        assertEq(governor.getActiveProposal(address(vault)), pid, "post-open: still active");

        // Cancel emergency — same.
        vm.prank(owner);
        governor.cancelEmergencySettle(pid);
        assertTrue(vault.redemptionsLocked(), "post-cancel: still locked");
        assertEq(governor.getActiveProposal(address(vault)), pid, "post-cancel: still active");

        // Normal settle — both flip.
        vm.prank(random);
        governor.settleProposal(pid);
        assertFalse(vault.redemptionsLocked(), "settled: unlocked");
        assertEq(governor.getActiveProposal(address(vault)), 0, "settled: cleared");
    }

    // ──────────────────────────────────────────────────────────────
    // BOUNDARY-4 — Re-emergency after cancel-by-settle works
    // ──────────────────────────────────────────────────────────────

    /// @notice After `_finishSettlement` cancels the registry review, a brand
    ///         new proposal on the same vault must be able to enter the
    ///         emergency path cleanly — no leftover state from the prior
    ///         proposal's cancelled review (different proposalId namespace,
    ///         but exercises the broader "post-cancel state is fresh" claim
    ///         on the registry).
    function test_postNormalSettleCancel_newProposal_canEmergency() public {
        uint256 pid1 = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        // Open + race normal-settle + (would-have-slashed) on pid1.
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid1, _customCalls());
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid1);
        vm.prank(random);
        governor.settleProposal(pid1);

        // Move past pid1's reviewEnd; ensure no slashing residue.
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        assertEq(registry.ownerStake(address(vault)), MIN_OWNER_STAKE, "owner stake preserved");

        // Owner needs cooldown for the next propose; warp past it.
        vm.warp(vm.getBlockTimestamp() + COOLDOWN_PERIOD + 1);

        // Brand-new proposal goes through the same lifecycle cleanly.
        uint256 pid2 = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid2, _customCalls());

        // No leftover block-vote weight from pid1's cancelled review (the
        // nonce-bump on cancel invalidates them). Finalize (nobody blocks)
        // succeeds.
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        governor.finalizeEmergencySettle(pid2, _customCalls());

        assertEq(
            uint256(governor.getProposal(pid2).state),
            uint256(ISyndicateGovernor.ProposalState.Settled),
            "BOUNDARY-4: pid2 finalizes cleanly post-pid1 cancel-by-settle"
        );
    }
}
