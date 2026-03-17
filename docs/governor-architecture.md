# SyndicateGovernor — Architecture

## Overview

A governance system where agents propose strategies, vault shareholders vote, and approved agents execute within mandated parameters — earning performance fees on profits.

**One-liner:** Agents pitch trade plans. Shareholders vote. Winners execute and earn carry.

---

## The Flow

```
1. Agent submits proposal
   "I'm a DeFi expert. I propose borrowing 5,000 USDC against the vault's WETH
    collateral on Moonwell. Health factor drops to 2.1 (still safe). I'll deploy
    the borrowed USDC into Uniswap WETH/USDC LP. Expected APY: 12%.
    My performance fee: 15% of profits."

2. Shareholders vote YES/NO (weighted by vault shares)

3. If quorum + majority → Approved

4. Agent executes within the mandate
   - Can only use up to the approved capital
   - Can only call the approved target contracts
   - Must execute within the execution window

5. On settlement
   - Profit = (position value at close) - (capital used)
   - Performance fee paid to agent
   - Remaining profit accrues to vault (all shareholders)
```

---

## Proposal Struct

```solidity
struct StrategyProposal {
    uint256 id;
    address proposer;           // agent address (must be registered in vault)
    string metadataURI;         // IPFS: full rationale, research, risk analysis
    uint256 capitalRequired;    // vault capital requested (in asset terms, e.g. USDC)
    uint256 performanceFeeBps;  // agent's cut of profits (e.g. 1500 = 15%)
    address[] targets;          // contract addresses the agent needs to call
    uint256 votesFor;           // share-weighted votes in favor
    uint256 votesAgainst;       // share-weighted votes against
    uint256 snapshotTimestamp;  // block.timestamp at creation (for vote weight snapshot)
    uint256 voteEnd;            // snapshotTimestamp + votingPeriod
    uint256 executeBy;          // voteEnd + executionWindow
    ProposalState state;        // Pending → Active → Approved → Executed → Settled
                                // (or Rejected / Expired / Cancelled)
}
```

### Who controls what

| Parameter | Controlled by | Notes |
|-----------|--------------|-------|
| capitalRequired | Agent (proposer) | How much vault capital they need |
| performanceFeeBps | Agent (proposer) | Their fee, capped by maxPerformanceFeeBps |
| targets | Agent (proposer) | Which contracts they need to interact with |
| metadataURI | Agent (proposer) | IPFS link to full strategy rationale |
| votingPeriod | Governor (owner setter) | How long voting lasts |
| executionWindow | Governor (owner setter) | Time after approval to execute |
| quorumBps | Governor (owner setter) | Min participation (% of total shares) |
| maxPerformanceFeeBps | Governor (owner setter) | Cap on agent fees |

---

## Voting

- **Voting power = vault shares** (ERC-4626 balanceOf)
- Snapshot at proposal creation (block.timestamp) to prevent flash-loan manipulation
- 1 address = 1 vote per proposal (weighted by shares at snapshot)
- Simple majority: votesFor > votesAgainst (if quorum met)
- Quorum = minimum % of total supply that must participate

---

## Agent Registration

**Permissionless.** Any address with an ERC-8004 identity NFT can self-register as an agent. No owner approval needed. The vault's caps (daily limits, per-tx limits, target allowlist) are the protection — agents operate freely within the box.

---

## Proposal States

```
              ┌─────────┐
              │ Pending  │  (created, voting not started — or voting active)
              └────┬─────┘
                   │ votingPeriod expires
          ┌────────┼────────┐
          ▼        │        ▼
    ┌──────────┐   │  ┌──────────┐
    │ Approved │   │  │ Rejected │  (votesAgainst >= votesFor, or quorum not met)
    └────┬─────┘   │  └──────────┘
         │         │
         │         ▼
         │   ┌──────────┐
         │   │ Expired  │  (execution window passed without execution)
         │   └──────────┘
         ▼
   ┌──────────┐
   │ Executed │  (agent called executeProposal within window)
   └────┬─────┘
        │
        ▼
   ┌──────────┐
   │ Settled  │  (P&L calculated, performance fee distributed)
   └──────────┘

   At any point before settlement:
   - Proposer can Cancel their own proposal
   - Owner can Emergency Cancel any proposal
```

---

## Mandate Execution

When a proposal is approved, the agent gets a **scoped mandate**:

1. Agent calls `executeProposal(proposalId, calls)` on the governor
2. Governor verifies: proposal is Approved, caller is proposer, within execution window
3. Governor calls vault's `executeProposalBatch(calls, capitalCap, allowedTargets)` 
4. Vault enforces: total value ≤ capitalRequired, all targets in proposal's target list
5. Vault delegatecalls BatchExecutorLib (same as regular executeBatch)

The mandate is **additive** to existing vault rules — proposal targets don't need to be in the vault's global allowlist. The governor authorizes them specifically for this proposal.

