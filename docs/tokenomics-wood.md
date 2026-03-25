# WOOD Token Incentive Program — ve(3,3) for Syndicates

> **Status:** Design Spec (Draft v2)
> **Author:** Ally (AI CEO)
> **Date:** 2026-03-18
> **Revised:** 2026-03-25 (economic simulation, bribe layer, regulatory, parameter updates)

## Overview

A vote-escrow tokenomics system inspired by Aerodrome/Velodrome's ve(3,3) model, adapted for Sherwood syndicates. Users lock WOOD tokens to vote for syndicates they want to incentivize. Epoch rewards (WOOD emissions) flow to voted syndicates and are streamed into each syndicate vault's rewards buffer for vault depositors/strategies. LP trading fees from `shareToken/WOOD` Uniswap V3 pools and vote incentives (bribes) flow back to voters.

## Tokens

| Token | Standard | Purpose |
|-------|----------|---------|
| `$WOOD` | ERC-20 | Utility token — emitted as rewards, traded, locked for governance |
| `$veWOOD` | ERC-721 (veNFT) | Governance NFT — represents locked WOOD with time-weighted voting power |

## Core Mechanism

```
                    ┌─────────────────────────────┐
                    │    WOOD Emissions (Minter)   │
                    │    each epoch (7 days)        │
                    └──────────┬──────────────────┘
                               │
                    proportional to veWOOD votes
                               │
                    ┌──────────▼──────────────────┐
                    │   Syndicate Gauges           │
                    │   (one per syndicate)         │
                    └──────┬────────────┬─────────┘
                           │            │
              90-100% to vault    0-10% to LPs
              rewards buffer     (weeks 1-12 only)
                           │            │
                    ┌──────▼────────────▼─────────┐
                    │   Vault Depositors / LPs      │
                    │   (WOOD claims via Merkle)     │
                    └──────────────────────────────┘

    Meanwhile, two fee streams flow back to voters:

    ┌─────────────────────┐    ┌─────────────────────┐
    │ Uniswap V3 LP Fees  │    │  Vote Incentives     │
    │ (shareToken/WOOD)    │    │  (bribes, any ERC-20)│
    └─────────┬───────────┘    └─────────┬───────────┘
              │                          │
              └──────────┬───────────────┘
                         │
              ┌──────────▼──────────────────┐
              │   veWOOD Voters              │
              │   (who voted for syndicate)   │
              └──────────────────────────────┘
```

## The Flywheel

```
Lock WOOD → veWOOD → vote for syndicates
       ↓
Voted syndicates get WOOD emissions → streamed to vault rewards buffer
       ↓
Vault depositors/strategies claim WOOD via Merkle flow (snapshot → tree → root → claim)
       ↓
More vault TVL + strategy activity → higher shareToken utility and trading
       ↓
LPs earn swap fees + bootstrapping emissions (weeks 1-12)
       ↓
Trading fees + vote incentives (bribes) → veWOOD voters who voted for that syndicate
       ↓
Higher voter + depositor yield → more people lock WOOD / deposit into vaults
       ↓
Agents bribe voters to attract emissions → additional voter yield
       ↓
WOOD price ↑ → emissions more valuable → more votes/deposits → repeat
```

## Detailed Design

### 1. Vote-Escrow Locking (VotingEscrow.sol)

Users lock WOOD for a chosen duration (4 weeks — 4 years) and receive a veWOOD NFT.

**Voting power scales linearly with lock duration:**
- 100 WOOD locked 4 years → 100 veWOOD voting power
- 100 WOOD locked 1 year → 25 veWOOD voting power
- 100 WOOD locked 4 weeks → ~1.92 veWOOD voting power

**Minimum lock: 4 weeks.** Shorter locks (e.g., 1 week) allow mercenary capital to farm epoch boundaries with minimal commitment. A 4-week minimum ensures voters have meaningful skin in the game while remaining accessible. (Validated via simulation — see `docs/wood-simulation.ts`.)

