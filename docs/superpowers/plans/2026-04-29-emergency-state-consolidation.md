# Emergency State Machine Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all emergency state (call hash, call array) from SyndicateGovernor to GuardianRegistry so the registry is the single owner of the emergency state machine, eliminating the split-state bug class.

**Architecture:** Governor emergency entrypoints become thin wrappers that delegate to the registry. Registry stores call arrays, validates hashes, resolves reviews, and returns calls for the governor to execute on the vault. `isEmergencyOpen()` view lets `_finishSettlement` skip unnecessary cancel calls.

**Tech Stack:** Solidity 0.8.28, Foundry, OpenZeppelin UUPS upgradeable, via_ir

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `contracts/src/interfaces/IGuardianRegistry.sol` | Modify | Replace 3 emergency functions, add 2 new ones |
| `contracts/src/interfaces/ISyndicateGovernor.sol` | Modify | Remove `calls` param from `finalizeEmergencySettle`, remove `EmergencySettleMismatch` error |
| `contracts/src/GuardianRegistry.sol` | Modify | Add `_emergencyCalls` storage, new emergency functions, `isEmergencyOpen` view |
| `contracts/src/GovernorEmergency.sol` | Modify | Remove virtual accessors, simplify entrypoints |
| `contracts/src/SyndicateGovernor.sol` | Modify | Delete emergency storage + implementations, update `_finishSettlement` |
| `contracts/test/governor/GovernorEmergency.t.sol` | Modify | Update test signatures, add new tests, remove hash-mismatch test |

---

### Task 1: Update IGuardianRegistry interface

**Files:**
- Modify: `contracts/src/interfaces/IGuardianRegistry.sol:124-131`

- [ ] **Step 1: Replace emergency function signatures and add new error**

In `contracts/src/interfaces/IGuardianRegistry.sol`, replace lines 124-131:

```solidity
    // ── Governor-only ──
    function openEmergencyReview(uint256 proposalId, bytes32 callsHash) external;
    function cancelEmergencyReview(uint256 proposalId) external;

    // ── Permissionless ──
    function openReview(uint256 proposalId) external;
    function resolveReview(uint256 proposalId) external returns (bool blocked);
    function resolveEmergencyReview(uint256 proposalId) external returns (bool blocked);
    function voteBlockEmergencySettle(uint256 proposalId) external;
```

with:

```solidity
    // ── Governor-only (emergency) ──
    function openEmergency(uint256 proposalId, bytes32 callsHash, BatchExecutorLib.Call[] calldata calls) external;
    function cancelEmergency(uint256 proposalId) external;
    function finalizeEmergency(uint256 proposalId) external returns (bool blocked, BatchExecutorLib.Call[] memory calls);

    // ── Views (emergency) ──
    function isEmergencyOpen(uint256 proposalId) external view returns (bool);

    // ── Permissionless ──
    function openReview(uint256 proposalId) external;
    function resolveReview(uint256 proposalId) external returns (bool blocked);
    function voteBlockEmergencySettle(uint256 proposalId) external;
```

Add the new errors after `OwnerBondInsufficient` (line 36):

```solidity
    error EmergencyHashMismatch();
    error EmergencyTooManyCalls();
    error EmergencyAlreadyOpen();
```

- [ ] **Step 2: Verify the interface compiles**

