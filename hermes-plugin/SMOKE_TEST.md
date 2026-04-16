# Sherwood-Monitor Smoke Test Runbook

> **For the Hermes agent:** this is your test plan. Execute the phases in order. Stop on the first failure and report what broke. Gather artifacts into `$RUN_DIR` (see Phase 0). Deliver a final report to the user.

## What you're testing

The `sherwood-monitor` plugin you're running. Your job is to prove it works end-to-end against a live testnet Sherwood deployment and report with evidence. "Evidence" means logs, state files, and observed behavior — not assertions.

## Ground rules

- **Testnet only.** Every command involving chain state must use the testnet (Base Sepolia). Verify first: `sherwood config get network` should show a testnet chain id. If it's mainnet, STOP and ask the user to switch.
- **Quiet is a valid pass.** If a layer produces "no output, no events, no complaints" — that can be correct. Log the absence; don't assume failure.
- **One phase at a time.** Do not run ahead. Each phase's prerequisites depend on prior phases passing.
- **Attach evidence.** For every pass/fail in your report, paste the command output or file snippet that justifies it.

---

## Phase 0 — Setup

1. **Create a run directory for artifacts:**
   ```bash
   export RUN_DIR=/tmp/sherwood-monitor-smoke-$(date +%s)
   mkdir -p "$RUN_DIR"
   echo "Run dir: $RUN_DIR"
   ```