**Voting power decays linearly** as the lock approaches expiry, incentivizing longer locks.

**Auto-Max Lock:** Optional flag per veNFT — treated as 4-year lock with no decay. Can be toggled on/off.

**Additional deposits:** Users can add more WOOD to an existing veNFT at any time.

**Lock extension:** Users can extend their lock duration (but never decrease it).

### 2. Epoch Voting (Voter.sol)

**Epoch:** 7-day period, Thursday 00:00 UTC → Wednesday 23:59 UTC.

Each epoch, veWOOD holders allocate their voting power across one or more syndicates:
- A veNFT can split votes across multiple syndicates (e.g., 60% Syndicate A, 40% Syndicate B)
- Votes are cast once per epoch — changing votes resets the allocation
- Voting power is snapshot at vote time (decaying veWOOD balance)

**Eligible syndicates:** Any syndicate registered in the SyndicateFactory with an active vault and a `shareToken/WOOD` Uniswap V3 pool.

**Bootstrapping new syndicates:** New syndicates face a chicken-and-egg problem — they need a WOOD pool to be eligible for votes, but need TVL/reputation to justify liquidity. To solve this:
- **Genesis Pool Program:** The protocol treasury seeds initial `shareToken/WOOD` liquidity (single-sided WOOD) for the first N syndicates (e.g., first 10). This comes from the 50M genesis liquidity allocation.
- **Minimum TVL gate:** After the genesis cohort, new syndicates must reach a minimum vault TVL (e.g., $10k USDC equivalent) before the protocol creates their gauge pool. This filters low-quality syndicates.
- **Self-bootstrap:** Syndicate agents can always create their own pool permissionlessly and request gauge registration from governance.

### 3. WOOD Emissions (Minter.sol)

WOOD is minted each epoch and distributed to syndicate gauges proportionally to votes.

**Emission schedule (3 phases):**

| Phase | Epochs | Rate Change | Description |
|-------|--------|-------------|-------------|
| Take-off | 1–14 | +3%/week | Rapid growth, bootstrap liquidity |
| Cruise | 15–66 | -1%/week | Gradual decay as protocol matures |
| WOOD Fed | 67+ | Voter-controlled | veWOOD voters decide: +0.01%, -0.01%, or hold (capped ±5% from baseline per epoch) |

**Initial emissions:** 10M WOOD/week (2% of initial supply).

**Projected emission milestones** (from simulation):

| Week | Emission/wk | Cumulative | Total Supply | Inflation |
|------|-------------|------------|--------------|-----------|
| 1 | 10.0M | 10.0M | 510M | 2% |
| 14 | 14.7M (peak) | 170.9M | 670.9M | 34% |
| 26 | 13.0M | 336.0M | 836.0M | 67% |
| 52 | 10.0M | 632.4M | 1.13B | 127% |
| 67 | 8.6M → WOOD Fed | 771.3M | 1.27B | 154% |
| 104 | 7.2M | 1.06B | 1.56B | 212% |

**Inflation note:** Year 1 cumulative emissions (~632M) exceed the initial supply (500M), roughly doubling total supply. This is aggressive but comparable to Aerodrome's launch phase. The rebase mechanism partially protects locked holders (see below).

**WOOD Fed guardrails:** To prevent whales from voting to keep emissions permanently high (diluting newcomers), the WOOD Fed rate adjustment is capped at ±5% deviation from a rolling 8-week baseline. This ensures gradual, bounded changes rather than abrupt manipulation.

**Team allocation:** 5% of weekly emissions to team/protocol treasury.

**veWOOD rebase (anti-dilution):**
```
rebase = weeklyEmissions × (1 - veWOOD.totalSupply / WOOD.totalSupply)² × 0.5
```
Distributed to veWOOD holders proportionally to locked amounts, protecting against dilution. At 40% lock rate, rebase covers approximately 50% of dilution for locked holders vs. full dilution for unlocked holders (see simulation §2).