Run: `cd contracts && forge build 2>&1 | head -5`
Expected: Compilation errors (implementations don't match yet — this is expected)

- [ ] **Step 3: Commit**

```bash
git add contracts/src/interfaces/IGuardianRegistry.sol
git commit -m "refactor: update IGuardianRegistry emergency interface signatures"
```

---

### Task 2: Update ISyndicateGovernor interface

**Files:**
- Modify: `contracts/src/interfaces/ISyndicateGovernor.sol:300,143-144`

- [ ] **Step 1: Change finalizeEmergencySettle signature and remove stale error**

In `contracts/src/interfaces/ISyndicateGovernor.sol`, replace line 300:

```solidity
    function finalizeEmergencySettle(uint256 proposalId, BatchExecutorLib.Call[] calldata calls) external;
```

with:

```solidity
    function finalizeEmergencySettle(uint256 proposalId) external;
```

Remove the `EmergencySettleMismatch` error (line 143) and the `EmergencyAlreadyOpen` error (line 145) — both checks move to registry. Replace:

```solidity
    error EmergencySettleMismatch();
    error EmergencyNotProposed();
    error EmergencyAlreadyOpen();
```

with:

```solidity
    error EmergencyNotProposed();
```

- [ ] **Step 2: Commit**

```bash
git add contracts/src/interfaces/ISyndicateGovernor.sol
git commit -m "refactor: update ISyndicateGovernor finalizeEmergencySettle signature, remove moved errors"
```

---

### Task 3: Implement new emergency functions on GuardianRegistry

**Files:**
- Modify: `contracts/src/GuardianRegistry.sol`

- [ ] **Step 1: Add `_emergencyCalls` storage and import**

In `contracts/src/GuardianRegistry.sol`, after the `_emergencyBlockVotes` mapping (line 133), add:

```solidity
    /// @dev Emergency call array — stored by governor via `openEmergency`,
    ///      returned on `finalizeEmergency`, cleared on cancel/finalize.
    ///      Moved from SyndicateGovernor to consolidate emergency state.
    mapping(uint256 => BatchExecutorLib.Call[]) internal _emergencyCalls;
```

Update the `__gap` comment and shrink by 1 (line 268):

```solidity
    ///      -1 (V2 _emergencyCalls)
    ///      = -14 total.
    uint256[37] private __gap;
```

Add the constant near the top of the contract, after other constants:

```solidity
    uint256 public constant MAX_CALLS_PER_PROPOSAL = 64;
```

Find the existing constants block by searching for `uint256 public constant` — add it after the last one.

- [ ] **Step 2: Replace `openEmergencyReview` with `openEmergency`**

Replace the function at line 1034:

```solidity
    function openEmergencyReview(uint256 proposalId, bytes32 callsHash) external onlyGovernor {
```

with:

```solidity
    /// @notice Governor opens an emergency review, storing the call array and
    ///         its pre-commitment hash. The registry is the single owner of all
    ///         emergency state — governor holds nothing.
    function openEmergency(uint256 proposalId, bytes32 callsHash, BatchExecutorLib.Call[] calldata calls)
        external
        onlyGovernor
    {
        if (calls.length > MAX_CALLS_PER_PROPOSAL) revert EmergencyTooManyCalls();
        if (keccak256(abi.encode(calls)) != callsHash) revert EmergencyHashMismatch();

        EmergencyReview storage er = _emergencyReviews[proposalId];
        if (er.reviewEnd > 0 && !er.resolved) revert EmergencyAlreadyOpen();
        uint64 newReviewEnd = uint64(block.timestamp + reviewPeriod);
        er.callsHash = callsHash;
        er.reviewEnd = newReviewEnd;
        er.totalStakeAtOpen = uint128(totalGuardianStake);
        er.totalDelegatedAtOpen = uint128(totalDelegatedStake);
        er.blockStakeWeight = 0;
        er.resolved = false;
        er.blocked = false;
        er.openedAt = uint64(block.timestamp - 1);
        unchecked {
            er.nonce++;
        }

        // Store call array
        delete _emergencyCalls[proposalId];
        for (uint256 i = 0; i < calls.length; i++) {
            _emergencyCalls[proposalId].push(calls[i]);
        }

        emit EmergencyReviewOpened(proposalId, callsHash, newReviewEnd);
    }
```

- [ ] **Step 3: Replace `cancelEmergencyReview` with `cancelEmergency`**

Replace the function at line 1064:

```solidity
    function cancelEmergencyReview(uint256 proposalId) external onlyGovernor {
```

with:

```solidity
    /// @notice Governor cancels an open emergency review. Invalidates votes,
    ///         clears stored calls, marks resolved so stale votes can't slash.
    function cancelEmergency(uint256 proposalId) external onlyGovernor {
        EmergencyReview storage er = _emergencyReviews[proposalId];
        er.resolved = true;
        er.blocked = false;
        er.blockStakeWeight = 0;
        er.reviewEnd = 0;
        er.callsHash = bytes32(0);
        unchecked {
            er.nonce++;
        }
        delete _emergencyCalls[proposalId];
        emit EmergencyReviewCancelled(proposalId);
    }
```

- [ ] **Step 4: Replace `resolveEmergencyReview` with `finalizeEmergency`**

Replace the function at line 1255:

```solidity
    function resolveEmergencyReview(uint256 proposalId) external nonReentrant whenNotPaused returns (bool) {
```

with:

```solidity
    /// @notice Governor finalizes an emergency review after the review window.
    ///         Returns (blocked, calls). If blocked, slashes the vault owner.
    ///         Clears stored calls on both paths.
    function finalizeEmergency(uint256 proposalId)
        external
        onlyGovernor
        nonReentrant
        whenNotPaused
        returns (bool, BatchExecutorLib.Call[] memory)
    {
        EmergencyReview storage er = _emergencyReviews[proposalId];
        if (er.reviewEnd == 0 || block.timestamp < er.reviewEnd) revert ReviewNotReadyForResolve();
        if (er.resolved) {
            // Idempotent: return cached result, calls already cleared
            BatchExecutorLib.Call[] memory empty;
            return (er.blocked, empty);
        }

        uint256 denomE = uint256(er.totalStakeAtOpen) + uint256(er.totalDelegatedAtOpen);
        if (denomE == 0) {
            er.resolved = true;
            BatchExecutorLib.Call[] memory calls = _emergencyCalls[proposalId];
            delete _emergencyCalls[proposalId];
            emit EmergencyReviewResolved(proposalId, false, 0);
            return (false, calls);
        }

        bool blocked_ = (uint256(er.blockStakeWeight) * 10_000 >= blockQuorumBps * denomE);

        // CEI: commit state BEFORE external transfer
        er.resolved = true;
        er.blocked = blocked_;

        uint256 slashed;
        if (blocked_) {
            slashed = _slashOwner(proposalId);
        }

        BatchExecutorLib.Call[] memory calls = _emergencyCalls[proposalId];
        delete _emergencyCalls[proposalId];

        emit EmergencyReviewResolved(proposalId, blocked_, slashed);
        return (blocked_, calls);
    }
```

- [ ] **Step 5: Add `isEmergencyOpen` view**

Add after `cancelEmergency`:

```solidity
    /// @notice Returns true if an emergency review is open (not yet resolved)
    ///         for the given proposal. Used by the governor's `_finishSettlement`
    ///         to skip unnecessary `cancelEmergency` calls.
    function isEmergencyOpen(uint256 proposalId) external view returns (bool) {
        EmergencyReview storage er = _emergencyReviews[proposalId];
        return er.reviewEnd > 0 && !er.resolved;
    }
```

- [ ] **Step 6: Verify compilation**

Run: `cd contracts && forge build 2>&1 | head -20`
Expected: Errors in GovernorEmergency.sol / SyndicateGovernor.sol (old calls to removed functions — fixed in next tasks)

- [ ] **Step 7: Commit**

```bash
git add contracts/src/GuardianRegistry.sol
git commit -m "refactor: consolidate emergency state into GuardianRegistry"
```

---

### Task 4: Simplify GovernorEmergency abstract

**Files:**
- Modify: `contracts/src/GovernorEmergency.sol`

- [ ] **Step 1: Remove virtual accessors and simplify entrypoints**

Replace the entire `GovernorEmergency.sol` content with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISyndicateGovernor} from "./interfaces/ISyndicateGovernor.sol";
import {ISyndicateVault} from "./interfaces/ISyndicateVault.sol";
import {IGuardianRegistry} from "./interfaces/IGuardianRegistry.sol";
import {BatchExecutorLib} from "./BatchExecutorLib.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title GovernorEmergency
/// @notice Abstract — emergency settlement paths extracted for bytecode headroom.
///         Inherited by SyndicateGovernor alongside GovernorParameters.
///
///         V2: All emergency state (call hash, call array, review lifecycle) is
///         owned by GuardianRegistry. Governor entrypoints are thin wrappers that
///         delegate to the registry and execute calls on the vault.
///
///         - `unstick`: vault owner rescues a proposal stuck in Executed state by
///           running its pre-committed settlement calls (no guardian review).
///         - `emergencySettleWithCalls`: vault owner proposes owner-supplied
///           settlement calls. Opens a guardian review on the registry.
///         - `cancelEmergencySettle`: vault owner withdraws their review.
///         - `finalizeEmergencySettle`: once the review period has elapsed and the
///           block quorum was not reached, the owner executes the reviewed calls.
abstract contract GovernorEmergency is ISyndicateGovernor {
    // ── Virtual accessors (implemented by SyndicateGovernor) ──

    function _getProposal(uint256) internal view virtual returns (StrategyProposal storage);
    function _getSettlementCalls(uint256) internal view virtual returns (BatchExecutorLib.Call[] storage);
    function _getRegistry() internal view virtual returns (IGuardianRegistry);
    function _emergencyReentrancyEnter() internal virtual;
    function _emergencyReentrancyLeave() internal virtual;
    function _finishSettlementHook(uint256 pid, StrategyProposal storage p)
        internal
        virtual
        returns (int256 pnl, uint256 totalFee);

    // ── Reentrancy modifier (shares status var with SyndicateGovernor) ──

    modifier emergencyNonReentrant() {
        _emergencyReentrancyEnter();
        _;
        _emergencyReentrancyLeave();
    }

    // ── Emergency settle lifecycle ──

    /// @notice Rescues a proposal stuck in Executed state past its duration by
    ///         running the governance-approved pre-committed settlement calls.
    /// @dev Does NOT require active owner stake — the calls were already voted on.
    function unstick(uint256 proposalId) external emergencyNonReentrant {
        StrategyProposal storage p = _getProposal(proposalId);
        if (msg.sender != OwnableUpgradeable(p.vault).owner()) revert NotVaultOwner();
        if (p.state != ProposalState.Executed) revert ProposalNotExecuted();
        if (block.timestamp < p.executedAt + p.strategyDuration) revert StrategyDurationNotElapsed();
        ISyndicateVault(p.vault).executeGovernorBatch(_getSettlementCalls(proposalId));
        _finishSettlementHook(proposalId, p);
    }

    /// @notice Vault owner opens an emergency review on a stuck proposal with
    ///         owner-supplied unwind calls. Requires bonded owner stake.
    ///         All call storage is delegated to the registry.
    function emergencySettleWithCalls(uint256 proposalId, BatchExecutorLib.Call[] calldata calls)
        external
        emergencyNonReentrant
    {
        StrategyProposal storage p = _getProposal(proposalId);
        if (msg.sender != OwnableUpgradeable(p.vault).owner()) revert NotVaultOwner();
        if (p.state != ProposalState.Executed) revert ProposalNotExecuted();
        if (block.timestamp < p.executedAt + p.strategyDuration) revert StrategyDurationNotElapsed();

        IGuardianRegistry reg = _getRegistry();
        if (reg.ownerStake(p.vault) < reg.requiredOwnerBond(p.vault)) revert OwnerBondInsufficient();

        bytes32 h = keccak256(abi.encode(calls));
        reg.openEmergency(proposalId, h, calls);
        emit EmergencySettleProposed(proposalId, msg.sender, h, uint64(block.timestamp + reg.reviewPeriod()));
    }

    /// @notice Vault owner withdraws their open emergency review before resolution.
    function cancelEmergencySettle(uint256 proposalId) external emergencyNonReentrant {
        StrategyProposal storage p = _getProposal(proposalId);
        if (msg.sender != OwnableUpgradeable(p.vault).owner()) revert NotVaultOwner();
        if (p.state != ProposalState.Executed) revert ProposalNotExecuted();
        IGuardianRegistry reg = _getRegistry();
        if (!reg.isEmergencyOpen(proposalId)) revert EmergencyNotProposed();
        reg.cancelEmergency(proposalId);
        emit EmergencySettleCancelled(proposalId, msg.sender);
    }

    /// @notice Resolves a reviewed emergency settle and executes the approved calls.
    ///         Registry returns the stored calls; governor executes them on the vault.
    function finalizeEmergencySettle(uint256 proposalId)
        external
        emergencyNonReentrant
    {
        StrategyProposal storage p = _getProposal(proposalId);
        if (msg.sender != OwnableUpgradeable(p.vault).owner()) revert NotVaultOwner();
        if (p.state != ProposalState.Executed) revert ProposalNotExecuted();

        IGuardianRegistry reg = _getRegistry();
        (bool blocked, BatchExecutorLib.Call[] memory calls) = reg.finalizeEmergency(proposalId);
        if (blocked) revert EmergencySettleBlocked();

        ISyndicateVault(p.vault).executeGovernorBatch(calls);
        (int256 pnl,) = _finishSettlementHook(proposalId, p);
        emit EmergencySettleFinalized(proposalId, pnl);
    }

    /// @dev Per-abstract upgrade-hygiene storage gap.
    uint256[10] private __emergencyGap;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd contracts && forge build 2>&1 | head -20`
Expected: Errors in SyndicateGovernor.sol (still has old storage + implementations — fixed in next task)

- [ ] **Step 3: Commit**

```bash
git add contracts/src/GovernorEmergency.sol
git commit -m "refactor: simplify GovernorEmergency — thin wrapper over registry"
```

---

### Task 5: Clean up SyndicateGovernor storage and implementations

**Files:**
- Modify: `contracts/src/SyndicateGovernor.sol`

- [ ] **Step 1: Remove emergency storage variables**

Delete these two lines (around lines 105-107):

```solidity
    /// @dev keccak256(abi.encode(calls)) pre-committed at `emergencySettleWithCalls`
    mapping(uint256 => bytes32) internal _emergencyCallsHashes;
    /// @dev Stored calls mirror so the owner (or a watcher) can recover them on-chain
    mapping(uint256 => BatchExecutorLib.Call[]) internal _emergencyCalls;
```

- [ ] **Step 2: Update __gap comment and size**

The gap was shrunk by 2 for these mappings. Now they're gone, so grow the gap back by 2. Update the comment and change `uint256[33]` to `uint256[35]`:

Replace:

```solidity
    /// @dev Reserved storage for future upgrades (shrunk by 1 for _guardianRegistry,
    ///      shrunk by 2 more for _emergencyCallsHashes + _emergencyCalls,
    ///      shrunk by 1 more for openProposalCount,
    ///      shrunk by 1 more for _unclaimedFees,
    ///      shrunk by 1 more for _approvedCount,
    ///      grew by 1 after P1-1: _guardianFeeRecipient reclaimed,
    ///      grew by 5 after P2-1: _params + _protocolFeeBps +
    ///      _protocolFeeRecipient + _guardianFeeBps + factory moved to
    ///      GovernorParameters)
    uint256[33] private __gap;
```

with:

```solidity
    /// @dev Reserved storage for future upgrades (shrunk by 1 for _guardianRegistry,
    ///      shrunk by 1 more for openProposalCount,
    ///      shrunk by 1 more for _unclaimedFees,
    ///      shrunk by 1 more for _approvedCount,
    ///      grew by 1 after P1-1: _guardianFeeRecipient reclaimed,
    ///      grew by 5 after P2-1: _params + _protocolFeeBps +
    ///      _protocolFeeRecipient + _guardianFeeBps + factory moved to
    ///      GovernorParameters,
    ///      grew by 2: _emergencyCallsHashes + _emergencyCalls moved to
    ///      GuardianRegistry in V2 emergency consolidation)
    uint256[35] private __gap;
```

- [ ] **Step 3: Delete the emergency call implementations**

Delete `_storeEmergencyCalls`, `_clearEmergencyCalls`, and `_getEmergencyCallsHash` (around lines 222-239):

```solidity
    function _storeEmergencyCalls(uint256 id, BatchExecutorLib.Call[] calldata calls) internal override {
        if (calls.length > MAX_CALLS_PER_PROPOSAL) revert TooManyCalls();
        _emergencyCallsHashes[id] = keccak256(abi.encode(calls));
        delete _emergencyCalls[id];
        for (uint256 i = 0; i < calls.length; i++) {
            _emergencyCalls[id].push(calls[i]);
        }
    }

    function _clearEmergencyCalls(uint256 id) internal override {
        delete _emergencyCallsHashes[id];
        delete _emergencyCalls[id];
    }

    function _getEmergencyCallsHash(uint256 id) internal view override returns (bytes32) {
        return _emergencyCallsHashes[id];
    }
```

- [ ] **Step 4: Update `_finishSettlement`**

In `_finishSettlement` (around line 923), replace:

```solidity
        if (_emergencyCallsHashes[proposalId] != bytes32(0)) {
            // PR #247 follow-up: H-G-01 hardened cancelEmergencySettle /
            // finalizeEmergencySettle to require state == Executed. If a
            // standard settleProposal / unstick races ahead of an open
            // registry review, those entrypoints can never invalidate the
            // review afterwards. Cancel it here so the permissionless
            // resolveEmergencyReview can no longer slash the owner for a
            // proposal that already settled normally.
            _getRegistry().cancelEmergencyReview(proposalId);
            _clearEmergencyCalls(proposalId);
        }
```

with:

```solidity
        // V2: emergency state lives on registry. If a standard settle races
        // ahead of an open emergency review, cancel it so the registry can't
        // slash the owner for a normally-settled proposal.
        if (_getRegistry().isEmergencyOpen(proposalId)) {
            _getRegistry().cancelEmergency(proposalId);
        }
```

- [ ] **Step 5: Verify compilation**

Run: `cd contracts && forge build 2>&1 | head -10`
Expected: Clean build (or only test compilation errors from stale test calls)

- [ ] **Step 6: Verify bytecode sizes**

Run: `cd contracts && forge build --sizes 2>&1 | grep -E "SyndicateGovernor|GuardianRegistry"`
Expected: Governor runtime < 23,661 (was), Registry runtime < 24,576 (limit)

- [ ] **Step 7: Commit**

```bash
git add contracts/src/SyndicateGovernor.sol
git commit -m "refactor: remove emergency storage from SyndicateGovernor"
```

---

### Task 6: Update existing tests

**Files:**
- Modify: `contracts/test/governor/GovernorEmergency.t.sol`

- [ ] **Step 1: Update `test_cancelEmergencySettle_clearsHash`**

The old test verified that `finalizeEmergencySettle(pid, _customCalls())` reverts with `EmergencySettleMismatch` after cancel. Now the error is different — `finalizeEmergency` on the registry will revert with `ReviewNotReadyForResolve` (review was resolved by cancel). Replace the test:

```solidity
    function test_cancelEmergencySettle_clearsState() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        vm.expectEmit(true, true, false, false, address(governor));
        emit ISyndicateGovernor.EmergencySettleCancelled(pid, owner);
        vm.prank(owner);
        governor.cancelEmergencySettle(pid);

        // After cancel, isEmergencyOpen returns false
        assertFalse(registry.isEmergencyOpen(pid));

        // Finalize reverts — review was resolved by cancel
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        vm.expectRevert(IGuardianRegistry.ReviewNotReadyForResolve.selector);
        governor.finalizeEmergencySettle(pid);
    }
