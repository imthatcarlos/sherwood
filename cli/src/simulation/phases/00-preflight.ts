/**
 * Phase 00 — Preflight
 *
 * Validates the environment before any agent operations:
 *   1. Node version ≥ v20.12
 *   2. npx available in PATH
 *   3. esbuild arch match (darwin only — warns if mismatch)
 *   4. RPC endpoint reachable (eth_blockNumber)
 *   5. SIM_MNEMONIC is a valid BIP-39 mnemonic
 *   6. Master wallet has sufficient ETH (agentCount × fundAmountEth + 0.01 buffer)
 *
 * Errors abort the run. Warnings print but allow continuation.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveWallets } from "../wallets.js";
import type { SimConfig } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PreflightResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

export async function runPhase00(config: SimConfig): Promise<PreflightResult> {
  console.log("\n=== Phase 00: Preflight ===\n");

  const result: PreflightResult = { ok: true, warnings: [], errors: [] };

  // 1. Node version
  const nodeVersion = process.version; // e.g. "v20.12.0"
  const [major, minor] = nodeVersion.slice(1).split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 12)) {
    result.errors.push(
      `Node ${nodeVersion} detected — requires ≥ v20.12.0 (styleText support). ` +
        `Try: PATH="/opt/homebrew/opt/node/bin:$PATH"`,
    );
    console.error(`  ✗ Node version: ${nodeVersion}`);
  } else {
    console.log(`  ✓ Node version: ${nodeVersion}`);
  }

  // 2. npx available
  try {
    execFileSync("npx", ["--version"], { encoding: "utf8", timeout: 5_000 });
    console.log(`  ✓ npx available`);
  } catch {
    result.errors.push(
      "npx not found in PATH — add Node.js bin to PATH, e.g. /opt/homebrew/opt/node/bin",
    );
    console.error(`  ✗ npx not found`);
  }

  // 3. esbuild arch (macOS only)
  if (process.platform === "darwin") {
    const expectedPkg = `@esbuild/darwin-${process.arch}`;
    try {
      const req = createRequire(import.meta.url);
      req.resolve(expectedPkg);
      console.log(`  ✓ esbuild: ${expectedPkg} present`);
    } catch {
      result.warnings.push(
        `esbuild package "${expectedPkg}" not found — tsx may fail with TransformError. ` +
          `Fix: npm install ${expectedPkg} --no-save`,
      );
      console.warn(`  ! esbuild: ${expectedPkg} not found (warning)`);
    }
  }

  // 3b. SIM_COMPILED: verify dist/index.js exists and is not stale
  if (config.compiled) {
    const cliDir = path.resolve(__dirname, "../../..");
    const distPath = path.resolve(cliDir, "dist", "index.js");
    const srcPath = path.resolve(cliDir, "src", "index.ts");
    try {
      const distStat = statSync(distPath);
      let stale = false;
      try {
        const srcStat = statSync(srcPath);
        stale = srcStat.mtimeMs > distStat.mtimeMs;
      } catch {
        // Can't stat src — skip staleness check
      }
      if (stale) {
        result.warnings.push(
          `dist/index.js is older than src/index.ts — run \`npm run build\` in cli/ to rebuild`,
        );
        console.warn(`  ! SIM_COMPILED: dist/index.js may be stale (warning)`);
      } else {
        console.log(`  ✓ SIM_COMPILED: dist/index.js present`);
      }
    } catch {
      result.errors.push(
        `SIM_COMPILED=true but dist/index.js not found at ${distPath} — run \`npm run build\` in cli/`,
      );
      console.error(`  ✗ SIM_COMPILED: dist/index.js not found`);
    }
  }

  // 4. RPC reachable
  try {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json()) as { result?: string };
    if (!json.result) {
      result.errors.push(`RPC at ${config.rpcUrl} returned unexpected: ${JSON.stringify(json)}`);
      console.error(`  ✗ RPC: unexpected response`);
    } else {
      const blockNum = parseInt(json.result, 16);
      console.log(`  ✓ RPC: ${config.rpcUrl} — block #${blockNum}`);
    }
  } catch (err) {
    result.errors.push(`RPC at ${config.rpcUrl} unreachable: ${(err as Error).message}`);
    console.error(`  ✗ RPC: ${(err as Error).message}`);
  }

  // 5. Mnemonic valid
  let masterAddress: string | undefined;
  try {
    const [master] = deriveWallets(config.mnemonic, 1);
    masterAddress = master.address;
    console.log(`  ✓ SIM_MNEMONIC valid — master: ${masterAddress}`);
  } catch (err) {
    result.errors.push(`SIM_MNEMONIC is invalid: ${(err as Error).message}`);
    console.error(`  ✗ SIM_MNEMONIC invalid`);
  }

  // 6. Master wallet ETH balance (skip in dry-run — no funds are spent)
  if (!config.dryRun && masterAddress && result.errors.filter((e) => e.includes("RPC")).length === 0) {
    try {
      const minEth = parseFloat(config.fundAmountEth) * config.agentCount + 0.01;
      const response = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [masterAddress, "latest"],
          id: 2,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const { result: hexBalance } = (await response.json()) as { result: string };
      const balanceEth = Number(BigInt(hexBalance)) / 1e18;

      if (balanceEth < minEth) {
        result.errors.push(
          `Master wallet ${masterAddress} has ${balanceEth.toFixed(4)} ETH — ` +
            `needs ≥ ${minEth.toFixed(4)} ETH ` +
            `(${config.agentCount} agents × ${config.fundAmountEth} + 0.01 buffer)`,
        );
        console.error(
          `  ✗ Master balance: ${balanceEth.toFixed(4)} ETH (need ${minEth.toFixed(4)})`,
        );
      } else {
        console.log(`  ✓ Master balance: ${balanceEth.toFixed(4)} ETH`);
      }
    } catch (err) {
      result.warnings.push(`Could not check master wallet balance: ${(err as Error).message}`);
      console.warn(`  ! Balance check failed (warning): ${(err as Error).message}`);
    }
  }

  result.ok = result.errors.length === 0;

  console.log(`\nPreflight ${result.ok ? "passed" : "FAILED"}:`);
  if (result.warnings.length > 0) {
    console.log("  Warnings:");
    for (const w of result.warnings) console.log(`    - ${w}`);
  }
  if (result.errors.length > 0) {
    console.log("  Errors:");
    for (const e of result.errors) console.log(`    - ${e}`);
  }

  return result;
}
