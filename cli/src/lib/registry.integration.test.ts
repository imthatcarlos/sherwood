/**
 * Integration tests for StrategyRegistry — read-only RPC calls.
 * Requires BASE_SEPOLIA_RPC_URL env var. Registry address is hardcoded in addresses.ts.
 */

import { describe, it, expect } from "vitest";
import { strategyCount, listStrategies } from "./registry.js";

describe("StrategyRegistry (Base Sepolia)", () => {
  it("strategyCount returns a bigint >= 0", async () => {
    const count = await strategyCount();
    expect(typeof count).toBe("bigint");
    expect(count).toBeGreaterThanOrEqual(0n);
  });

  it("listStrategies returns an array", async () => {
    const strategies = await listStrategies();
    expect(Array.isArray(strategies)).toBe(true);
  });
});
