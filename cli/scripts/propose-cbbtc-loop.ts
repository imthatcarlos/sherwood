/**
 * Ad-hoc propose script for the MoonwellCbBTCLoopMamoStrategy — a bespoke,
 * agent-authored strategy that is *not* part of the Sherwood CLI template
 * catalog. Deliberately sits outside `sherwood strategy propose` because the
 * whole point is to simulate an agent rolling its own strategy contract for a
 * specific playbook:
 *
 *   cbBTC → Moonwell supply → Moonwell USDC borrow → Mamo USDC deposit
 *
 * What this script does:
 *   1. Deploys a fresh MoonwellCbBTCLoopMamoStrategy template (read from the
 *      Foundry build output at contracts/out)
 *   2. Clones + initializes it with the agent's params (supply/borrow amounts,
 *      Moonwell + Mamo addresses)
 *   3. Submits a governor proposal with the execute/settle batch calls
 *
 * Usage (from the cli/ directory):
 *   cd cli && npx tsx scripts/propose-cbbtc-loop.ts \
 *     --vault 0x...               (required — the cbBTC-denominated syndicate vault)
 *     --mamo-factory 0x...        (required — Mamo StrategyFactory on Base)
 *     --supply 0.0005             (cbBTC to supply, 8 decimals; default 0.0005)
 *     --borrow 15                 (USDC to borrow, 6 decimals; default 15)
 *     --duration 259200           (strategy duration in seconds; default 3 days)
 *     --fee 1000                  (performance fee bps; default 10%)
 *
 * Requires: BASE_RPC_URL and PRIVATE_KEY (or ~/.sherwood/config.json).
 *
 * NOTE: Dry-run against a local anvil fork before touching mainnet:
 *   anvil --fork-url $BASE_RPC_URL
 *   export BASE_RPC_URL=http://127.0.0.1:8545
 */

import { config as loadDotenv } from "dotenv";
try { loadDotenv(); } catch {}

import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ERC20_ABI, BASE_STRATEGY_ABI, SYNDICATE_GOVERNOR_ABI } from "../src/lib/abis.js";

// ── Constants (Base mainnet) ──────────────────────────────────────────────

const CBBTC: Address = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MCBBTC: Address = "0xF877ACaFA28c19b96727966690b2f44d35aD5976";
const MUSDC: Address = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const COMPTROLLER: Address = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";
const SYNDICATE_GOVERNOR: Address = "0x358AD8B492BcC710BE0D7c902D8702164c35DC34";

// ── Arg parsing ───────────────────────────────────────────────────────────

function getArg(flag: string, required = false): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  if (required) {
    console.error(`\nMissing required arg: ${flag}`);
    process.exit(1);
  }
  return undefined;
}

const vaultAddr = getArg("--vault", true) as Address;
const mamoFactory = getArg("--mamo-factory", true) as Address;
const supplyArg = getArg("--supply") ?? "0.0005";
const borrowArg = getArg("--borrow") ?? "15";
const durationArg = getArg("--duration") ?? String(3 * 24 * 60 * 60);
const feeArg = getArg("--fee") ?? "1000";

const supplyAmount = parseUnits(supplyArg, 8); // cbBTC = 8 decimals on Base
const borrowAmount = parseUnits(borrowArg, 6); // USDC = 6 decimals
const minRedeemAmount = (supplyAmount * 90n) / 100n; // 90% floor
const strategyDuration = BigInt(durationArg);
const performanceFeeBps = BigInt(feeArg);

// ── Bytecode loader ────────────────────────────────────────────────────────

function loadStrategyBytecode(): Hex {
  // When run via `cd cli && npx tsx scripts/...`, cwd is the cli/ directory.
  // Foundry artifacts live at ../contracts/out.
  const artifactPath = path.resolve(
    process.cwd(),
    "..",
    "contracts",
    "out",
    "MoonwellCbBTCLoopMamoStrategy.sol",
    "MoonwellCbBTCLoopMamoStrategy.json",
  );
  if (!fs.existsSync(artifactPath)) {
    console.error(`\nBuild artifact not found at ${artifactPath}`);
    console.error("Run: cd contracts && forge build");
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
  const bytecode = artifact?.bytecode?.object as string | undefined;
  if (!bytecode || !bytecode.startsWith("0x")) {
    console.error(`\nBytecode missing from artifact ${artifactPath}`);
    process.exit(1);
  }
  return bytecode as Hex;
}

// ── Private key resolver (matches cli/src/lib/client.ts pattern) ───────────

function getPrivateKey(): Hex {
  const env = process.env.PRIVATE_KEY;
  if (env) return (env.startsWith("0x") ? env : `0x${env}`) as Hex;

  const configPath = path.join(process.env.HOME || "~", ".sherwood", "config.json");
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (cfg.privateKey) {
      const k = cfg.privateKey as string;
      return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
    }
  }
  throw new Error("Private key not found. Set PRIVATE_KEY or run 'sherwood config set --private-key <key>'.");
}

// ── InitParams encoding (matches the Solidity struct) ──────────────────────

