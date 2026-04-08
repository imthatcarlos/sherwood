/**
 * CoinGecko free API provider with rate-limiting (1.5s between calls).
 */

import type { Provider, ProviderInfo } from "../../types.js";

const BASE_URL = "https://api.coingecko.com/api/v3";

// Shared across all instances to prevent 429s when multiple CoinGeckoProvider exist
let sharedLastCallTime = 0;

export class CoinGeckoProvider implements Provider {
  private readonly minInterval = 1500; // 1.5s between calls

  info(): ProviderInfo {
    return {
      name: "CoinGecko",
      type: "research",
      capabilities: ["price", "market-data", "ohlc", "coin-details", "trending"],
      supportedChains: [],
    };
  }

  /** Throttle: wait until 1.5s has passed since last call (shared across all instances). */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - sharedLastCallTime;
    if (elapsed < this.minInterval) {
      await new Promise((resolve) => setTimeout(resolve, this.minInterval - elapsed));
    }
    sharedLastCallTime = Date.now();
  }

  private async fetchJson(url: string): Promise<any> {
    await this.throttle();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status} ${res.statusText} — ${url}`);
    return res.json();
  }

  /**
   * Get simple prices for multiple tokens.
   * Returns price, 24h vol, 24h change, and market cap per token.
   */
  async getPrice(
    ids: string[],
    vsCurrencies: string[] = ["usd"],
  ): Promise<Record<string, any>> {
    const params = new URLSearchParams({
      ids: ids.join(","),
      vs_currencies: vsCurrencies.join(","),
      include_24hr_vol: "true",
      include_24hr_change: "true",
      include_market_cap: "true",
    });
    return this.fetchJson(`${BASE_URL}/simple/price?${params}`);
  }

  /**
   * Get market chart data (prices, market_caps, total_volumes) over time.
   * Note: only fetches for a single id at a time.
   */
  async getMarketData(
    id: string,
    days: number = 30,
  ): Promise<{ prices: number[][]; market_caps: number[][]; total_volumes: number[][] }> {
    const params = new URLSearchParams({
      vs_currency: "usd",
      days: String(days),
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}/market_chart?${params}`);
  }

  /**
   * Get OHLC candle data.
   * days: 1/7/14/30/90/180/365/max
   * Returns array of [timestamp, open, high, low, close].
   */
  async getOHLC(
    id: string,
    days: number = 30,
  ): Promise<number[][]> {
    const params = new URLSearchParams({
      vs_currency: "usd",
      days: String(days),
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}/ohlc?${params}`);
  }

  /** Get detailed coin information. */
  async getCoinDetails(id: string): Promise<any> {
    const params = new URLSearchParams({
      localization: "false",
      tickers: "false",
      community_data: "true",
      developer_data: "true",
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}?${params}`);
  }

  /** Get trending coins. */
  async getTrending(): Promise<any> {
    return this.fetchJson(`${BASE_URL}/search/trending`);
  }
}
