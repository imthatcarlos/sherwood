# Sherwood-Monitor Smoke Test Runbook

> **For the Hermes agent:** this is your test plan. Execute the phases in order. Stop on the first failure and report what broke. Gather artifacts into `$RUN_DIR` (see Phase 0). Deliver a final report to the user.

## What you're testing

The `sherwood-monitor` plugin you're running. Your job is to prove it works end-to-end against a live Sherwood deployment and report with evidence. "Evidence" means logs, state files, and observed behavior — not assertions.

## Ground rules

- **Default target is `alpha-fund` on Base mainnet.** The user has designated this as the test subject. Do NOT create new syndicates, do NOT test against production funds other than this one. If `sherwood config get` shows a different network or wallet than expected, confirm with the user before proceeding.
- **Mainnet means real capital.** Any command that writes state on-chain (proposals, votes, executes, settles) costs gas and commits funds. The default mode of this runbook is **observation-only** — validate the plugin by watching activity that's already happening, not by creating synthetic activity. Any phase that requires a write asks for explicit user approval first, with a single-line "are you sure?" prompt.
- **Quiet is a valid pass.** If a layer produces "no output, no events, no complaints" — that can be correct. Log the absence; don't assume failure.
- **One phase at a time.** Do not run ahead. Each phase's prerequisites depend on prior phases passing.
- **Attach evidence.** For every pass/fail in your report, paste the command output or file snippet that justifies it.
- **Never retry writes.** If a write command fails, STOP and report. Do not assume idempotency.

---

## Phase 0 — Setup

1. **Create a run directory for artifacts:**
   ```bash
   export RUN_DIR=/tmp/sherwood-monitor-smoke-$(date +%s)
   mkdir -p "$RUN_DIR"
   echo "Run dir: $RUN_DIR"
   ```

2. **Confirm the target with the user (once):**
   - Default: `SUB=alpha-fund` on Base mainnet.
   - Ask: "Proceeding against alpha-fund on Base mainnet — confirm?" If they say a different subdomain or network, use that instead. If they decline, STOP.
   - Ask: "Is there any activity you expect in the next ~10 minutes (a proposal you're about to create, an LP vote coming in, a settlement elapsing)? If so, which? This helps me know what to watch for in Phase 3."
   - Save answers to `$RUN_DIR/0-targets.txt`.

3. **Prepare loggers:**
   ```bash
   # Plugin log (if not already configured, start it now)
   : > "$RUN_DIR/sherwood-monitor.log"
   export PYTHONUNBUFFERED=1

   # Snapshot plugin state dir
   ls -la ~/.hermes/plugins/sherwood-monitor/ > "$RUN_DIR/plugin-dir-before.txt" 2>&1
   ls -la ~/.sherwood/sessions/ > "$RUN_DIR/sessions-before.txt" 2>&1 || true
   ```

4. **Verify preconditions:**
   ```bash
   sherwood --version      # must be >= 0.4.0
   sherwood config get     # note the network + wallet address
   sherwood vault info $SUB --json > "$RUN_DIR/0-vault-info.json" || true
   sherwood proposal list $SUB --json > "$RUN_DIR/0-proposals-before.json" || true
   ```
   Save the first two outputs to `$RUN_DIR/preflight.txt`. The last two snapshot the current on-chain state so you can diff later.

**Pass condition:** `$SUB` resolves to a real vault, `$RUN_DIR` exists, sherwood CLI version ≥ 0.4.0, network matches user expectation, vault info + proposal list are readable.

---

## Phase 1 — Plugin surface

Goal: confirm every tool + hook is wired correctly.

1. Call `sherwood_monitor_status()`. Expected: `{"syndicates": []}` if none started, or a list. Save response to `$RUN_DIR/1-status-before.json`.

2. Call `sherwood_monitor_exposure()`. This will aggregate across whatever is in `~/.hermes/plugins/sherwood-monitor/config.yaml`. Save response to `$RUN_DIR/1-exposure-initial.json`.

3. Inspect the plugin config:
   ```bash
   cat ~/.hermes/plugins/sherwood-monitor/config.yaml > "$RUN_DIR/1-config.yaml"
   ```
   If `$SUB` is not in the `syndicates` list, append it (do not overwrite other syndicates):
   ```bash
   # Use yq or python to insert — ask user if unsure.
   ```

4. List your own tools to the user. Name every tool starting with `sherwood_monitor_`. You should see exactly: `sherwood_monitor_start`, `sherwood_monitor_stop`, `sherwood_monitor_status`, `sherwood_monitor_exposure`, `sherwood_monitor_cron_tick`.

