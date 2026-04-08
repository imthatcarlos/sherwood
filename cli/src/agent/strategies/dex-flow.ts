/**
 * DEX Flow Analysis Strategy
 * Uses buy/sell transaction ratios from DEXScreener to gauge on-chain momentum.
 *
 * If buy txns significantly > sell txns (ratio > 1.5): bullish +0.3 to +0.6
 * If sell txns > buy txns (ratio > 1.5): bearish -0.3 to -0.6
 * Volume spike (24h volume > 3x liquidity): signal amplified
 * Combines 1h (reactive) and 24h (trend confirmation) data
 */

import type { Signal } from '../scoring.js';
import type { Strategy, StrategyContext } from './types.js';
import { DexScreenerProvider } from '../../providers/data/dexscreener.js';
import type { DexPair } from '../../providers/data/dexscreener.js';

function clamp(v: number, min: number = -1, max: number = 1): number {
  return Math.max(min, Math.min(max, v));
}

export class DexFlowStrategy implements Strategy {
  name = 'dexFlow';
  description = 'Analyzes DEX buy/sell transaction ratios and volume for on-chain momentum';
  requiredData = ['marketData'];

  private dex = new DexScreenerProvider();

  async analyze(ctx: StrategyContext): Promise<Signal> {
    const details: string[] = [];
    let value = 0;
    let confidence = 0.3;

    // Try to find DEX pairs for the token
    let pairs: DexPair[] = [];
    try {
      pairs = await this.dex.searchPairs(ctx.tokenId);
    } catch (err) {
      return {
        name: this.name,
        value: 0,
        confidence: 0.1,
        source: 'DEX Flow Analysis',
        details: `Failed to fetch DEX data: ${(err as Error).message}`,
      };
    }

    if (pairs.length === 0) {
      return {
        name: this.name,
        value: 0,
        confidence: 0.1,
        source: 'DEX Flow Analysis',
        details: `No DEX pairs found for ${ctx.tokenId}`,
      };
    }

    // Use the highest-volume pair
    const pair = pairs
      .filter((p) => p.volume?.h24 > 0 && p.txns)
      .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];

    if (!pair || !pair.txns) {
      return {
        name: this.name,
        value: 0,
        confidence: 0.1,
        source: 'DEX Flow Analysis',
        details: 'No DEX pairs with transaction data',
      };
    }

    details.push(`Pair: ${pair.baseToken.symbol}/${pair.quoteToken.symbol} on ${pair.dexId}`);

    // 1h transaction ratio analysis (more reactive, weighted higher)
    const h1Buys = pair.txns.h1?.buys ?? 0;
    const h1Sells = pair.txns.h1?.sells ?? 0;
    const h1Total = h1Buys + h1Sells;

    let h1Signal = 0;
    if (h1Total > 10) { // need minimum activity
      const h1Ratio = h1Buys / Math.max(h1Sells, 1);
      if (h1Ratio > 1.5) {
        // Bullish: scale from +0.3 (ratio=1.5) to +0.6 (ratio=3.0+)
        h1Signal = 0.3 + Math.min((h1Ratio - 1.5) / 1.5, 1.0) * 0.3;
        details.push(`1h: ${h1Buys} buys / ${h1Sells} sells (ratio ${h1Ratio.toFixed(2)}, bullish)`);
      } else if (h1Ratio < 1 / 1.5) {
        // Bearish: inverse ratio
        const invRatio = h1Sells / Math.max(h1Buys, 1);
        h1Signal = -(0.3 + Math.min((invRatio - 1.5) / 1.5, 1.0) * 0.3);
        details.push(`1h: ${h1Buys} buys / ${h1Sells} sells (ratio ${h1Ratio.toFixed(2)}, bearish)`);
      } else {
        details.push(`1h: ${h1Buys} buys / ${h1Sells} sells (balanced)`);
      }
      confidence += 0.1;
    }

    // 24h transaction ratio analysis (trend confirmation)
    const h24Buys = pair.txns.h24?.buys ?? 0;
    const h24Sells = pair.txns.h24?.sells ?? 0;
    const h24Total = h24Buys + h24Sells;

    let h24Signal = 0;
    if (h24Total > 50) { // need minimum activity
      const h24Ratio = h24Buys / Math.max(h24Sells, 1);
      if (h24Ratio > 1.5) {
        h24Signal = 0.3 + Math.min((h24Ratio - 1.5) / 1.5, 1.0) * 0.3;
        details.push(`24h: ${h24Buys} buys / ${h24Sells} sells (ratio ${h24Ratio.toFixed(2)}, bullish)`);
      } else if (h24Ratio < 1 / 1.5) {
        const invRatio = h24Sells / Math.max(h24Buys, 1);
        h24Signal = -(0.3 + Math.min((invRatio - 1.5) / 1.5, 1.0) * 0.3);
        details.push(`24h: ${h24Buys} buys / ${h24Sells} sells (ratio ${h24Ratio.toFixed(2)}, bearish)`);
      } else {
        details.push(`24h: ${h24Buys} buys / ${h24Sells} sells (balanced)`);
      }
      confidence += 0.1;
    }

    // Combine: 60% weight on 1h (reactive), 40% on 24h (trend)
    value = h1Signal * 0.6 + h24Signal * 0.4;

    // Volume spike amplifier: if 24h volume > 3x liquidity, signal is amplified
    const volume24h = pair.volume?.h24 ?? 0;
    const liquidity = pair.liquidity?.usd ?? 0;
    if (liquidity > 0 && volume24h > liquidity * 3) {
      const amplifier = Math.min(volume24h / liquidity / 3, 2.0); // cap at 2x
      value = clamp(value * amplifier);
      confidence += 0.1;
      details.push(`Volume spike: $${(volume24h / 1e6).toFixed(1)}M vol vs $${(liquidity / 1e6).toFixed(1)}M liq (${(volume24h / liquidity).toFixed(1)}x)`);
    }

    // Agreement bonus: if 1h and 24h agree in direction, boost confidence
    if ((h1Signal > 0 && h24Signal > 0) || (h1Signal < 0 && h24Signal < 0)) {
      confidence += 0.1;
      details.push('1h and 24h signals agree');
    } else if ((h1Signal > 0 && h24Signal < 0) || (h1Signal < 0 && h24Signal > 0)) {
      confidence -= 0.1;
      details.push('1h and 24h signals diverge');
    }

    return {
      name: this.name,
      value: clamp(value),
      confidence: Math.min(Math.max(confidence, 0.1), 1.0),
      source: 'DEX Flow Analysis',
      details: details.join('; '),
    };
  }
}
