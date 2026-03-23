import { describe, it, expect } from "vitest";
import { checkExit, DEFAULT_EXIT_CONFIG } from "./exit-strategy.js";
import type { ExitConfig } from "./exit-strategy.js";
import type { SignalResult } from "./signals.js";

describe("checkExit", () => {
  const base: ExitConfig = { ...DEFAULT_EXIT_CONFIG };

  it("returns hold when no conditions met", () => {
    const result = checkExit(100, 105, 105, base);
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toBe("hold");
    expect(result.currentPnlPct).toBeCloseTo(5);
  });

  it("triggers stop loss at threshold", () => {
    // Entry 100, current 90 = -10% exactly
    const result = checkExit(100, 90, 100, base);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("stop_loss");
    expect(result.currentPnlPct).toBeCloseTo(-10);
  });

  it("does not trigger stop loss just above threshold", () => {
    const result = checkExit(100, 90.1, 100, base);
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toBe("hold");
  });

  it("triggers deadline exit", () => {
    const pastDeadline: ExitConfig = {
      ...base,
      deadlineUnix: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
    };
    const result = checkExit(100, 105, 105, pastDeadline);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("deadline");
  });

  it("does not trigger deadline when in future", () => {
    const futureDeadline: ExitConfig = {
      ...base,
      deadlineUnix: Math.floor(Date.now() / 1000) + 3600,
    };
    const result = checkExit(100, 105, 105, futureDeadline);
    expect(result.shouldExit).toBe(false);
  });

  it("triggers trailing stop on drawdown from high-water", () => {
    const config: ExitConfig = { ...base, trailingStopPct: 20 };
    // Entry 100, high 200, current 155 → drawdown = 22.5%
    const result = checkExit(100, 155, 200, config);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("trailing_stop");
  });

  it("does not trigger trailing stop within tolerance", () => {
    const config: ExitConfig = { ...base, trailingStopPct: 20 };
    // Entry 100, high 200, current 165 → drawdown = 17.5%
    const result = checkExit(100, 165, 200, config);
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toBe("hold");
  });

  it("triggers take profit", () => {
    const config: ExitConfig = { ...base, takeProfitPct: 50 };
    const result = checkExit(100, 155, 155, config);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("take_profit");
    expect(result.currentPnlPct).toBeCloseTo(55);
  });

  it("triggers signal-based exit on bearish signal", () => {
    const signal: SignalResult = {
      action: "sell",
      confidence: 0.7,
      compositeScore: -0.5,
      signals: [],
      costUsdc: "0",
      timestamp: 0,
    };
    const result = checkExit(100, 105, 105, base, signal);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("signal_bearish");
  });

  it("does not trigger signal exit with low confidence", () => {
    const signal: SignalResult = {
      action: "sell",
      confidence: 0.3, // below 0.4 threshold
      compositeScore: -0.5,
      signals: [],
      costUsdc: "0",
      timestamp: 0,
    };
    const result = checkExit(100, 105, 105, base, signal);
    expect(result.shouldExit).toBe(false);
  });

  it("does not trigger signal exit when disabled", () => {
    const config: ExitConfig = { ...base, signalExitEnabled: false };
    const signal: SignalResult = {
      action: "sell",
      confidence: 0.9,
      compositeScore: -0.8,
      signals: [],
      costUsdc: "0",
      timestamp: 0,
    };
    const result = checkExit(100, 105, 105, config, signal);
    expect(result.shouldExit).toBe(false);
  });

  it("deadline takes priority over stop loss", () => {
    const config: ExitConfig = {
      ...base,
      deadlineUnix: Math.floor(Date.now() / 1000) - 60,
    };
    // Also in stop-loss territory
    const result = checkExit(100, 85, 100, config);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("deadline");
  });

  it("handles zero entry price gracefully", () => {
    const result = checkExit(0, 100, 100, base);
    expect(result.shouldExit).toBe(false);
    expect(result.currentPnlPct).toBe(0);
  });

  it("calculates high water PnL correctly", () => {
    const result = checkExit(100, 120, 150, base);
    expect(result.highWaterPnlPct).toBeCloseTo(50);
    expect(result.currentPnlPct).toBeCloseTo(20);
  });
});