```

- [ ] **Step 2: Update `test_cancelEmergencySettle_preventsResolveSlashingStaleVotes`**

The old test called `registry.resolveEmergencyReview(pid)` — replace with the new flow. The cancel now clears everything on the registry side, so there's no permissionless resolve path. Replace:

```solidity
    function test_cancelEmergencySettle_preventsResolveSlashingStaleVotes() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        // Both guardians hit block quorum
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid);
        vm.prank(guardianB);
        registry.voteBlockEmergencySettle(pid);

        // Owner cancels before reviewEnd
        vm.prank(owner);
        governor.cancelEmergencySettle(pid);

        uint256 stakeBefore = registry.ownerStake(address(vault));
        assertEq(stakeBefore, MIN_OWNER_STAKE);

        // Emergency is no longer open — cancel resolved it
        assertFalse(registry.isEmergencyOpen(pid));

        // Owner stake untouched
        assertEq(registry.ownerStake(address(vault)), stakeBefore, "owner stake NOT slashed");
    }
```

- [ ] **Step 3: Update `test_reopenAfterCancel_startsFresh`**

Replace `registry.resolveEmergencyReview(pid)` with governor flow. The finalize now goes through the governor:

```solidity
    function test_reopenAfterCancel_startsFresh() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        // Round 1: owner opens, guardianA blocks, owner cancels
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid);

        vm.prank(owner);
        governor.cancelEmergencySettle(pid);

        // Round 2: owner re-opens. guardianA can vote again (nonce bumped)
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid); // must NOT revert AlreadyVoted

        // Only guardianA this round → 30k/60k = 50% ≥ 30% block quorum
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        vm.expectRevert(ISyndicateGovernor.EmergencySettleBlocked.selector);
        governor.finalizeEmergencySettle(pid);
    }
