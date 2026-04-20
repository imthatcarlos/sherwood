// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISyndicateGovernor} from "./interfaces/ISyndicateGovernor.sol";
import {IGuardianRegistry} from "./interfaces/IGuardianRegistry.sol";
import {BatchExecutorLib} from "./BatchExecutorLib.sol";

// ISyndicateVault / IERC4626 / IERC20 intentionally NOT imported here — the
// Task-24 implementation will pull them in when the bodies are fleshed out.

/// @title GovernorEmergency
/// @notice Abstract — emergency settlement paths extracted for bytecode headroom.
///         Inherited by SyndicateGovernor alongside GovernorParameters.
///
///         Functions are stubs in Task 2. Task 24 implements the full guardian
///         review lifecycle: `unstick`, `emergencySettleWithCalls`,
///         `cancelEmergencySettle`, `finalizeEmergencySettle`.
abstract contract GovernorEmergency is ISyndicateGovernor {
    // ── Virtual accessors (implemented by SyndicateGovernor) ──

    function _getProposal(uint256) internal view virtual returns (StrategyProposal storage);
    function _getSettlementCalls(uint256) internal view virtual returns (BatchExecutorLib.Call[] storage);
    function _getRegistry() internal view virtual returns (IGuardianRegistry);
    function _emergencyReentrancyEnter() internal virtual;
    function _emergencyReentrancyLeave() internal virtual;

    // ── Reentrancy modifier (shares status var with SyndicateGovernor) ──

    modifier emergencyNonReentrant() {
        _emergencyReentrancyEnter();
        _;
        _emergencyReentrancyLeave();
    }

    // ── Emergency settle lifecycle (stubs — Task 24) ──

    /// @notice Legacy emergency settle entrypoint. Preserved as a stub for
    ///         ISyndicateGovernor interface compatibility until Task 25
    ///         migrates the interface to the new lifecycle fns below.
    /// @dev Reverts — callers must switch to `emergencySettleWithCalls` +
    ///      `finalizeEmergencySettle` once Task 24 is live.
    /// @param proposalId governor proposal id
    /// @param calls owner-supplied fallback settlement calls
    function emergencySettle(uint256 proposalId, BatchExecutorLib.Call[] calldata calls)
        external
        emergencyNonReentrant
    {
        proposalId;
        calls;
        revert(); // TODO(task-24/25): remove after interface migration
    }

    /// @notice Rescues a proposal stuck in Executed state past its duration.
    /// @dev Full implementation in Task 24 — currently reverts.
    /// @param proposalId governor proposal id
    function unstick(uint256 proposalId) external emergencyNonReentrant {
        proposalId; // silence unused warning
        revert(); // TODO(task-24)
    }

    /// @notice Vault owner opens an emergency review on a stuck proposal with
    ///         owner-supplied unwind calls. Requires bonded guardian review.
    /// @dev Full implementation in Task 24 — currently reverts.
    /// @param proposalId governor proposal id
    /// @param calls owner-supplied settlement calls to be reviewed
    function emergencySettleWithCalls(uint256 proposalId, BatchExecutorLib.Call[] calldata calls)
        external
        emergencyNonReentrant
    {
        proposalId;
        calls;
        revert(); // TODO(task-24)
    }

    /// @notice Vault owner cancels their own open emergency review before resolution.
    /// @dev Full implementation in Task 24 — currently reverts.
    /// @param proposalId governor proposal id
    function cancelEmergencySettle(uint256 proposalId) external emergencyNonReentrant {
        proposalId;
        revert(); // TODO(task-24)
    }

    /// @notice Resolves a reviewed emergency settle and executes the approved calls.
    /// @dev Full implementation in Task 24 — currently reverts.
    /// @param proposalId governor proposal id
    /// @param calls calls whose hash was pre-committed at review open time
    function finalizeEmergencySettle(uint256 proposalId, BatchExecutorLib.Call[] calldata calls)
        external
        emergencyNonReentrant
    {
        proposalId;
        calls;
        revert(); // TODO(task-24)
    }
}