### 4. Syndicate Gauges (SyndicateGauge.sol)

One gauge per syndicate. Receives WOOD emissions proportional to votes.

**Gauge cap:** No single syndicate can receive more than **25% of total epoch emissions**, regardless of vote share. Excess votes above the cap are redistributed proportionally to other gauges.

> **Why 25% instead of 35%:** Simulation showed that at 35%, three colluding whales can capture 105% (i.e., all) of emissions. At 25%, three colluding whales capture at most 75%, leaving 25% for the remaining ecosystem. This also requires a minimum of 4 syndicates to fully distribute emissions, ensuring a healthier ecosystem.

**Who earns emissions:**
- The syndicate vault rewards buffer (for vault depositors/strategies)
- Gauge streams epoch emissions into the vault rewards buffer; rewards are distributed to depositors via Merkle claims

**LP bootstrapping emissions (weeks 1-12 only):**

During the first 12 weeks, a declining share of gauge emissions is directed to `shareToken/WOOD` LPs to bootstrap pool depth:

| Weeks | LP Share | Depositor Share |
|-------|----------|-----------------|
| 1–4 | 10% | 90% |
| 5–8 | 7% | 93% |
| 9–12 | 3% | 97% |
| 13+ | 0% | 100% |

This costs approximately 9M WOOD total (6.4% of first 12 weeks' emissions) — a modest investment to solve the cold-start liquidity problem. After week 12, LPs earn only Uniswap swap fees (no scheduled WOOD emissions).

### 5. Uniswap V3 Pools (shareToken/WOOD)

Each syndicate vault produces share tokens (e.g., `swUSDC`, `swETH`). For each syndicate participating in the incentive program, a Uniswap V3 pool is created:

**Pool:** `shareToken/WOOD`

**Bootstrapping (WOOD-only, single-sided):**
- Set tick range entirely above the current price
- Deposit WOOD only into the position
- As buyers push the price into range, WOOD converts to share tokens
- Protocol seeds initial liquidity from treasury/emissions allocation

**Fee tier:** 1% (10000) or 0.3% (3000) — configurable per pool, higher fee for less liquid pairs.

**Fee capture:**
- Uniswap V3 LP fees accumulate in the positions
- `FeeCollector` contract claims fees from registered `shareToken/WOOD` LP positions at epoch flip
- Collected fees distributed to veWOOD voters who voted for that syndicate

**LP earnings scope:** LPs in `shareToken/WOOD` pools earn Uniswap swap fees + bootstrapping emissions (weeks 1-12 only).

### 6. Fee Distribution (FeeDistributor.sol)

At each epoch boundary:

1. `FeeCollector` harvests accrued Uniswap V3 swap fees from registered LP positions across all syndicates
2. Fees are held per-syndicate in the `FeeDistributor`
3. veWOOD voters who voted for syndicate X claim their pro-rata share of syndicate X's fees
4. Claim is proportional to voting power allocated to that syndicate

**Fee tokens:** Fees are in `shareToken` + `WOOD` (both sides of the pair). Distributed as-is (no conversion).

### 7. Vault Rewards Distribution (Merkle Flow)

Scheduled WOOD emissions for a voted syndicate are paid into that syndicate vault rewards buffer, then distributed to vault depositors/strategies through a Merkle claim flow:

1. **Snapshot:** At epoch boundary, record each eligible depositor/strategy weight for the syndicate vault
2. **Tree:** Build a Merkle tree of `(account, amount)` WOOD entitlements for that epoch
3. **Root:** Publish/store the Merkle root on-chain for the syndicate epoch
4. **Claim:** Depositors/strategies claim WOOD from the distributor contract using Merkle proofs

This makes depositor payout deterministic and auditable while keeping per-user distribution gas-efficient.

**Trust model:** The Merkle root publisher is a trusted role. In v1, the protocol operator (multisig) publishes roots. To mitigate abuse:
- **Dispute window:** Roots are posted with a 24-hour challenge period before claims activate. During this window, anyone can submit a fraud proof showing the root doesn't match the on-chain vault share snapshot.
- **Fallback:** If no root is published within 48h of epoch end, depositors can trigger a proportional on-chain distribution (gas-heavy but trustless fallback).

**Distribution alternatives evaluated:**

| Approach | Pros | Cons | When to use |
|----------|------|------|-------------|
| **Merkle claims (v1)** | Gas-efficient, battle-tested | Trusted publisher, 24h delay, off-chain infra | Launch (current recommendation) |
| **Sablier V2 streaming** | Fully on-chain, no trusted publisher | Higher gas per recipient per epoch | If <50 depositors per syndicate |
| **Drips Protocol** | Purpose-built streaming | External protocol dependency | If Drips matures and integrates with Base |

**Recommendation:** Launch with Merkle (Phase 2), evaluate streaming for Phase 4+ once depositor count and gas costs are better understood.

### 8. Vote Incentives — VoteIncentive.sol (Bribe Layer)

**Why this is essential:** Simulation shows that at realistic trading volumes ($500K/week per syndicate), voter APR from trading fees alone is likely <5%. In every successful ve(3,3) deployment (Aerodrome, Velodrome, Curve), the bribe marketplace is the primary economic engine for voter returns. Without it, locking WOOD is not economically attractive.

**Mechanism:**

Syndicate agents (or anyone) can deposit ERC-20 tokens as incentives to attract veWOOD votes to their syndicate. Voters who direct emissions to that syndicate earn a pro-rata share of the incentives.

**Contract interface:**
```solidity
interface IVoteIncentive {
    /// @notice Deposit incentive tokens for a syndicate in the current or next epoch
    /// @param syndicateId The syndicate to incentivize
    /// @param token The ERC-20 token to deposit as incentive
    /// @param amount The amount of tokens to deposit
    function depositIncentive(uint256 syndicateId, address token, uint256 amount) external;

    /// @notice Claim earned incentives for a specific syndicate and epoch
    /// @param syndicateId The syndicate voted for
    /// @param epoch The epoch number
    /// @param tokens Array of incentive token addresses to claim
    function claimIncentives(uint256 syndicateId, uint256 epoch, address[] calldata tokens) external;

    /// @notice View pending incentives for a voter
    function pendingIncentives(address voter, uint256 syndicateId, uint256 epoch, address token)
        external view returns (uint256);
}
```

**Rules:**
- **Any ERC-20 accepted:** USDC, WOOD, WETH, or any token. Depositors choose.
- **Deposit deadline:** Incentives for epoch N must be deposited before epoch N start + 24 hours. This prevents last-second bribe sniping where voters can't react.
- **Pro-rata distribution:** Incentives are split among voters proportional to their voting power allocated to that syndicate.
- **Claim timing:** Incentives become claimable after epoch N ends (same timing as fee distribution).
- **Integration with Voter.sol:** VoteIncentive reads vote allocations from `Voter.sol` to determine pro-rata shares. No additional on-chain voting required.

**Expected dynamics:**
- Syndicate agents bribe voters to attract emissions → higher TVL → better strategy performance → higher agent fees. This creates a self-reinforcing loop where agents spend a portion of their earnings to grow their syndicate.
- Third parties (protocols, DAOs) can bribe for emissions to syndicates that hold their tokens, creating cross-protocol incentive alignment.
- The bribe market provides price discovery for the "cost of emissions" — a key health metric for the protocol.

## Fee Architecture Integration

WOOD adds three new revenue streams alongside the existing USDC-based fee waterfall. They are **additive**, not replacements:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPLETE FEE FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. STRATEGY PROFITS (USDC) — existing, unchanged                  │
│     ┌──────────────────────────────────────────────┐               │
│     │  Gross Profit (from strategy settlement)      │               │
│     │    ├─ Protocol Fee (0-10%) → protocolFeeRecipient            │
│     │    ├─ Agent Fee (bps) → proposer + co-proposers              │
│     │    ├─ Management Fee (bps) → vault owner                     │
│     │    └─ Remainder → vault (depositors)                         │
│     └──────────────────────────────────────────────┘               │
│     Source: SyndicateGovernor._distributeFees()                    │
│                                                                     │
│  2. WOOD EMISSIONS (WOOD) — new                                    │
│     ┌──────────────────────────────────────────────┐               │
│     │  Minter (weekly)                              │               │
│     │    ├─ 5% → team/protocol treasury             │               │
│     │    ├─ Rebase → veWOOD holders (anti-dilution) │               │
│     │    └─ Gauges → vault rewards buffer → depositors (Merkle)    │
│     └──────────────────────────────────────────────┘               │
│                                                                     │
│  3. TRADING FEES (shareToken + WOOD) — new                         │
│     ┌──────────────────────────────────────────────┐               │
│     │  Uniswap V3 LP positions                      │               │
│     │    → FeeCollector (at epoch flip)              │               │
│     │    → FeeDistributor → veWOOD voters            │               │
│     └──────────────────────────────────────────────┘               │
│                                                                     │
│  4. VOTE INCENTIVES / BRIBES (any ERC-20) — new                   │
│     ┌──────────────────────────────────────────────┐               │
│     │  Anyone deposits incentives                    │               │
│     │    → VoteIncentive (per syndicate per epoch)   │               │
│     │    → veWOOD voters (pro-rata to voting power)  │               │
│     └──────────────────────────────────────────────┘               │
│                                                                     │
│  INTERACTION: WOOD emissions do NOT reduce or replace              │
│  protocolFeeBps revenue. Protocol fee is taken from strategy       │
│  profits (USDC). WOOD emissions are a separate incentive layer.    │
│  Future governance may decide to use protocol fee revenue to       │
│  buy back WOOD from the market.                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Who earns what:**

| Participant | USDC Profits | WOOD Emissions | Trading Fees | Bribes |
|-------------|:---:|:---:|:---:|:---:|
| Vault depositors | Remainder after fees | Via Merkle claims | — | — |
| Vault owner | Management fee | — | — | — |
| Agent (proposer) | Performance fee | — | — | — |
| Protocol | Protocol fee | 5% of emissions | — | — |
| veWOOD voters | — | Rebase (anti-dilution) | Pro-rata | Pro-rata |
| LPs | — | Weeks 1-12 only | Swap fees | — |

## Token Distribution

### Initial Supply: 500M WOOD

| Allocation | Amount | % | Form | Insider? |
|------------|--------|---|------|----------|
| Genesis liquidity | 50M | 10% | WOOD (for pool bootstrapping) | No |
| Early voter rewards (epoch 1-4) | 40M | 8% | WOOD (bootstrap voting) | No |
| Protocol treasury | 75M | 15% | veWOOD (auto-max-locked) | Yes |
| Team | 75M | 15% | veWOOD (auto-max-locked, 1yr cliff + 3yr vest) | Yes |
| Early syndicate creators | 15M | 3% | veWOOD (airdrop to existing agents) | Yes |
| Community / grants | 85M | 17% | veWOOD (auto-max-locked) | No |
| Future partnerships | 60M | 12% | WOOD (held in treasury) | No |
| Public sale / LBP | 75M | 15% | WOOD | No |
| **Protocol reserve** | 25M | 5% | WOOD (emergency / insurance fund) | No |

**Insider-aligned veWOOD: 33% (165M).** This is the maximum acceptable threshold to prevent governance capture. At 40% external lock rate, insiders dilute below 50% of total veWOOD by week 26 (see simulation §6).

**Team vesting:** 1-year cliff, then linear vesting over 3 years (156 weeks). Team veWOOD is auto-max-locked during vesting but voting power is active from day 1.

### Emission Schedule (Projected)

```
Week 1:   10.0M WOOD
Week 14:  14.7M WOOD (peak, after +3%/week take-off)
Week 26:  13.0M WOOD (cruise decay)
Week 52:  10.0M WOOD
Week 67:  ~8.6M WOOD → WOOD Fed activates
Year 2:   Voter-controlled (est. 7-10M/week)
```

## Contracts

| Contract | Description | Key Dependencies |
|----------|-------------|-----------------|
| `WoodToken.sol` | ERC-20 with controlled minting (only Minter can mint) | OpenZeppelin ERC20 |
| `VotingEscrow.sol` | Lock WOOD → veWOOD NFT, voting power with linear decay | ERC721, ReentrancyGuard |
| `Voter.sol` | Epoch voting for syndicates, gauge creation/management | VotingEscrow, SyndicateFactory |
| `SyndicateGauge.sol` | Per-syndicate emission receiver, streams WOOD to vault + LPs | Voter, Vault |
| `Minter.sol` | Emission schedule, epoch flipping, rebase calculation | WoodToken, Voter, VotingEscrow |
| `FeeCollector.sol` | Harvests Uniswap V3 swap fees from registered LP positions | Uniswap V3 NonfungiblePositionManager |
| `FeeDistributor.sol` | Distributes collected trading fees to veWOOD voters | Voter, VotingEscrow |
| `VoteIncentive.sol` | Bribe marketplace — deposit incentives for voters | Voter, VotingEscrow |
| `VaultRewardsMerkleDistributor.sol` | Stores epoch Merkle roots and processes vault depositor WOOD claims | SyndicateGauge, Vault |
| `RewardsDistributor.sol` | veWOOD rebase (anti-dilution) distribution | VotingEscrow, Minter |

## Uniswap V3 Integration Details

### Deployed Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| UniswapV3Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |

### Pool Creation Flow

1. **Create pool:** Call `UniswapV3Factory.createPool(shareToken, WOOD, feeTier)`
2. **Initialize price:** Call `pool.initialize(sqrtPriceX96)` — set initial shareToken/WOOD ratio
3. **Seed liquidity (single-sided WOOD):**
   - Calculate tick range above current price
   - Call `NonfungiblePositionManager.mint()` with `amount0Desired=0, amount1Desired=woodAmount` (or vice versa depending on token ordering)
   - This creates an out-of-range position with WOOD only
4. **Register gauge:** Call `Voter.createGauge(syndicateId, pool, nftTokenId)`

### Fee Harvesting

Uniswap V3 fees accrue inside position NFTs. To collect:
```solidity
NonfungiblePositionManager.collect(CollectParams({
    tokenId: lpNftId,
    recipient: feeCollector,
    amount0Max: type(uint128).max,
    amount1Max: type(uint128).max
}))
```

`FeeCollector` calls this for all registered positions at epoch flip, then forwards to `FeeDistributor`.

## Epoch Lifecycle

```
Thursday 00:00 UTC — Epoch N starts
│
├── Minter.flipEpoch()
│   ├── Mint WOOD emissions for epoch N
│   ├── Distribute to gauges (proportional to epoch N-1 votes)
│   ├── Gauges stream emissions into each voted vault rewards buffer
│   ├── Snapshot vault rewards weights
│   ├── Build Merkle tree + publish epoch root
│   ├── Mint veWOOD rebase
│   └── Collect fees from epoch N-1 → FeeDistributor
│
├── Users vote for syndicates (any time during epoch)
├── Vote incentive deposits close (epoch start + 24h)
├── Vault depositors/strategies claim WOOD via Merkle proofs
├── LPs provide liquidity for swap fees (+ bootstrapping emissions weeks 1-12)
├── Voters claim epoch N-1 fees + incentives
│
Wednesday 23:59 UTC — Epoch N ends
```

## Security Considerations

1. **Reentrancy:** VotingEscrow handles NFTs and token transfers — use ReentrancyGuard on all external calls
2. **Flash loan attacks:** Voting power based on locked balance (not transferable), immune to flash loans
3. **Checkpoint manipulation:** Use block.timestamp checkpoints for vote weight snapshots
4. **Fee collection atomicity:** FeeCollector must handle failed collections gracefully (one position failing shouldn't block others)
5. **Merkle correctness:** Snapshot and tree generation must be deterministic; root publication must match off-chain computation
6. **Overflow:** veWOOD voting power calculation uses time math — careful with uint256 overflow at boundaries
7. **Oracle manipulation:** Pool price can be manipulated — don't use pool price for anything security-critical (only for LP bootstrapping)
8. **Bribe token safety:** VoteIncentive must use SafeERC20 and handle fee-on-transfer / rebasing tokens gracefully (or explicitly reject them)
9. **Gauge cap enforcement:** Cap must be enforced at distribution time (not just at vote time) to prevent manipulation via late voting

## Regulatory Considerations

> **This section is not legal advice. It identifies risks and recommends actions.**

### Howey Test Analysis (US Securities Law)

The four-prong Howey test for whether WOOD could be classified as a security:

| Prong | Assessment | Risk |
|-------|-----------|------|
| **Investment of money** | Users buy or earn WOOD, then lock it | Met |
| **Common enterprise** | Token value tied to protocol success (horizontal commonality) | Likely met |
| **Expectation of profits** | Voters receive trading fees, bribes, and rebase | Arguably met |
| **Solely from efforts of others** | Voters actively direct emissions (governance function); not passive | **Key mitigating factor** |

**Mitigations already in the design:**
- veWOOD is non-transferable (locked NFT) — not freely tradeable like typical securities
- Voting is active participation (governance work), not passive investment
- WOOD Fed gives voters direct control over monetary policy
- No dividends — fee distribution is tied to active voting, not passive holding

**Remaining risks:**
- Team + treasury hold 33% of initial veWOOD with full voting power — concentrated control
- Emissions schedule is set by protocol, not purely by voter action (until WOOD Fed at week 67)
- Public sale / LBP could be viewed as a securities offering

### Jurisdictional Notes

| Jurisdiction | Key Regulation | Consideration |
|-------------|---------------|---------------|
| **US (SEC)** | Howey test, Securities Act | Most conservative. Avoid marketing WOOD as investment. Geographic restrictions on public sale. |
| **EU (MiCA)** | Markets in Crypto-Assets Regulation | Utility token classification requires clear non-investment utility. White paper requirements. |
| **Singapore (MAS)** | Payment Services Act | Digital payment token vs capital markets product distinction. |
| **Cayman/BVI** | Common token issuer domicile | Consider for legal entity structure. |

### Recommendations

1. **Engage securities counsel** before any token generation event (TGE) or public sale
2. **Geographic restrictions** — consider excluding US persons from public sale/LBP
3. **SAFT structure** — use Simple Agreement for Future Tokens for any pre-sale allocation
4. **Sufficient decentralization** — accelerate the transition to WOOD Fed (voter-controlled emissions) and minimize team governance power over time
5. **Utility-first messaging** — position WOOD as a governance/coordination token, not an investment vehicle
6. **No profit language** — avoid terms like "yield", "returns", "APR" in marketing materials; use "voting rewards", "incentives", "governance participation"

## Economic Simulation

An interactive economic simulation is available at `docs/wood-simulation.ts`. Run it to validate parameter choices:

```bash
npx tsx docs/wood-simulation.ts              # full 104-week simulation
npx tsx docs/wood-simulation.ts --csv        # output CSV files for analysis
npx tsx docs/wood-simulation.ts --weeks 52   # 1-year simulation
```

**Key simulation findings:**

1. **Inflation:** Year 1 emissions (~632M) roughly double total supply. Aggressive but comparable to Aerodrome's launch.
2. **Rebase protection:** At 40% lock rate, veWOOD holders absorb ~50% less dilution than unlocked holders.
3. **Voter fees alone are insufficient:** At $500K/week trading volume per syndicate, voter APR from fees is <5%. The bribe layer is essential.
4. **Gauge cap at 25%:** Three colluding whales capture at most 75% of emissions (vs. 105% at 35%). Four syndicates minimum to distribute all emissions.
5. **Insider dilution:** At 33% insider veWOOD, insiders drop below 50% voting power by week 26. Insider + whale (10% of circulating) collusion peaks at 49.78% — just under majority.
6. **LP bootstrapping cost:** 9M WOOD over 12 weeks (6.4% of early emissions) — modest and effective.

## Open Questions

1. **WOOD token launch mechanism:** LBP (Balancer Liquidity Bootstrapping Pool)? Fair launch? Fixed-price sale?
2. ~~**Gauge cap:**~~ **Resolved** — 25% cap per syndicate (reduced from 35% based on simulation).
3. ~~**Minimum lock duration:**~~ **Resolved** — 4 weeks minimum (increased from 1 week to prevent mercenary farming).
4. ~~**Syndicate eligibility:**~~ **Resolved** — Genesis Pool Program for first 10 syndicates, then minimum TVL gate (see §2).
5. **Multi-chain:** Base only initially, or plan for L2 expansion?
6. **Merkle root publisher:** Multisig in v1 with dispute window. Acceptable for launch? (see §7)
7. **Audit budget:** 10 contracts with complex interactions require comprehensive audit. Estimated $200K-$500K and 4-8 weeks.

## Phased Deployment Plan

Do not ship all 10 contracts at once. Each phase should be audited, deployed, and stabilized before proceeding.

### Phase 0: Pre-launch
- Deploy `WoodToken.sol`
- Execute initial distribution (team veWOOD, treasury, genesis liquidity)
- Run LBP or public sale
- **Gate:** Token is live and liquid on at least one DEX

### Phase 1: Core Locking & Voting
- Deploy `VotingEscrow.sol`, `Voter.sol`, `Minter.sol`
- Enable WOOD locking and syndicate voting
- Emissions begin flowing to gauges
- **Gate:** At least 5 syndicates with active gauges, >20% of supply locked

### Phase 2: Gauge Economics
- Deploy `SyndicateGauge.sol`, `VaultRewardsMerkleDistributor.sol`
- Emissions flow through gauges into vault rewards buffers
- Depositors can claim WOOD rewards via Merkle proofs
- LP bootstrapping emissions active (weeks 1-12 of this phase)
- **Gate:** Merkle infrastructure stable for 4+ epochs, depositor claims working

### Phase 3: Fee Routing
- Deploy `FeeCollector.sol`, `FeeDistributor.sol`, `RewardsDistributor.sol`
- Trading fees flow to voters
- veWOOD rebase (anti-dilution) activated
- **Gate:** Fee collection reliable for 4+ epochs, rebase mathematically verified

### Phase 4: Bribe Market
- Deploy `VoteIncentive.sol`
- Agents and third parties can deposit vote incentives
- Full flywheel operational
- **Gate:** Bribe deposits observed, voter APR meaningfully above fee-only APR

### Phase 5: WOOD Fed
- Activate voter-controlled emission rate adjustments (~week 67)
- Protocol transitions from fixed schedule to community governance
- **Gate:** Sufficient decentralization metrics met (>60% of veWOOD held by non-insiders)

**Emergency infrastructure:** All contracts include OpenZeppelin Pausable. The Minter has an emergency pause that halts emissions if a critical vulnerability is discovered. This fits the existing UUPS upgradeability trust model.

## References

- [Aerodrome Finance Docs](https://aerodrome.finance/docs)
- [Velodrome V2 Contracts](https://github.com/velodrome-finance/contracts)
- [Uniswap V3 Core](https://github.com/Uniswap/v3-core)
- [Uniswap V3 Periphery](https://github.com/Uniswap/v3-periphery)
- [Curve VotingEscrow](https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy)
- [Sablier V2 (streaming alternative)](https://docs.sablier.com/)
