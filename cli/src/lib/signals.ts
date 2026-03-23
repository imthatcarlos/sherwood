/**
 * Signal engine — aggregates on-chain, social, and fundamental data
 * into a composite buy/sell/hold recommendation.
 *
 * Sources:
 *   On-chain:     Nansen smart-money net flow (x402, ~$0.06)
 *   Social:       Venice inference with web search (X/Twitter sentiment)
 *   Fundamental:  Messari market data (x402, ~$0.20)
 *
 * No technical analysis — purely signal-driven.
 */

import type { Address } from "viem";
import { getResearchProvider } from "../providers/research/index.js";
import type { ResearchResult } from "../providers/research/index.js";
import { chatCompletion } from "./venice.js";

// ── Types ──

export type SignalAction = "buy" | "sell" | "hold";
export type SignalSource = "onchain" | "social" | "fundamental";

export interface Signal {
  source: SignalSource;
  name: string;
  value: number;    // -1.0 (bearish) to +1.0 (bullish)
  weight: number;   // contribution to composite score
  raw: Record<string, unknown>;
}

export interface SignalResult {
  action: SignalAction;
  confidence: number;     // 0.0 to 1.0
  compositeScore: number; // -1.0 to +1.0
  signals: Signal[];
  costUsdc: string;       // total x402 cost
  timestamp: number;
}

export interface SignalConfig {
  buyThreshold: number;   // composite score above this → buy (default 0.3)
  sellThreshold: number;  // composite score below this → sell (default -0.2)
}

const DEFAULT_CONFIG: SignalConfig = {
  buyThreshold: 0.3,
  sellThreshold: -0.2,
};

// ── Main Entry Point ──

/**
 * Analyze a token using on-chain, social, and fundamental signals.
 * Runs all three data sources in parallel for speed.
 */
export async function analyzeToken(
  tokenAddress: Address,
  tokenSymbol: string,
  config?: Partial<SignalConfig>,
): Promise<SignalResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let totalCostUsdc = 0;

  // Run all three signals in parallel — each returns a Signal + cost
  const [onChain, social, fundamental] = await Promise.allSettled([
    getOnChainSignal(tokenSymbol),
    getSocialSignal(tokenAddress, tokenSymbol),
    getFundamentalSignal(tokenSymbol),
  ]);

  const signals: Signal[] = [];

  if (onChain.status === "fulfilled") {
    signals.push(onChain.value.signal);
    totalCostUsdc += onChain.value.costUsdc;
  }

  if (social.status === "fulfilled") {
    signals.push(social.value.signal);
    totalCostUsdc += social.value.costUsdc;
  }

  if (fundamental.status === "fulfilled") {
    signals.push(fundamental.value.signal);
    totalCostUsdc += fundamental.value.costUsdc;
  }

  // Compute composite score
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of signals) {
    weightedSum += s.value * s.weight;
    totalWeight += s.weight;
  }
  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Confidence = average absolute signal strength
  const confidence =
    signals.length > 0
      ? signals.reduce((sum, s) => sum + Math.abs(s.value), 0) / signals.length
      : 0;

  // Decision
  let action: SignalAction = "hold";
  if (compositeScore >= cfg.buyThreshold && confidence >= 0.5) {
    action = "buy";
  } else if (compositeScore <= cfg.sellThreshold) {
    action = "sell";
  }

  return {
    action,
    confidence: Math.min(confidence, 1),
    compositeScore,
    signals,
    costUsdc: totalCostUsdc.toFixed(4),
    timestamp: Math.floor(Date.now() / 1000),
  };
}

// ── Individual Signal Sources ──

interface SignalWithCost {
  signal: Signal;
  costUsdc: number;
}

/**
 * On-chain signal: Nansen smart-money net flow.
 * Positive net flow (whales buying) → bullish.
 */
async function getOnChainSignal(tokenSymbol: string): Promise<SignalWithCost> {
  const nansen = getResearchProvider("nansen");
  let result: ResearchResult;
  try {
    result = await nansen.query({ type: "smart-money", target: tokenSymbol });
  } catch {
    return {
      signal: {
        source: "onchain",
        name: "smart_money_net_flow",
        value: 0,
        weight: 0.40,
        raw: { error: "nansen query failed" },
      },
      costUsdc: 0,
    };
  }

  const data = result.data as Record<string, unknown>;

  // Extract net flow value — Nansen returns flow data in various formats
  const netFlow = extractNetFlow(data);
  // Normalize to -1..+1 range (clamp large values)
  const value = Math.max(-1, Math.min(1, netFlow));

  return {
    signal: {
      source: "onchain",
      name: "smart_money_net_flow",
      value,
      weight: 0.40,
      raw: data,
    },
    costUsdc: Number(result.costUsdc) || 0.06,
  };
}

/**
 * Social signal: Venice inference with web search for X/Twitter sentiment.
 */
