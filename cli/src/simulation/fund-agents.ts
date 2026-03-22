/**
 * Fund agents from the master wallet (index 0).
 *
 * Transfers ETH (for gas) and USDC from the master wallet to each agent wallet.
 * Uses viem directly — not the sherwood CLI — for reliable nonce management.
 *
 * USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { SimConfig } from "./types.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface FundResult {
  agentIndex: number;
  address: string;
  ethTxHash?: string;
  usdcTxHash?: string;
  skipped: boolean;
  error?: string;
}

/**
 * Fund all agent wallets (indices 1 through agentCount) from master (index 0).
 *
 * Sends ETH first (for gas), waits for confirmation, then sends USDC.
 * Sequential to avoid nonce collisions on the master wallet.
 */
export async function fundAgents(
  masterPrivateKey: `0x${string}`,
  agentAddresses: { index: number; address: string }[],
  config: SimConfig,
): Promise<FundResult[]> {
  const chain = base;
  const transport = http(config.rpcUrl);

  const masterAccount = privateKeyToAccount(masterPrivateKey);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: masterAccount, chain, transport });

  console.log(`\nFunding ${agentAddresses.length} agents from master wallet: ${masterAccount.address}`);

  // Check master wallet balances
  const [masterEth, masterUsdc] = await Promise.all([
    publicClient.getBalance({ address: masterAccount.address }),
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_TRANSFER_ABI,
      functionName: "balanceOf",
      args: [masterAccount.address],
    }) as Promise<bigint>,
  ]);

  console.log(`  Master ETH:  ${formatEther(masterEth)} ETH`);
  console.log(`  Master USDC: ${formatUnits(masterUsdc, USDC_DECIMALS)} USDC`);

  const ethAmount = parseEther(config.fundAmountEth);
  const usdcAmount = parseUnits(config.fundAmountUsdc, USDC_DECIMALS);

  const totalEthNeeded = ethAmount * BigInt(agentAddresses.length);
  const totalUsdcNeeded = usdcAmount * BigInt(agentAddresses.length);

  if (masterEth < totalEthNeeded) {
    console.warn(
      `  WARNING: Master has ${formatEther(masterEth)} ETH, need ~${formatEther(totalEthNeeded)} ETH`,
    );
  }
  if (masterUsdc < totalUsdcNeeded) {
    console.warn(
      `  WARNING: Master has ${formatUnits(masterUsdc, USDC_DECIMALS)} USDC, need ${formatUnits(totalUsdcNeeded, USDC_DECIMALS)} USDC`,
    );
  }

  const results: FundResult[] = [];

  for (const { index, address } of agentAddresses) {
    if (config.dryRun) {
      console.log(`  [agent-${index}] [DRY RUN] would fund ${address}`);
      results.push({ agentIndex: index, address, skipped: true });
      continue;
    }

    const result: FundResult = { agentIndex: index, address, skipped: false };

    try {
      // Check current agent balance — skip if already funded
      const [agentEth, agentUsdc] = await Promise.all([
        publicClient.getBalance({ address: address as `0x${string}` }),
        publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_TRANSFER_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }) as Promise<bigint>,
      ]);

      const needsEth = agentEth < ethAmount / 2n; // fund if less than half target
      const needsUsdc = agentUsdc < usdcAmount / 2n;

      if (!needsEth && !needsUsdc) {
        console.log(
          `  [agent-${index}] already funded (${formatEther(agentEth)} ETH, ${formatUnits(agentUsdc, USDC_DECIMALS)} USDC) — skipping`,
        );
        result.skipped = true;
        results.push(result);
        continue;
      }

      // Send ETH first
      if (needsEth) {
        console.log(`  [agent-${index}] sending ${config.fundAmountEth} ETH → ${address}`);
        const ethHash = await walletClient.sendTransaction({
          to: address as `0x${string}`,
          value: ethAmount,
        });
        await publicClient.waitForTransactionReceipt({ hash: ethHash });
        result.ethTxHash = ethHash;
        console.log(`  [agent-${index}] ETH sent: ${ethHash}`);
      }

      // Send USDC
      if (needsUsdc) {
        console.log(
          `  [agent-${index}] sending ${config.fundAmountUsdc} USDC → ${address}`,
        );
        const usdcHash = await walletClient.writeContract({
          address: USDC_ADDRESS,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [address as `0x${string}`, usdcAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: usdcHash });
        result.usdcTxHash = usdcHash;
        console.log(`  [agent-${index}] USDC sent: ${usdcHash}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [agent-${index}] FAILED to fund: ${msg}`);
      result.error = msg;
    }

    results.push(result);
  }

  return results;
}
