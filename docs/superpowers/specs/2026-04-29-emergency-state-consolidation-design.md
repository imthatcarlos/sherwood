# Emergency State Machine Consolidation — Design Spec

## Motivation

The emergency-settle state machine is split across `SyndicateGovernor` (call hash + call array + entrypoints) and `GuardianRegistry` (review struct + votes + slashing). Every entrypoint that touches the emergency lifecycle must mutate both sides. Miss one, get a race. Four bugs of the same shape have been fixed: stale block-votes surviving cancel-reopen (PR #229), `voteBlockEmergencySettle` reading live stake vs snapshotted denominator, `cancelEmergencySettle` missing precondition (PR #229 review), and dangling-review-on-normal-settle (PR #247). All stem from the same boundary.

**Fix:** Make `GuardianRegistry` the single owner of all emergency state. Governor becomes a thin caller — no emergency storage, no hash validation, no call array.

## Architecture

### What moves to GuardianRegistry

- `_emergencyCallsHashes[pid]` (bytes32 mapping) — already partially there as `EmergencyReview.callsHash`
- `_emergencyCalls[pid]` (Call[] mapping) — full calldata array
- Hash validation (keccak256 match check)
- `MAX_CALLS_PER_PROPOSAL` enforcement
- Storage cleanup on cancel/finalize

### What stays on SyndicateGovernor

- The 3 emergency entrypoints (`emergencySettleWithCalls`, `cancelEmergencySettle`, `finalizeEmergencySettle`) — thin wrappers that validate owner/state then delegate to registry
- `unstick()` — separate code path, no emergency state, no guardian review
- Reentrancy guard (shared across settlement paths)
- Vault batch execution (`vault.executeGovernorBatch`)
- Settlement finalization (`_finishSettlement`)

### Race elimination

The bug class is eliminated by construction: there is no emergency state on the governor to go stale. `_finishSettlement` calls `registry.isEmergencyOpen(pid)` (cheap view) and `registry.cancelEmergency(pid)` which operates on the single source of truth.

## Interface Changes

### GuardianRegistry — new emergency interface

```solidity
// Replaces openEmergencyReview — also stores call array
function openEmergency(uint256 proposalId, bytes32 callsHash, BatchExecutorLib.Call[] calldata calls) external;

// Replaces cancelEmergencyReview — also clears stored calls
function cancelEmergency(uint256 proposalId) external;

// Replaces resolveEmergencyReview — returns calls for governor to execute, clears storage
function finalizeEmergency(uint256 proposalId) external returns (bool blocked, BatchExecutorLib.Call[] memory calls);

// New read-only view — used by _finishSettlement to skip unnecessary cancel calls
function isEmergencyOpen(uint256 proposalId) external view returns (bool);

// Unchanged
function voteBlockEmergencySettle(uint256 proposalId) external;
```

Old functions (`openEmergencyReview`, `cancelEmergencyReview`, `resolveEmergencyReview`) are removed, not aliased.

### SyndicateGovernor — breaking change on finalizeEmergencySettle

```solidity
// OLD: caller passes calls for hash verification
function finalizeEmergencySettle(uint256 proposalId, BatchExecutorLib.Call[] calldata calls) external;

// NEW: registry returns calls, caller no longer passes them
function finalizeEmergencySettle(uint256 proposalId) external;
```

`emergencySettleWithCalls` and `cancelEmergencySettle` signatures are unchanged.

## Registry Implementation Details

### Storage additions

```solidity
// Appended after existing storage (UUPS-safe, __gap shrinks by 1)
mapping(uint256 => BatchExecutorLib.Call[]) internal _emergencyCalls;
```

Import: `BatchExecutorLib` for the `Call` struct type.

### openEmergency

```solidity
function openEmergency(uint256 pid, bytes32 callsHash, BatchExecutorLib.Call[] calldata calls)
    external onlyGovernor
{
    if (calls.length > MAX_CALLS_PER_PROPOSAL) revert TooManyCalls();
    if (keccak256(abi.encode(calls)) != callsHash) revert EmergencyHashMismatch();

    EmergencyReview storage er = _emergencyReviews[pid];
    // ... existing openEmergencyReview body (review struct init, nonce bump, event) ...

    // Store calls
    delete _emergencyCalls[pid];
    for (uint256 i = 0; i < calls.length; i++) {
        _emergencyCalls[pid].push(calls[i]);
    }
}
```

### cancelEmergency

```solidity
function cancelEmergency(uint256 pid) external onlyGovernor {
    // ... existing cancelEmergencyReview body (resolved=true, nonce++, event) ...
    delete _emergencyCalls[pid];
}
```

### finalizeEmergency

```solidity
function finalizeEmergency(uint256 pid)
    external onlyGovernor nonReentrant whenNotPaused
    returns (bool blocked, BatchExecutorLib.Call[] memory calls)
{
    // ... existing resolveEmergencyReview body (time check, quorum check, slash if blocked) ...

    calls = _emergencyCalls[pid];
    delete _emergencyCalls[pid];
    return (blocked, calls);
}
```

Note: `finalizeEmergency` is `onlyGovernor` (not permissionless like the old `resolveEmergencyReview`). The governor is the only consumer of the returned calls. The old permissionless `resolveEmergencyReview` was only useful for keepers to trigger slashing independently — under the new design, slashing only happens when the vault owner calls `finalizeEmergencySettle` on the governor, which delegates to `finalizeEmergency`. This is acceptable: a rational owner won't call finalize if they know they'll be slashed, but the blocked state prevents execution regardless — the proposal stays stuck in `Executed` forever, which is the desired outcome (owner can't extract funds via emergency path).

### isEmergencyOpen

```solidity
function isEmergencyOpen(uint256 pid) external view returns (bool) {
    EmergencyReview storage er = _emergencyReviews[pid];
    return er.reviewEnd > 0 && !er.resolved;
}
```

## Governor Implementation Details

### Removed from GovernorEmergency (abstract)

- Virtual accessor `_getEmergencyCallsHash(uint256)` — deleted
- Virtual method `_storeEmergencyCalls(uint256, Call[])` — deleted
- Virtual method `_clearEmergencyCalls(uint256)` — deleted

### Removed from SyndicateGovernor (concrete)

- `_emergencyCallsHashes` mapping — deleted
- `_emergencyCalls` mapping — deleted
- Implementations of `_storeEmergencyCalls`, `_clearEmergencyCalls`, `_getEmergencyCallsHash` — deleted

### Updated entrypoints in GovernorEmergency

**emergencySettleWithCalls(pid, calls):**
```solidity
// validate owner, state == Executed, duration elapsed, bond sufficient (unchanged)
bytes32 h = keccak256(abi.encode(calls));
reg.openEmergency(pid, h, calls);
emit EmergencySettleProposed(pid, owner, h, reviewEnd);
```

**cancelEmergencySettle(pid):**
```solidity
// validate owner, state == Executed (unchanged)
// OLD: checked _getEmergencyCallsHash(pid) != bytes32(0)
// NEW: check registry
if (!reg.isEmergencyOpen(pid)) revert EmergencyNotProposed();
reg.cancelEmergency(pid);
emit EmergencySettleCancelled(pid, owner);
```

**finalizeEmergencySettle(pid):** (signature change — no `calls` param)
```solidity
// validate owner, state == Executed (unchanged)
// OLD: hash match check + resolveEmergencyReview + execute + clear
// NEW: single registry call returns everything
(bool blocked, BatchExecutorLib.Call[] memory calls) = reg.finalizeEmergency(pid);
if (blocked) revert EmergencySettleBlocked();
ISyndicateVault(p.vault).executeGovernorBatch(calls);
_finishSettlementHook(pid, p);
emit EmergencySettleFinalized(pid, pnl);
```

### Updated _finishSettlement in SyndicateGovernor

```solidity
// OLD:
if (_emergencyCallsHashes[proposalId] != bytes32(0)) {
    _getRegistry().cancelEmergencyReview(proposalId);
    _clearEmergencyCalls(proposalId);
}

// NEW:
if (_getRegistry().isEmergencyOpen(proposalId)) {
    _getRegistry().cancelEmergency(proposalId);
}
```

## Bytecode Impact

| Contract | Before | After (est.) | Margin |
|---|---|---|---|
| SyndicateGovernor | 23,661 | ~23,350 | ~1,226 |
| GuardianRegistry | 23,271 | ~23,520 | ~1,056 |

Governor loses ~300 bytes (2 mappings, 3 internal functions, hash validation logic). Registry gains ~250 bytes (Call[] storage, isEmergencyOpen view, return logic in finalizeEmergency). Both stay comfortably within EIP-170.

## Testing

### Existing tests to update (not rewrite)

**GovernorEmergency.t.sol** (19 tests):
- `finalizeEmergencySettle` calls lose the `calls` parameter (signature change)
- `test_finalizeEmergencySettle_hashMismatch_reverts` — removed (caller no longer passes calls; hash validation is internal to registry)
- All other tests: same lifecycle scenarios, updated call signatures

**GuardianReviewLifecycle.t.sol** (8 tests):
- Minor call signature updates, same scenarios

### New tests

1. **Registry stores and returns calls correctly** — `openEmergency` with N calls, `finalizeEmergency` returns identical calls
2. **Registry clears calls on cancel** — `cancelEmergency` deletes stored calls
3. **Registry clears calls on finalize** — second `finalizeEmergency` returns empty / reverts
4. **isEmergencyOpen lifecycle** — false before open, true after open, false after cancel, false after finalize
5. **Standard settle cancels emergency via registry** — `settleProposal` triggers `_finishSettlement` which calls `cancelEmergency`, registry state is clean
6. **MAX_CALLS_PER_PROPOSAL validated on registry** — `openEmergency` with 11 calls reverts `TooManyCalls`
7. **Hash mismatch on registry** — `openEmergency` with calls that don't match provided hash reverts `EmergencyHashMismatch`

### Invariants

No new invariant tests needed. Existing WOOD conservation invariant still covers slashing (mechanics unchanged, just storage location).

## Migration

V1.5 is a fresh mainnet deployment — proxies start zeroed. No storage migration needed. The old `resolveEmergencyReview` (permissionless) is removed; keepers that called it directly will need to go through the governor's `finalizeEmergencySettle` instead.

## Out of scope

- Moving `unstick()` to registry (separate code path, no emergency state)
- Changing vault trust model (governor remains only authorized executor)
- Changing slashing mechanics (same quorum, same burn)
- Changing vote mechanics (`voteBlockEmergencySettle` unchanged)
