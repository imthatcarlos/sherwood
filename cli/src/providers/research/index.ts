/**
 * Research providers — pluggable interface for DeFi research data via x402 micropayments.
 *
 * Same pattern as DeFi providers (Moonwell, Uniswap). Each research provider
 * implements ResearchProvider and uses x402-wrapped fetch for automatic USDC payments.
 */

import type { Provider } from "../../types.js";
import { MessariProvider } from "./messari.js";
import { NansenProvider } from "./nansen.js";

// ── Types ──

export interface ResearchQuery {
  /** Query type determines which API endpoint is called */
  type: "token" | "smart-money" | "market" | "wallet";
  /** Token address, asset symbol, or wallet address depending on type */
  target: string;
  /** Additional query params (e.g. token symbol for smart-money queries) */
  options?: Record<string, string>;
}

export interface ResearchResult {
  provider: string;
  queryType: string;
  target: string;
  /** Structured response data from the provider */
  data: Record<string, unknown>;
  /** Cost paid in USDC (human-readable, e.g. "0.05") */
  costUsdc: string;
  timestamp: number;
}

export interface ResearchProvider extends Provider {
  /** Query the research provider. Payment is handled automatically via x402. */
  query(params: ResearchQuery): Promise<ResearchResult>;
}

// ── Factory ──

export function getResearchProvider(name: string): ResearchProvider {
  switch (name) {
    case "messari":
      return new MessariProvider();
    case "nansen":
      return new NansenProvider();
    default:
      throw new Error(
        `Unknown research provider: ${name}. Valid providers: messari, nansen`,
      );
  }
}

// ── Re-exports ──

export { MessariProvider, NansenProvider };
