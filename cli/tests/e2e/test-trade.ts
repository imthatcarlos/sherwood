/**
 * E2E test: Trade buy/sell with flexible token inputs (#127)
 *
 * Runs on Base mainnet (real liquidity) using a funded agent from simulation state.
 * Tests all trade buy/sell variants: USDC input, --with ETH, --with WETH,
 * sell --for WETH, sell default USDC output, and positions display.
 */

import { execSherwood } from "../../src/simulation/exec.js";
import { agentHomeDir } from "../../src/simulation/agent-home.js";
import type { SimConfig, SimState, SimLogger, AgentState } from "./types.js";
import { createPublicClient, http, parseUnits } from "viem";
import { base } from "viem/chains";
import { TOKENS } from "../../src/lib/addresses.js";

const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MIN_USDC = parseUnits("1.5", 6); // Need ~1.5 USDC for the full test

async function findAgentWithUsdc(
  agents: AgentState[],
  client: ReturnType<typeof createPublicClient>,
): Promise<AgentState | undefined> {
  for (const agent of agents) {
    const bal = await client.readContract({
      address: USDC_ADDR as `0x${string}`,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [agent.address as `0x${string}`],
    }) as bigint;
    if (bal >= MIN_USDC) return agent;
  }
  return undefined;
}

export async function testTrade(config: SimConfig, state: SimState, logger?: SimLogger): Promise<void> {
  // Check for Uniswap API key — required for all trade commands
  if (!process.env.UNISWAP_API_KEY) {
    console.log("  ⚠  UNISWAP_API_KEY not set — skipping trade tests");
    console.log("     Set it with: sherwood config set --uniswap-api-key <key>");
    console.log("     Or export UNISWAP_API_KEY=<key> before running");
    return;
  }

  // Find an agent with enough USDC to run the full test
  const client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
  const agent = await findAgentWithUsdc(state.agents, client);
  if (!agent) {
    console.log("  ⚠  No agent has enough USDC (>=1.5) — skipping trade tests");
    return;
  }
  const home = agentHomeDir(config.baseDir, agent.index);

  console.log(`  Using agent ${agent.index} (${agent.address}) for trade tests`);

  // 1. buy DEGEN with USDC (default input) — $0.50
  const buyOut = execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.5", "--slippage", "5"],
    config, logger, agent.index,
  );
  if (!buyOut && !config.dryRun) throw new Error("trade buy returned empty output");

  // 2. buy DEGEN --with ETH (should wrap ETH → WETH, then swap)
  execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.0001", "--with", "ETH", "--slippage", "10"],
    config, logger, agent.index,
  );

  // 3. buy DEGEN --with WETH (direct WETH input)
  // Note: agent may have no WETH at this point (wrapped WETH was consumed by step 2 swap).
  // The --with WETH path is exercised fully in step 5 (after step 4 sells for WETH).
  // Skip gracefully here if no WETH balance.
  try {
    execSherwood(
      home,
      ["trade", "buy", "--token", "DEGEN", "--amount", "0.0001", "--with", "WETH", "--slippage", "10"],
      config, logger, agent.index,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.toLowerCase().includes("insufficient weth") || msg.toLowerCase().includes("have 0")) {
      console.log("  ⚠  No WETH at step 3 — --with WETH path tested in step 5 instead");
    } else {
      throw err;
    }
  }

  // 4. sell DEGEN --for WETH (non-USDC output)
  execSherwood(
    home,
    ["trade", "sell", "--token", "DEGEN", "--for", "WETH"],
    config, logger, agent.index,
  );

  // 5. Buy more DEGEN with WETH (uses WETH received from step 4) — also tests --with WETH path
  execSherwood(
    home,
    ["trade", "buy", "--token", "DEGEN", "--amount", "0.00005", "--with", "WETH", "--slippage", "10"],
    config, logger, agent.index,
  );

  // 6. sell DEGEN (default USDC output) — test the default sell path
  execSherwood(
    home,
    ["trade", "sell", "--token", "DEGEN"],
    config, logger, agent.index,
  );

  // 7. positions — should show at least closed entries from above trades
  const posOut = execSherwood(
    home,
    ["trade", "positions"],
    config, logger, agent.index,
  );

  if (!config.dryRun && posOut &&
      !posOut.includes("DEGEN") &&
      !posOut.includes("position") &&
      !posOut.includes("closed") &&
      !posOut.includes("No open")) {
    throw new Error(`trade positions output unexpected:\n${posOut}`);
  }

  console.log("  ✓ All trade variants executed successfully");
}
