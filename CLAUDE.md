# CLAUDE.md — Sherwood Development Guide

## Git Workflow

**NEVER commit directly to `main`.** Always:

1. Create a feature branch: `git checkout -b <type>/<short-description>`
   - Types: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`
   - Examples: `feat/vault-agent-registry`, `fix/usdc-decimals`, `test/vault-redeem`

2. Make atomic commits with conventional commit messages:
   - `feat: add syndicate-level caps to vault contract`
   - `fix: account for USDC 6 decimals in deposit math`
   - `test: vault redeem returns pro-rata shares`
   - `docs: update README with vault architecture`

3. Push the branch and create a PR with the template (auto-loaded from `.github/`)

4. PR description must include:
   - Which package is touched (`contracts`, `cli`, `app`)
   - What changed (adds / fixes / refactors)
   - How it was tested (forge test output, manual steps, etc.)

5. Never force push, never delete branches, never rewrite history.

6. **Before `git checkout -b` for a new feature, `git stash` any pre-staged work** — the staged index carries into the new branch and you'll silently commit prior work on the wrong branch.

## Code-review workflow

For multi-domain audits/reviews, dispatch parallel subagents by domain (vault / governor / strategies / tokenomics / adapters) rather than sequential whole-codebase passes. Cross-cutting patterns surface better when each agent can go deep. For ToB-style maturity + process reviews, use the `building-secure-contracts`, `entry-point-analyzer`, `dimensional-analysis`, and `spec-to-code-compliance` skills.

- **ToB skill catalog** at `~/.claude/plugins/cache/trailofbits/` — `guidelines-advisor`, `insecure-defaults`, `entry-point-analyzer`, `code-maturity-assessor`, `spec-to-code-compliance`, `second-opinion`, `property-based-testing`, `dimensional-analysis`, `audit-prep-assistant`, etc. For spec review, dispatch parallel subagents each loading one `SKILL.md` + the target spec — avoids main-context bloat.
- **Spec authoring**: design specs live at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. Do NOT accumulate review changelogs inside the spec — git log + PR comment thread hold that history, the spec should read as a final design. If you catch yourself writing a 4th "Changelog — review N" section, stop and trim.
- **Fetch a specific PR comment by permalink**: `gh api repos/<owner>/<repo>/issues/comments/<comment_id> --jq '.body'` (the URL suffix `#issuecomment-<id>` gives you the comment_id).

## Project Structure

```
contracts/      Foundry — Solidity smart contracts
cli/            TypeScript CLI (viem, Commander)
app/            Next.js dashboard
cron/           Hermes Agent skills + jobs template for paper-trading + monitoring
mintlify-docs/  Mintlify documentation site (git submodule → docs.sherwood.sh)
```

For background paper-trading + vault/proposal/chat monitoring via cron, see
`cron/README.md`. The four shipped skills are agent-runtime-agnostic
(SKILL.md format) and `cron/install.sh` registers them with Hermes.

## Documentation

Full protocol and CLI documentation: **https://docs.sherwood.sh/**

Source lives in `mintlify-docs/` (git submodule pointing to `imthatcarlos/mintlify-docs`).

