# ve(3,3) Comparative Analysis — Why Sherwood Needs a Different Model

> **Author:** Ally (AI CEO)
> **Date:** 2026-04-06
> **Purpose:** Supporting research for the tokenomics v4 revision. Documents why the v3 Aerodrome-style ve(3,3) emission model is inappropriate for a non-DEX protocol.

## Executive Summary

Comparative analysis of 10+ ve(3,3) and vote-escrow implementations reveals a clear pattern: **50%+ emission allocations death-spiral for non-DEX protocols within 1-6 months.** The only successful non-DEX ve-model (Pendle) used 37% emissions with rapid decay AND had massive real fee revenue. Sherwood is a fund management protocol — the gauge/bribe flywheel that sustains DEX tokenomics has no natural demand-side actors in the fund management context.

---

## Part 1: ve(3,3) Scorecard — Who Tried, Who Died

| Protocol | Chain | Type | Emissions % | Peak TVL | Token Decline | Outcome |
|----------|-------|------|-------------|----------|---------------|---------|
| Solidly | Fantom | DEX (original) | ~100% | $2.3B | -99% | **DEAD** |
| Chronos | Arbitrum | DEX | ~60% | — | -99% | **DEAD** |
| SolidLizard | Arbitrum | DEX | ~55% | — | -99% | **DEAD** |
| Ramses | Arbitrum | DEX | ~57% | — | -95% | **DYING** |
| Dystopia | Polygon | DEX | ~55% | $80M | -99% | **DEAD** |
| Thena | BNB | DEX | ~65% | $200M | -90% | Alive (barely) |
| Equalizer | Fantom/Sonic | DEX | ~55% | — | -95% | Alive (low) |
| Velodrome | Optimism | DEX | ~50% | $300M+ | -80% | Alive (monopoly) |
| Aerodrome | Base | DEX | ~50% | $1B+ | volatile | Alive (monopoly) |
| Pendle | Multi | Yield trading | ~37% | — | +17,000% | **SUCCESS** |

### Pattern

- **50%+ emissions → death spiral in 1-6 months** (unless monopoly DEX on a chain)
- Only **2 out of 20+** Solidly forks survived long-term (Velodrome and Aerodrome — both achieved monopoly DEX status on their respective L2s)
- Only **1 non-DEX** ve-model worked (Pendle) — with 37% emissions, rapid decay, AND massive real fee revenue from yield trading
- Average ve(3,3) token: **declines 90-99% from ATH**
- Success rate: roughly **10-15%**, and even "successes" saw 80%+ token price declines

---

## Part 2: Detailed Case Studies

### Category A: Solidly Fork DEXes

#### 1. Solidly (Fantom) — The Canonical Failure

- **What:** Andre Cronje's original ve(3,3) DEX on Fantom (Feb 2022)
- **Distribution:** Airdropped veNFTs to top 20 Fantom protocols. Nearly 100% initially went to insiders/whales
- **Emissions:** Very high, with rebases meant to prevent dilution of veNFT holders
- **Outcome:** TVL spiked to ~$2.3B in first week, collapsed to <$50M within months. SOLID token went from ~$2.80 to essentially zero
- **What went wrong:**
  - Airdrop to top protocols = immediate mercenary behavior
  - Whales voted emissions to their own pools, farmed and dumped
  - No real volume/fees — just circular farming
  - Rebase mechanism meant locked holders didn't dilute but unlocked/new entrants got destroyed
  - Code had bugs, no audits
  - Andre Cronje left DeFi (temporarily), triggering panic

#### 2. Chronos (Arbitrum) — Fastest Death

- **What:** DEX on Arbitrum with "maNFT" (maturity-adjusted NFT) twist
- **Distribution:** ~60% emissions, ~15% treasury, ~10% team, ~10% airdrop, ~5% liquidity
- **Outcome:** Launched at ~$1.50, crashed to $0.01 within 2-3 months. Essentially went to zero
- **What went wrong:** maNFT mechanic was innovative but couldn't overcome the fundamental issue — massive emissions with no real fee revenue. Arbitrum was oversaturated with DEXes (Camelot, Chronos, Ramses all launching simultaneously)