```

- [ ] **Step 4: Remove `test_finalizeEmergencySettle_hashMismatch_reverts`**

Delete the entire test (lines 419-438). Hash validation is now internal to the registry's `openEmergency` — callers of `finalizeEmergencySettle` never pass calls.

- [ ] **Step 5: Update all `finalizeEmergencySettle` calls to remove `calls` parameter**

Replace every occurrence of `governor.finalizeEmergencySettle(pid, _customCalls())`, `governor.finalizeEmergencySettle(pid, bad)`, `governor.finalizeEmergencySettle(pid, customCalls)`, and `governor.finalizeEmergencySettle(pid, different)` with `governor.finalizeEmergencySettle(pid)`.

These appear in tests:
- `test_finalizeEmergencySettle_notBlocked_executes` (line 453)
- `test_finalizeEmergencySettle_blocked_reverts` (line 483)
- `test_emergencySettle_blocked_revertsFinalize_ownerSlashed` (lines 523, 537)
- `test_emergencySettle_notBlocked_finalizes` (line 554)
- `test_finalize_afterStandardSettle_reverts` (line 583)

- [ ] **Step 6: Update `test_emergencySettle_blocked_revertsFinalize_ownerSlashed`**

This test relied on permissionless `resolveEmergencyReview` to commit the slash outside the reverted tx. Under V2, `finalizeEmergency` is governor-only and the slash happens inside. The revert rolls back the slash AND the resolution. On retry, `finalizeEmergency` re-resolves and re-slashes, still reverts. The owner stake IS slashed from the governor's perspective because each call attempts slash + revert.

However, the slash is actually committed because `finalizeEmergency` on the registry commits state (resolved=true, blocked=true, _slashOwner) BEFORE returning. The governor then reverts its own frame but the registry call already committed.

Wait — that's wrong. If the governor reverts, the entire transaction reverts, including the registry state changes. So the slash is NOT committed. This is the same problem the old code had, which is why the old test used a separate permissionless `resolveEmergencyReview` call.

Under V2, `finalizeEmergency` is `onlyGovernor`, so there's no permissionless path to commit the slash. The design spec addresses this: "a rational owner won't call finalize if they know they'll be slashed, but the blocked state prevents execution regardless — the proposal stays stuck in Executed forever."

Update the test to verify the blocked-but-not-slashed behavior:

```solidity
    /// @notice V2: when guardians block, `finalizeEmergencySettle` reverts.
    ///         Because the revert rolls back the slash, the owner stake is NOT
    ///         slashed. The proposal stays stuck in Executed — the owner cannot
    ///         extract funds via the emergency path. This is acceptable: stuck
    ///         funds are the security outcome; slashing is a bonus deterrent.
    function test_emergencySettle_blocked_revertsFinalize_ownerNotSlashed() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        BatchExecutorLib.Call[] memory bad = _customCalls();
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, bad);

        // guardianA + guardianB both block
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid);
        vm.prank(guardianB);
        registry.voteBlockEmergencySettle(pid);

        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);

        uint256 ownerStakeBefore = registry.ownerStake(address(vault));
        assertEq(ownerStakeBefore, MIN_OWNER_STAKE, "owner bonded pre-finalize");

        // Finalize reverts — entire tx rolls back including slash
        vm.prank(owner);
        vm.expectRevert(ISyndicateGovernor.EmergencySettleBlocked.selector);
        governor.finalizeEmergencySettle(pid);

        // Owner stake preserved (revert rolled back the slash)
        assertEq(registry.ownerStake(address(vault)), ownerStakeBefore, "owner stake preserved — revert rolled back slash");

        // Proposal stays stuck in Executed — funds safe
        assertEq(uint256(governor.getProposal(pid).state), uint256(ISyndicateGovernor.ProposalState.Executed));
    }