**Pass condition:** all 5 tools present. Status and exposure return well-formed JSON. Config is writable. Save a one-paragraph summary to `$RUN_DIR/1-PASS.txt`.

**If fail:** STOP. Report which tool was missing or what error came back. Do not proceed.

---

## Phase 2 — Subprocess lifecycle

Goal: prove the streaming supervisor spawns, reads, and stops a child process cleanly.

1. Call `sherwood_monitor_start(subdomain=$SUB)`. Expected: `{"started": true, "pid": <non-zero>}`. Save to `$RUN_DIR/2-start.json`.

2. Verify the process is actually running:
   ```bash
   ps -p <pid> -o pid,ppid,command > "$RUN_DIR/2-ps.txt"
   ```
   The command column should contain `sherwood session check $SUB --stream`.

3. Wait 10 seconds, then `sherwood_monitor_status()`. Save to `$RUN_DIR/2-status-running.json`. Verify:
   - `uptime_seconds` > 5
   - `stderr_tail` is a list (may be empty)

4. Call `sherwood_monitor_stop(subdomain=$SUB)`. Expected: `{"stopped": true}`.

5. Verify the process is gone:
   ```bash
   ps -p <pid> > "$RUN_DIR/2-ps-after-stop.txt" || echo "process gone (expected)"
   ```

6. `sherwood_monitor_status()` should return empty syndicates or no pid. Save to `$RUN_DIR/2-status-after-stop.json`.

**Pass condition:** subprocess spawned, observed via ps, stopped cleanly, no zombies.

**If fail:** inspect `$RUN_DIR/2-ps.txt` — if the subprocess never appeared, the plugin's `cfg.sherwood_bin` may be wrong. Report what you found.

---

## Phase 3 — Reactive event injection (mainnet-safe)

Goal: prove events arriving from the subprocess actually reach you on the next turn via `pre_llm_call`.

**Mainnet constraint:** you do NOT create proposals or trigger on-chain state changes. Instead, you replay recent history by resetting the session cursor, then observe the injection.

### Strategy: replay-via-cursor-reset

The Sherwood CLI stores a per-syndicate cursor at `~/.sherwood/sessions/`. Resetting it to a block ~1000 blocks back (≈33 min on Base) causes the next `session check --stream` to re-emit every event since then as if fresh. The events have already happened on-chain — this is read-only.

### Setup

