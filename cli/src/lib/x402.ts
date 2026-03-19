/**
 * x402 fetch wrapper — wraps native fetch with automatic USDC micropayments.
 *
 * Uses the Coinbase x402 protocol: when a server responds 402 Payment Required,
 * the wrapper automatically signs a USDC payment on Base and retries the request.
 * The agent pays from its own wallet — no vault interaction needed.
 *
 * Singleton pattern matching client.ts — cached after first creation.
 */

import { getAccount } from "./client.js";

let _x402Fetch: typeof fetch | null = null;

/**
 * Returns a fetch function that automatically handles x402 (402 Payment Required)
 * responses by signing USDC micropayments on Base.
 *
 * Lazily initializes the x402 client on first call and caches it.
 * Uses dynamic imports so @x402 packages are only loaded when research commands run.
 */
export async function getX402Fetch(): Promise<typeof fetch> {
  if (_x402Fetch) return _x402Fetch;

  const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/client");

  const signer = getAccount();
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  _x402Fetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return _x402Fetch;
}

/**
 * Reset cached x402 fetch. Required for tests that change accounts.
 */
export function resetX402Fetch(): void {
  _x402Fetch = null;
}