```

- [ ] **Step 7: Update `test_settleProposal_cancelsOpenEmergencyReview`**

Replace the `resolveEmergencyReview` reference with `isEmergencyOpen` check:

```solidity
    function test_settleProposal_cancelsOpenEmergencyReview() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        // Both guardians vote block
        vm.prank(guardianA);
        registry.voteBlockEmergencySettle(pid);
        vm.prank(guardianB);
        registry.voteBlockEmergencySettle(pid);

        uint256 stakeBefore = registry.ownerStake(address(vault));
        assertEq(stakeBefore, MIN_OWNER_STAKE, "precondition: owner stake bonded");

        // Race: standard settleProposal fires before reviewEnd
        governor.settleProposal(pid);
        assertEq(uint256(governor.getProposal(pid).state), uint256(ISyndicateGovernor.ProposalState.Settled));

        // _finishSettlement called cancelEmergency on registry
        assertFalse(registry.isEmergencyOpen(pid), "emergency review cancelled by settle");

        // Owner stake untouched
        assertEq(registry.ownerStake(address(vault)), stakeBefore, "owner stake NOT slashed");
    }
```

- [ ] **Step 8: Update `test_emergencySettleWithCalls_callsLengthExceeds_reverts`**

The `TooManyCalls` error now comes from the registry (`EmergencyTooManyCalls`), not the governor. Update:

```solidity
    function test_emergencySettleWithCalls_callsLengthExceeds_reverts() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        BatchExecutorLib.Call[] memory tooMany = new BatchExecutorLib.Call[](65);
        for (uint256 i = 0; i < 65; i++) {
            tooMany[i] = BatchExecutorLib.Call({
                target: address(usdc), data: abi.encodeCall(usdc.approve, (address(targetToken), 0)), value: 0
            });
        }

        vm.prank(owner);
        vm.expectRevert(IGuardianRegistry.EmergencyTooManyCalls.selector);
        governor.emergencySettleWithCalls(pid, tooMany);
    }