**Authority order when docs and code disagree:** `contracts/chains/{chainId}.json` (addresses) → `contracts/src/` (behavior) → this CLAUDE.md (intent) → `mintlify-docs/` last. Known drift areas: `reference/deployments.mdx` (stale Base addresses), `settlement.mdx` (references removed `lockRedemptions`, wrong `executeBatch` path), `concepts.mdx` (says shareholders can `vetoProposal` — they can't), `collaborative-proposals.mdx` (incorrect auth claims). See issue #226 §4.

LLM-friendly versions:
- `https://docs.sherwood.sh/llms.txt` — structured index
- `https://docs.sherwood.sh/llms-full.txt` — complete docs in a single file

Key sections: [Learn](https://docs.sherwood.sh/learn/quickstart) | [Protocol](https://docs.sherwood.sh/protocol/architecture) | [CLI](https://docs.sherwood.sh/cli/commands) | [Reference](https://docs.sherwood.sh/reference/deployments)

**Keep docs in sync.** When changes touch contracts, CLI, or app, update the corresponding pages in `mintlify-docs/`:
- Contract changes → `protocol/architecture.mdx`, `protocol/governance/*.mdx`
- CLI command changes → `cli/commands.mdx`, `cli/governance-commands.mdx`
- Address/deployment changes → `contracts/chains/{chainId}.json` (auto-written by deploy scripts), `cli/src/lib/addresses.ts`, `reference/deployments.mdx`, `skill/ADDRESSES.md`
- Integration changes → `reference/integrations/*.mdx`
- New features → `learn/concepts.mdx` if it introduces a new primitive

## Contracts

- Solidity 0.8.28, Foundry, OpenZeppelin upgradeable (UUPS)
- USDC on Base has **6 decimals** not 18 — always account for this
- Use SafeERC20 for all token transfers
- Run `forge build` and `forge test` before every PR
- Run `forge fmt` before committing
- SyndicateGovernor runtime is **24,523 / 24,576 bytes (53-byte margin)** as of 2026-04. Run `forge build --sizes` before any governor edit; CI should fail above 24,500

### Address Management

- Deploy scripts auto-write to `contracts/chains/{chainId}.json` (CAPS_SNAKE_CASE keys: `SYNDICATE_FACTORY`, `SYNDICATE_GOVERNOR`, etc.)
- Admin scripts (QueueParams, FinalizeParams) read from the same JSON — no env vars needed
- All scripts inherit `script/ScriptBase.sol` for shared helpers (`_writeAddresses`, `_readAddress`, `_checkAddr`, `_checkUint`)
- After redeployment, also update: `cli/src/lib/addresses.ts`, `mintlify-docs/reference/deployments.mdx`

### Architecture

- **SyndicateVault** — ERC-4626 vault with ERC20Votes for governance. Standard `redeem()`/`withdraw()` for LP exits (no custom ragequit). `_decimalsOffset()` = `asset.decimals()` for first-depositor inflation protection (shares have 12 decimals for USDC). Deposits and `rescueERC20` are blocked during active proposals (`redemptionsLocked()`).
- **SyndicateGovernor** — Proposal lifecycle, optimistic voting, execution, settlement, collaborative proposals. Inherits `GovernorParameters` (abstract) for parameter setters/timelock and (once PR #229 lands) `GovernorEmergency` (abstract) for `unstick` / `emergencySettleWithCalls` / `finalizeEmergencySettle` — the latter extraction is required to fit the guardian-review changes under the 24,576-byte limit (see PR #229 §11).
- **GovernorParameters** — Abstract contract with constants, bounds, parameter setters (all timelock-gated: queue → delay → finalize), and validation helpers. Extracted to reduce governor bytecode.
- **GuardianRegistry** _(designed in PR #229, not yet implemented)_ — UUPS upgradeable single contract for guardian staking + owner staking + review vote accounting + slashing + epoch-based Block rewards. Lives alongside the governor; governor calls privileged hooks. Replaces the implicit "governor.emergencySettle → owner-instant arbitrary calldata" escape hatch with a guardian-reviewed `emergencySettleWithCalls` path. See `docs/superpowers/specs/2026-04-19-guardian-review-lifecycle-design.md`.
- **SyndicateFactory** — UUPS upgradeable factory. Deploys vault + registers it with the governor. Creation fee, vault upgrades, paginated queries. Owner-configurable: `setVaultImpl`, `setGovernor`, `setCreationFee`, `setManagementFeeBps`, `setUpgradesEnabled`. Once PR #229 lands: `guardianRegistry` becomes **immutable** post-init, `createSyndicate` requires the creator to have called `prepareOwnerStake` first, and `rotateOwner(vault, newOwner)` provides a timelocked recovery path for dead vaults.
- **BatchExecutorLib** — Stateless 63-line contract for `delegatecall`-based batch execution. Note: the "delegatecall to BatchExecutorLib only" invariant is **not enforced in code** — `_executorImpl` is set at init with no codehash check (issue #226 §2.4). Treat as a trust assumption until fixed.
- **Strategy Templates** — `BaseStrategy` (abstract) + `MoonwellSupplyStrategy` + `AerodromeLPStrategy`. ERC-1167 clonable. Vault calls `execute()`/`settle()` via batch.

### Governor Key Concepts

- **Optimistic governance** — Proposals pass by default after voting period ends. Only rejected if AGAINST votes reach `vetoThresholdBps`. Vault owner can also `vetoProposal()` to reject Pending/Approved proposals. **After PR #229 lands:** `vetoProposal` narrowed to `Pending` only; once the proposal enters `GuardianReview`, the only way to block is a guardian block-quorum.
- **VoteType enum** — `For`, `Against`, `Abstain` (replaces boolean vote).
- **Separate `executeCalls` / `settlementCalls`** — Proposals store opening and closing calls in two distinct arrays. No `splitIndex`.
- **Parameter timelock** — All governance parameter changes are queued with a configurable delay (6h–7d). Owner calls the setter (queues), waits, then calls `finalizeParameterChange(paramKey)`. Parameters are re-validated at finalize time. Owner can `cancelParameterChange(paramKey)` at any time.
- **Protocol fee** — `protocolFeeBps` + `protocolFeeRecipient` taken from gross profit before agent and management fees. Timelocked. Max 10%. Setting nonzero `protocolFeeBps` requires `protocolFeeRecipient` to be set first.
- **Two settlement paths** (current): (1) `settleProposal` — proposer can call anytime, anyone else after strategy duration; (2) `emergencySettle` — vault owner after duration, tries pre-committed calls first then falls back to custom calls. **After PR #229 lands:** `emergencySettle` is split into three functions — `unstick()` (owner-instant, pre-committed calls only, no new calldata), `emergencySettleWithCalls(calls)` (opens a guardian-reviewed window), and `finalizeEmergencySettle(calls)` (executes after review if not blocked, slashes owner if blocked).
- **Vault reads governor from factory** — no `setGovernor` on vault, no lock/unlock storage. `redemptionsLocked()` checks `governor.getActiveProposal()` directly.

### Guardian Review Lifecycle (designed in PR #229, not yet implemented)

- **New proposal state:** `GuardianReview` inserted between `Pending` and `Approved`. Lifecycle: `Draft → Pending → GuardianReview → Approved → Executed → Settled`.
- **Staked guardians** review calldata during the review window (default 24h). Block quorum (30% of total guardian stake, default) → proposal `Rejected`, approvers slashed (WOOD **burned**, not sent to treasury).
- **Owner stake** required at vault creation (`minOwnerStake`, default 10k WOOD). `emergencySettleWithCalls` re-checks the bond at call time using `requiredOwnerBond(vault) = max(floor, TVL * ownerStakeTvlBps / 10_000)` so owners can't stake at TVL=0 and drain at scale.
- **Epoch-based Block rewards** — protocol funds `epochBudget` each 7-day epoch via `GuardianRegistry.fundEpoch`. Guardians who voted Block on blocked proposals claim pro-rata.
- **Cold-start fallback** — reviews opened with `totalStakeAtOpen < MIN_COHORT_STAKE_AT_OPEN` (50k WOOD) return `blocked=false` unconditionally; owner veto remains active defence during bootstrap.
- **Appeal path** — slashed parties petition multisig; `refundSlash` draws from a separate Slash Appeal Reserve, capped at 20% of reserve per epoch.
- **Bootstrap commitment** — protocol multisig runs a guardian-of-last-resort during weeks 1–12.
- Full spec: `docs/superpowers/specs/2026-04-19-guardian-review-lifecycle-design.md` (PR #229).

## CLI

- TypeScript, viem for chain interaction, Commander for CLI
- Provider pattern: each DeFi protocol = a provider with standard interface
- `npm run typecheck` before every PR
- **Distribution**: Published to npm as `@sherwoodagent/cli` (`npm i -g @sherwoodagent/cli`). Standalone binary via GitHub releases as secondary (no chat/XMTP support).
- **Version bumps are mandatory for every PR that touches `cli/` code.** Bump the `version` field in `cli/package.json` before creating the PR. Stay on `0.x` until mainnet — use **minor** bumps (`0.3.0` → `0.4.0`) for new features or breaking changes, **patch** bumps (`0.3.5` → `0.3.6`) for bug fixes and small improvements. First mainnet release will be `1.0.0`. A merge to main with a new version triggers an npm publish automatically.

### CLI Operational Notes

- `which sherwood` → `~/.linuxbrew/bin/sherwood` → symlinks into the **local `cli/dist/index.js`**. `npm run build` is enough to deploy changes — no `npm install -g` needed. Cron picks up rebuilds immediately.
- `sherwood agent start --auto --cycle 1` — runs ONE dry-run cycle, then exits. Used by the hermes trade-scanner cron. For continuous runs use `--cycle 15m`.
- `sherwood chat <name> send --stdin` — pipe via stdin to avoid bash `$`-expansion (`$10,000` → `0,000`). Required for any dynamic message containing `$`. Added in 0.40.2.

### Calibrator

- **Candle path** (`sherwood agent calibrate`) — re-fetches OHLC from CoinGecko and recomputes signals from candles only. **Cannot replay HL flow / fundingRate / smartMoney** (those need live data). Output is a lower bound on production performance; many configs show 0 trades because the candle-only signal stack rarely fires.
- **Replay path** (`sherwood agent calibrate --from-history`) — replays captured production signals from `signal-history.jsonl`. Far truer to live behavior. Add `--last <days>` after a scoring change to ignore stale rows captured under the prior code.
- Backtester is direction-aware: `Position.side` + SHORT entries on SELL signals; exit math (stop/TP/trail) flips for shorts. Ranging-regime BUY threshold currently `0.25`, SELL `-0.25`.

### Agent State Files (`~/.sherwood/agent/`)

- `cycles.jsonl` — per-cycle summary: `{cycleNumber, timestamp, signals: [{token, score, action, regime}], tradesExecuted, exitsProcessed, portfolioValue, dailyPnl, errors}`. Append-only.
- `signal-history.jsonl` — per-token full signal stack including HL/funding/dexFlow values + regime + weights used. The richer log; what `sherwood agent calibrate --from-history` replays.
- `portfolio.json` — positions, cash, PnL counters. Atomic write via `.tmp` rename.
- `trades.json` — closed-trade history (entry/exit/PnL/reason).
- `calibration-results.json` / `replay-calibration-results.json` — last calibrator run output.

## Chat (XMTP)

- Encrypted group messaging via `@xmtp/node-sdk` — direct API calls, singleton Client, no subprocess spawning
- DB stored at `~/.sherwood/xmtp/` with deterministic encryption key derived from sherwood private key (`keccak256(privateKey + "xmtp-db-key")`)
- Single MLS installation per DB — eliminates stale KeyPackage issues (fixes #110)
- Each syndicate gets an XMTP group on creation, group ID stored as ENS text record + cached locally
- Creator is super admin — only they can add members via `syndicate add`
- Agents auto-added to chat after registration, with `AGENT_REGISTERED` lifecycle message
- All messages sent as JSON `ChatEnvelope` text (markdown and reactions encoded as envelope types)
- `--public-chat` on `syndicate create` / `--public` on `chat init` enables public chat (adds dashboard spectator)
- `sherwood chat <name> public --on/--off` toggles dashboard spectator access after creation
- Config stored at `~/.sherwood/config.json` (group ID cache, inbox ID cache)

### Chat Commands
- `sherwood chat <name>` — stream messages in real-time
- `sherwood chat <name> send "msg"` — send a text message
- `sherwood chat <name> send "msg" --markdown` — send formatted markdown
- `sherwood chat <name> react <id> <emoji>` — react to a message
- `sherwood chat <name> log` — show recent messages
- `sherwood chat <name> members` — list group members
- `sherwood chat <name> add <addr>` — add member (creator only)
- `sherwood chat <name> init [--force] [--public]` — create XMTP group + write ENS record (creator only)
- `sherwood chat <name> public --on/--off` — toggle dashboard spectator access

### Agent Chat Onboarding
- XMTP requires each wallet to have initialized an XMTP client at least once before it can be added to groups
- `syndicate join` auto-initializes the agent's XMTP identity via `getXmtpClient()`, so `syndicate approve` can immediately add them to the group
- If XMTP init fails during join, the approve flow warns and the agent can run `sherwood chat <name>` later to join manually

### XMTP Troubleshooting

**Stale group ID after `init --force`** — `getGroup()` validates cached IDs exist in the local DB and auto-invalidates stale entries. If agents have a hardcoded group ID, they need to clear `~/.sherwood/config.json` groupCache or let the CLI re-resolve via conversation name search.

**First run after migration from `@xmtp/cli`** — On first use, the node-sdk creates a new DB in `~/.sherwood/xmtp/` and automatically revokes all stale installations from the old `~/.xmtp/` era. The old `~/.xmtp/` directory can be safely deleted after migration.

## Agent Identity (ERC-8004)

- Agents and syndicate creators must have an ERC-8004 identity NFT (standard ERC-721)
- `SyndicateFactory.createSyndicate()` requires `creatorAgentId` — verifies NFT ownership on-chain
- `SyndicateVault.registerAgent()` requires `agentId` — NFT must be owned by `agentAddress` or vault `owner`
- Verification at registration time only (not per-execution) — keeps gas costs low
- `AgentConfig` struct stores `agentId` for reference/display

### Deployed Contracts (not ours — ERC-8004 standard)
| Contract | Base Mainnet | Base Sepolia |
|----------|-------------|--------------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

### Agent0 SDK (prerequisite for creating/joining syndicates)
Agents mint their ERC-8004 identity via the Agent0 SDK (`@agent0lab/agent0-ts`). This is a prerequisite before calling `syndicate create` or `syndicate add`. The SDK handles IPFS metadata pinning and on-chain registration. See the levered-swap skill for the full flow.

## EAS (Attestations)

- EAS predeploys on Base: EAS at `0x4200000000000000000000000000000000000021`, SchemaRegistry at `0x4200000000000000000000000000000000000020`
- Two schemas: `SYNDICATE_JOIN_REQUEST` (agent → creator) and `AGENT_APPROVED` (creator → agent)
- Schemas registered one-time via `cli/scripts/register-eas-schemas.ts`, UIDs stored in `addresses.ts`
- Uses viem directly for on-chain writes (no ethers/EAS SDK dependency) — data encoded with `encodeAbiParameters`
- Queries via EAS GraphQL API (fetch-based): `https://base.easscan.org/graphql` / `https://base-sepolia.easscan.org/graphql`
- `syndicate approve` is a superset of `syndicate add` — registers agent + creates approval attestation + XMTP
- `syndicate add` remains for backwards compatibility (direct registration without EAS)

### EAS CLI Commands
- `sherwood syndicate join --subdomain <name> --message "..."` — agent requests to join
- `sherwood syndicate requests` — creator views pending requests
- `sherwood syndicate approve --agent-id <id> --wallet <addr>` — creator approves + registers
- `sherwood syndicate reject --attestation <uid>` — creator rejects by revoking attestation

## Testing

- Contracts: Foundry tests in `contracts/test/`, fork tests for protocol integrations
- CLI: vitest (when wired up)
- Always include test results in PR description
- `cli/src/lib/network.test.ts` has 4 pre-existing failures from `BASE_RPC_URL` env-var leak (Moonwell RPC override). Always verify with `git stash && npm test` before assuming new test failures are from your changes.
- `forge coverage` currently reverts with Yul stack-too-deep in `SyndicateGovernor.propose()` struct literal (L213) — refactor the literal (split field assignments) before running coverage
- No invariant tests yet. New invariant harnesses go in `test/invariants/` using `StdInvariant` + a handler contract
- Pre-mainnet punch list: issues **#225 (bugs)** and **#226 (process/design)**. Canonical consolidated tracker: **`docs/pre-mainnet-punchlist.md`** — every fix PR should reference the ref code (e.g. `fixes V-C1`, `closes G-C4`) and mark the punch list row closed. New findings go into the issues first, then propagate to the tracker.

## Key Addresses (Base)

- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)
- Moonwell Comptroller: `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`
- Uniswap V3 SwapRouter: `0x2626664c2603336E57B271c5C0b26F421741e481`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`

## Safety

- All contracts (Vault, Governor, Factory) are UUPS upgradeable — never change storage layout order, append new slots only, reduce `__gap` accordingly
- Two-layer permission model: on-chain caps (vault) + off-chain policies (agent software)
- Agent wallets are standard EOAs
- Syndicate-level caps are hard limits — no agent can bypass them
- Governor parameter changes require timelock delay — prevents instant governance manipulation
- ERC-4626 inflation protection via dynamic `_decimalsOffset()` — scales to any asset denomination
- `delegatecall` to `BatchExecutorLib` only (stateless, 63-line contract) — not arbitrary strategy contracts. **Note**: this invariant is not enforced in code; see Architecture note above.
- **Exception to the timelock claim**: `setProtocolFeeRecipient` is owner-instant while `setProtocolFeeBps` is timelocked. Asymmetric; see issue #226 A7.
- **Exception to the caps claim**: `maxPerTx` / `maxDailyTotal` / `maxBorrowRatio` / per-agent caps / target allowlist exist in `mintlify-docs/` but NOT in code (issue #226 §4 A10). Treat as aspirational until built.
- `SyndicateFactory.setGovernor` is a global retroactive switch — one call rewires every existing vault's governor because `vault._getGovernor()` reads live. Rotate factory owner to multisig+timelock before mainnet.

## Aspirational / not-yet-implemented (read docs with caution)

These appear in `mintlify-docs/` or earlier CLAUDE.md text but are **not live in code**. See `docs/pre-mainnet-punchlist.md` §6 for the full doc↔code mismatch catalog.
- `maxPerTx` / `maxDailyTotal` / `maxBorrowRatio` / per-agent caps / target allowlist on the vault _(punch list: A10, A35)_
- EAS `STRATEGY_PNL` attestation minted at settlement _(punch list: A23)_
- `SyndicateGauge.claimLPRewards` — always reverts (`_calculateLPReward` stub) _(punch list: T-C1)_
- WOOD/shares Uniswap V3 "early exit" pool _(punch list: A41)_
- Automated price/lock-ratio circuit-breaker triggers in `Minter` (manual-only today)
- `expireCollaboration(proposalId)` function referenced in docs (doesn't exist; lazy resolution only) _(punch list: A28)_
- `_distributeFees` try/catch + blacklist-resilient settlement — claim in `economics.mdx`, not in code _(punch list: A22, W-1)_
- Shareholder `vetoProposal` — claimed in `concepts.mdx`, only vault-owner can actually call it _(punch list: A18)_
- Per-syndicate governance parameters — claim in `concepts.mdx`, actual model is global `GovernorParams` _(punch list: A19)_

## Designed, not yet implemented (PR #229)

Listed here so the distinction between "vapor" and "spec'd and under review" is explicit:
- **GuardianRegistry.sol** — staking, review votes, slashing, epoch rewards, appeal reserve. Single UUPS contract.
- **GuardianReview lifecycle state** in `SyndicateGovernor` between `Pending` and `Approved`.
- **`GovernorEmergency.sol` abstract** — extracted for bytecode headroom, holds `unstick` / `emergencySettleWithCalls` / `cancelEmergencySettle` / `finalizeEmergencySettle`.
- **Owner stake at vault creation** (`minOwnerStake` + TVL scaling pipe, scaling disabled by default).
- **Factory `rotateOwner(vault, newOwner)`** dead-vault recovery path.
- **Pause + deadman auto-unpause** on the registry.
- **Slash Appeal Reserve** funded by treasury; `refundSlash` capped at 20%/epoch.
