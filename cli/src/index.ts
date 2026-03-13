#!/usr/bin/env node
import { Command } from "commander";
import { MoonwellProvider } from "./providers/moonwell.js";
import { UniswapProvider } from "./providers/uniswap.js";

const program = new Command();

program
  .name("sherwood")
  .description("CLI for agent-managed investment syndicates")
  .version("0.1.0");

// ── Vault commands ──
const vault = program.command("vault");

vault
  .command("create")
  .description("Deploy a new syndicate vault")
  .option("--asset <address>", "Underlying asset (default: USDC on Base)")
  .option("--name <name>", "Vault name")
  .action(async (opts) => {
    console.log("Creating vault...", opts);
    // TODO: Deploy SyndicateVault via proxy
  });

vault
  .command("deposit")
  .description("Deposit assets into a vault")
  .requiredOption("--vault <address>", "Vault address")
  .requiredOption("--amount <amount>", "Amount to deposit")
  .action(async (opts) => {
    console.log("Depositing...", opts);
  });

vault
  .command("ragequit")
  .description("Withdraw all shares from a vault")
  .requiredOption("--vault <address>", "Vault address")
  .action(async (opts) => {
    console.log("Ragequitting...", opts);
  });

// ── Strategy commands ──
const strategy = program.command("strategy");

strategy
  .command("list")
  .description("List registered strategies")
  .option("--type <id>", "Filter by strategy type")
  .action(async (opts) => {
    console.log("Listing strategies...", opts);
    // TODO: Read from StrategyRegistry contract
  });

strategy
  .command("register")
  .description("Register a new strategy on-chain")
  .requiredOption("--implementation <address>", "Strategy contract address")
  .requiredOption("--type <id>", "Strategy type ID")
  .requiredOption("--name <name>", "Strategy name")
  .option("--metadata <uri>", "Metadata URI (IPFS/Arweave)")
  .action(async (opts) => {
    console.log("Registering strategy...", opts);
  });

strategy
  .command("run")
  .description("Execute a strategy from a vault")
  .requiredOption("--vault <address>", "Vault address")
  .requiredOption("--strategy <address>", "Strategy address")
  .requiredOption("--action <action>", "Action to execute")
  .action(async (opts) => {
    console.log("Running strategy...", opts);
  });

// ── Provider info ──
program
  .command("providers")
  .description("List available providers")
  .action(() => {
    const providers = [new MoonwellProvider(), new UniswapProvider()];
    for (const p of providers) {
      const info = p.info();
      console.log(`\n${info.name} (${info.type})`);
      console.log(`  Capabilities: ${info.capabilities.join(", ")}`);
      console.log(`  Chains: ${info.supportedChains.map((c) => c.name).join(", ")}`);
    }
  });

program.parse();
