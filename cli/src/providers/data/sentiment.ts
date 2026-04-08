/**
 * Sentiment data provider — Fear & Greed index and z-score utilities.
 */

import type { Provider, ProviderInfo } from "../../types.js";

export interface FearAndGreedData {
  value: number;
  classification: string;
  timestamp: string;
}

export interface FearAndGreedResponse {
  name: string;
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

export class SentimentProvider implements Provider {
  info(): ProviderInfo {
    return {
      name: "Sentiment",
      type: "research",
      capabilities: ["fear-and-greed", "sentiment-zscore"],
      supportedChains: [],
    };
  }

  /** Fetch last 30 days of Fear & Greed index data. */
  async getFearAndGreed(): Promise<FearAndGreedData[]> {
    try {
      const res = await fetch("https://api.alternative.me/fng/?limit=30");
      if (!res.ok) throw new Error(`Fear & Greed API error: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as FearAndGreedResponse;
      return json.data.map((d) => ({
        value: Number(d.value),
        classification: d.value_classification,
        timestamp: d.timestamp,
      }));
    } catch (err) {
      throw new Error(`Failed to fetch Fear & Greed: ${(err as Error).message}`);
    }
  }

  /** Get just the latest Fear & Greed value. */
  async getFearAndGreedCurrent(): Promise<FearAndGreedData> {
    const data = await this.getFearAndGreed();
    if (!data.length) throw new Error("No Fear & Greed data available");
    return data[0]!;
  }

  /**
   * Compute z-score of the latest value compared to the array.
   * z = (latest - mean) / stddev
   */
  computeSentimentZScore(values: number[]): number {
    if (values.length < 2) return 0;
    const latest = values[0]!;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;
    return (latest - mean) / stddev;
  }
}
