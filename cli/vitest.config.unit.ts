import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "src/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 10_000,
    env: {
      ENABLE_TESTNET: "true",
    },
  },
});
