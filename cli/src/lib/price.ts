/**
 * Network-aware price quoting for portfolio valuation.
 *
 * Dispatches to the right DEX quoter based on network:
 *   - Base / Base Sepolia → Uniswap QuoterV2 (struct params, 4-tuple return)
 *   - Robinhood testnet   → Synthra QuoterV2 (flat params, single return)
 *
 * Both quoters use eth_call (not view functions — they revert internally).
 */

import type { Address, Hex } from "viem";
import { encodeFunctionData, decodeFunctionResult, parseUnits, formatUnits } from "viem";
import { getPublicClient } from "./client.js";
import { getNetwork } from "./network.js";
import { UNISWAP, SYNTHRA } from "./addresses.js";
import { UNISWAP_QUOTER_V2_ABI, SYNTHRA_QUOTER_ABI } from "./abis.js";

export interface TokenPrice {
  price: number;       // 1 token = X asset units (human-readable)
  amountOut: bigint;   // raw quoter output
  source: "uniswap" | "synthra";
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/**
 * Get the price of one token denominated in the strategy's asset.
 * Uses the appropriate DEX quoter for the current network.
 */
export async function getTokenPriceInAsset(params: {
  token: Address;
  tokenDecimals: number;
  asset: Address;
  assetDecimals: number;
  feeTier: number;
}): Promise<TokenPrice> {
  const { token, tokenDecimals, asset, assetDecimals, feeTier } = params;

  // Short-circuit: token IS the asset
  if (token.toLowerCase() === asset.toLowerCase()) {
    return { price: 1.0, amountOut: parseUnits("1", assetDecimals), source: "uniswap" };
  }

  const network = getNetwork();
  const client = getPublicClient();

  if (network === "robinhood-testnet") {
    return quoteSynthra(client, token, tokenDecimals, asset, assetDecimals, feeTier);
  }

  return quoteUniswap(client, token, tokenDecimals, asset, assetDecimals, feeTier);
}

/**
 * Batch price lookup — parallel, graceful failure (null per failed quote).
 */
export async function getTokenPricesInAsset(params: {
  tokens: { token: Address; tokenDecimals: number; feeTier: number }[];
  asset: Address;
  assetDecimals: number;
}): Promise<(TokenPrice | null)[]> {
  const { tokens, asset, assetDecimals } = params;

  const results = await Promise.allSettled(
    tokens.map((t) =>
      getTokenPriceInAsset({
        token: t.token,
        tokenDecimals: t.tokenDecimals,
        asset,
        assetDecimals,
        feeTier: t.feeTier,
      }),
    ),
  );

  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}

// ── Synthra QuoterV2 (Robinhood testnet) ──

async function quoteSynthra(
  client: ReturnType<typeof getPublicClient>,
  tokenIn: Address,
  tokenInDecimals: number,
  tokenOut: Address,
  tokenOutDecimals: number,
  fee: number,
): Promise<TokenPrice> {
  const quoterAddr = SYNTHRA().QUOTER;
  if (quoterAddr === ZERO) {
    throw new Error("Synthra Quoter not deployed on this network");
  }

  const oneToken = parseUnits("1", tokenInDecimals);

  const calldata = encodeFunctionData({
    abi: SYNTHRA_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [tokenIn, tokenOut, fee, oneToken, 0n],
  });

  const { data } = await client.call({ to: quoterAddr, data: calldata });

  if (!data) {
    throw new Error(`Synthra quoter returned no data for ${tokenIn}→${tokenOut} fee=${fee}`);
  }

  // Synthra quoter returns a single uint256 (not a tuple)
  const amountOut = decodeFunctionResult({
    abi: SYNTHRA_QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    data,
  }) as unknown as bigint;

  const price = Number(formatUnits(amountOut, tokenOutDecimals));
  return { price, amountOut, source: "synthra" };
}

// ── Uniswap QuoterV2 (Base / Base Sepolia) ──

async function quoteUniswap(
  client: ReturnType<typeof getPublicClient>,
  tokenIn: Address,
  tokenInDecimals: number,
  tokenOut: Address,
  tokenOutDecimals: number,
  fee: number,
): Promise<TokenPrice> {
  const quoterAddr = UNISWAP().QUOTER_V2;
  if (quoterAddr === ZERO) {
    throw new Error("Uniswap QuoterV2 not deployed on this network");
  }

  const oneToken = parseUnits("1", tokenInDecimals);

  const calldata = encodeFunctionData({
    abi: UNISWAP_QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn: oneToken,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const { data } = await client.call({ to: quoterAddr, data: calldata });

  if (!data) {
    throw new Error(`Uniswap quoter returned no data for ${tokenIn}→${tokenOut} fee=${fee}`);
  }

  const [amountOut] = decodeFunctionResult({
    abi: UNISWAP_QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    data,
  }) as [bigint, bigint, number, bigint];

  const price = Number(formatUnits(amountOut, tokenOutDecimals));
  return { price, amountOut, source: "uniswap" };
}