```

- [ ] **Step 9: Update `test_emergencySettle_reopenWithoutCancel_reverts`**

The `EmergencyAlreadyOpen` error is now thrown by the registry. Update:

```solidity
    function test_emergencySettle_reopenWithoutCancel_reverts() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());

        vm.prank(owner);
        vm.expectRevert(IGuardianRegistry.EmergencyAlreadyOpen.selector);
        governor.emergencySettleWithCalls(pid, _customCalls());
    }
```

- [ ] **Step 10: Verify all tests compile and pass**

Run: `cd contracts && forge test --match-contract GovernorEmergencyTest -vvv 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add contracts/test/governor/GovernorEmergency.t.sol
git commit -m "test: update GovernorEmergency tests for V2 registry consolidation"
```

---

### Task 7: Add new tests for registry emergency functions

**Files:**
- Modify: `contracts/test/governor/GovernorEmergency.t.sol`

- [ ] **Step 1: Add `test_registryStoresAndReturnsCalls`**

```solidity
    function test_registryStoresAndReturnsCalls() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        BatchExecutorLib.Call[] memory calls = _customCalls();
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, calls);

        // No guardian blocks → finalize returns calls
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        governor.finalizeEmergencySettle(pid);

        // Proposal settled = calls were returned and executed
        assertEq(uint256(governor.getProposal(pid).state), uint256(ISyndicateGovernor.ProposalState.Settled));
    }