---

## Settlement & Performance Fees

When the agent closes the position:

1. Agent calls `settleProposal(proposalId)`
2. Governor calculates profit: `currentValue - capitalDeployed`
3. If profit > 0: `performanceFee = profit * performanceFeeBps / 10000`
4. Fee transferred to agent, remainder stays in vault
5. Proposal state → Settled

**Open question:** How to track "currentValue" for complex multi-step positions (borrow + LP + swap)? Options:
- Agent self-reports (simple, but trust issue)
- Oracle-based valuation (complex, needs price feeds per position type)
- Asset-balance diff (vault's asset balance before vs after settlement tx)

**Recommendation for hackathon:** Asset-balance diff. When agent settles, vault checks its asset balance increase. Simple, accurate for single-asset vaults (USDC).

---

## Open Design Questions

### 1. LP Withdrawal When Capital is Deployed

**Problem:** If 100% of vault capital is deployed in active strategies, LPs can't ragequit — the vault has no liquid assets to return.

**Option A: Secondary market for vault shares**
- Vault shares are ERC-20 tokens — tradeable on any DEX or OTC
- LP sells shares instead of redeeming against vault
- Capital stays deployed, LP gets liquidity from a buyer
- Zero contract changes needed (already works)
- Con: requires a liquid market for shares (bootstrap problem)

**Option B: Withdrawal queue**
- LP signals intent to withdraw → enters queue
- When a strategy settles (agent closes position), queued withdrawals are filled first before capital can be re-deployed
- Capital is never idle — either in a strategy or being withdrawn
- Con: LP has to wait, unknown timing

**Option C: Redemption at settlement only**
- LPs can only redeem when a proposal settles
- Between settlements, trade shares on secondary
- Clean but restrictive

**Option D: Minimum liquidity reserve**
- Governor enforces X% of TVL must stay liquid
- Proposals can only request capital up to `totalAssets - reserve`
- Con: idle capital not earning yield — defeats the purpose

**Current recommendation:** Option A for hackathon (already works). Option B for production.

---

### 2. Multiple Active Proposals

Can multiple proposals be active simultaneously?
- Yes → capital allocation becomes complex (what if 3 proposals each want 50% of vault?)
- No → simpler but slower (one strategy at a time)

**Recommendation:** Yes, but with a capital budget. Sum of all active proposals' `capitalRequired` cannot exceed `totalAssets`. Governor tracks `totalCapitalAllocated` and rejects proposals that would over-commit.

---

### 3. Strategy Carry Model

From the Notion: *"Strategies are free to use. Strategy creators earn a cut of protocol fee on all TVL running their strategy."*

Two possible models:

**A. Per-proposal performance fee (current design)**
- Agent sets fee when proposing
- Fee paid on settlement from profits only
- Simple, clear, hackathon-ready

**B. Protocol-level revenue share (v2)**
- Strategy creators earn ongoing % of all TVL running their strategy
- More DeFi-native (like Uniswap LP fees)
- Needs StrategyRegistry integration, TVL tracking, streaming payments

**Recommendation:** Model A for hackathon. Model B is the long-term vision.

---

### 4. What Happens if a Strategy Loses Money?

- Agent earns nothing (performance fee only applies to profits)
- Loss is socialized across all shareholders (standard fund behavior)
- Agent's reputation takes a hit (EAS attestation records the loss)
- No slashing mechanism in v1

**Future consideration:** Agent bonds / slashing for repeated losses.

---

### 5. Can Agents Update a Live Proposal?

No. Once submitted, proposal params are immutable. If an agent wants different terms, they cancel and create a new proposal. Keeps voting clean — shareholders know exactly what they're voting on.

---

## Contract Architecture

```
┌──────────────────┐     ┌──────────────────────┐
│ SyndicateGovernor │────▶│    SyndicateVault     │
│  (UUPS proxy)    │     │   (ERC-4626 proxy)    │
│                  │     │                       │
│  - proposals     │     │  - executeProposalBatch│
│  - voting        │     │  - settleProposal     │
│  - parameters    │     │  - registerAgent      │
│                  │     │    (permissionless)    │
└──────────────────┘     │                       │
                         │  delegatecall ───────►│── BatchExecutorLib
                         └──────────────────────┘
```

Governor is a separate contract. Vault trusts the governor address (set by owner) to call proposal execution functions. This keeps the vault clean and governance upgradeable independently.

---

## Implementation Plan

1. **ISyndicateGovernor.sol** — interface with structs, errors, events
2. **SyndicateGovernor.sol** — proposals, voting, parameter setters, mandate enforcement
3. **SyndicateVault.sol updates** — permissionless registration, governor slot, executeProposalBatch, settleProposal
4. **SyndicateGovernor.t.sol** — full test suite
5. **CLI commands** — `sherwood proposal create|list|vote|execute|settle`
