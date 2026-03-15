/**
 * Local config management — ~/.sherwood/config.json
 *
 * Stores XMTP DB encryption key, group ID cache, and per-chain contract addresses.
 * The encryption key is auto-generated on first run.
 */

import fs from "node:fs";
import path from "node:path";
import { getRandomValues } from "node:crypto";

const CONFIG_DIR = path.join(process.env.HOME || "~", ".sherwood");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/** Per-chain user-specific addresses (stored by chainId). */
export interface ChainContracts {
  vault?: string; // user's default vault address
}

export interface SherwoodConfig {
  dbEncryptionKey: string; // hex-encoded 32 bytes
  privateKey?: string; // wallet private key (0x-prefixed)
  xmtpInboxId?: string;
  groupCache: Record<string, string>; // subdomain → XMTP group ID
  veniceApiKey?: string; // Venice AI inference API key
  agentId?: number; // ERC-8004 identity token ID
  contracts?: Record<string, ChainContracts>; // chainId → user addresses
}

export function loadConfig(): SherwoodConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }

  // First run: generate encryption key
  const key = Buffer.from(getRandomValues(new Uint8Array(32))).toString("hex");
  const config: SherwoodConfig = { dbEncryptionKey: key, groupCache: {} };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

export function saveConfig(config: SherwoodConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function cacheGroupId(subdomain: string, groupId: string): void {
  const config = loadConfig();
  config.groupCache[subdomain] = groupId;
  saveConfig(config);
}

export function getCachedGroupId(subdomain: string): string | undefined {
  const config = loadConfig();
  return config.groupCache[subdomain];
}

export function setVeniceApiKey(apiKey: string): void {
  const config = loadConfig();
  config.veniceApiKey = apiKey;
  saveConfig(config);
}

export function getVeniceApiKey(): string | undefined {
  return loadConfig().veniceApiKey;
}

export function setAgentId(agentId: number): void {
  const config = loadConfig();
  config.agentId = agentId;
  saveConfig(config);
}

export function getAgentId(): number | undefined {
  return loadConfig().agentId;
}

export function setPrivateKey(key: string): void {
  const config = loadConfig();
  config.privateKey = key.startsWith("0x") ? key : `0x${key}`;
  saveConfig(config);
}

export function getPrivateKey(): string | undefined {
  return loadConfig().privateKey;
}

// ── Per-chain contract addresses ──

export function getChainContracts(chainId: number): ChainContracts {
  const config = loadConfig();
  return config.contracts?.[String(chainId)] ?? {};
}

export function setChainContract(
  chainId: number,
  key: keyof ChainContracts,
  value: string,
): void {
  const config = loadConfig();
  if (!config.contracts) config.contracts = {};
  const cid = String(chainId);
  if (!config.contracts[cid]) config.contracts[cid] = {};
  config.contracts[cid][key] = value;
  saveConfig(config);
}
