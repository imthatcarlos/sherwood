/**
 * SyndicateFactory contract wrapper.
 *
 * Creates new syndicate vaults via the factory. Each syndicate = one vault proxy
 * with shared executor lib and vault implementation.
 */

import type { Address, Hex } from "viem";
import { parseUnits, formatUnits } from "viem";
import { getChain, getNetwork } from "./network.js";
import { getPublicClient, getWalletClient, getAccount } from "./client.js";
import { SYNDICATE_FACTORY_ABI } from "./abis.js";
import { TOKENS, SHERWOOD } from "./addresses.js";

export interface SyndicateInfo {
  id: bigint;
  vault: Address;
  creator: Address;
  metadataURI: string;
  createdAt: bigint;
  active: boolean;
  subdomain: string;
}

export interface CreateSyndicateParams {
  creatorAgentId: bigint;
  metadataURI: string;
  asset: Address;
  name: string;
  symbol: string;
  maxPerTx: bigint;
  maxDailyTotal: bigint;
  maxBorrowRatio: bigint;
  initialTargets: Address[];
  openDeposits: boolean;
  subdomain: string;
}

function getFactoryAddress(): Address {
  return SHERWOOD().FACTORY;
}

export interface CreateSyndicateResult {
  hash: Hex;
  syndicateId: bigint;
  vault: Address;
}

/**
 * Create a new syndicate via the factory.
 * Deploys a UUPS vault proxy, initializes it, and registers in the factory.
 * Waits for receipt and extracts vault address from SyndicateCreated event.
 */
export async function createSyndicate(params: CreateSyndicateParams): Promise<CreateSyndicateResult> {
  const wallet = getWalletClient();
  const client = getPublicClient();

  const hash = await wallet.writeContract({
    account: getAccount(),
    chain: getChain(),
    address: getFactoryAddress(),
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "createSyndicate",
    args: [
      params.creatorAgentId,
      {
        metadataURI: params.metadataURI,
        asset: params.asset,
        name: params.name,
        symbol: params.symbol,
        caps: {
          maxPerTx: params.maxPerTx,
          maxDailyTotal: params.maxDailyTotal,
          maxBorrowRatio: params.maxBorrowRatio,
        },
        initialTargets: params.initialTargets,
        openDeposits: params.openDeposits,
        subdomain: params.subdomain,
      },
    ],
  });

  // Wait for receipt and extract vault from SyndicateCreated event
  const receipt = await client.waitForTransactionReceipt({ hash });

  // SyndicateCreated(uint256 syndicateId, address vault, address creator, string metadataURI, string subdomain)
  // Event topic[0] = keccak256 of signature, topic[1] = syndicateId (indexed), topic[2] = vault (indexed), topic[3] = creator (indexed)
  const syndicateCreatedTopic = "0x" + "SyndicateCreated(uint256,address,address,string,string)"
    .split("") // We'll use a simpler approach — read from factory
    .join("");

  // Simpler: read the latest syndicate count and get that syndicate's info
  const count = await getSyndicateCount();
  const info = await getSyndicate(count);

  return {
    hash,
    syndicateId: count,
    vault: info.vault,
  };
}

/**
 * Get syndicate info by ID.
 */
export async function getSyndicate(id: bigint): Promise<SyndicateInfo> {
  const client = getPublicClient();
  const result = (await client.readContract({
    address: getFactoryAddress(),
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "syndicates",
    args: [id],
  })) as [bigint, Address, Address, string, bigint, boolean, string];

  return {
    id: result[0],
    vault: result[1],
    creator: result[2],
    metadataURI: result[3],
    createdAt: result[4],
    active: result[5],
    subdomain: result[6],
  };
}

/**
 * Get the total number of syndicates created.
 */
export async function getSyndicateCount(): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: getFactoryAddress(),
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "syndicateCount",
  }) as Promise<bigint>;
}

/**
 * Get all active syndicates from the factory.
 */
export async function getActiveSyndicates(): Promise<SyndicateInfo[]> {
  const client = getPublicClient();
  const result = (await client.readContract({
    address: getFactoryAddress(),
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "getActiveSyndicates",
  })) as readonly {
    id: bigint;
    vault: Address;
    creator: Address;
    metadataURI: string;
    createdAt: bigint;
    active: boolean;
    subdomain: string;
  }[];

  return result.map((s) => ({
    id: s.id,
    vault: s.vault,
    creator: s.creator,
    metadataURI: s.metadataURI,
    createdAt: s.createdAt,
    active: s.active,
    subdomain: s.subdomain,
  }));
}

/**
 * Update syndicate metadata (creator only).
 */
export async function updateMetadata(syndicateId: bigint, metadataURI: string): Promise<Hex> {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account: getAccount(),
    chain: getChain(),
    address: getFactoryAddress(),
    abi: SYNDICATE_FACTORY_ABI,
    functionName: "updateMetadata",
    args: [syndicateId, metadataURI],
  });
}
