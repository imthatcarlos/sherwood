/**
 * Integration test setup — runs before all integration tests.
 * Loads .env, sets network to base-sepolia, and validates RPC is available.
 * Factory/registry addresses are hardcoded in addresses.ts — no env vars needed.
 */

import "dotenv/config";
import { beforeAll } from "vitest";
import { setNetwork } from "../lib/network.js";
import { resetClients } from "../lib/client.js";

beforeAll(() => {
  setNetwork("base-sepolia");
  resetClients();

  if (!process.env.BASE_SEPOLIA_RPC_URL) {
    throw new Error(
      "BASE_SEPOLIA_RPC_URL is required for integration tests. " +
      "Set it in cli/.env or as an environment variable.",
    );
  }
});
