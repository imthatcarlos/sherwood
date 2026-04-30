// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {SyndicateGovernor} from "../../src/SyndicateGovernor.sol";
import {SyndicateVault} from "../../src/SyndicateVault.sol";
import {ISyndicateGovernor} from "../../src/interfaces/ISyndicateGovernor.sol";
import {ISyndicateVault} from "../../src/interfaces/ISyndicateVault.sol";
import {BatchExecutorLib} from "../../src/BatchExecutorLib.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {BlacklistingERC20Mock} from "../mocks/BlacklistingERC20Mock.sol";
import {MockAgentRegistry} from "../mocks/MockAgentRegistry.sol";
import {MockRegistryMinimal} from "../mocks/MockRegistryMinimal.sol";

import {FeeBlacklistHandler} from "./handlers/FeeBlacklistHandler.sol";

/// @title FeeBlacklistInvariantTest
/// @notice INV-47 fuzz harness — `_distributeFees` MUST NOT revert because
///         a fee recipient is blacklisted (W-1). The unit-test counterpart
///         lives at `test/governor/FeeBlacklistResilience.t.sol`; this
///         invariant raises the bar to "no random sequence of blacklist
///         toggles + proposal lifecycles + claim retries can break the
///         escrow accounting".
///
///         Property under test:
///             totalFeesAccrued == totalFeesClaimed + totalFeesEscrowed
///
///         The three quantities are measured INDEPENDENTLY by the handler
///         (see `FeeBlacklistHandler` NatSpec for derivation), so a real
///         off-by-one in `_distributeFees`, `_distributeAgentFee`, or
///         `claimUnclaimedFees` will surface as an inequality.
///
///         If `runProposalLifecycle` ever sees a settle revert from a
///         blacklisted recipient, the handler reraises with the underlying
///         selector so the fuzzer reports a concrete counterexample.
contract FeeBlacklistInvariantTest is StdInvariant, Test {
    SyndicateGovernor public governor;
    SyndicateVault public vault;
    BatchExecutorLib public executorLib;
    BlacklistingERC20Mock public usdc;
    MockAgentRegistry public agentRegistry;
    MockRegistryMinimal public guardianRegistry;

    FeeBlacklistHandler public handler;

    address public owner = makeAddr("owner");
    address public agent = makeAddr("agent");
    address public coAgent = makeAddr("coAgent");
    address public protocolRecipient = makeAddr("protocolRecipient");
    address public lp1 = makeAddr("lp1");
    address public lp2 = makeAddr("lp2");

    uint256 public agentNftId;
    uint256 public coAgentNftId;

    // Governor params (mirrored to handler for accrued-fee accounting).
    uint256 constant VOTING_PERIOD = 1 days;
    uint256 constant EXECUTION_WINDOW = 1 days;
    uint256 constant VETO_THRESHOLD_BPS = 4_000;
    uint256 constant MAX_PERF_FEE_BPS = 3_000;
    uint256 constant COOLDOWN_PERIOD = 1 days;
    uint256 constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 constant MGMT_FEE_BPS = 50; // 0.5%

    function setUp() public {
        usdc = new BlacklistingERC20Mock("USD Coin", "USDC", 6);
        executorLib = new BatchExecutorLib();
        agentRegistry = new MockAgentRegistry();
        guardianRegistry = new MockRegistryMinimal();
        agentNftId = agentRegistry.mint(agent);
        coAgentNftId = agentRegistry.mint(coAgent);

        // ── Vault (proxy, real impl) ──
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
                    managementFeeBps: MGMT_FEE_BPS
                }))
        );
        vault = SyndicateVault(payable(address(new ERC1967Proxy(address(vaultImpl), vaultInit))));

        // Register the lead + co-proposer agents.
        vm.prank(owner);
        vault.registerAgent(agentNftId, agent);
        vm.prank(owner);
        vault.registerAgent(coAgentNftId, coAgent);

        // ── Governor (proxy, real impl) ──
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
                    protocolFeeBps: PROTOCOL_FEE_BPS,
                    protocolFeeRecipient: protocolRecipient,
                    guardianFeeBps: 0
                }),
                address(guardianRegistry)
            )
        );
        governor = SyndicateGovernor(address(new ERC1967Proxy(address(govImpl), govInit)));

        vm.prank(owner);
        governor.addVault(address(vault));

        // ── LP deposits — funds the vault + provides voting weight ──
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

        // Auto-delegate happens on first deposit (SyndicateVault._deposit).
        // Move past the deposit block so checkpoints are readable in `vote`.
        vm.warp(vm.getBlockTimestamp() + 1);

        // ── Handler + fuzz target bindings ──
        handler = new FeeBlacklistHandler(
            governor,
            vault,
            usdc,
            agent,
            coAgent,
            owner,
            protocolRecipient,
            lp1,
            lp2,
            PROTOCOL_FEE_BPS,
            MGMT_FEE_BPS,
            MAX_PERF_FEE_BPS,
            VOTING_PERIOD,
            COOLDOWN_PERIOD
        );

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = FeeBlacklistHandler.blacklistRandomRecipient.selector;
        selectors[1] = FeeBlacklistHandler.runProposalLifecycle.selector;
        selectors[2] = FeeBlacklistHandler.claimUnclaimedFees.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ──────────────────────────────────────────────────────────────
    // INV-47: accrued = claimed + escrowed
    // ──────────────────────────────────────────────────────────────

    /// @notice Every fee accrued by `_distributeFees` must end up either
    ///         (a) in the recipient's wallet (direct success or post-claim)
    ///         or (b) in the governor's `_unclaimedFees` escrow. Nothing
    ///         can be lost or double-counted across any random sequence
    ///         of blacklist toggles, lifecycles, and claims.
    function invariant_feesAccountedAfterBlacklist() public view {
        assertEq(
            handler.totalFeesAccrued(),
            handler.totalFeesClaimed() + handler.totalFeesEscrowed(),
            "INV-47: accrued = claimed + escrowed"
        );
    }

    /// @notice Final-state sanity gate — `afterInvariant` runs once after the
    ///         full fuzz campaign completes. Fail loud if the fuzzer never
    ///         drove a single lifecycle end-to-end across 128k calls (default
    ///         runs * depth). Without this, a regression that bricks
    ///         `_distributeFees` could be vacuously satisfied: every settle
    ///         reverts so accrued, claimed, and escrowed all stay 0.
    ///
    ///         Cannot be a plain `invariant_*` because forge checks every
    ///         invariant at run-0 setup (before any action runs), where
    ///         `lifecycleSuccesses` is genuinely 0. `afterInvariant` runs
    ///         once at the end of the campaign with terminal state.
    function afterInvariant() external view {
        assertGt(
            handler.lifecycleSuccesses(),
            0,
            "INV-47 sanity: no proposal lifecycle settled across the fuzz run - vacuous fuzz set"
        );
    }

    /// @notice Direct unit-style sanity check: drive one lifecycle through the
    ///         handler entry point and verify accrued > 0. Catches a
    ///         configuration regression where the handler stops driving the
    ///         full lifecycle (e.g., revert silenced inside try/catch on a
    ///         path that should always succeed).
    function test_handler_drivesLifecycleEndToEnd() public {
        handler.runProposalLifecycle(123);
        assertGt(handler.lifecycleSuccesses(), 0, "handler did not complete a lifecycle");
        assertGt(handler.totalFeesAccrued(), 0, "handler did not accrue any fees");
    }
}