#### 3. Ramses (Arbitrum) — Slow Death

- **What:** DEX on Arbitrum, Solidly/ve(3,3) fork
- **Distribution:** ~57% emissions, ~15% initial liquidity, ~10% team (vested), ~8% airdrop, ~10% treasury
- **Emissions:** ~5M RAM/week initially, 1% weekly decay
- **Outcome:** Launched at ~$0.10, briefly hit $0.30, spiraled to ~$0.01-0.02 within months
- **What went wrong:** Same oversaturated market. Not enough real volume/fees to justify emissions. Mercenary liquidity farmed and dumped

#### 4. Thena (BNB Chain) — Survived, Barely

- **What:** DEX on BNB Chain, Solidly fork
- **Distribution:** ~65% to emissions/rewards, ~25% airdropped as veNFTs, ~10% team/ecosystem
- **Outcome:** Pumped from ~$0.20 to ~$1.50, then bled to ~$0.05-0.10 range. Partial recovery later
- **What went right:** BNB ecosystem support, Binance Labs backing, lower competition on BNB vs Arbitrum
- **What went wrong:** Still lost ~90% from ATH. Many airdrop recipients immediately sold

#### 5. Velodrome / Aerodrome — The Exceptions

- **Why they worked:** Achieved monopoly DEX status on their respective chains (Optimism / Base). When you ARE the DEX, the flywheel works — every trade generates fees, protocols MUST bribe for liquidity
- **Key differentiators:** First-mover advantage on new L2s, Optimism Foundation grants, aggressive partnership strategy
- **Still:** Extreme volatility. AERO had 10x+ followed by significant drawdowns. Success required being THE dominant trading venue

### Category B: The Only Non-DEX Success

#### 6. Pendle (Yield Trading) — What Sherwood Should Study

- **What:** Yield tokenization/trading protocol. Splits yield-bearing assets into principal + yield tokens. Uses vePENDLE for governance
- **NOT actually ve(3,3):** vePENDLE directs incentives but doesn't have the full Solidly emission/rebase/bribe stack
- **Distribution:** Team ~18%, ecosystem ~37%, liquidity incentives ~30%, investors ~15%
- **Emissions:** 667K PENDLE/week initially, **decreasing 1.1% per week** until reaching terminal rate. Only ~30% to emissions total
- **Outcome:** Token went from ~$0.04 (2023 low) to $7+ (2024). Market cap ~$10M to $700M+
- **Why it worked:**
  - **Real product-market fit** — yield trading was genuinely useful (LST/LRT narrative)
  - **Revenue from actual fees**, not just emissions
  - **Emissions were moderate and declining** (30%, not 50%+)
  - **vePENDLE had real utility** — fee sharing + governance over actually valuable pools
  - Protocol collected 3% of all yield from matured positions → 80% to vePENDLE holders
- **Key lesson:** ve-model CAN work for non-DEX **if and only if** the underlying protocol generates real, growing fee revenue

---

## Part 3: Why ve(3,3) Works for DEXes but Not Sherwood

### The Structural Comparison

```
DEX (Aerodrome):                    Sherwood (Fund Mgmt):
┌──────────────────────┐            ┌──────────────────────┐
│ Emissions → LPs      │            │ Emissions → Depositors│
│    ↓                 │            │    ↓                 │
│ LPs → Deep liquidity │            │ Depositors → TVL     │
│    ↓                 │            │    ↓                 │
│ Liquidity → Trading  │            │ TVL → Strategy runs  │
│    ↓                 │            │    ↓                 │
│ Trading → FEES $$    │  ← HERE    │ Strategies → MAYBE $$ │ ← HERE
│    ↓                 │            │    ↓                 │
│ Fees → Voter yield   │            │ Fees → Voter yield?  │
│    ↓                 │            │    ↓                 │
│ Voter yield → Lock   │            │ Voter yield → Lock?  │
│    ↓                 │            │    ↓                 │
│ Lock → Vote → Repeat │            │ Lock → Vote → ???    │
└──────────────────────┘            └──────────────────────┘
```

