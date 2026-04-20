---
name: sherwood-trade-scanner
description: Run one paper-trading cycle of the Sherwood agent on the auto-selected Hyperliquid token universe and post a concise summary to a syndicate XMTP chat.
tags: [sherwood, defi, paper-trading, hyperliquid, xmtp, cron]
triggers:
  - run sherwood paper trade scan
  - sherwood trade-scanner cron
  - paper trading cycle
---

# Sherwood Paper-Trading Scan

Executes one analyze + paper-execute cycle of the Sherwood trading agent
and posts a short summary to the configured syndicate XMTP chat. Designed
for fresh-session cron use — assume zero prior context.

The cron job invoking this skill MUST provide:
- `<REPO_DIR>` — local sherwood checkout (e.g. `~/code/sherwood`)
- `<SYNDICATE_NAME>` — XMTP chat identifier (e.g. `hyperliquid-algo`)
- `<CHAIN>` — chain for the chat & execution (e.g. `hyperevm`)

If any of these are missing from the invocation, ask once for the missing
value (or skip the XMTP post and report locally only).

## Procedure

### 1. Run the scanner

From `<REPO_DIR>`:

```bash
sherwood agent start --auto --cycle 1 --use-judge
```

This executes one DRY-RUN cycle in paper-trading mode:
- Dynamic token selection from Hyperliquid (up to 25 tokens, $5M+ 24h volume)
- Full signal engine (technical + sentiment + on-chain + smart-money)
- Paper trades logged when BUY / SELL fires (no on-chain execution)
- Paper PnL tracked in `~/.sherwood/agent/portfolio.json`
- Exit logic: 3% stop, 6% take-profit, 2.5% trailing, 48h time-stop

Capture the latest cycle from the log:

```bash
tail -1 ~/.sherwood/agent/cycles.jsonl
```

### 2. Post a concise summary to XMTP — use --stdin (CRITICAL)

`sherwood chat send` arguments are passed through bash. A naive
`send "Portfolio $10,000"` becomes `Portfolio 0,000` because bash expands
`$10` (empty positional arg). ALWAYS pipe via `--stdin`:

```bash
printf '%s' '<message>' | sherwood --chain <CHAIN> chat <SYNDICATE_NAME> send --stdin
```

- Single quotes around `printf` prevent shell expansion at quote time
- `--stdin` reads the message after argv parsing → dollar signs render literally
- The `--stdin` flag was added in CLI 0.40.2; require ≥ 0.40.2

### 3. Message format — look like a professional crypto trading bot

The XMTP message must be **human-readable**, visually structured, and
immediately scannable — like alerts from Whale Alert, 3Commas, or Copin.

#### Template A — no trade this cycle (quiet scan)

```
🤖 SHERWOOD — Scan Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Regime: Ranging (B≥0.30 / S≤-0.20)

💰 $10,161.73 (+1.62%)
   Today: +$0.00 realized | +$0.00 unrealized

🔎 Signals (17 scanned):
   NEAR      +0.025  ——
   ETH       +0.029  ——
   BTC       -0.017  ——
   DOGE      -0.036  ——

⚡ No entries. No exits. Watching.
```

#### Template B — entry fired

```
🤖 SHERWOOD — Trade Executed
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 LONG ETHENA @ $0.1128
   Stop $0.1079 (-4.3%) | TP $0.1219 (+8.1%)
   Size $2,005 (20.0% of port)

📊 Regime: Ranging (B≥0.30 / S≤-0.20)

💰 $10,026.25 (+0.26%)
   Today: +$0.00 realized | +$26.25 unrealized

🔎 Top signals:
   ETHENA    +0.403  BUY ▲
   AAVE      +0.312  BUY ▲
   WLD       +0.282  HOLD ——

⚡ 1 entry | 0 exits
```

#### Template C — exit fired

```
🤖 SHERWOOD — Position Closed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ CLOSED ETHENA long
   Entry $0.1128 → Exit $0.1234 (+9.4%)
   P&L: +$93.66
   Reason: Take profit hit

📊 Regime: Ranging

💰 $10,254.39 (+2.54%)
   Today: +$93.66 realized | +$80.00 unrealized

⚡ 0 entries | 1 exit
```

#### Formatting rules

- Use `▲` for BUY / STRONG_BUY signals, `▼` for SELL / STRONG_SELL, `——` for HOLD
- Show the top 3-4 signals by |score| descending, always include any that fired BUY/SELL
- Show at most the bottom 2 signals (worst scores) if space allows
- Token symbols: use uppercase SHORT names (ETH not ethereum, BTC not bitcoin, HYPE not hyperliquid, ENA not ethena)
- Prices: 2 decimals for tokens >$1, 4 decimals for tokens <$1
- PnL%: always show sign (+1.62% not 1.62%)
- Line separator `━` is a single-width Unicode box character — renders in most chat clients
- Keep under 600 chars — chat bubbles truncate beyond that

#### Data sources for the message

From `tail -1 ~/.sherwood/agent/cycles.jsonl`:
- `portfolioValue` — total value (mark-to-market)
- `totalPnlUsd` / `totalPnlPct` — cumulative since inception
- `dailyRealizedPnl` — realized since UTC midnight
- `unrealizedPnl` — open-position mark-to-market
- `signals[]` — token scores + actions
- `tradesExecuted` / `exitsProcessed` — trade counts

From `~/.sherwood/agent/portfolio.json`:
- `positions[]` — open positions with entry/stop/tp/size for entry callouts
- Use `trades.json` last entry for exit details (entry price, exit price, PnL, reason)

#### Symbol mapping (CoinGecko ID → ticker)

When composing the message, map full CoinGecko IDs to short tickers:
bitcoin→BTC, ethereum→ETH, solana→SOL, hyperliquid→HYPE, ethena→ENA,
aave→AAVE, dogecoin→DOGE, near→NEAR, ripple→XRP, sui→SUI,
fartcoin→FARTCOIN, bittensor→TAO, zcash→ZEC, arbitrum→ARB,
avalanche-2→AVAX, chainlink→LINK, worldcoin-wld→WLD, pudgy-penguins→PENGU,
binancecoin→BNB, blur→BLUR, fetch-ai→FET, cardano→ADA.
For unmapped tokens, uppercase the first 5 chars of the CoinGecko ID.

## Output policy

This is a data-collection job. Always post the XMTP summary AND respond
in the cron channel with the same summary plus any notable observations.
Do NOT use `[SILENT]` — every cycle should produce a visible record.

## Idempotency

Each run is independent. Re-execution opens a new paper position only if
a fresh signal fires; the position-tracker prevents duplicate entries on
the same token within the pyramid spacing window (4h, max 2 adds).

## References

- CLI version: ≥ 0.40.2 (required for `--stdin`)
- Cycles log: `~/.sherwood/agent/cycles.jsonl`
- Signal log: `~/.sherwood/agent/signal-history.jsonl`
- Portfolio: `~/.sherwood/agent/portfolio.json`
