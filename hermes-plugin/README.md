# sherwood-monitor — Hermes plugin

Turns Sherwood from "a CLI your agent can call" into an always-on fund
management system. The plugin bridges Sherwood's on-chain + XMTP event
stream into Hermes, so a running agent reacts to syndicate activity in
real time, posts summaries back to the syndicate chat, and escalates to
humans via Hermes' existing delivery channels.

## Prerequisites

- Hermes Agent installed
- Node.js 20+ and npm (for Sherwood CLI)
- Sherwood CLI installed globally: `npm i -g @sherwoodagent/cli`
- Sherwood CLI configured: `sherwood config set`

## Install

```bash
hermes plugins install imthatcarlos/sherwood-hermes-plugin
```

## Configure

Edit `~/.hermes/plugins/sherwood-monitor/config.yaml`:

```yaml
syndicates:
  - alpha-fund
  - beta-yield
auto_start: true
xmtp_summaries: true
```

## Usage

Start Hermes:

```bash
hermes
```

The plugin auto-starts monitors for each configured syndicate and injects
a catch-up summary. From chat:

- "start monitoring gamma-fund" → LLM calls `sherwood_monitor_start("gamma-fund")`
- "what's the status of my monitors?" → LLM calls `sherwood_monitor_status()`
- On a new `ProposalCreated`, the agent sees:
  ```
  <sherwood-event syndicate="alpha-fund" source="chain" type="ProposalCreated" ...>
  ```
  and can analyze + respond.

CLI outside chat:

```bash
hermes sherwood status
hermes sherwood start alpha-fund
hermes sherwood tail alpha-fund
```

## What the plugin does

| Event | Plugin behavior |
|---|---|
| On-chain `ProposalCreated` | Inject context + auto-post markdown summary to XMTP |
| On-chain `ProposalExecuted` / `ProposalSettled` / `ProposalCancelled` | Inject + XMTP summary |
| On-chain `VoteCast`, lifecycle events | Inject only (no XMTP post) |
| XMTP `RISK_ALERT` | Inject with `priority="high"` for agent escalation |
| XMTP `APPROVAL_REQUEST` | Inject with `priority="human-escalate"` |
| XMTP plain `MESSAGE` | Inject only when `@`-mention present (configurable) |
| Agent calls `sherwood proposal create/execute/settle` | `pre_tool_call` runs risk checks; `post_tool_call` writes memory + injects `<sherwood-settlement>` block |

## Risk checks

When the agent attempts `sherwood strategy propose` or `sherwood proposal create`,
the plugin blocks if any of these fail:

- Position size > 25% of vault AUM
- Total portfolio exposure > 50% of vault AUM
- Protocol not in the vault's configured mandate list

Day-1 limitation: the default state fetcher returns zeros when `sherwood vault info
--json` is unavailable, causing checks to fail-open (permissive). Configure
your mandate explicitly once `vault info` is fully wired.

## Development

```bash
cd hermes-plugin
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -v
```

Refresh bundled skill pack from the Sherwood repo:

```bash
./scripts/refresh_skill_pack.sh ../skill
```

## Autonomous mode (cron)

Every 15 minutes, a fresh isolated Hermes session runs a cron job that calls
`sherwood_monitor_cron_tick` for each configured syndicate. The tick checks for
new interesting events (proposals created, settled, executed, cancelled; risk
alerts; approval requests) since the last run, advances a cursor, and delivers a
concise digest via Hermes' configured gateway (Telegram, Discord, etc.). If all
ticks return empty events and no concentration alerts, nothing is delivered.

Cursor state is persisted at `~/.hermes/plugins/sherwood-monitor/cron_cursor.json`.

The cron job is set up once from the BOOT.md routine:

```python
cronjob(
    action="create",
    prompt="For each syndicate in ~/.hermes/plugins/sherwood-monitor/config.yaml, call sherwood_monitor_cron_tick(subdomain, include_exposure=true). Compose a concise digest of any returned events and concentration alerts. If all ticks returned empty events and no alerts, say nothing (deliver no message). Otherwise deliver the digest.",
    schedule="*/15 * * * *",
    name="sherwood-monitor"
)
```

## Cross-syndicate exposure

Ask the agent "what's my total Aerodrome exposure?" or call
`sherwood_monitor_exposure()` directly. The tool aggregates vault positions
across all configured syndicates, returns total AUM, per-protocol breakdown,
concentration percentages, and any protocols above the concentration threshold.

Configure the threshold in `config.yaml`:

```yaml
concentration_threshold_pct: 30  # default 30%
```

When a protocol's share of total AUM exceeds this value, the tool returns a
`concentration_alerts` list so the agent can flag it or take action.

## Institutional memory

After every `sherwood proposal execute` or `sherwood proposal settle` command,
the plugin injects a `<sherwood-settlement>` block into the agent's next turn:

```
<sherwood-settlement syndicate="alpha-fund" action="settle" proposal_id="42"
  pnl_usd="500.0" tx="0xabc...">
REMEMBER THIS — use the remember-settlement skill to persist it to memory.
</sherwood-settlement>
```

The bundled `remember-settlement` skill primes the agent to call its `memory`
tool and store a one-line record. Over weeks this becomes a fund history the
agent can query: "Has the Aerodrome LP strategy been profitable?", "Which
proposer has the best track record?", "What's our average P&L on 7-day
strategies for alpha-fund?"

## License

MIT
