/**
 * Integration test setup — runs before all integration tests.
 * Loads .env, sets network to base-sepolia, and validates required env vars.
 */

import "dotenv/config";
import { beforeAll } from "vitest";
import { setNetwork } from "../lib/network.js";
import { resetClients } from "../lib/client.js";

beforeAll(() => {
  setNetwork("base-sepolia");
  resetClients();

  const required = [
    "BASE_SEPOLIA_RPC_URL",
    "FACTORY_ADDRESS_TESTNET",
    "REGISTRY_ADDRESS_TESTNET",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(
        `${key} is required for integration tests. ` +
        `Set it in cli/.env or as an environment variable.`,
      );
    }
  }
});