function encodeInitParams(
  mamoFactory_: Address,
  supplyAmount_: bigint,
  borrowAmount_: bigint,
  minRedeemAmount_: bigint,
): Hex {
  // struct InitParams { cbBTC, usdc, mCbBTC, mUSDC, comptroller, mamoFactory,
  //                     supplyAmount, borrowAmount, minRedeemAmount }
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "cbBTC", type: "address" },
          { name: "usdc", type: "address" },
          { name: "mCbBTC", type: "address" },
          { name: "mUSDC", type: "address" },
          { name: "comptroller", type: "address" },
          { name: "mamoFactory", type: "address" },
          { name: "supplyAmount", type: "uint256" },
          { name: "borrowAmount", type: "uint256" },
          { name: "minRedeemAmount", type: "uint256" },
        ],
      },
    ],
    [
      {
        cbBTC: CBBTC,
        usdc: USDC,
        mCbBTC: MCBBTC,
        mUSDC: MUSDC,
        comptroller: COMPTROLLER,
        mamoFactory: mamoFactory_,
        supplyAmount: supplyAmount_,
        borrowAmount: borrowAmount_,
        minRedeemAmount: minRedeemAmount_,
      },
    ],
  );
}

// ── Clones library (EIP-1167 minimal proxy) bytecode factory ───────────────

/**
 * Build the deployment bytecode for an EIP-1167 minimal proxy that delegates
 * to `implementation`. This matches OpenZeppelin's `Clones.clone()` output.
 *
 * We deploy a proxy rather than a fresh copy so the strategy clone looks and
 * behaves identically to strategies cloned from the standard template
 * catalog — same storage layout, same owner-of-implementation model.
 */
function buildCloneInitCode(implementation: Address): Hex {
  // Init code: `60593d8160093d39f3` followed by the runtime code.
  // Runtime (EIP-1167 with push20 impl): 0x363d3d373d3d3d363d73<impl>5af43d82803e903d91602b57fd5bf3
  const runtime =
    "363d3d373d3d3d363d73" +
    implementation.toLowerCase().replace(/^0x/, "") +
    "5af43d82803e903d91602b57fd5bf3";
  const init = "3d602d80600a3d3981f3" + runtime;
  return `0x${init}` as Hex;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const account = privateKeyToAccount(getPrivateKey());
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  console.log(`\nNetwork: ${base.name}`);
  console.log(`Account: ${account.address}`);
  console.log(`Vault:   ${vaultAddr}`);
  console.log(`Governor: ${SYNDICATE_GOVERNOR}`);
  console.log(`Supply:   ${supplyArg} cbBTC (${supplyAmount})`);
  console.log(`Borrow:   ${borrowArg} USDC (${borrowAmount})`);
  console.log(`Duration: ${Number(strategyDuration) / 3600}h`);
  console.log(`Fee:      ${Number(performanceFeeBps) / 100}%`);

  // 1. Deploy a fresh strategy template
  console.log("\n[1/3] Deploying MoonwellCbBTCLoopMamoStrategy template...");
  const bytecode = loadStrategyBytecode();
  const deployHash = await walletClient.deployContract({
    account,
    abi: [],
    bytecode,
  });
  console.log(`  deploy tx: ${deployHash}`);
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const templateAddr = deployReceipt.contractAddress;
  if (!templateAddr) throw new Error("Template deployment returned no contractAddress");
  console.log(`  template:  ${templateAddr}`);

  // 2. Deploy an EIP-1167 clone of the template and initialize it
  console.log("\n[2/3] Cloning + initializing...");
  const cloneInitCode = buildCloneInitCode(templateAddr);
  const cloneHash = await walletClient.sendTransaction({
    account,
    chain: base,
    to: null as unknown as Address, // contract creation
    data: cloneInitCode,
  });
  const cloneReceipt = await publicClient.waitForTransactionReceipt({ hash: cloneHash });
  const cloneAddr = cloneReceipt.contractAddress;
  if (!cloneAddr) throw new Error("Clone deployment returned no contractAddress");
  console.log(`  clone:     ${cloneAddr}`);

  const initData = encodeInitParams(mamoFactory, supplyAmount, borrowAmount, minRedeemAmount);
  const initHash = await walletClient.writeContract({
    account,
    chain: base,
    address: cloneAddr,
    abi: BASE_STRATEGY_ABI,
    functionName: "initialize",
    args: [vaultAddr, account.address, initData],
  });
  await publicClient.waitForTransactionReceipt({ hash: initHash });
  console.log(`  init tx:   ${initHash}`);

  // 3. Submit proposal
  console.log("\n[3/3] Submitting governor proposal...");
  const executeCalls = [
    {
      target: CBBTC,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [cloneAddr, supplyAmount] }),
      value: 0n,
    },
    {
      target: cloneAddr,
      data: encodeFunctionData({ abi: BASE_STRATEGY_ABI, functionName: "execute" }),
      value: 0n,
    },
  ] as const;

  const settleCalls = [
    {
      target: cloneAddr,
      data: encodeFunctionData({ abi: BASE_STRATEGY_ABI, functionName: "settle" }),
      value: 0n,
    },
  ] as const;

  const proposeHash = await walletClient.writeContract({
    account,
    chain: base,
    address: SYNDICATE_GOVERNOR,
    abi: SYNDICATE_GOVERNOR_ABI,
    functionName: "propose",
    args: [
      vaultAddr,
      "ipfs://cbbtc-moonwell-mamo-loop",
      performanceFeeBps,
      strategyDuration,
      executeCalls,
      settleCalls,
      [], // no co-proposers
    ],
  });
  console.log(`  propose tx: ${proposeHash}`);
  const proposeReceipt = await publicClient.waitForTransactionReceipt({ hash: proposeHash });
  console.log(`  status: ${proposeReceipt.status}`);

  console.log("\nDone. Next steps:");
  console.log("  1. LPs vote on the proposal");
  console.log("  2. Call governor.executeProposal() after voting period");
  console.log(`  3. After ${Number(strategyDuration) / 3600}h, call governor.settleProposal()`);
  console.log(`\n  clone address: ${cloneAddr}`);
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
