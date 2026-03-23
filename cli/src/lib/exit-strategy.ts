/**
 * Signal-based exit strategy for memecoin trades.
 *
 * Pure computation — no network calls. Evaluates a priority-ordered
 * set of exit conditions against the current position state.
 */

import type { SignalResult } from "./signals.js";

export interface ExitConfig {
  stopLossPct: number;         // exit if PnL drops below this % (default 10)
  trailingStopPct: number;     // exit if drawdown from high-water exceeds this % (0 = disabled)
  takeProfitPct: number;       // exit if PnL reaches this % (0 = disabled, use signal exit)
  deadlineUnix: number;        // force exit before this unix timestamp (0 = none)
  signalExitEnabled: boolean;  // exit when signals flip bearish (default true)
}

export type ExitReason =
  | "stop_loss"
  | "trailing_stop"
  | "take_profit"
  | "deadline"
  | "signal_bearish"
  | "hold";

export interface ExitCheck {
  shouldExit: boolean;
  reason: ExitReason;
  currentPnlPct: number;
  highWaterPnlPct: number;
}

export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  stopLossPct: 10,
  trailingStopPct: 0,
  takeProfitPct: 0,
  deadlineUnix: 0,
  signalExitEnabled: true,
};

/**
 * Check whether a position should be exited.
 *
 * Priority order (first match wins):
 *   1. Deadline passed
 *   2. Stop loss
 *   3. Trailing stop (drawdown from high-water mark)
 *   4. Take profit
 *   5. Signal-based (bearish signals with sufficient confidence)
 *   6. Hold
 */
export function checkExit(
  entryPrice: number,
  currentPrice: number,
  highWaterPrice: number,
  config: ExitConfig,
  signalResult?: SignalResult,
): ExitCheck {
  if (entryPrice <= 0) {
    return { shouldExit: false, reason: "hold", currentPnlPct: 0, highWaterPnlPct: 0 };
  }

  const currentPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const highWaterPnlPct = ((highWaterPrice - entryPrice) / entryPrice) * 100;

  // 1. Deadline
  if (config.deadlineUnix > 0 && Date.now() / 1000 > config.deadlineUnix) {
    return { shouldExit: true, reason: "deadline", currentPnlPct, highWaterPnlPct };
  }

  // 2. Stop loss
  if (currentPnlPct <= -config.stopLossPct) {
    return { shouldExit: true, reason: "stop_loss", currentPnlPct, highWaterPnlPct };
  }

  // 3. Trailing stop
  if (config.trailingStopPct > 0 && highWaterPrice > 0) {
    const drawdownPct = ((highWaterPrice - currentPrice) / highWaterPrice) * 100;
    if (drawdownPct >= config.trailingStopPct) {
      return { shouldExit: true, reason: "trailing_stop", currentPnlPct, highWaterPnlPct };
    }
  }

  // 4. Take profit
  if (config.takeProfitPct > 0 && currentPnlPct >= config.takeProfitPct) {
    return { shouldExit: true, reason: "take_profit", currentPnlPct, highWaterPnlPct };
  }

  // 5. Signal-based exit
  if (
    config.signalExitEnabled &&
    signalResult &&
    signalResult.action === "sell" &&
    signalResult.confidence > 0.4
  ) {
    return { shouldExit: true, reason: "signal_bearish", currentPnlPct, highWaterPnlPct };
  }

  // 6. Hold
  return { shouldExit: false, reason: "hold", currentPnlPct, highWaterPnlPct };
}
