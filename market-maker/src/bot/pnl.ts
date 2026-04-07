/**
 * FIX 7: PnL tracking - per-cycle profit/loss accounting.
 * Tracks fees collected vs gas spent. IL tracking deferred (complex).
 */

import { logger } from './logger.js';
import type { BotState, PnLData } from '../types.js';
import { formatEth } from '../pool/math.js';

/** Per-cycle PnL snapshot */
export interface CyclePnL {
  portfolioValueEth: number;
  feesCollectedEth: number;
  gasSpentEth: number;
  netPnlEth: number;
}

/** Create a default PnL data object */
export function defaultPnL(): PnLData {
  return {
    totalFeesEth: 0,
    totalGasEth: 0,
    netPnlEth: 0,
    cyclesTracked: 0,
    firstCycleTime: 0,
    lastCycleTime: 0,
  };
}

/**
 * Compute gas cost in ETH from a transaction receipt.
 * gasUsed * effectiveGasPrice gives the cost in wei.
 */
export function computeGasCostEth(receipt: {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}): number {
  const costWei = receipt.gasUsed * receipt.effectiveGasPrice;
  return Number(costWei) / 1e18;
}

/**
 * Compute fees in ETH terms.
 * token0 fees + token1 fees converted to ETH using current price.
 * If token0 is WOOD, amount0 * woodPriceInEth + amount1 (which is ETH).
 * If token0 is WETH, amount0 + amount1 * woodPriceInEth.
 */
export function computeFeesEth(
  amount0: bigint,
  amount1: bigint,
  isToken0Wood: boolean,
  woodPriceInEth: number,
): number {
  const a0 = Number(amount0) / 1e18;
  const a1 = Number(amount1) / 1e18;

  if (isToken0Wood) {
    // token0 = WOOD, token1 = WETH
    return a0 * woodPriceInEth + a1;
  } else {
    // token0 = WETH, token1 = WOOD
    return a0 + a1 * woodPriceInEth;
  }
}

/**
 * Update cumulative PnL with a cycle's data and log a summary.
 */
export function updatePnL(
  state: BotState,
  cyclePnl: CyclePnL,
): void {
  const now = Date.now() / 1000;

  state.pnl.totalFeesEth += cyclePnl.feesCollectedEth;
  state.pnl.totalGasEth += cyclePnl.gasSpentEth;
  state.pnl.netPnlEth = state.pnl.totalFeesEth - state.pnl.totalGasEth;
  state.pnl.cyclesTracked++;
  state.pnl.lastCycleTime = now;

  if (state.pnl.firstCycleTime === 0) {
    state.pnl.firstCycleTime = now;
  }

  logPnLSummary(state, cyclePnl);
}

/**
 * Log per-cycle and cumulative PnL summary.
 */
function logPnLSummary(state: BotState, cyclePnl: CyclePnL): void {
  const runtimeHours = state.pnl.firstCycleTime > 0
    ? (state.pnl.lastCycleTime - state.pnl.firstCycleTime) / 3600
    : 0;

  logger.info(
    {
      cycle: {
        portfolioEth: cyclePnl.portfolioValueEth.toFixed(6),
        feesEth: cyclePnl.feesCollectedEth.toFixed(8),
        gasEth: cyclePnl.gasSpentEth.toFixed(8),
        netEth: cyclePnl.netPnlEth.toFixed(8),
      },
      cumulative: {
        totalFeesEth: state.pnl.totalFeesEth.toFixed(8),
        totalGasEth: state.pnl.totalGasEth.toFixed(8),
        netPnlEth: state.pnl.netPnlEth.toFixed(8),
        cyclesTracked: state.pnl.cyclesTracked,
        runtimeHours: runtimeHours.toFixed(2),
      },
    },
    'PnL summary',
  );
}