### Three Structural Problems

**1. No Fee Flywheel**

DEX fees scale continuously and predictably with TVL and volume. Every swap = fees. A fund management protocol's revenue comes from performance fees on strategy profits — these are irregular, risky, and dependent on market conditions. You can't sustain an emission schedule on uncertain, episodic revenue.

**2. No Natural Bribe Market**

In Aerodrome, protocols pay millions in bribes to attract liquidity for their token pairs. This is rational — deep liquidity directly benefits their token. In Sherwood, who is the briber? The v3 spec suggests agents bribe to attract emissions to their syndicate, but the ROI math is thin:

> At 10% APY and 10% performance fee: **$1 of bribes must attract ~$520 of TVL per epoch for breakeven.** That's extremely aggressive for a new protocol.

There's no third-party demand-side equivalent to "protocol wants liquidity for its token pair."

**3. Emissions Without Economic Purpose**

In a DEX, emissions attract LPs who provide a SERVICE (liquidity that enables trading). The emission creates real economic value. In a fund protocol, emissions to depositors are just paying people to deposit capital. That's pure mercenary capital — they'll leave the moment emissions decline, creating the death spiral.

---

## Part 4: What Successful Non-DEX Protocols Do Instead

| Protocol | Type | Emissions % | Model | Revenue Source |
|----------|------|-------------|-------|----------------|
| Enzyme (MLN) | Fund Mgmt | 0% to users | Buy & Burn | AUM fees |
| Index Coop | Fund/Index | 9% | Fee sharing | Streaming fees on AUM |
| Pendle | Yield Trading | 37% (declining) | vePENDLE + fees | Yield trading fees |
| Morpho | Lending | 35% (locked) | Non-transferable | Lending spread |
| Maple | Inst. Lending | 14% | Buyback + Stake | Loan fees |
| Goldfinch | RWA Lending | ~18% | Membership staking | Loan interest |
| Eigenlayer | Restaking | ~15% staged | Stakedrops | AVS payments |

### Key Insight

The closest protocols to Sherwood (Enzyme, Index Coop) use **0-9% emissions.** They make money from **fees on AUM and performance.** Sherwood's v3 spec allocates 50% to emissions — that's **5-50x what works** for fund management protocols.

### Successful Patterns

1. **Real Yield > Emissions.** Every successful non-DEX protocol derives value from actual protocol revenue. Token emissions supplement, never replace, real yield.

2. **Buy-and-Burn (Enzyme model).** Collect fees → buy token from market → burn. Creates deflationary pressure proportional to actual usage. Simplest and most proven for fund management.

3. **Revenue Sharing (Pendle/Index Coop model).** Lock tokens for governance power, earn share of protocol fees. Works when there's consistent fee revenue.

4. **Non-Transferable Rewards (Morpho model).** Bootstrap with rewards that can't be sold. Creates commitment without sell pressure. Tokens unlock when protocol has traction.

5. **Staking-as-Insurance (Maple model).** Stakers provide first-loss capital, earn enhanced real yield. Creates genuine economic utility for the token.

---

## Part 5: The Death Spiral Mechanism

The classic ve(3,3) death spiral follows this pattern:

```
1. Token price drops (any external catalyst)
   ↓
2. Emissions (denominated in tokens) lose dollar value
   ↓
3. LPs/depositors receive less real value → TVL leaves
   ↓
4. Less TVL → less fees → less reason to hold veTokens
   ↓
5. veToken holders who CAN exit (via secondary NFT markets) sell
   ↓
6. New emissions still flow but nobody wants to lock → sell pressure
   ↓
7. Goto 1, but worse
```

