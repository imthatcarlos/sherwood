/**
 * ENS resolution + text records via Durin L2Registry on Base.
 *
 * Two responsibilities:
 *   1. Resolve syndicate subdomain → on-chain syndicate data (via factory)
 *   2. Read/write ENS text records (via L2Registry)
 */

import type { Address, Hex } from "viem";
import { namehash } from "viem/ens";
import { getPublicClient, getWalletClient, getAccount } from "./client.js";
import { getChain, getNetwork } from "./network.js";
import { SYNDICATE_FACTORY_ABI, L2_REGISTRY_ABI } from "./abis.js";
import { ENS } from "./addresses.js";

const ENS_DOMAIN = "sherwoodagent.eth";

// ── Factory address helper (reuse pattern from factory.ts) ──

function getFactoryAddress(): Address {
  const envKey = getNetwork() === "base-sepolia" ? "FACTORY_ADDRESS_TESTNET" : "FACTORY_ADDRESS";
  const addr = process.env[envKey];
  if (!addr) {
    throw new Error(`${envKey} env var is required`);
  }
  return addr as Address;
}

// ── Syndicate Resolution (via factory) ──

export interface SyndicateResolution {
  id: bigint;
  vault: Address;
  creator: Address;
  subdomain: string;
}

/**
 * Resolve a syndicate subdomain to its on-chain data.
 * Uses factory.subdomainToSyndicate() → factory.syndicates().
 */
export async function resolveSyndicate(subdomain: string): Promise<SyndicateResolution> {
  const client = getPublicClient();
  const factory = getFactoryAddress();

  // Get syndicate ID from subdomain
  const syndicateId = (await client.readContract({
    address: factory,
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "subdomainToSyndicate",
    args: [subdomain],
  })) as bigint;

  if (syndicateId === 0n) {
    throw new Error(`Syndicate "${subdomain}" not found`);
  }

  // Get full syndicate record
  const result = (await client.readContract({
    address: factory,
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "syndicates",
    args: [syndicateId],
  })) as [bigint, Address, Address, string, bigint, boolean, string];

  return {
    id: result[0],
    vault: result[1],
    creator: result[2],
    subdomain: result[6],
  };
}

/**
 * Reverse lookup: vault address → syndicate info.
 * Uses factory.vaultToSyndicate() → factory.syndicates().
 */
export async function resolveVaultSyndicate(
  vaultAddress: Address,
): Promise<SyndicateResolution> {
  const client = getPublicClient();
  const factory = getFactoryAddress();

  const syndicateId = (await client.readContract({
    address: factory,
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "vaultToSyndicate",
    args: [vaultAddress],
  })) as bigint;

  if (syndicateId === 0n) {
    throw new Error(`No syndicate found for vault ${vaultAddress}`);
  }

  const result = (await client.readContract({
    address: factory,
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "syndicates",
    args: [syndicateId],
  })) as [bigint, Address, Address, string, bigint, boolean, string];

  return {
    id: result[0],
    vault: result[1],
    creator: result[2],
    subdomain: result[6],
  };
}

// ── ENS Text Records (via L2Registry) ──

/**
 * Compute the ENS node hash for a subdomain under sherwoodagent.eth.
 */
function getSubdomainNode(subdomain: string): Hex {
  return namehash(`${subdomain}.${ENS_DOMAIN}`);
}

/**
 * Write a text record to the L2Registry.
 * Used to store xmtpGroupId on-chain after group creation.
 */
export async function setTextRecord(
  subdomain: string,
  key: string,
  value: string,
): Promise<Hex> {
  const wallet = getWalletClient();
  const node = getSubdomainNode(subdomain);

  return wallet.writeContract({
    account: getAccount(),
    chain: getChain(),
    address: ENS().L2_REGISTRY,
    abi: L2_REGISTRY_ABI,
    functionName: "setText",
    args: [node, key, value],
  });
}

/**
 * Read a text record from the L2Registry.
 * Used to look up xmtpGroupId when not cached locally.
 */
export async function getTextRecord(
  subdomain: string,
  key: string,
): Promise<string> {
  const client = getPublicClient();
  const node = getSubdomainNode(subdomain);

  return client.readContract({
    address: ENS().L2_REGISTRY,
    abi: L2_REGISTRY_ABI,
    functionName: "text",
    args: [node, key],
  }) as Promise<string>;
}
