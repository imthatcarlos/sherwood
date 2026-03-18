/**
 * Integration tests for SyndicateVault — read-only RPC calls.
 * Requires BASE_SEPOLIA_RPC_URL env var.
 * Tests against the vault deployed by "sherwood syndicate create" on Base Sepolia.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { Address } from "viem";
import { setVaultAddress, getAssetAddress, getAssetDecimals, getVaultInfo } from "./vault.js";
import { TOKENS } from "./addresses.js";

// Vault deployed by syndicate #1 on the redeployed factory
const VAULT_ADDRESS = "0x22577c660E2B68c5609490d3a37FBB06b4802644" as Address;

beforeAll(() => {
  setVaultAddress(VAULT_ADDRESS);
});

describe("SyndicateVault (Base Sepolia)", () => {
  it("getAssetAddress returns USDC on Sepolia", async () => {
    const asset = await getAssetAddress();
    expect(asset.toLowerCase()).toBe(TOKENS().USDC.toLowerCase());
  });

  it("getAssetDecimals returns 6 for USDC", async () => {
    const decimals = await getAssetDecimals();
    expect(decimals).toBe(6);
  });

  it("getVaultInfo returns valid shape", async () => {
    const info = await getVaultInfo();
    expect(info.address.toLowerCase()).toBe(VAULT_ADDRESS.toLowerCase());
    expect(typeof info.totalAssets).toBe("string");
    expect(["number", "bigint"]).toContain(typeof info.agentCount);
    expect(typeof info.redemptionsLocked).toBe("boolean");
    expect(typeof info.managementFeeBps).toBe("bigint");
  });
});
