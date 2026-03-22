/**
 * Per-agent HOME directory setup.
 *
 * Each agent needs its own HOME to avoid collisions in:
 *   ~/.sherwood/config.json  — private key, agentId, group cache
 *   ~/.xmtp/               — XMTP DB + encryption key
 *
 * The simulation sets HOME=/tmp/sherwood-sim/agents/agent-{i} per subprocess.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Create a per-agent HOME directory and write the sherwood config.
 * Returns the HOME path for this agent.
 */
export function setupAgentHome(
  baseDir: string,
  index: number,
  privateKey: string,
  agentId?: number,
): string {
  const home = path.join(baseDir, `agent-${index}`);
  const sherwoodDir = path.join(home, ".sherwood");

  fs.mkdirSync(sherwoodDir, { recursive: true, mode: 0o700 });

  const config: Record<string, unknown> = {
    privateKey: privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
    groupCache: {},
  };
  if (agentId !== undefined) {
    config.agentId = agentId;
  }

  fs.writeFileSync(path.join(sherwoodDir, "config.json"), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });

  return home;
}

/**
 * Update the sherwood config for an agent — preserves existing fields.
 */
export function updateAgentConfig(
  baseDir: string,
  index: number,
  updates: Record<string, unknown>,
): void {
  const home = path.join(baseDir, `agent-${index}`);
  const configPath = path.join(home, ".sherwood", "config.json");

  let existing: Record<string, unknown> = { groupCache: {} };
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // ignore parse errors, start fresh
    }
  }

  const merged = { ...existing, ...updates };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

/**
 * Get the HOME dir for an agent index.
 */
export function agentHomeDir(baseDir: string, index: number): string {
  return path.join(baseDir, `agent-${index}`);
}

/**
 * Read the current sherwood config for an agent.
 */
export function readAgentConfig(baseDir: string, index: number): Record<string, unknown> {
  const configPath = path.join(baseDir, `agent-${index}`, ".sherwood", "config.json");
  if (!fs.existsSync(configPath)) return { groupCache: {} };
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { groupCache: {} };
  }
}
