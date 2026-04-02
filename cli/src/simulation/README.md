# Sherwood Multi-Agent Simulation

A simulation toolkit for orchestrating 12 agents through the full Sherwood lifecycle: identity minting, syndicate creation, membership, deposits, XMTP chat, proposals, voting, execution, settlement, and re-proposal.

Designed to be orchestrated by Claude Code via its native scheduler — each phase is a CLI command, all state is persisted to JSON, and all operations are idempotent.

## Architecture

**Wallet derivation**: Single BIP-39 mnemonic -> HD wallets via BIP-44 (`m/44'/60'/0'/0/i`).
- Index 0 = master wallet (holds ETH + USDC/WETH for funding)
- Indices 1-5 = creator agents (deploy syndicates with diverse strategies)
- Indices 6-12 = joiner agents (request + join syndicates)

**XMTP/config isolation**: Each agent gets `HOME=/tmp/sherwood-sim/agents/agent-{i}` with its own `~/.sherwood/config.json` and XMTP database. Set per subprocess — no CLI modifications needed.

**State**: All progress is saved to `SIM_STATE_FILE` (default `/tmp/sherwood-sim/state.json`) after each operation. Every phase is idempotent — re-running skips completed steps.

**Compressed timelines**: Strategy duration defaults to 3 hours (`SIM_STRATEGY_DURATION`). Full propose -> vote -> execute -> settle -> re-propose cycles complete within hours, not days.

## Setup

### Prerequisites

1. Node.js v20+
2. Install CLI dependencies: `cd cli && npm install`
3. A funded master wallet (holds ETH + USDC for all 12 agents)

### Environment Variables

```bash
# Required
export SIM_MNEMONIC="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"

# Optional — chain defaults to "base", RPC auto-resolves from chain config
export SIM_CHAIN=base-sepolia          # or pass --chain base-sepolia at runtime
export BASE_RPC_URL="..."              # override RPC for base mainnet
export BASE_SEPOLIA_RPC_URL="..."      # override RPC for base-sepolia
export SIM_AGENT_COUNT=12              # default: 12
export SIM_SYNDICATE_COUNT=5           # default: 5
export SIM_DRY_RUN=false               # default: false (set true to skip on-chain calls)
export SIM_BASE_DIR=/tmp/sherwood-sim/agents   # default
export SIM_STATE_FILE=/tmp/sherwood-sim/state.json  # default
export SIM_FUND_ETH=0.007              # ETH per agent (gas + WETH deposit buffer), default: 0.007
export SIM_FUND_USDC=10                # USDC per agent, default: 10
export SIM_STRATEGY_DURATION=3h        # proposal strategy duration, default: 3h
export SIM_CONCURRENCY=4               # max parallel agent ops per batch, default: 4
export SIM_COMPILED=true               # use pre-built dist/index.js instead of npx tsx (faster)
```

### Chain support

| Chain | Flag | Notes |
|-------|------|-------|
| Base mainnet | `--chain base` (default) | Production — real funds |
| Base Sepolia | `--chain base-sepolia` | Testnet — Circle test USDC |
| Robinhood testnet | `--chain robinhood-testnet` | L2 testnet — no USDC (ETH-only) |

For testnet chains, `ENABLE_TESTNET=true` is set automatically in CLI subprocesses.

### Pre-flight check

Run the environment validator before your first simulation:

```bash
SIM_MNEMONIC="..." npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia preflight
```

