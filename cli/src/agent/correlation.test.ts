/**
 * Test file for CorrelationGuard functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorrelationGuard } from './correlation.js';

// Mock the CoinGeckoProvider as a class constructor
vi.mock('../providers/data/coingecko.js', () => ({
  CoinGeckoProvider: class {
    getOHLC = vi.fn().mockResolvedValue([]);
  },
}));

describe('CorrelationGuard', () => {
  let correlationGuard: CorrelationGuard;

  beforeEach(() => {
    correlationGuard = new CorrelationGuard();
  });

  it('should skip correlation check for BTC', async () => {
    const result = await correlationGuard.checkCorrelation('bitcoin');

    expect(result.btcBias).toBe('neutral');
    expect(result.shouldSuppress).toBe(false);
    expect(result.suppressionFactor).toBe(1.0);
    expect(result.reason).toContain('BTC or stablecoin');
  });

  it('should skip correlation check for stablecoins', async () => {
    const result = await correlationGuard.checkCorrelation('tether');

    expect(result.btcBias).toBe('neutral');
    expect(result.shouldSuppress).toBe(false);
    expect(result.suppressionFactor).toBe(1.0);
    expect(result.reason).toContain('BTC or stablecoin');
  });

  it('should return neutral check on data failure', async () => {
    // Mock failed data fetch
    const mockCoingecko = vi.mocked(correlationGuard['coingecko']);
    mockCoingecko.getOHLC = vi.fn().mockRejectedValue(new Error('API error'));

    // Force cache miss — getBtcStructure() uses a 10-min on-disk cache that
    // may hold a valid prior structure from unrelated runs.
    (correlationGuard as unknown as { loadCache: () => Promise<never> }).loadCache =
      () => Promise.reject(new Error('no cache'));

    const result = await correlationGuard.checkCorrelation('ethereum');

    expect(result.btcBias).toBe('neutral');
    expect(result.btcScore).toBe(0);
    expect(result.shouldSuppress).toBe(false);
  });

  it('should fetch 90 days of BTC OHLC and not throw insufficient-data', async () => {
    // Build 90 synthetic daily candles in a mild uptrend so the flow has real
    // data to compute EMA/RSI/MACD against. The point of the test is to prove
    // the threshold (<50) no longer trips for a valid fetch — regardless of
    // which bias the math produces, we must NOT fall back to the neutral-on-
    // failure branch (btcScore === 0 with reason starting "BTC or stablecoin"
    // is the skip path; the error path also sets btcScore === 0).
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ohlc: number[][] = Array.from({ length: 90 }, (_, i) => {
      const price = 50_000 + i * 100; // steady rise
      return [now - (89 - i) * dayMs, price, price + 50, price - 50, price];
    });

    const mockCoingecko = vi.mocked(correlationGuard['coingecko']);
    const getOHLCMock = vi.fn().mockResolvedValue(ohlc);
    mockCoingecko.getOHLC = getOHLCMock;

    // Force cache miss so analyzeBtcStructure() is actually invoked.
    (correlationGuard as unknown as { loadCache: () => Promise<never> }).loadCache =
      () => Promise.reject(new Error('no cache'));

    const result = await correlationGuard.checkCorrelation('ethereum');

    // Verify the call site now requests 90 days, not 30.
    expect(getOHLCMock).toHaveBeenCalledWith('bitcoin', 90);
    // Reason must not be the "BTC or stablecoin" skip message — we passed in
    // ethereum, so the structure branch was taken.
    expect(result.reason).not.toContain('BTC or stablecoin');
    // Should produce a valid bias (not the string literal 'error' or similar).
    expect(['bullish', 'bearish', 'neutral']).toContain(result.btcBias);
  });

  it('should NOT persist the neutral fallback structure to cache when CoinGecko throws', async () => {
    // Spy on saveCache via a helper the test can inspect.
    const saveCacheSpy = vi.fn().mockResolvedValue(undefined);
    (correlationGuard as unknown as { saveCache: typeof saveCacheSpy }).saveCache = saveCacheSpy;
    // Force a cache miss so analyzeBtcStructure runs.
    (correlationGuard as unknown as { loadCache: () => Promise<never> }).loadCache =
      () => Promise.reject(new Error('no cache'));
    // Simulate the 429 / rate-limit branch by making the OHLC fetch throw.
    const mockCoingecko = vi.mocked(correlationGuard['coingecko']);
    mockCoingecko.getOHLC = vi.fn().mockRejectedValue(new Error('429 rate limited'));

    await correlationGuard.checkCorrelation('ethereum');

    // Critical invariant: the catch-branch fallback (price===0) must never be cached.
    // A cached price===0 would stick the correlation score at neutral for 60 min after
    // a single transient 429, stranding alt long-entry suppression in the dead zone.
    expect(saveCacheSpy).not.toHaveBeenCalled();
  });

  it('should prefer a stale-but-real cached structure over a fresh fallback', async () => {
    // Stale cache older than 60min — the TTL bumped from 10min to 60min.
    const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
    (correlationGuard as unknown as { loadCache: () => Promise<{ timestamp: number; btcStructure: { price: number; ema50: number; ema200: number; rsi: number; macdDirection: string; score: number } }> }).loadCache =
      () => Promise.resolve({
        timestamp: Date.now() - STALE_MS,
        btcStructure: { price: 70000, ema50: 68000, ema200: 65000, rsi: 55, macdDirection: 'bullish', score: 0.4 },
      });

    const mockCoingecko = vi.mocked(correlationGuard['coingecko']);
    mockCoingecko.getOHLC = vi.fn().mockRejectedValue(new Error('429 rate limited'));

    const result = await correlationGuard.checkCorrelation('ethereum');

    // Real-but-stale beats fresh fallback. We should see a bullish bias from the stored
    // structure (score 0.4), NOT the neutral fallback (score 0, price 0).
    expect(result.btcBias).toBe('bullish');
  });
});