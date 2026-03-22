/**
 * viem client factory — resolves chain and RPC from the network module.
 * Private key is read from ~/.sherwood/config.json (set via `sherwood config set --private-key`),
 * with PRIVATE_KEY env var as fallback.
 */

// dotenv loaded at entrypoint
import type { Hex } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain, getRpcUrl } from "./network.js";
import { loadConfig } from "./config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _publicClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _walletClient: any = null;

/**
 * Resolve the private key: config → env → error.
 */
function getPrivateKey(): `0x${string}` {
  // 1. Config (~/.sherwood/config.json)
  const config = loadConfig();
  if (config.privateKey) {
    const k = config.privateKey;
    return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
  }

  // 2. Env var fallback
  const env = process.env.PRIVATE_KEY;
  if (env) {
    return (env.startsWith("0x") ? env : `0x${env}`) as `0x${string}`;
  }

  throw new Error(
    "Private key not found. Run 'sherwood config set --private-key <key>' or set PRIVATE_KEY env var.",
  );
}

export function getPublicClient() {
  const chain = getChain();
  // Auto-invalidate if network changed since last creation
  if (_publicClient && _publicClient.chain?.id !== chain.id) {
    _publicClient = null;
  }
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain,
      transport: http(getRpcUrl()),
    });
  }
  return _publicClient as ReturnType<typeof createPublicClient>;
}

export function getWalletClient() {
  const chain = getChain();
  // Auto-invalidate if network changed since last creation
  if (_walletClient && _walletClient.chain?.id !== chain.id) {
    _walletClient = null;
  }
  if (!_walletClient) {
    const account = privateKeyToAccount(getPrivateKey());
    _walletClient = createWalletClient({
      account,
      chain,
      transport: http(getRpcUrl()),
    });
  }
  return _walletClient as ReturnType<typeof createWalletClient>;
}

/**
 * Reset cached clients. Required for tests that call setNetwork()
 * after a client was already created.
 */
export function resetClients() {
  _publicClient = null;
  _walletClient = null;
}

export function getAccount() {
  return privateKeyToAccount(getPrivateKey());
}

/**
 * Estimate EIP-1559 fees with a 20% buffer to avoid stuck txs on Base gas spikes.
 */
export async function estimateFeesWithBuffer() {
  const client = getPublicClient();
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await client.estimateFeesPerGas();
  return {
    maxFeePerGas: (maxFeePerGas * 120n) / 100n,
    maxPriorityFeePerGas: (maxPriorityFeePerGas * 120n) / 100n,
  };
}

// ── Retry helpers for nonce collision / underpriced tx recovery ──

const MAX_RETRIES = 3;
const GAS_BUMP_NUMERATOR = 110n;
const GAS_BUMP_DENOMINATOR = 100n;

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("replacement transaction underpriced") ||
    msg.includes("nonce too low") ||
    msg.includes("already known") ||
    msg.includes("NONCE_EXPIRED")
  );
}

function bumpFees(fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) {
  return {
    maxFeePerGas: (fees.maxFeePerGas * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR,
    maxPriorityFeePerGas: (fees.maxPriorityFeePerGas * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR,
  };
}

/**
 * Send a raw transaction with automatic gas-bump retry on nonce/underpriced errors.
 * Uses explicit nonce + EIP-1559 fee buffer to prevent stuck txs on Base gas spikes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendTxWithRetry(txParams: Record<string, any>): Promise<Hex> {
  const wallet = getWalletClient();
  const client = getPublicClient();
  const account = getAccount();
  let fees = await estimateFeesWithBuffer();
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await wallet.sendTransaction({ ...txParams, ...fees, nonce } as any);
    } catch (err) {
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        fees = bumpFees(fees);
        continue;
      }
      throw err;
    }
  }
  throw new Error("sendTxWithRetry: exhausted retries");
}

/**
 * Call writeContract with automatic gas-bump retry on nonce/underpriced errors.
 * Uses explicit nonce + EIP-1559 fee buffer to prevent stuck txs on Base gas spikes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeContractWithRetry(txParams: Record<string, any>): Promise<Hex> {
  const wallet = getWalletClient();
  const client = getPublicClient();
  const account = getAccount();
  let fees = await estimateFeesWithBuffer();
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await wallet.writeContract({ ...txParams, ...fees, nonce } as any);
    } catch (err) {
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        fees = bumpFees(fees);
        continue;
      }
      throw err;
    }
  }
  throw new Error("writeContractWithRetry: exhausted retries");
}
