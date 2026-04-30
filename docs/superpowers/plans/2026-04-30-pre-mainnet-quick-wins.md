# Pre-mainnet Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all small, independently-shippable pre-mainnet items from issue #255 — file hygiene, CI gates, code consolidation, two protocol-core deferred test items, and Create3 regression coverage — in a single coordinated branch, then PR.

**Architecture:** Six tracks. Track A1 lands first (sequential — touches `SyndicateGovernor.sol`, `GuardianRegistry.sol`, both bytecode-tight). Track A2 runs immediately after A1 (also touches `SyndicateGovernor.sol`). Tracks B–F then fan out as parallel subagents on disjoint file sets per CLAUDE.md's parallel-write-disjointness mandate (two prior 25-minute stalls came from overlapping write sets).

**Tech Stack:** Solidity 0.8.28, Foundry (forge build/test/coverage/fmt), OpenZeppelin v5, GitHub Actions CI.

**Branch:** `feat/pre-mainnet-quick-wins` (already created on `main`).

**Source issue:** https://github.com/sherwoodagent/sherwood/issues/255

---

## Out of scope

The following from #255 are **deliberately deferred** and must NOT be touched in this plan:

- **§6 Pausable posture** — three of four target contracts (`FeeDistributor`, `BootstrapRewards`, `BuybackEngine`) don't exist yet. Blocked on §9.
- **§9 v4 tokenomics redesign** — multi-week project (delete 7 contracts, write 3 new per `docs/tokenomics-wood.md`). Needs its own brainstorm → spec → plan flow.
- **§7 INV-15** vault solvency invariant — needs full lifecycle handler with real ERC-4626 transitions; deserves a dedicated plan.
- **§7 EAS `STRATEGY_PNL` attestation (A23)** — small but needs schema registration coordination with multisig owner; better as a separate quick PR.
- **§7 Correct-Approve guardian rewards** — design unsettled per #226.
- **§7 Shareholder challenge (Option C)** — explicitly "not specced" in #226.
- **§7 Minter→`fundEpoch` wiring** — `Minter.sol` is deleted in v4; drop entirely (also remove the row from #255).

## Scope adjustments from research

These were on the original #255 list but research showed they're already addressed in code:

- **§1 `MockSwapAdapter.sol`** — already at `contracts/test/mocks/MockSwapAdapter.sol`. Issue text was stale. Track B drops this and only moves `CoreWriter.sol`.
- **§11 A-C1 `Create3Factory.deploy` permissionless** — closed at `Create3Factory.sol:17` (`Ownable` + `onlyOwner`). Track E only adds regression tests + updates issue.
- **§11 A-C4 silent CREATE failure** — closed at `Create3.sol:37` (`if (!success || deployed.code.length == 0) revert DeployFailed();`). Track E only adds regression test + updates issue.
- **§3 CI size gate for `GuardianRegistry`** — already in place at `.github/workflows/contracts.yml:50-58`. Track F only extends to vault + factory.

---

## Track ordering & parallelism map

```
Phase 1 (sequential):
  Track A1 — Constants library (touches SyndicateGovernor, GuardianRegistry, SyndicateFactory)
       │
       ▼
Phase 2 (sequential):
  Track A2 — forge coverage stack-too-deep fix (touches SyndicateGovernor)
       │
       ▼
Phase 3 (parallel — disjoint write sets, dispatch in one message):
  ┌─── Track B — Move CoreWriter.sol → test/mocks/
  ├─── Track C — G-H5 executeBy boundary test
  ├─── Track D — INV-47 fee-blacklist fuzz harness
  ├─── Track E — Create3 regression tests + #255 admin
  └─── Track F — Vault/Factory size gates + MAX_MANAGEMENT_FEE_BPS

Phase 4 (sequential):
  Track G — Final integration: forge test full + sizes report + PR
```

**Why A1 first:** A2's coverage fix re-flows local variables in `propose()`. If Track 1 (constants) runs after, the `BPS_DENOMINATOR` rename inside the modified function will land on already-rewritten lines and create merge conflicts. Land A1 first, A2 rebases on it.

**Why B–F parallel:** Each writes to a disjoint file set. Verify no overlap before dispatch:

| Track | Writes |
|---|---|
| B | `contracts/test/mocks/CoreWriter.sol` (new), delete `contracts/src/hyperliquid/CoreWriter.sol`, `contracts/test/hyperliquid/*` (import path updates only) |
| C | `contracts/test/governor/ExecuteByBoundary.t.sol` (new) |
| D | `contracts/test/invariants/FeeBlacklistInvariant.t.sol` (new), `contracts/test/invariants/handlers/FeeBlacklistHandler.sol` (new) |
| E | `contracts/test/Create3Factory.t.sol` (new), `contracts/test/Create3.t.sol` (new), `gh issue edit 255` |
| F | `.github/workflows/contracts.yml`, `contracts/src/SyndicateFactory.sol` |

No overlaps. Safe to fan out.

---

## Track A1 — Constants library

Replace bare `10000` / `10_000` / `1000` literals in surviving v4 protocol-core contracts with named constants. Skip Voter / VoteIncentive / Minter / SyndicateGauge — they're deleted in v4 (per `docs/tokenomics-wood.md`); changing their literals is wasted work.

**Files:**
- Modify: `contracts/src/GovernorParameters.sol` — add `BPS_DENOMINATOR` constant
- Modify: `contracts/src/SyndicateGovernor.sol:836, 942, 958, 983, 986, 1016` — replace `10000` literals
- Modify: `contracts/src/GuardianRegistry.sol:640, 827, 1440` — add `BPS_DENOMINATOR` constant + replace `10_000` literals
- Modify: `contracts/src/SyndicateFactory.sol:197` — add `MAX_MANAGEMENT_FEE_BPS` constant + replace `1000` literal

### Task A1.1 — Add `BPS_DENOMINATOR` to `GovernorParameters.sol`

- [ ] **Step 1: Read the existing constants block**

Run: `grep -n "uint256 public constant\|uint256 internal constant" contracts/src/GovernorParameters.sol`

Expected output: list including `MAX_PROTOCOL_FEE_BPS = 1000` at line 39.

- [ ] **Step 2: Add `BPS_DENOMINATOR` constant**

Edit `contracts/src/GovernorParameters.sol`. Find the line:

```solidity
uint256 public constant MAX_PROTOCOL_FEE_BPS = 1000; // 10%
```

Add immediately above it:

```solidity
/// @notice 100% in basis points. Centralized so SyndicateGovernor and
///         GuardianRegistry both reference one constant.
uint256 public constant BPS_DENOMINATOR = 10_000;
```

- [ ] **Step 3: Verify build still compiles + bytecode unchanged**

Run: `forge build --sizes`
Expected: `SyndicateGovernor` runtime size unchanged from previous commit (24,244 bytes ± 0).

If size changed by >0, the constant introduction wasn't inlined — investigate with `forge inspect SyndicateGovernor bytecode | head -c 500`.

### Task A1.2 — Replace `10000` literals in `SyndicateGovernor.sol`

- [ ] **Step 1: Replace all 6 occurrences**

Edit `contracts/src/SyndicateGovernor.sol`. Six lines need updating:

```
Line 836: / 10000  →  / BPS_DENOMINATOR
Line 942: / 10000  →  / BPS_DENOMINATOR
Line 958: / 10000  →  / BPS_DENOMINATOR
Line 983: / 10000  →  / BPS_DENOMINATOR
Line 986: / 10000  →  / BPS_DENOMINATOR
Line 1016: / 10000  →  / BPS_DENOMINATOR
```

`SyndicateGovernor` inherits `GovernorParameters` so the constant is in scope.

- [ ] **Step 2: Verify build**

Run: `forge build --sizes 2>&1 | grep SyndicateGovernor`
Expected: runtime size unchanged (24,244 bytes ± 0).

- [ ] **Step 3: Run governor tests**

Run: `forge test --match-path "test/governor/**" --no-match-path "test/integration/**" -v`
Expected: all pass.

- [ ] **Step 4: Verify no remaining literal `10000` in governor**

Run: `grep -nE "/ ?10000|10000 ?\)" contracts/src/SyndicateGovernor.sol`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/GovernorParameters.sol contracts/src/SyndicateGovernor.sol
git commit -m "refactor(governor): extract BPS_DENOMINATOR constant"
```

### Task A1.3 — Add `BPS_DENOMINATOR` to `GuardianRegistry.sol` + replace literals

- [ ] **Step 1: Add constant to GuardianRegistry**

Edit `contracts/src/GuardianRegistry.sol`. Find the constants block (search `uint256 public constant` near top of contract). Add at the top of that block:

```solidity
/// @notice 100% in basis points.
uint256 public constant BPS_DENOMINATOR = 10_000;
```

- [ ] **Step 2: Replace `10_000` literals**

Three sites:

```
Line 640: / 10_000  →  / BPS_DENOMINATOR
Line 827: / 10_000  →  / BPS_DENOMINATOR
Line 1440: / 10_000  →  / BPS_DENOMINATOR
```

- [ ] **Step 3: Verify build + bytecode**

Run: `forge build --sizes 2>&1 | grep GuardianRegistry`
Expected: runtime size unchanged (24,306 bytes ± 0). 270-byte EIP-170 margin must be preserved.

- [ ] **Step 4: Run registry tests**

Run: `forge test --match-path "test/GuardianRegistry*.t.sol" --no-match-path "test/integration/**" -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/GuardianRegistry.sol
git commit -m "refactor(registry): extract BPS_DENOMINATOR constant"
```

### Task A1.4 — Add `MAX_MANAGEMENT_FEE_BPS` to `SyndicateFactory.sol`

- [ ] **Step 1: Read the validation site**

```bash
sed -n '190,200p' contracts/src/SyndicateFactory.sol
```

- [ ] **Step 2: Add constant + replace literal**

Edit `contracts/src/SyndicateFactory.sol`. Find a constants block near the top of the contract (or the first `uint256` constant), and add:

```solidity
/// @notice Maximum management fee a vault owner may charge (10% of post-strategy net).
uint256 public constant MAX_MANAGEMENT_FEE_BPS = 1000;
```

Then change line 197 from:

```solidity
if (p.managementFeeBps > 1000) revert ManagementFeeTooHigh();
```

to:

```solidity
if (p.managementFeeBps > MAX_MANAGEMENT_FEE_BPS) revert ManagementFeeTooHigh();
```

- [ ] **Step 3: Verify build + tests**

Run: `forge build --sizes 2>&1 | grep SyndicateFactory && forge test --match-path "test/SyndicateFactory*.t.sol" -v`
Expected: build OK; tests pass.

- [ ] **Step 4: Commit**

```bash
git add contracts/src/SyndicateFactory.sol
git commit -m "refactor(factory): extract MAX_MANAGEMENT_FEE_BPS constant"
```

---

## Track A2 — `forge coverage` stack-too-deep fix

`forge coverage` runs without optimizer/viaIR (cite the warning). Currently fails at `SyndicateGovernor.sol:294` (`++openProposalCount[vault]`). The `propose()` function's non-collaborative branch sets 6 storage fields + an enum + a counter increment, which exceeds Yul's stack budget under no-optimizer.

**Fix strategy:** extract the non-collaborative initialization into a private helper. PR #229 already used the "sequential field assignments" pattern at lines 270–275 to dodge a different stack-too-deep; this is the same medicine.

**Files:**
- Modify: `contracts/src/SyndicateGovernor.sol:280-296`

### Task A2.1 — Extract `_initPendingProposal` helper

- [ ] **Step 1: Read the current branch**

```bash
sed -n '270,310p' contracts/src/SyndicateGovernor.sol
```

- [ ] **Step 2: Replace the if/else branch with a helper call**

Find:

```solidity
        if (isCollaborative) {
            p.state = ProposalState.Draft;
        } else {
            // -1 closes the same-block flash-delegate window (G-C1).
            p.snapshotTimestamp = block.timestamp - 1;
            p.voteEnd = block.timestamp + _params.votingPeriod;
            p.reviewEnd = p.voteEnd + reviewPeriod_;
            p.executeBy = p.reviewEnd + _params.executionWindow;
            p.state = ProposalState.Pending;
            // G-H6: snapshot vetoThresholdBps so a mid-vote timelock finalize
            // can't retroactively move the threshold for this proposal.
            p.vetoThresholdBps = _params.vetoThresholdBps;
            // Draft doesn't count (not binding on the vault); Pending does.
            unchecked {
                ++openProposalCount[vault];
            }
        }
```

Replace with:

```solidity
        if (isCollaborative) {
            p.state = ProposalState.Draft;
        } else {
            _initPendingProposal(p, vault, reviewPeriod_);
        }
```

- [ ] **Step 3: Add the helper function**

Add this private helper anywhere appropriate within the contract (suggest: immediately after `propose()` ends, near other `_storeXxx` helpers around line 309–320):

```solidity
    /// @dev Hoisted out of `propose` to keep that function under Yul's
    ///      stack budget when `forge coverage` runs (optimizer + viaIR off).
    function _initPendingProposal(StrategyProposal storage p, address vault, uint256 reviewPeriod_) private {
        // -1 closes the same-block flash-delegate window (G-C1).
        p.snapshotTimestamp = block.timestamp - 1;
        p.voteEnd = block.timestamp + _params.votingPeriod;
        p.reviewEnd = p.voteEnd + reviewPeriod_;
        p.executeBy = p.reviewEnd + _params.executionWindow;
        p.state = ProposalState.Pending;
        // G-H6: snapshot vetoThresholdBps so a mid-vote timelock finalize
        // can't retroactively move the threshold for this proposal.
        p.vetoThresholdBps = _params.vetoThresholdBps;
        // Draft doesn't count (not binding on the vault); Pending does.
        unchecked {
            ++openProposalCount[vault];
        }
    }
```

- [ ] **Step 4: Verify bytecode delta**

Run: `forge build --sizes 2>&1 | grep SyndicateGovernor`
Expected: runtime size delta ≤ +20 bytes (helper adds a small jump but avoids inline duplication; via_ir often inlines it back). Margin must remain positive (>0 bytes under 24,576).

If the size grew by >50 bytes (suggesting via_ir didn't inline), revert and use a different approach: factor `block.timestamp - 1` and `_params.votingPeriod` into local variables first to relieve stack pressure without a function call.

- [ ] **Step 5: Verify forge coverage now compiles**

Run: `timeout 180 forge coverage --no-match-path "test/integration/**" 2>&1 | tail -5`
Expected: coverage starts running (no "Stack too deep" error). Don't wait for full coverage to finish — just verify compile succeeds.

- [ ] **Step 6: Run all governor tests to verify behavior unchanged**

Run: `forge test --match-path "test/governor/**" --no-match-path "test/integration/**" -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add contracts/src/SyndicateGovernor.sol
git commit -m "refactor(governor): extract _initPendingProposal to fix forge coverage stack-too-deep"
```

---

## Track B — Move `CoreWriter.sol` → `test/mocks/`

`contracts/src/hyperliquid/CoreWriter.sol` is labeled "do not deploy" in a comment but lives in `src/`. A glob in a deploy script could accidentally include it. A real mock already exists in `test/mocks/`; the in-`src/` copy must move.

**Files:**
- Create: `contracts/test/mocks/hyperliquid/CoreWriter.sol` (or merge into existing test mock if compatible)
- Delete: `contracts/src/hyperliquid/CoreWriter.sol`
- Modify: any test file that imports `src/hyperliquid/CoreWriter.sol` (update path)

### Task B.1 — Verify and move

- [ ] **Step 1: Find all importers of `src/hyperliquid/CoreWriter`**

Run: `grep -rn "hyperliquid/CoreWriter" contracts/`
Expected: list of importing files. All should be in `contracts/test/`.

- [ ] **Step 2: Compare with existing test mock**

```bash
diff contracts/src/hyperliquid/CoreWriter.sol contracts/test/mocks/MockCoreWriter.sol 2>&1 | head -40
```

If the test/mocks/ copy already exposes the same surface — delete the src/ copy and update importers to use the existing mock.
If the src/ copy is different — move it to `test/mocks/hyperliquid/CoreWriter.sol`.

- [ ] **Step 3: Move the file (assuming distinct content)**

```bash
mkdir -p contracts/test/mocks/hyperliquid
git mv contracts/src/hyperliquid/CoreWriter.sol contracts/test/mocks/hyperliquid/CoreWriter.sol
```

- [ ] **Step 4: Update import paths in all importing test files**

For each file from Step 1, update the import. Pattern:

Before:
```solidity
import {CoreWriter} from "../../src/hyperliquid/CoreWriter.sol";
```

After:
```solidity
import {CoreWriter} from "../mocks/hyperliquid/CoreWriter.sol";
```

The exact relative path depends on where the test file lives.

- [ ] **Step 5: Verify build + tests still work**

Run: `forge build && forge test --match-path "test/**Hyperliquid**" --no-match-path "test/integration/**" -v`
Expected: build OK; tests pass.

- [ ] **Step 6: Verify no `src/` references to CoreWriter remain**

Run: `grep -rn "src/hyperliquid/CoreWriter" contracts/`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add contracts/src/hyperliquid/CoreWriter.sol contracts/test/mocks/hyperliquid/CoreWriter.sol contracts/test/
git commit -m "refactor(test): move CoreWriter mock from src/ to test/mocks/"
```

---

## Track C — G-H5 boundary test for `executeProposal` at `executeBy`

#236 leaves G-H5 open: explicit boundary test for `executeProposal` at the `executeBy` deadline. The behavior should be: at `block.timestamp == executeBy`, execution is permitted; at `block.timestamp == executeBy + 1`, execution reverts as `ProposalExpired` (or similar).

**Files:**
- Create: `contracts/test/governor/ExecuteByBoundary.t.sol`

### Task C.1 — Read execute logic to know exact revert symbol

- [ ] **Step 1: Find `executeBy` checks**

Run: `grep -n "executeBy\|ProposalExpired\|Expired" contracts/src/SyndicateGovernor.sol | head -10`

Note the exact comparison (`>` vs `>=`) and the revert custom error name. The test must assert against the actual error.

### Task C.2 — Write the boundary test

- [ ] **Step 1: Write the failing test**

Create `contracts/test/governor/ExecuteByBoundary.t.sol`. The test setup should mirror the existing governor test pattern — use the helpers from `test/governor/Helpers.sol` if present, otherwise copy the proxy bootstrapping from `test/governor/SyndicateGovernor.t.sol` (read it first to find the canonical setup).

Test cases (3 minimum):

```solidity
function test_executeProposal_atExecuteByBoundary_succeeds() public {
    // Set up Approved proposal with executeBy = T.
    // vm.warp(T);
    // governor.executeProposal(proposalId);
    // assertEq(uint8(proposal.state), uint8(ProposalState.Executed));
}

function test_executeProposal_oneSecondAfterExecuteBy_reverts() public {
    // Set up Approved proposal with executeBy = T.
    // vm.warp(T + 1);
    // vm.expectRevert(<exact error from Step 1 above>);
    // governor.executeProposal(proposalId);
}

function test_executeProposal_oneSecondBeforeExecuteBy_succeeds() public {
    // Sanity: executable just before the deadline.
    // vm.warp(T - 1);
    // governor.executeProposal(proposalId);
}
```

Use `vm.getBlockTimestamp()` at every read site (per CLAUDE.md: via_ir reorders `block.timestamp` reads across `vm.warp`).

- [ ] **Step 2: Verify the tests fail in expected way (sanity — boundary-1 + boundary-3 must pass; boundary-2 must revert with the right error)**

Run: `forge test --match-path "test/governor/ExecuteByBoundary.t.sol" -vv`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add contracts/test/governor/ExecuteByBoundary.t.sol
git commit -m "test(governor): pin executeBy boundary behavior (G-H5)"
```

---

## Track D — INV-47 fee-blacklist invariant fuzz harness

#236 has INV-47 deferred (unit test exists at `FeeBlacklistResilience.t.sol`; fuzz harness needed). Property: `_distributeFees` never reverts due to a blacklisted recipient — the failing transfer escrows into `_unclaimedFees` instead of bricking settlement.

**Files:**
- Create: `contracts/test/invariants/FeeBlacklistInvariant.t.sol` (the harness)
- Create: `contracts/test/invariants/handlers/FeeBlacklistHandler.sol` (the random-action driver)

Reuse the pattern from PR #229's invariant harness (find with: `find contracts/test/invariants -name "*.sol"`).

### Task D.1 — Read the existing invariant harness

- [ ] **Step 1: Find the existing invariant test**

Run: `find contracts/test/invariants -name "*.sol" | head; ls contracts/test/invariants/`
Expected: directory exists with at least one `*.t.sol` and at least one handler. If none exists, see PR #229 commit `bf0e4cd` for the pattern.

- [ ] **Step 2: Read FeeBlacklistResilience.t.sol for the unit pattern**

Run: `wc -l contracts/test/governor/FeeBlacklistResilience.t.sol; head -80 contracts/test/governor/FeeBlacklistResilience.t.sol`

Note the blacklisting mock (likely a `BlacklistableERC20Mock` that lets the test set blacklist status mid-test) and the assertion shape.

### Task D.2 — Write the handler

- [ ] **Step 1: Create the handler**

Create `contracts/test/invariants/handlers/FeeBlacklistHandler.sol`. The handler exposes 3–5 random-action functions that the invariant fuzzer calls in random order:

- `blacklistRandomRecipient(uint256 seed)` — toggles blacklist status for one of the fee recipients (lead proposer, co-proposers, vault owner, protocol-fee recipient).
- `unblacklistRecipient(uint256 seed)` — undoes the above.
- `runProposalLifecycle(uint256 seed)` — propose → vote → execute → settle. Must not revert just because a recipient is blacklisted.
- `claimUnclaimedFees(uint256 seed)` — recipient calls `claimUnclaimedFees(vault, token)` after un-blacklisting.

The handler must track ghost variables: `totalFeesAccrued`, `totalFeesClaimed`, `totalFeesEscrowed`. The invariant in D.3 reads these.

Full handler skeleton (adapt to the actual existing handler interface):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SyndicateGovernor} from "../../../src/SyndicateGovernor.sol";
import {SyndicateVault} from "../../../src/SyndicateVault.sol";
// ... mock imports

contract FeeBlacklistHandler is Test {
    SyndicateGovernor public governor;
    SyndicateVault public vault;
    BlacklistableERC20Mock public asset;

    uint256 public totalFeesAccrued;
    uint256 public totalFeesEscrowed;
    uint256 public totalFeesClaimed;

    constructor(SyndicateGovernor _gov, SyndicateVault _vault, BlacklistableERC20Mock _asset) {
        governor = _gov;
        vault = _vault;
        asset = _asset;
    }

    function blacklistRandomRecipient(uint256 seed) external {
        // pick a recipient from the fee waterfall and toggle blacklist
    }

    function runProposalLifecycle(uint256 seed) external {
        // propose / vote / execute / settle a proposal that produces a positive PnL
        // recording totalFeesAccrued += expected fee; totalFeesEscrowed += whatever escrowed
    }

    function claimUnclaimedFees(uint256 seed) external {
        // recipient un-blacklists then claims; totalFeesClaimed += claimed
    }
}
```

### Task D.3 — Write the invariant

- [ ] **Step 1: Write the invariant test**

Create `contracts/test/invariants/FeeBlacklistInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {FeeBlacklistHandler} from "./handlers/FeeBlacklistHandler.sol";

contract FeeBlacklistInvariantTest is StdInvariant, Test {
    FeeBlacklistHandler public handler;

    function setUp() public {
        // Deploy registry/governor/vault proxies + asset mock.
        // Create handler. Call targetContract(handler).
        // Restrict targetSelector to the 4 random-action selectors.
    }

    /// @notice INV-47: a blacklisted recipient never bricks settlement —
    ///         every accrued fee either goes to the recipient or is escrowed.
    function invariant_feesAccountedAfterBlacklist() public view {
        assertEq(
            handler.totalFeesAccrued(),
            handler.totalFeesClaimed() + handler.totalFeesEscrowed(),
            "INV-47: accrued = claimed + escrowed"
        );
    }
}
```

- [ ] **Step 2: Run the invariant**

Run: `forge test --match-path "test/invariants/FeeBlacklistInvariant.t.sol" -vv`
Expected: invariant passes for the configured run/depth.

If it fails, the failure is itself useful: a counterexample handler trace surfaces a real W-1 regression.

- [ ] **Step 3: Commit**

```bash
git add contracts/test/invariants/FeeBlacklistInvariant.t.sol contracts/test/invariants/handlers/FeeBlacklistHandler.sol
git commit -m "test(invariants): INV-47 fee-blacklist non-blocking fuzz harness"
```

---

## Track E — Create3 regression tests + close A-C1/A-C4 in #255

A-C1 (`Create3Factory.deploy` permissionless) and A-C4 (silent CREATE failure) are both already mitigated in code. This track adds regression coverage and updates the issue to mark them closed.

**Files:**
- Create: `contracts/test/Create3Factory.t.sol`
- Create: `contracts/test/Create3.t.sol`

### Task E.1 — `Create3Factory` access-control regression test

- [ ] **Step 1: Write `test_deploy_revertsForNonOwner`**

Create `contracts/test/Create3Factory.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Create3Factory} from "../src/Create3Factory.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Create3FactoryTest is Test {
    Create3Factory public factory;
    address public owner = makeAddr("owner");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        factory = new Create3Factory(owner);
    }

    /// @notice A-C1: deploy() must be onlyOwner. Mempool observers can't
    ///         squat well-known CREATE3 addresses.
    function test_deploy_revertsForNonOwner() public {
        bytes memory creationCode = type(EmptyContract).creationCode;
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        factory.deploy(bytes32(uint256(1)), creationCode);
    }

    /// @notice Sanity: owner can deploy.
    function test_deploy_succeedsForOwner() public {
        bytes memory creationCode = type(EmptyContract).creationCode;
        vm.prank(owner);
        address deployed = factory.deploy(bytes32(uint256(1)), creationCode);
        assertGt(deployed.code.length, 0);
    }

    /// @notice Address is deterministic from (factory, salt) only.
    function test_addressOf_predictsDeployment() public {
        bytes32 salt = bytes32(uint256(42));
        address predicted = factory.addressOf(salt);
        vm.prank(owner);
        address actual = factory.deploy(salt, type(EmptyContract).creationCode);
        assertEq(predicted, actual);
    }
}

contract EmptyContract {
    constructor() {}
}
```

- [ ] **Step 2: Run + verify**

Run: `forge test --match-path "test/Create3Factory.t.sol" -vv`
Expected: 3 tests pass.

### Task E.2 — `Create3` failed-CREATE regression test

- [ ] **Step 1: Write `test_deploy_revertsOnConstructorRevert`**

Create `contracts/test/Create3.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Create3} from "../src/Create3.sol";

/// @notice Test wrapper that exposes the internal library.
contract Create3Wrapper {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address) {
        return Create3.deploy(salt, creationCode);
    }
}

contract AlwaysReverts {
    constructor() {
        revert("nope");
    }
}

contract Create3Test is Test {
    Create3Wrapper public wrapper;

    function setUp() public {
        wrapper = new Create3Wrapper();
    }

    /// @notice A-C4: deploy() must revert (not silently succeed) when the
    ///         constructor reverts. Without the post-call check, the salt
    ///         would be permanently unusable but `deployed.code.length == 0`.
    function test_deploy_revertsOnConstructorRevert() public {
        bytes memory creationCode = type(AlwaysReverts).creationCode;
        vm.expectRevert(Create3.DeployFailed.selector);
        wrapper.deploy(bytes32(uint256(1)), creationCode);
    }

    /// @notice A-C4 corollary: trampoline collision (re-using a salt with
    ///         a different code) reverts.
    function test_deploy_revertsOnSaltReuse() public {
        bytes memory ok = type(AlwaysReverts).creationCode; // any code; first call burns the trampoline slot
        bytes32 salt = bytes32(uint256(2));
        // First call reverts because constructor reverts (above test covers this).
        // Second call with same salt reverts because trampoline already exists at the CREATE2 address.
        try wrapper.deploy(salt, ok) {} catch {}
        vm.expectRevert(); // TrampolineDeployFailed or DeployFailed
        wrapper.deploy(salt, ok);
    }
}
```

- [ ] **Step 2: Run + verify**

Run: `forge test --match-path "test/Create3.t.sol" -vv`
Expected: 2 tests pass.

- [ ] **Step 3: Commit both Create3 test files**

```bash
git add contracts/test/Create3Factory.t.sol contracts/test/Create3.t.sol
git commit -m "test(create3): regression coverage for A-C1 access-control + A-C4 failure detection"
```

### Task E.3 — Update issue #255 to close A-C1, A-C4 line items

- [ ] **Step 1: Mark items complete in the issue body**

Run:

```bash
gh issue view 255 --repo sherwoodagent/sherwood --json body --jq '.body' > /tmp/issue255-body.md
```

Edit `/tmp/issue255-body.md`. Find the §11 Create3Factory block:

```
- [ ] **A-C1** `Create3Factory.deploy` permissionless ...
- [ ] **A-C4** `Create3.deploy` silently "succeeds" on failed CREATE ...
```

Change both `- [ ]` to `- [x]` and append `(closed in code; regression covered by `contracts/test/Create3Factory.t.sol` + `contracts/test/Create3.t.sol`).` to each.

Also strike-through the §1 MockSwapAdapter line — append `~~Already at `contracts/test/mocks/`.~~`.

- [ ] **Step 2: Push the edit**

```bash
gh issue edit 255 --repo sherwoodagent/sherwood --body-file /tmp/issue255-body.md
```

---

## Track F — Vault/Factory CI size gates + minor cleanup

Add CI size gates for `SyndicateVault` and `SyndicateFactory` (defense in depth — both have huge headroom today, but the gate prevents silent regressions).

**Files:**
- Modify: `.github/workflows/contracts.yml`

### Task F.1 — Extend the size-gate step

- [ ] **Step 1: Read current size-gate block**

Run: `sed -n '32,60p' .github/workflows/contracts.yml`

- [ ] **Step 2: Add vault + factory gates**

Edit `.github/workflows/contracts.yml`. After the GuardianRegistry block (line ~58), append:

```yaml
          # Vault: currently ~11k bytes. 22,000 byte gate gives us ~10kb of
          # headroom but catches a runaway addition before it tips EIP-170.
          VAULT_SIZE=$(echo "$SIZES_JSON" | jq -r '.SyndicateVault.runtime_size // empty')
          echo "SyndicateVault runtime size: $VAULT_SIZE bytes"
          if [ -z "$VAULT_SIZE" ]; then
            echo "::error::could not read SyndicateVault runtime size"
            exit 1
          fi
          if [ "$VAULT_SIZE" -gt 22000 ]; then
            echo "::error::SyndicateVault $VAULT_SIZE > 22000 byte budget"
            exit 1
          fi

          # Factory: currently ~11k bytes. Same headroom rationale.
          FACTORY_SIZE=$(echo "$SIZES_JSON" | jq -r '.SyndicateFactory.runtime_size // empty')
          echo "SyndicateFactory runtime size: $FACTORY_SIZE bytes"
          if [ -z "$FACTORY_SIZE" ]; then
            echo "::error::could not read SyndicateFactory runtime size"
            exit 1
          fi
          if [ "$FACTORY_SIZE" -gt 22000 ]; then
            echo "::error::SyndicateFactory $FACTORY_SIZE > 22000 byte budget"
            exit 1
          fi
```

- [ ] **Step 3: Verify the YAML parses (locally)**

Run: `python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/contracts.yml"))' && echo OK`
Expected: `OK`.

- [ ] **Step 4: Sanity-check current sizes against the gate**

Run: `cd contracts && forge build --sizes --json | jq '.SyndicateVault.runtime_size, .SyndicateFactory.runtime_size'`
Expected: both well under 22000 (vault ~11069, factory ~11206 per CLAUDE.md).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/contracts.yml
git commit -m "ci: add bytecode size gates for SyndicateVault and SyndicateFactory"
```

---

## Track G — Final integration

After all six tracks land on this branch, run end-to-end verification + open the PR.

### Task G.1 — Full test suite

- [ ] **Step 1: Run all unit tests**

Run: `forge test --no-match-path "test/integration/**" -v`
Expected: every test passes. If a test fails, do not proceed; identify which track introduced the regression.

- [ ] **Step 2: Run forge fmt check**

Run: `forge fmt --check`
Expected: no diff. If diff, run `forge fmt` and amend the latest commit on the offending track.

- [ ] **Step 3: Verify final bytecode sizes**

Run: `forge build --sizes --json | jq -r '"SyndicateGovernor=" + (.SyndicateGovernor.runtime_size|tostring) + " GuardianRegistry=" + (.GuardianRegistry.runtime_size|tostring) + " SyndicateVault=" + (.SyndicateVault.runtime_size|tostring) + " SyndicateFactory=" + (.SyndicateFactory.runtime_size|tostring)'`
Expected:
- `SyndicateGovernor` ≤ 24,300 (332-byte margin or better, possibly smaller from constants extraction)
- `GuardianRegistry` ≤ 24,310 (270-byte margin or better)
- `SyndicateVault` ≤ 11,100
- `SyndicateFactory` ≤ 11,250

If governor or registry exceeded their pre-PR size by >50 bytes, investigate before pushing.

### Task G.2 — Open the PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/pre-mainnet-quick-wins
```

- [ ] **Step 2: Create PR with `gh pr create`**

```bash
gh pr create --title "feat: pre-mainnet quick wins (#255 §1/§2/§3/§7/§11)" --body "$(cat <<'EOF'
## Summary

Closes the small, independently-shippable items from #255 that don't require new contracts. Six tracks landed on this branch:

- **§1 Source-tree hygiene** — `CoreWriter.sol` moved from `src/hyperliquid/` to `test/mocks/hyperliquid/`. (`MockSwapAdapter.sol` was already at `test/mocks/` — issue text was stale.)
- **§2 Coverage** — `forge coverage` no longer trips Yul stack-too-deep at `SyndicateGovernor.sol:294`. Extracted `_initPendingProposal` private helper.
- **§3 Code consolidation** — `BPS_DENOMINATOR = 10_000` extracted into `GovernorParameters` (inherited by `SyndicateGovernor`) and `GuardianRegistry`. `MAX_MANAGEMENT_FEE_BPS = 1000` named in `SyndicateFactory`. Bytecode-neutral (constants inlined).
- **§3 CI gates** — added size gates for `SyndicateVault` and `SyndicateFactory` (governor + registry already had them).
- **§7 G-H5** — `executeProposal` boundary tests pin behavior at `executeBy`, `executeBy + 1`, and `executeBy - 1`.
- **§7 INV-47** — fee-blacklist invariant fuzz harness at `test/invariants/FeeBlacklistInvariant.t.sol`. Property: `accrued = claimed + escrowed` across random blacklist toggles.
- **§11 A-C1, A-C4** — already closed in code; this PR adds regression tests at `test/Create3Factory.t.sol` and `test/Create3.t.sol`.

Issue #255 updated to mark closed items.

## Out of scope (explicit deferrals — see plan §"Out of scope")

§6 Pausable posture, §9 v4 tokenomics redesign, §7 INV-15 / EAS / correct-approve / shareholder challenge / Minter→fundEpoch.

## Test plan

- [x] `forge test --no-match-path "test/integration/**" -v` — all pass
- [x] `forge fmt --check` — clean
- [x] `forge build --sizes` — governor + registry margins preserved or improved
- [x] `forge coverage --no-match-path "test/integration/**"` — compiles (no stack-too-deep)
- [x] CI size gates exercised locally

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

Before dispatching subagents, verify:

1. **Spec coverage:** every §1/§2/§3/§7/§11 item from #255 (minus the explicit deferrals listed under "Out of scope") has a task. ✓
2. **Placeholder scan:** no "TBD", "implement later", or "similar to Task N" sites. Code blocks present at every code step. ✓
3. **Type consistency:** `BPS_DENOMINATOR` is the same name in both `GovernorParameters.sol` and `GuardianRegistry.sol`. `_initPendingProposal` is the helper name across A2.1 steps. ✓
4. **Disjoint write sets:** B/C/D/E/F do not collide on any file (verified in the parallelism map). ✓
5. **Bytecode invariant:** every track touching governor or registry has a `forge build --sizes` verification step. ✓