2. **Ask the user two questions before starting:**
   - "Which testnet syndicate subdomain should I test against?" — save as `$SUB`. If they don't have one handy, STOP and tell them to create one first (`sherwood syndicate create ...`).
   - "Can you run a second terminal to trigger events if I ask, or should I trigger them all myself from my tools?" — this determines Phase 3 strategy.

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
   ```
   Save output to `$RUN_DIR/preflight.txt`.

**Pass condition:** `$SUB` is set, `$RUN_DIR` exists, sherwood CLI version ≥ 0.4.0, network is testnet.

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

## Phase 3 — Reactive event injection

Goal: prove events arriving from the subprocess actually reach you on the next turn via `pre_llm_call`.

This is the trickiest phase. You need to cause an event to happen on-chain while the supervisor is running.

### Setup

1. Start the supervisor again: `sherwood_monitor_start(subdomain=$SUB)`.
2. Wait 5 seconds for the process to settle.
3. Note the current block: `sherwood session check $SUB | jq '.meta'` → save to `$RUN_DIR/3-pre-event-meta.json`.

### Trigger an event

Based on user's answer in Phase 0:

**If the user is driving the second terminal:** ask them to trigger a proposal now. Wait for them to confirm. Give them a sample command:
```bash
sherwood proposal create $SUB --template moonwell-supply --size-usd 100 --duration 600
```

**If you're triggering it yourself:** run it via the terminal tool. Use a tiny size ($100, 10-min duration) to minimize cost.

Save the tx hash from the output to `$RUN_DIR/3-proposal-tx.txt`.

### Observe the injection

1. Wait 45 seconds (subprocess polls on-chain every 30s, plus a margin).

2. Now say something innocuous to test injection. Don't mention the proposal. Example: *"Can you summarize what you know about this syndicate's recent activity?"*

3. **Your own response to that turn is the evidence.** If the `pre_llm_call` hook injected the `<sherwood-event>` block, you should see it in your context this turn — it will look like:
   ```
   <sherwood-event syndicate="$SUB" source="chain" type="ProposalCreated" ...>
   ```

4. Record in `$RUN_DIR/3-injection-evidence.md`:
   - YES / NO — did you see the `<sherwood-event type="ProposalCreated">` block injected?
   - Quote the exact block you received.
   - Did you mention the new proposal in your response without the user asking about it? (You should have.)

### Verify XMTP auto-post

1. Check the syndicate's XMTP chat log:
   ```bash
   sherwood chat $SUB log --limit 5 > "$RUN_DIR/3-xmtp-log.txt"
   ```
2. Confirm a markdown summary from **your agent identity** referencing "Proposal #<id>" appears within the last minute.

**Pass condition:** both the in-session injection AND the XMTP auto-post happened. Save `$RUN_DIR/3-PASS.txt` with both evidences.

**If fail:**
- If XMTP post missing but injection worked → `xmtp_summaries` config flag may be false, or `sherwood chat send` failed. Inspect `$RUN_DIR/sherwood-monitor.log`.
- If injection missing → the EventBuffer isn't being drained. Call `sherwood_monitor_status()` and check `events_seen` for the subdomain — should be ≥ 1.

---

## Phase 4 — Risk guardrails

Goal: prove `pre_tool_call` blocks oversized proposals with a reason, and allows compliant ones.

### Oversized test

1. First, get the vault's AUM so you can calculate what "oversized" means:
   ```bash
   sherwood vault info $SUB --json > "$RUN_DIR/4-vault-info.json"
   ```
   Read `aumUsd` from the output. Call it `$AUM`.

2. Plan a proposal at **30% of `$AUM`** (the cap is 25% — this should be blocked).

3. Attempt to create it via the terminal tool. Use the full command including `--size-usd` and `--protocol` flags so the hook can parse it:
   ```bash
   sherwood proposal create $SUB --protocol moonwell --size-usd <30% of AUM> ...
   ```

4. **Expected:** the hook returns `{"blocked": True, "reason": "...position sizing..."}`. Your terminal tool should return this as the tool result. You should NOT have actually created a proposal on-chain.

5. Verify no new proposal appeared on-chain:
   ```bash
   sherwood proposal list $SUB --json | jq '. | length' > "$RUN_DIR/4-proposal-count-after-block.txt"
   ```
   Compare to before the attempt.

Save to `$RUN_DIR/4-block-evidence.md`.

### Compliant test

1. Attempt again at **10% of `$AUM`** using an allowed protocol. Should succeed.
2. Save tx hash to `$RUN_DIR/4-compliant-tx.txt`.

**Pass condition:** oversized was blocked with reason; compliant went through.

**Caveat:** if `sherwood vault info --json` returns zero AUM or doesn't exist yet, the risk hook fails-open (allows everything). This is documented behavior. Log it to `$RUN_DIR/4-NOTE-failopen.txt` and note the test can't fully validate until the CLI supports it.

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

### Idempotency after new event

1. Create another small proposal via terminal (similar to Phase 3, $100, 10-min).
2. Wait 30 seconds for it to be indexed.
3. Call `sherwood_monitor_cron_tick` again. Save to `$RUN_DIR/5-tick-3.json`.
4. **Expected:** `events` contains exactly 1 entry — the new `ProposalCreated`.

### Concentration alert

If the user has multiple syndicates configured and one exceeds the threshold, `concentration_alerts` should appear in the tick response. If single syndicate, this will be empty — note that in the report.

**Pass condition:** cursor advances, second-call returns empty, third-call (after new event) returns exactly the new event.

---

## Phase 6 — Settlement + memory

Goal: prove `<sherwood-settlement>` injection primes the agent to write memory via the `remember-settlement` skill.

### Trigger settlement

1. Identify a proposal that can be settled. Use the one from Phase 3 or Phase 5 — whichever has finished its duration. Check `sherwood proposal list $SUB --json`.

2. If none are ready, either wait (10-min durations from Phase 3/5 should be ready soon) or create a new 1-minute proposal and wait.

3. Execute if not already: `sherwood proposal execute $SUB <id>`. Save tx to `$RUN_DIR/6-execute-tx.txt`.

4. Wait for duration to elapse.

5. Settle: `sherwood proposal settle $SUB <id>`. Save tx to `$RUN_DIR/6-settle-tx.txt`.

### Observe the settlement block

1. The `post_tool_call` hook should have fired on the settle command. On your next turn, you should see a `<sherwood-settlement>` block injected with `REMEMBER THIS — use the remember-settlement skill to persist it to memory.`

2. Save what you saw to `$RUN_DIR/6-settlement-injection.md` — paste the exact block.

### Invoke the skill

1. Load the `remember-settlement` skill (it's bundled with the plugin at `skills/sherwood-agent/skills/remember-settlement/`).

2. Follow its instructions: call your `memory` tool with a structured record extracted from the settlement block.

3. Verify the memory write:
   ```bash
   grep -A 2 "$SUB" ~/.hermes/memories/MEMORY.md > "$RUN_DIR/6-memory-entry.txt"
   ```
   The entry should mention the syndicate, strategy name if available, pnl_usd, and the date.

### Cross-session test

1. Start a fresh Hermes conversation (or just a clean turn without context) and ask: *"Has the <strategy name> strategy on $SUB been profitable historically?"*

2. Your answer should reference the memory entry you just wrote — WITHOUT needing to call any Sherwood tool. The content should come from the MEMORY.md injection into the system prompt.

3. Save your answer and a note confirming you did not call tools to `$RUN_DIR/6-memory-recall.md`.

**Pass condition:** settlement block injected, memory written, memory recalled in a later turn without tool calls.

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