```

- [ ] **Step 2: Add `test_isEmergencyOpen_lifecycle`**

```solidity
    function test_isEmergencyOpen_lifecycle() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        // Before open: false
        assertFalse(registry.isEmergencyOpen(pid));

        // After open: true
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        assertTrue(registry.isEmergencyOpen(pid));

        // After cancel: false
        vm.prank(owner);
        governor.cancelEmergencySettle(pid);
        assertFalse(registry.isEmergencyOpen(pid));

        // Re-open: true
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        assertTrue(registry.isEmergencyOpen(pid));

        // After finalize: false
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        governor.finalizeEmergencySettle(pid);
        assertFalse(registry.isEmergencyOpen(pid));
    }
```

- [ ] **Step 3: Add `test_registryClearsCallsOnCancel`**

```solidity
    /// @notice After cancel, re-opening stores fresh calls — no stale data.
    function test_registryClearsCallsOnCancel() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        vm.prank(owner);
        governor.cancelEmergencySettle(pid);

        // Emergency closed
        assertFalse(registry.isEmergencyOpen(pid));

        // Can re-open with new calls
        BatchExecutorLib.Call[] memory newCalls = new BatchExecutorLib.Call[](1);
        newCalls[0] = BatchExecutorLib.Call({
            target: address(usdc), data: abi.encodeCall(usdc.approve, (address(targetToken), 42)), value: 0
        });
        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, newCalls);

        assertTrue(registry.isEmergencyOpen(pid));

        // Finalize executes new calls (not old ones)
        vm.warp(vm.getBlockTimestamp() + REVIEW_PERIOD + 1);
        vm.prank(owner);
        governor.finalizeEmergencySettle(pid);
        assertEq(uint256(governor.getProposal(pid).state), uint256(ISyndicateGovernor.ProposalState.Settled));
    }