Checks:
1. Node.js ≥ v20.12 (required for `styleText` support)
2. `npx` available in PATH
3. esbuild arch package installed (macOS — warns if missing, won't fail)
4. RPC endpoint reachable (`eth_blockNumber`)
5. `SIM_MNEMONIC` is a valid BIP-39 mnemonic
6. Master wallet has sufficient ETH (`agentCount × SIM_FUND_ETH + 0.01` buffer)

`run-all` runs preflight automatically and aborts on errors.

Estimate total funding needed:
- ETH: `0.007 x 12 = 0.084 ETH` + gas buffer (~0.02 ETH)
- USDC: `10 x 12 = 120 USDC` (testnet: use faucet USDC)

Index 0 wallet (master) must hold this before running Phase 01.

## Usage

### Full simulation (phases 01-08)

```bash
# Base Sepolia testnet (recommended for simulation)
npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia run-all

# Base mainnet
npx tsx cli/src/simulation/orchestrator.ts run-all
```

This runs preflight, then all setup phases in parallel batches. Wall-clock time depends on `SIM_CONCURRENCY` and RPC latency — see [Performance](#performance) below.

### Individual phases

```bash
# Phase 01 — Derive wallets, fund agents, mint ERC-8004 identities
npx tsx cli/src/simulation/orchestrator.ts setup

# Phase 02 — Creators deploy 5 syndicates (USDC or WETH vaults)
npx tsx cli/src/simulation/orchestrator.ts syndicates

# Phase 03 — Joiners send EAS membership requests
npx tsx cli/src/simulation/orchestrator.ts join

# Phase 04 — Creators approve pending requests (register + add to chat)
npx tsx cli/src/simulation/orchestrator.ts approve

# Phase 05 — All eligible agents deposit (USDC or ETH->WETH per vault asset)
npx tsx cli/src/simulation/orchestrator.ts deposit

# Phase 06 — Agents send XMTP messages themed to their persona
npx tsx cli/src/simulation/orchestrator.ts chat

# Phase 07 — Creators submit strategy proposals (diverse per persona)
npx tsx cli/src/simulation/orchestrator.ts propose

# Phase 08 — Members vote on pending proposals
npx tsx cli/src/simulation/orchestrator.ts vote
```

### Lifecycle management (phase 10)

The `lifecycle` command manages the full proposal state machine in one pass:

```bash
npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia lifecycle
```

For each syndicate it:
1. Fetches on-chain proposal states
2. Executes approved proposals (voting period ended)
3. Settles executed proposals (strategy duration elapsed)
4. Creates new proposals when all previous ones are settled

### Heartbeat (phase 09)

Social activity — chat monitoring + voting on pending proposals:

```bash
npx tsx cli/src/simulation/orchestrator.ts heartbeat --rounds 1
```

### Claude Cron (autonomous scheduling)

Instead of a long-running Node.js process, use Claude Code's native scheduler:

```
CronCreate({
  cron: "*/17 * * * *",
  durable: true,
  prompt: `Run the Sherwood simulation lifecycle on base-sepolia:
1. Run: npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia lifecycle
2. Run: npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia heartbeat --rounds 1
3. Run: npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia diagnose
If diagnose shows errors, investigate and retry with: sim retry --phase <N>`
})
```

Durable crons survive Claude session restarts. Recurring crons auto-expire after 7 days.

### Inspecting logs (for Claude)

Every CLI command is logged as a JSONL entry to `SIM_LOG_FILE` (default `/tmp/sherwood-sim/sim.log`).

```bash
# Show last 50 entries (human-readable)
npx tsx cli/src/simulation/orchestrator.ts logs

# Show only errors
npx tsx cli/src/simulation/orchestrator.ts logs --errors

# Filter to a specific phase or agent
npx tsx cli/src/simulation/orchestrator.ts logs --phase 3 --agent 7

# Raw JSONL output (for piping to jq or other tools)
npx tsx cli/src/simulation/orchestrator.ts logs --raw --last 100
```

### Diagnose (machine-readable for Claude)

```bash
npx tsx cli/src/simulation/orchestrator.ts diagnose
```

Output includes: `errorCount`, `errorsByPhase`, `agentsWithErrors`, `errorPatterns`, `suggestions`, `simState`.

### Retrying failures

```bash
npx tsx cli/src/simulation/orchestrator.ts retry --phase 3
npx tsx cli/src/simulation/orchestrator.ts retry --phase 10  # retry lifecycle
```

## Agent Personas

| Index | Name | Role | Vault Asset | Strategy | Syndicate |
|-------|------|------|-------------|----------|-----------|
| 0 | Master | Funder | — | — | — |
| 1 | Yield Maximizer | Creator | USDC | moonwell-supply | steady-yield |
| 2 | LP Hunter | Creator | USDC | moonwell-supply | aero-alpha |
| 3 | Venice Oracle | Creator | USDC | venice-inference | venice-oracle |
| 4 | Basis Trader | Creator | WETH | wsteth-moonwell | eth-staking |
| 5 | Multi-Strategy | Creator | WETH | moonwell-supply | diversified-defi |
| 6 | DeFi Scout | Joiner | — | — | round-robin |
| 7 | Risk Sentinel | Joiner | — | — | round-robin |
| 8 | Alpha Seeker | Joiner | — | — | round-robin |
| 9 | Stable Hand | Joiner | — | — | round-robin |
| 10 | Whale Watcher | Joiner | — | — | round-robin |
| 11 | Gas Optimizer | Joiner | — | — | round-robin |
| 12 | Governance Hawk | Joiner | — | — | round-robin |

All agents deposit max $10 (USDC for USDC vaults, ~0.004 WETH for WETH vaults).

## Proposal Lifecycle

```
propose -> vote -> [voting period] -> execute -> [strategy duration] -> settle -> re-propose
```

With default 3h strategy duration and ~15min cron interval, each full cycle takes ~4-6 hours (including voting period). The cron runs `lifecycle` each interval, advancing proposals through their states.

## Performance

All phases (except heartbeat) run agent operations in parallel batches controlled by `SIM_CONCURRENCY`. Increase it for large simulations:

```bash
SIM_CONCURRENCY=8 npx tsx cli/src/simulation/orchestrator.ts run-all
```

| Scenario | concurrency=1 | concurrency=4 | concurrency=8 |
|----------|---------------|---------------|---------------|
| 12 agents, run-all | ~25 min | ~8 min | ~5 min |
| 50 agents, run-all | ~100 min | ~28 min | ~16 min |
| 100 agents, run-all | ~200 min | ~55 min | ~30 min |

At high concurrency the bottleneck shifts from sequential scheduling to RPC latency + tx confirmation time.

### SIM_COMPILED — skip TypeScript compilation per subprocess

By default each agent subprocess runs `npx tsx src/index.ts`, which compiles TypeScript on every call (~1.5s overhead). `SIM_COMPILED=true` bypasses this by spawning `node dist/index.js` instead (~100ms). This is **~10× faster** per call.

**Setup (one-time, and after any CLI changes):**

```bash
cd cli && npm run build
```

**Run with compiled binary:**

```bash
SIM_COMPILED=true SIM_CONCURRENCY=8 npx tsx cli/src/simulation/orchestrator.ts run-all
```

Preflight automatically checks that `dist/index.js` exists and is not older than `src/index.ts` — if stale, it warns you to rebuild.

> **Note:** If you make CLI changes during development, always re-run `npm run build` before using `SIM_COMPILED=true`, or preflight will warn about a stale build.

## Dry Run

```bash
SIM_DRY_RUN=true SIM_MNEMONIC="test test test test test test test test test test test test" \
  npx tsx cli/src/simulation/orchestrator.ts --chain base-sepolia run-all
```

## File Structure

```
cli/src/simulation/
├── README.md                    # This file
├── types.ts                     # AgentState, SimConfig, SimState, etc.
├── config.ts                    # Load SimConfig from env vars + chain config
├── wallets.ts                   # HD wallet derivation (BIP-44)
├── agent-home.ts                # Per-agent HOME dir + config.json management
├── fund-agents.ts               # ETH + USDC transfers from master wallet
├── exec.ts                      # Run sherwood CLI with HOME isolation + --chain
│                                #   execSherwood (sync) + execSherwoodAsync (async)
│                                #   SIM_COMPILED: node dist/index.js vs npx tsx
├── pool.ts                      # runInPool<T>() — fixed-window concurrency helper
├── state.ts                     # Read/write SimState to JSON
├── personas.ts                  # 12 agent persona definitions (asset + strategy)
├── proposal-specs.ts            # Strategy-specific proposal CLI arg builder
├── phases/
│   ├── 00-preflight.ts          # Node, npx, esbuild, RPC, mnemonic, balance checks
│   ├── 01-setup.ts              # Derive wallets, fund, mint identities
│   ├── 02-create-syndicates.ts  # 5 creators deploy syndicates (USDC or WETH)
│   ├── 03-join-syndicates.ts    # Joiners request membership
│   ├── 04-approve-members.ts    # Creators approve pending requests
│   ├── 05-deposit.ts            # Everyone deposits (USDC or ETH->WETH)
│   ├── 06-chat.ts               # Agents send XMTP messages
│   ├── 07-propose.ts            # Creators submit diverse strategy proposals
│   ├── 08-vote.ts               # Members vote on proposals
│   ├── 09-heartbeat.ts          # Chat monitoring + voting (sequential — intentional pacing)
│   └── 10-lifecycle.ts          # Execute, settle, re-propose state machine
└── orchestrator.ts              # Main CLI entry point
```
