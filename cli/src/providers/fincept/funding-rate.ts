/**
 * CCXT multi-exchange funding rate wrapper.
 *
 * Aggregates perpetual funding rates across Binance, Bybit, and OKX via
 * the Fincept Python bridge (fetch_funding_rate.py).
 *
 * NOTE: fetch_funding_rate.py is not yet vendored. This wrapper will
 * gracefully return null until the script is added.
 */

import { callFincept } from "./bridge.js";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const EXCHANGES = ["binance", "bybit", "okx"] as const;

/** CoinGecko ID to CCXT perpetual symbol. */
const PERP_SYMBOL: Record<string, string> = {
  bitcoin: "BTC/USDT:USDT",
  ethereum: "ETH/USDT:USDT",
  solana: "SOL/USDT:USDT",
  aave: "AAVE/USDT:USDT",
  chainlink: "LINK/USDT:USDT",
  ripple: "XRP/USDT:USDT",
  dogecoin: "DOGE/USDT:USDT",
  polkadot: "DOT/USDT:USDT",
  avalanche: "AVAX/USDT:USDT",
  arbitrum: "ARB/USDT:USDT",
  sui: "SUI/USDT:USDT",
  near: "NEAR/USDT:USDT",
  aptos: "APT/USDT:USDT",
  pepe: "PEPE/USDT:USDT",
};

export interface AggregateFunding {
  meanRate: number;
  maxRate: number;
  minRate: number;
  exchanges: string[];
  consensus: "long-crowded" | "short-crowded" | "neutral";
}

interface FundingRateResponse {
  rate?: number;
  exchange?: string;
}

/**
 * Fetch and aggregate funding rates across multiple exchanges.
 *
 * @param tokenId - CoinGecko-style token ID (e.g. "bitcoin", "ethereum")
 * @returns Aggregate funding data, or null if token is unsupported or
 *          no exchanges returned data
 */
export async function getAggregateFunding(
  tokenId: string,
): Promise<AggregateFunding | null> {
  const symbol = PERP_SYMBOL[tokenId];
  if (!symbol) return null;

  const results = await Promise.all(
    EXCHANGES.map((exchange) =>
      callFincept<FundingRateResponse>(
        "fetch_funding_rate.py",
        [exchange, symbol],
        30_000,
        CACHE_TTL,
      ),
    ),
  );

  const rates: number[] = [];
  const successExchanges: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const res = results[i]!;
    if (res.ok && res.data?.rate != null) {
      rates.push(res.data.rate);
      successExchanges.push(EXCHANGES[i]);
    }
  }

  if (rates.length === 0) return null;

  const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const maxRate = Math.max(...rates);
  const minRate = Math.min(...rates);

  let consensus: AggregateFunding["consensus"];
  if (meanRate > 0.0001) {
    consensus = "long-crowded";
  } else if (meanRate < -0.0001) {
    consensus = "short-crowded";
  } else {
    consensus = "neutral";
  }

  return { meanRate, maxRate, minRate, exchanges: successExchanges, consensus };
}
