/**
 * Read/write SimState to a JSON file with atomic updates.
 *
 * State is written after every successful agent operation so partial
 * progress is preserved across restarts. All phases are idempotent —
 * they check state flags before acting.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentState, SimState, SyndicateState } from "./types.js";

/**
 * Load state from disk. Returns null if the file doesn't exist.
 */
export function loadState(stateFile: string): SimState | null {
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8")) as SimState;
  } catch {
    return null;
  }
}

/**
 * Write state to disk atomically (write to .tmp then rename).
 */
export function saveState(stateFile: string, state: SimState): void {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

/**
 * Initialize a fresh SimState with the given agents and syndicates.
 */
export function initState(
  agents: AgentState[],
  syndicates: SyndicateState[],
): SimState {
  return {
    agents,
    syndicates,
    phase: 0,
    lastRun: Date.now(),
  };
}

/**
 * Update a single agent's state in place and save.
 */
export function updateAgent(
  stateFile: string,
  state: SimState,
  index: number,
  updates: Partial<AgentState>,
): void {
  const agent = state.agents[index];
  if (!agent) throw new Error(`Agent index ${index} not found in state`);
  Object.assign(agent, updates);
  state.lastRun = Date.now();
  saveState(stateFile, state);
}

/**
 * Update a single syndicate's state in place and save.
 */
export function updateSyndicate(
  stateFile: string,
  state: SimState,
  subdomain: string,
  updates: Partial<SyndicateState>,
): void {
  const syn = state.syndicates.find((s) => s.subdomain === subdomain);
  if (!syn) throw new Error(`Syndicate "${subdomain}" not found in state`);
  Object.assign(syn, updates);
  state.lastRun = Date.now();
  saveState(stateFile, state);
}

/**
 * Advance the phase counter and save.
 */
export function advancePhase(stateFile: string, state: SimState): void {
  state.phase += 1;
  state.lastRun = Date.now();
  saveState(stateFile, state);
}

/**
 * Pretty-print a state summary to console.
 */
export function printStateSummary(state: SimState): void {
  console.log();
  console.log("=== Simulation State ===");
  console.log(`Phase:      ${state.phase}`);
  console.log(`Last run:   ${new Date(state.lastRun).toLocaleString()}`);
  console.log();

  console.log("Agents:");
  for (const agent of state.agents) {
    const flags = [
      agent.funded ? "funded" : "not-funded",
      agent.identityMinted ? `id#${agent.agentId}` : "no-id",
      agent.role === "creator"
        ? agent.syndicateCreated
          ? `created:${agent.syndicateSubdomain}`
          : "no-syndicate"
        : agent.approved
          ? `approved:${agent.syndicateSubdomain}`
          : agent.joinRequested
            ? `requested:${agent.syndicateSubdomain}`
            : "not-joined",
      agent.deposited ? "deposited" : "not-deposited",
    ];
    console.log(
      `  [${agent.index}] ${agent.role.padEnd(7)} ${agent.persona.padEnd(20)} ${flags.join(" | ")}`,
    );
  }

  console.log();
  console.log("Syndicates:");
  for (const syn of state.syndicates) {
    const proposalCount = syn.proposals.length;
    console.log(
      `  ${syn.subdomain.padEnd(20)} vault:${syn.vault ? syn.vault.slice(0, 10) + "..." : "none"} members:${syn.members.length} proposals:${proposalCount}`,
    );
  }
  console.log();
}