1. Start the supervisor: `sherwood_monitor_start(subdomain=$SUB)` (or make sure it's running from Phase 2).
2. Wait 5 seconds for the process to settle.
3. Get current block number:
   ```bash
   sherwood session check $SUB | jq '.meta' > "$RUN_DIR/3-meta.json"
   ```
4. Call `sherwood_monitor_status()` and note `events_seen` for `$SUB`. Save as `EVENTS_BEFORE`.

### Replay recent events

1. Stop the supervisor first so the cursor reset isn't racing:
   ```text
   sherwood_monitor_stop(subdomain=$SUB)
   ```

2. Reset the session cursor back ~1000 blocks:
   ```bash
   CURRENT_BLOCK=$(cast block-number --rpc-url https://mainnet.base.org 2>/dev/null || sherwood session check $SUB | jq -r '.meta.blocksScanned as $b | (input_filename)')
   # Simpler: use sherwood's own reset which supports --since-block
   REPLAY_FROM=$((CURRENT_BLOCK - 1000))
   sherwood session reset $SUB --since-block $REPLAY_FROM
   ```

   If `session reset` doesn't support `--since-block`, check `~/.sherwood/sessions/$SUB.json` and edit `lastBlockNumber` to a value ~1000 blocks earlier. Save the before/after JSON to `$RUN_DIR/3-cursor-reset.diff`.

3. Restart the supervisor: `sherwood_monitor_start(subdomain=$SUB)`.

4. **Wait 45 seconds.** The streaming subprocess will catch up by re-emitting every event in the replay window.

### Observe the injection

1. Say something neutral that gives the LLM an excuse to look at recent activity: *"What's happened on $SUB recently? Just summarize, don't do anything."*

2. **Your own response to that turn is the evidence.** If the `pre_llm_call` hook injected `<sherwood-event>` blocks, they appear in your context this turn:
   ```
   <sherwood-event syndicate="$SUB" source="chain" type="..." ...>
   ```

3. Record in `$RUN_DIR/3-injection-evidence.md`:
   - YES / NO — did you see `<sherwood-event>` blocks injected?
   - Quote the first 2–3 blocks you received (redact wallet addresses if sensitive).
   - How many distinct events did the injection include? Should roughly match what `sherwood session check $SUB` reports in its `events` array for the replay window.
   - Did your summary reference events you weren't explicitly told about? (Proves they came from injection, not tool calls.)

4. Call `sherwood_monitor_status()` again. `events_seen` for `$SUB` should now be `EVENTS_BEFORE + N` where N matches the event count above.

### XMTP auto-post check (observational only)

Auto-posts only happen for LIVE proposal lifecycle events, not replays (the plugin's post-fn runs on the handler path, so replays will also trigger posts — but that would spam the real group). To avoid this:

**Before replay:** temporarily disable auto-posts by editing config:
```bash
sed -i.bak 's/xmtp_summaries: true/xmtp_summaries: false/' ~/.hermes/plugins/sherwood-monitor/config.yaml
```

And restore after replay:
```bash
mv ~/.hermes/plugins/sherwood-monitor/config.yaml.bak ~/.hermes/plugins/sherwood-monitor/config.yaml
```

Skip XMTP validation in this phase. Instead, record to `$RUN_DIR/3-xmtp-note.md`: "xmtp_summaries disabled during replay to prevent spam; XMTP auto-post verified separately via code review of handlers.py — see CHAIN_INJECT_AND_POST set."

**Pass condition:** injection observed (≥1 event), `events_seen` counter advanced, no spam sent to the real XMTP group.

**If fail:**
- No injection → check `$RUN_DIR/sherwood-monitor.log` for errors. Check `sherwood_monitor_status()` `stderr_tail` for subprocess errors. Check `~/.sherwood/sessions/$SUB.json` still has the old cursor (reset may not have worked).
- Injection but wrong count → replay window may have had no interesting events. Try a larger replay window (2000 blocks back).
- Cursor reset didn't work → the CLI version may be older than expected. Skip the replay path and instead: leave the supervisor running for 10+ min and wait for a natural event (poll `events_seen` periodically). Document this fallback in the report.

---

## Phase 4 — Risk guardrails (block-only on mainnet)

Goal: prove `pre_tool_call` blocks oversized proposals with a reason.

**Mainnet constraint:** the "oversized" test is safe — a blocked proposal never reaches the chain, costs zero gas, commits no capital. The "compliant" test would create a real proposal and is SKIPPED by default. Only run it if the user explicitly opts in.

### Oversized test (safe, block-only)

1. Get the vault's AUM so you can calculate what "oversized" means. You already saved this in Phase 0 as `$RUN_DIR/0-vault-info.json`:
   ```bash
   AUM=$(jq -r '.aumUsd' "$RUN_DIR/0-vault-info.json")
   echo "AUM: $AUM" > "$RUN_DIR/4-aum.txt"
   ```

2. **If AUM is 0 or missing:** the risk hook fails-open (allows everything). Document in `$RUN_DIR/4-NOTE-failopen.txt` and SKIP the rest of Phase 4, marking it YELLOW not GREEN.

3. If AUM > 0, plan a proposal at **30% of `$AUM`** (cap is 25% — should be blocked). Compute the size:
   ```bash
   OVERSIZED=$(python3 -c "print(int($AUM * 0.30))")
   echo "Oversized size: $OVERSIZED" >> "$RUN_DIR/4-aum.txt"
   ```

4. Attempt to create it via your terminal tool. Full command including `--size-usd` and `--protocol` so the hook parses it:
   ```bash
   sherwood proposal create $SUB --protocol moonwell --size-usd $OVERSIZED
   ```

5. **Expected:** the pre_tool_call hook returns `{"blocked": True, "reason": "...position sizing..."}`. Your terminal tool should return this as its result. The command should NEVER have been executed.

6. Verify no new proposal appeared on-chain (diff against Phase 0 snapshot):
   ```bash
   sherwood proposal list $SUB --json > "$RUN_DIR/4-proposals-after-block.json"
   diff <(jq '. | length' "$RUN_DIR/0-proposals-before.json") <(jq '. | length' "$RUN_DIR/4-proposals-after-block.json")
   ```
   Should report no difference.

7. Save the blocked-reason text to `$RUN_DIR/4-block-evidence.md`.

### Compliant test (SKIP unless explicitly approved)

This would create a real on-chain proposal. By default: **SKIP**. Record in `$RUN_DIR/4-compliant-SKIPPED.txt`:
"Compliant write-path test skipped by default on mainnet. Block-path validated above. Write-path was exercised in unit tests and in Layer 2 of the unit suite."

Only proceed with the compliant test if the user explicitly says:

> "Yes, create a real $X proposal on $SUB to validate the allow-path."

If so:
1. Confirm the exact size, protocol, and duration with the user one more time.
2. Execute. Save tx hash to `$RUN_DIR/4-compliant-tx.txt`.
3. Record the user's approval message verbatim in `$RUN_DIR/4-compliant-APPROVAL.txt`.

**Pass condition (mainnet default):** oversized was blocked with a readable reason; no on-chain proposal count change; compliant path SKIPPED with note.

**Pass condition (if user opted in):** above, plus tx hash recorded.

---

## Phase 5 — Autonomous cron tick

Goal: prove the cron-driven digest logic works, without waiting 15 minutes.

### Manual tick

1. Call `sherwood_monitor_cron_tick(subdomain=$SUB, include_exposure=true)`. Save response to `$RUN_DIR/5-tick-1.json`.

2. Check cursor file:
   ```bash
   cat ~/.hermes/plugins/sherwood-monitor/cron_cursor.json > "$RUN_DIR/5-cursor-1.json"
   ```
   Should contain a key `$SUB` with `block`, `timestamp`, `last_tick_at`.

3. Call `sherwood_monitor_cron_tick` again immediately. Save to `$RUN_DIR/5-tick-2.json`. **Expected:** `events` is empty (cursor advanced on first call). This is the "quiet is good news" invariant — critical.

4. Check cursor again:
   ```bash
   cat ~/.hermes/plugins/sherwood-monitor/cron_cursor.json > "$RUN_DIR/5-cursor-2.json"
   ```
   `last_tick_at` should have changed; `block` should not have (no new events).

### Idempotency after a new event (replay-based on mainnet)

You will NOT create a new proposal. Instead, manually rewind the cron cursor and prove the tick re-surfaces historical events.

1. Back up the cron cursor, then rewind its `block` for `$SUB` by ~500:
   ```bash
   cp ~/.hermes/plugins/sherwood-monitor/cron_cursor.json "$RUN_DIR/5-cursor-backup.json"
   python3 - <<'PY'
   import json, pathlib
   p = pathlib.Path.home() / ".hermes/plugins/sherwood-monitor/cron_cursor.json"
   data = json.loads(p.read_text())
   import os
   sub = os.environ["SUB"]
   data[sub]["block"] = max(0, int(data[sub]["block"]) - 500)
   p.write_text(json.dumps(data, indent=2))
   print(f"rewound cursor for {sub} to block {data[sub]['block']}")
   PY
   ```

2. Call `sherwood_monitor_cron_tick(subdomain=$SUB)` again. Save to `$RUN_DIR/5-tick-3.json`.

3. **Expected:** `events` contains any interesting events (`ProposalCreated`, `ProposalSettled`, `ProposalCancelled`, `RISK_ALERT`, `APPROVAL_REQUEST`) that occurred in the rewound window. If there were none in the last 500 blocks, use a larger rewind (2000 blocks).

4. After the test, restore the backup so you don't falsely replay events on the next real cron tick:
   ```bash
   cp "$RUN_DIR/5-cursor-backup.json" ~/.hermes/plugins/sherwood-monitor/cron_cursor.json
   ```

**What this proves:** the cursor logic is consulted and the tick returns deltas, not the full history. If the third tick returns the same events as the first (no cursor advance), that's a bug.

### Concentration alert

If the user has multiple syndicates configured and one exceeds the threshold, `concentration_alerts` should appear in the tick response. If single syndicate, this will be empty — note that in the report.

**Pass condition:** cursor advances, second-call returns empty, third-call (after new event) returns exactly the new event.

---

## Phase 6 — Settlement + memory (opportunistic on mainnet)

Goal: prove `<sherwood-settlement>` injection primes the agent to write memory via the `remember-settlement` skill.

**Mainnet constraint:** you will NOT create + execute + settle a synthetic proposal. Instead you either (a) find a real settleable proposal on `$SUB` and ask the user to drive the settle, or (b) simulate the settlement-handler path in a controlled way using an already-settled historical event.

Pick the path based on current state:

### Path A — real settlement, user-driven

Precondition: `sherwood proposal list $SUB --json` shows a proposal with status "ReadyToSettle" (duration elapsed, not yet settled).

1. Show the proposal to the user and ask: "Proposal #X on $SUB is ready to settle. Can you run `sherwood proposal settle $SUB X` from your terminal? I'll observe from mine."

2. While they're doing it, watch `$RUN_DIR/sherwood-monitor.log` for a `ProposalSettled` event.

3. Proceed to "Observe the settlement block" below.

### Path B — synthetic replay of a historical settlement

Precondition: `sherwood proposal list $SUB --json` includes at least one already-settled proposal.

1. Pick the most recent settled proposal. Note its id, tx hash, pnl.

2. Reset the cursor far enough back to re-observe the `ProposalSettled` event (same technique as Phase 3).

3. With the supervisor running and `xmtp_summaries: false` set in config, the stream will re-emit the `ProposalSettled` event, which routes through `handle_chain_event` → injects a `<sherwood-event type="ProposalSettled">` block. This validates the injection path.

4. **Note carefully:** Path B does NOT exercise the `post_tool_call` hook, because the hook only fires when YOU (the agent) invoke `sherwood proposal settle ...` via the terminal tool. It doesn't fire on replay. Record this limitation in `$RUN_DIR/6-path-B-note.md`.

   To fully validate `post_tool_call`, either use Path A or accept that this phase is YELLOW under Path B.

### Observe the settlement block

1. On the turn after the settle (Path A) or the replay (Path B), look for an injection block:
   - Path A: `<sherwood-settlement syndicate="..." action="settle" proposal_id="X" pnl_usd="..." tx="0x...">` — pushed by `post_tool_call`.
   - Path B: `<sherwood-event syndicate="..." source="chain" type="ProposalSettled" ...>` — pushed by the event handler.

2. Save what you saw to `$RUN_DIR/6-settlement-injection.md` — paste the exact block.

### Invoke the skill

Only meaningful under Path A (Path B lacks the explicit REMEMBER THIS marker).

1. Load the `remember-settlement` skill from `skills/sherwood-agent/skills/remember-settlement/SKILL.md`.

2. Follow its instructions: call your `memory` tool with a structured record extracted from the block. Example:
   ```
   memory(action="add", content="Syndicate $SUB — strategy '<name>' settled <pnl_usd> on <date>. Proposal #<id>. Tx <short>.")
   ```

3. Verify the memory write landed:
   ```bash
   grep "$SUB" ~/.hermes/memories/MEMORY.md > "$RUN_DIR/6-memory-entry.txt"
   ```
   Should contain your new entry.

### Cross-session test

1. Ask yourself a fresh question without context: *"Has anything been settled on $SUB recently? What did it do?"*

2. Your answer should reference the memory entry you just wrote — WITHOUT calling any Sherwood tool. Content comes from MEMORY.md injection into the system prompt.

3. Save your answer + a note confirming you did not call tools to `$RUN_DIR/6-memory-recall.md`.

**Pass condition (Path A):** settlement block injected, memory written, memory recalled in a later turn without tool calls. Mark GREEN.

**Pass condition (Path B):** settlement event injected via the chain-event path; note that `post_tool_call` was not exercised. Mark YELLOW.

**Pass condition (no settleable proposal available):** phase cannot run; mark YELLOW with note to re-run when a settlement happens naturally.

---

## Final report

After all 6 phases complete (or on first failure), produce a report and deliver to the user.

### Report template

```markdown
# Sherwood-Monitor Smoke Test Report

**Run dir:** $RUN_DIR
**Syndicate:** $SUB
**Network:** <from preflight>
**Started:** <timestamp>
**Completed:** <timestamp>

## Results

| Phase | Status | Evidence |
|---|---|---|
| 0. Setup | ✓ / ✗ | preflight.txt |
| 1. Plugin surface | ✓ / ✗ | 1-PASS.txt |
| 2. Subprocess lifecycle | ✓ / ✗ | 2-ps.txt |
| 3. Reactive injection | ✓ / ✗ | 3-injection-evidence.md |
| 4. Risk guardrails | ✓ / ✗ | 4-block-evidence.md |
| 5. Autonomous cron tick | ✓ / ✗ | 5-tick-1.json, 5-tick-2.json, 5-tick-3.json |
| 6. Settlement + memory | ✓ / ✗ | 6-memory-recall.md |

## Observed behaviors worth noting

<anything surprising, slow, or ambiguous>

## Caveats / known limitations hit

<e.g. "sherwood vault info --json returned zero AUM; risk hook fail-open applies">

## Artifacts

All files in `$RUN_DIR/`. To inspect:
\`\`\`bash
ls -la $RUN_DIR
\`\`\`

## Verdict

**GREEN / YELLOW / RED**

- GREEN = all 6 phases passed with clear evidence
- YELLOW = core phases passed but some test couldn't run (missing CLI feature, no LP wallet, etc.)
- RED = one or more phases failed with a clear bug
```

Deliver the report as a message to the user. If RED, attach the most relevant artifacts inline.

---

## Post-run cleanup (optional)

```bash
# Archive the run
tar -czf "$RUN_DIR.tar.gz" -C "$(dirname $RUN_DIR)" "$(basename $RUN_DIR)"
echo "Archived to $RUN_DIR.tar.gz"

# Stop any supervisors started during the test
sherwood_monitor_stop(subdomain=$SUB)
```
