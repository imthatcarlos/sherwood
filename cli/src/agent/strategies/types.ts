/**
 * Strategy module types — base interfaces for all trading strategies.
 */

import type { Signal } from '../scoring.js';
import type { Candle, TechnicalSignals } from '../technical.js';

export type { Candle, TechnicalSignals };

export interface StrategyConfig {
  enabled: boolean;
  weight: number;  // override default weight
  params: Record<string, any>;
}

export interface StrategyContext {
  tokenId: string;
  candles?: Candle[];
  technicals?: TechnicalSignals;
  fearAndGreed?: { value: number; classification: string };
  sentimentZScore?: number;
  tvlData?: any;       // from DefiLlama
  marketData?: any;     // from CoinGecko
  nansenData?: any;     // from x402 research (Nansen)
  messariData?: any;    // from x402 research (Messari)
}

export interface Strategy {
  name: string;
  description: string;
  requiredData: string[];  // what data this strategy needs
  analyze(ctx: StrategyContext): Promise<Signal>;
}