async function getSocialSignal(
  tokenAddress: Address,
  tokenSymbol: string,
): Promise<SignalWithCost> {
  try {
    const result = await chatCompletion({
      model: "llama-3.3-70b",
      messages: [
        {
          role: "system",
          content: `You are a crypto market sentiment analyst. Analyze current Twitter/X discourse about the given token. Return ONLY valid JSON with no markdown: {"sentiment": <number from -1.0 to 1.0>, "reasoning": "<brief explanation>", "tweetCount": <estimated tweets in last 24h>, "keyTopics": ["topic1", "topic2"]}. Positive sentiment means bullish discussion, influencer endorsements, positive news. Negative means FUD, rug pull warnings, community exodus. If you cannot find data, return {"sentiment": 0, "reasoning": "insufficient data", "tweetCount": 0, "keyTopics": []}.`,
        },
        {
          role: "user",
          content: `Analyze current X/Twitter sentiment for token ${tokenSymbol} (contract: ${tokenAddress} on Base chain). What is the social consensus in the last 24 hours?`,
        },
      ],
      temperature: 0.3,
      maxTokens: 500,
      enableWebSearch: true,
    });

    // Parse JSON from response
    const parsed = parseJsonResponse(result.content);
    const sentiment = typeof parsed.sentiment === "number"
      ? Math.max(-1, Math.min(1, parsed.sentiment))
      : 0;

    return {
      signal: {
        source: "social",
        name: "x_sentiment",
        value: sentiment,
        weight: 0.30,
        raw: parsed as Record<string, unknown>,
      },
      costUsdc: 0, // Venice inference is prepaid via sVVV, no per-call cost
    };
  } catch {
    return {
      signal: {
        source: "social",
        name: "x_sentiment",
        value: 0,
        weight: 0.30,
        raw: { error: "venice inference failed" },
      },
      costUsdc: 0,
    };
  }
}

/**
 * Fundamental signal: Messari market data — volume spike, market cap, ATH distance.
 */
async function getFundamentalSignal(
  tokenSymbol: string,
): Promise<SignalWithCost> {
  const messari = getResearchProvider("messari");
  let result: ResearchResult;
  try {
    result = await messari.query({ type: "market", target: tokenSymbol });
  } catch {
    return {
      signal: {
        source: "fundamental",
        name: "market_fundamentals",
        value: 0,
        weight: 0.30,
        raw: { error: "messari query failed" },
      },
      costUsdc: 0,
    };
  }

  const data = result.data as Record<string, unknown>;
  const value = scoreFundamentals(data);

  return {
    signal: {
      source: "fundamental",
      name: "market_fundamentals",
      value,
      weight: 0.30,
      raw: data,
    },
    costUsdc: Number(result.costUsdc) || 0.20,
  };
}

// ── Scoring Helpers ──

/**
 * Extract net flow from Nansen smart-money response.
 * Normalizes to -1..+1 range.
 */
function extractNetFlow(data: Record<string, unknown>): number {
  // Nansen returns various formats — try common paths
  const netFlow =
    (data.netFlow as number) ??
    (data.net_flow as number) ??
    ((data.inflow as number ?? 0) - (data.outflow as number ?? 0));

  if (typeof netFlow !== "number" || isNaN(netFlow)) return 0;

  // Normalize: scale by rough heuristic (> $1M net flow = strong signal)
  const normalized = netFlow / 1_000_000;
  return Math.max(-1, Math.min(1, normalized));
}

/**
 * Score fundamental data from Messari.
 *
 * Factors:
 *   - Volume spike (24h vs 7d avg): > 3x = +0.5, > 2x = +0.25
 *   - Market cap: < $10M with volume = +0.3 (high upside)
 *   - ATH distance: > 80% down = +0.2 (recovery play), < 10% = -0.3 (possible top)
 */
function scoreFundamentals(data: Record<string, unknown>): number {
  let score = 0;

  // Try to extract market data from nested Messari response
  const marketData = (data.marketData ?? data.market_data ?? data) as Record<string, unknown>;
  const athData = (data.allTimeHigh ?? data.ath ?? {}) as Record<string, unknown>;

  // Volume spike
  const vol24h = toNumber(marketData.volume_last_24_hours ?? marketData.volume24h);
  const vol7d = toNumber(marketData.volume_last_7_days ?? marketData.volume7d);
  if (vol24h > 0 && vol7d > 0) {
    const dailyAvg7d = vol7d / 7;
    const ratio = vol24h / dailyAvg7d;
    if (ratio > 3) score += 0.5;
    else if (ratio > 2) score += 0.25;
    else if (ratio < 0.5) score -= 0.25;
  }

  // Market cap
  const mcap = toNumber(marketData.current_marketcap_usd ?? marketData.marketCap);
  if (mcap > 0 && mcap < 10_000_000 && vol24h > 0) {
    score += 0.3; // small cap with volume = high upside potential
  } else if (mcap > 1_000_000_000) {
    score -= 0.15; // large cap = less upside for memecoins
  }

  // ATH distance
  const currentPrice = toNumber(marketData.price_usd ?? marketData.currentPrice);
  const athPrice = toNumber(athData.price ?? athData.athPrice);
  if (currentPrice > 0 && athPrice > 0) {
    const athDistance = ((athPrice - currentPrice) / athPrice) * 100;
    if (athDistance > 80) score += 0.2;  // deep discount recovery play
    else if (athDistance < 10) score -= 0.3; // near ATH, potential top
  }

  return Math.max(-1, Math.min(1, score));
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

/**
 * Parse a JSON response from Venice, handling markdown fences and extra text.
 */
function parseJsonResponse(content: string): Record<string, unknown> {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Find the first { ... } block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // Fall through
    }
  }
  return { sentiment: 0, reasoning: "failed to parse response", raw: content };
}
