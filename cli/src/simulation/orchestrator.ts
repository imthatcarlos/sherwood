#!/usr/bin/env node
/**
 * Multi-Agent Simulation Orchestrator
 *
 * CLI entry point for running simulation phases.
 *
 * Usage:
 *   npx tsx cli/src/simulation/orchestrator.ts <command> [options]
 *
 * Commands:
 *   setup       Phase 01 — derive wallets, fund, mint identities
 *   syndicates  Phase 02 — creators deploy syndicates
 *   join        Phase 03 — joiners request membership
 *   approve     Phase 04 — creators approve pending joiners
 *   deposit     Phase 05 — all eligible agents deposit
 *   chat        Phase 06 — agents send XMTP messages
 *   propose     Phase 07 — creators submit strategy proposals
 *   vote        Phase 08 — members vote on proposals
 *   heartbeat   Phase 09 — ongoing monitoring loop
 *   status      Show current simulation state
 *   run-all     Run phases 01-08 sequentially
 */

import { Command } from "commander";
import { loadSimConfig } from "./config.js";
import { loadState, saveState, advancePhase, printStateSummary } from "./state.js";
import { runPhase01 } from "./phases/01-setup.js";
import { runPhase02 } from "./phases/02-create-syndicates.js";
import { runPhase03 } from "./phases/03-join-syndicates.js";
import { runPhase04 } from "./phases/04-approve-members.js";
import { runPhase05 } from "./phases/05-deposit.js";
import { runPhase06 } from "./phases/06-chat.js";
import { runPhase07 } from "./phases/07-propose.js";
import { runPhase08 } from "./phases/08-vote.js";
import { runPhase09 } from "./phases/09-heartbeat.js";

const program = new Command();

program
  .name("sim")
  .description("Sherwood multi-agent simulation orchestrator")
  .version("1.0.0");

// ── setup ──

program
  .command("setup")
  .description("Phase 01 — derive wallets, fund, mint ERC-8004 identities")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const existingState = loadState(config.stateFile);
      const state = await runPhase01(config, existingState);
      if (state.phase < 1) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── syndicates ──

program
  .command("syndicates")
  .description("Phase 02 — creators deploy syndicates")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase02(config, state);
      if (state.phase < 2) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── join ──

program
  .command("join")
  .description("Phase 03 — joiners send EAS membership requests")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase03(config, state);
      if (state.phase < 3) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── approve ──

program
  .command("approve")
  .description("Phase 04 — creators approve pending member requests")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase04(config, state);
      if (state.phase < 4) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── deposit ──

program
  .command("deposit")
  .description("Phase 05 — agents deposit USDC into their syndicates")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase05(config, state);
      if (state.phase < 5) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── chat ──

program
  .command("chat")
  .description("Phase 06 — agents send XMTP messages in their syndicates")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase06(config, state);
      if (state.phase < 6) advancePhase(config.stateFile, state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── propose ──

program
  .command("propose")
  .description("Phase 07 — creators submit Moonwell supply strategy proposals")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase07(config, state);
      if (state.phase < 7) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── vote ──

program
  .command("vote")
  .description("Phase 08 — members vote on pending proposals")
  .action(async () => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      await runPhase08(config, state);
      if (state.phase < 8) advancePhase(config.stateFile, state);
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── heartbeat ──

program
  .command("heartbeat")
  .description("Phase 09 — ongoing monitoring: check chat, vote, propose")
  .option("--rounds <n>", "Number of heartbeat rounds to run", "3")
  .action(async (opts) => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.error("No state found. Run 'sim setup' first.");
        process.exit(1);
      }
      const rounds = parseInt(opts.rounds, 10);
      await runPhase09(config, state, rounds);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── status ──

program
  .command("status")
  .description("Show current simulation state")
  .action(() => {
    try {
      const config = loadSimConfig();
      const state = loadState(config.stateFile);
      if (!state) {
        console.log("No simulation state found. Run 'sim setup' to initialize.");
        return;
      }
      printStateSummary(state);
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── run-all ──

program
  .command("run-all")
  .description("Run phases 01-08 sequentially (full simulation setup)")
  .action(async () => {
    try {
      const config = loadSimConfig();

      console.log("Starting full simulation run (phases 01-08)...\n");

      // Phase 01 — Setup
      const existingState = loadState(config.stateFile);
      const state = await runPhase01(config, existingState);
      if (state.phase < 1) advancePhase(config.stateFile, state);

      // Phase 02 — Create syndicates
      await runPhase02(config, state);
      if (state.phase < 2) advancePhase(config.stateFile, state);

      // Phase 03 — Join requests
      await runPhase03(config, state);
      if (state.phase < 3) advancePhase(config.stateFile, state);

      // Phase 04 — Approve members
      await runPhase04(config, state);
      if (state.phase < 4) advancePhase(config.stateFile, state);

      // Phase 05 — Deposit
      await runPhase05(config, state);
      if (state.phase < 5) advancePhase(config.stateFile, state);

      // Phase 06 — Chat
      await runPhase06(config, state);
      if (state.phase < 6) advancePhase(config.stateFile, state);

      // Phase 07 — Propose
      await runPhase07(config, state);
      if (state.phase < 7) advancePhase(config.stateFile, state);

      // Phase 08 — Vote
      await runPhase08(config, state);
      if (state.phase < 8) advancePhase(config.stateFile, state);

      console.log("\n=== Full simulation setup complete! ===\n");
      printStateSummary(state);

      console.log("Next: run heartbeat rounds to simulate ongoing activity:");
      console.log("  npx tsx cli/src/simulation/orchestrator.ts heartbeat --rounds 5\n");
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