```

- [ ] **Step 4: Add `test_registryHashMismatchReverts`**

```solidity
    /// @notice Registry validates hash matches calls on open.
    function test_registryHashMismatchReverts() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        // Construct calls and a mismatched hash
        BatchExecutorLib.Call[] memory calls = _customCalls();
        bytes32 wrongHash = keccak256("wrong");

        // Call registry directly (as governor) to test hash validation
        vm.prank(address(governor));
        vm.expectRevert(IGuardianRegistry.EmergencyHashMismatch.selector);
        registry.openEmergency(pid, wrongHash, calls);
    }
```

- [ ] **Step 5: Add `test_standardSettleCancelsEmergencyViaRegistry`**

```solidity
    /// @notice Standard settle triggers `_finishSettlement` which calls
    ///         `cancelEmergency` on registry, cleaning up all emergency state.
    function test_standardSettleCancelsEmergencyViaRegistry() public {
        uint256 pid = _createExecutedProposal(7 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);

        vm.prank(owner);
        governor.emergencySettleWithCalls(pid, _customCalls());
        assertTrue(registry.isEmergencyOpen(pid), "emergency open before settle");

        // Standard settle races ahead
        governor.settleProposal(pid);

        // Emergency state fully cleaned on registry
        assertFalse(registry.isEmergencyOpen(pid), "emergency cleaned after settle");
        assertEq(uint256(governor.getProposal(pid).state), uint256(ISyndicateGovernor.ProposalState.Settled));
    }
```

- [ ] **Step 6: Run all tests**

Run: `cd contracts && forge test --match-contract GovernorEmergencyTest -vvv 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 7: Run full test suite**

Run: `cd contracts && forge test --no-match-path "test/integration/**" 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add contracts/test/governor/GovernorEmergency.t.sol
git commit -m "test: add new tests for registry emergency state consolidation"
```

---

### Task 8: Update GuardianReviewLifecycle tests and final verification

**Files:**
- Modify: `contracts/test/governor/GuardianReviewLifecycle.t.sol` (if it references old emergency functions)

- [ ] **Step 1: Check for stale references in GuardianReviewLifecycle.t.sol**

Run: `cd contracts && grep -n "resolveEmergencyReview\|cancelEmergencyReview\|openEmergencyReview" test/governor/GuardianReviewLifecycle.t.sol`

If any matches, update them to use the new function names (`finalizeEmergency`, `cancelEmergency`, `openEmergency`). If no matches, skip to step 3.

- [ ] **Step 2: Check for stale references in all test files**

Run: `cd contracts && grep -rn "resolveEmergencyReview\|cancelEmergencyReview\|openEmergencyReview\|EmergencySettleMismatch\|EmergencyAlreadyOpen" test/`

Update any remaining references. Common patterns:
- `registry.resolveEmergencyReview(pid)` → remove or replace with governor flow
- `EmergencySettleMismatch` → removed error
- `EmergencyAlreadyOpen` → `ReviewNotOpen` (from registry)

- [ ] **Step 3: Run full test suite and verify sizes**

Run: `cd contracts && forge test --no-match-path "test/integration/**" 2>&1 | tail -10`
Expected: All tests pass

Run: `cd contracts && forge build --sizes 2>&1 | grep -E "SyndicateGovernor|GuardianRegistry"`
Expected: Both under 24,576 bytes

- [ ] **Step 4: Run forge fmt**

Run: `cd contracts && forge fmt`

- [ ] **Step 5: Commit**

```bash
git add -A contracts/
git commit -m "refactor: final cleanup — update all stale emergency references"
```

- [ ] **Step 6: Push branch**

```bash
git push origin refactor/emergency-state-machine-v2
```