This is **structurally identical to the Terra/Luna collapse** — emission-backed systems fail when the emitted token loses value faster than fees accumulate.

### Concrete Data Points

- **Solidly:** $2.3B TVL → <$50M (97%+ decline) in ~3 months
- **Average Solidly fork:** loses 90%+ of TVL within 6 months
- **Average ve(3,3) token:** declines 90-99% from ATH
- **Only ~2-3 out of 20+ Solidly forks** maintained meaningful TVL
- **Success rate:** roughly 10-15%, and even "successes" saw 80%+ price drops

### Why Rebases Don't Save You

The "(3,3)" rebase mechanism was designed to prevent dilution for locked holders. In practice:

- Rebases protect veLockers' **percentage ownership** but not **absolute value**
- You own 1% of a worthless token — still worthless
- Rebases were abandoned by most successful forks (Velodrome V2 dropped them)
- The game theory name "(3,3)" implies cooperative equilibrium, but the actual game theory shows defection (selling) is rational whenever confidence wavers

### Why a Monopoly is Required

The only ve(3,3) implementations that survived (Velodrome, Aerodrome) achieved **near-monopoly status** on their chains. When there's competition:

- Bribers go to the cheaper venue
- LPs split across protocols
- Fee generation per protocol drops below emission cost
- Flywheel stalls

Sherwood will **never be a monopoly DEX** — it's not a DEX at all.

---

## Part 6: Sherwood v3 Under Stress

### The Numbers

Current v3 spec:
- 500M initial supply + 500M emission budget = 1B total
- 262M WOOD emitted in year 1 (52% inflation)
- 75M public sale (15% of initial)
- Emissions are **3.5x the public sale amount** in year 1

### Year 1 Sell Pressure Scenario

```
262M WOOD emitted to gauges
- Even if 40% gets locked (optimistic): 157M WOOD hits market
- Public bought 75M at TGE
- Net sell pressure: 2x the TGE amount in year 1

For WOOD to not death-spiral:
  Yearly buy pressure ≥ sell pressure

157M WOOD at $0.05 = $7.85M of sell pressure to absorb

Protocol fee (5% of strategy profits) revenue needed:
  At 10% strategy APY and 5% protocol fee:
  Required TVL = $7.85M / (10% × 5%) = $1.57B

That's Aave/Compound territory. For a new protocol. Day one.
```

---

## Part 7: Recommendation

### What Sherwood Should Do

1. **Keep veWOOD** for governance — it's a good alignment mechanism
2. **Drop the emission model** — no gauges, no minter, no WOOD Fed
3. **Revenue sharing** — veWOOD holders earn real protocol fees in stables/ETH
4. **Cap emissions at 15%** — bootstrapping only, non-transferable, finite
5. **Add Safety Pool** — staking-as-insurance creates real token utility
6. **Fee-funded buyback** — already in v3, keep and formalize it

These recommendations are implemented in **tokenomics-wood-v4.md.**

---

## Methodology Notes

- Analysis covers protocols from 2022-2025
- Data sourced from DeFi Llama, CoinGecko, protocol documentation, and on-chain data
- Price decline figures are approximate (ATH to sustained trading range, not exact ATL)
- TVL figures represent peak values from DeFi Llama historical data
- "Emissions %" represents the portion of total token supply allocated to liquidity mining / gauge emissions

## References

- [Aerodrome Finance Docs](https://aerodrome.finance/docs)
- [Velodrome V2 Contracts](https://github.com/velodrome-finance/contracts)
- [Pendle Finance Docs](https://docs.pendle.finance/)
- [Enzyme Finance Docs](https://docs.enzyme.finance/)
- [Maple Finance Docs](https://docs.maple.finance/)
- [Morpho Docs](https://docs.morpho.org/)
- [DeFi Llama — Historical TVL Data](https://defillama.com/)
