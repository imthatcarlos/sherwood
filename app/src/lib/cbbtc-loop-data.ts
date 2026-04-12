/**
 * MoonwellCbBTCLoopMamoStrategy detector + data fetcher.
 *
 * Walks a proposal's execute calls, finds the strategy clone by calling
 * `name()`, and reads the three-leg yield breakdown via `getYieldInfo()`.
 * Sources the Mamo USDC APY on-chain by reading the Mamo strategy's split
 * between Moonwell mUSDC and MetaMorpho, then computing a weighted rate.
 *
 * Mirrors the detector pattern in `portfolio-data.ts`.
 */

import type { Address } from "viem";
import { getPublicClient, SYNDICATE_GOVERNOR_ABI } from "./contracts";

// ── Types ──

export interface CbBTCLoopYieldLegs {
  cbBTCSupplyApy: bigint;
  usdcBorrowApr: bigint;
  mamoUsdcApy: bigint;
  netApyBps: bigint;
}

export interface CbBTCLoopData {
  strategyAddress: Address;
  legs: CbBTCLoopYieldLegs;
  display: {
    cbBTCSupplyApyPct: string;
    usdcBorrowAprPct: string;
    mamoUsdcApyPct: string;
    netApyPct: string;
  };
}

// ── Scoped ABIs ──

const CBBTC_LOOP_STRATEGY_ABI = [
  { name: "name", type: "function", stateMutability: "pure", inputs: [], outputs: [{ type: "string" }] },
  { name: "getYieldInfo", type: "function", stateMutability: "view", inputs: [],
    outputs: [{ name: "cbBTCSupplyApy", type: "uint256" }, { name: "usdcBorrowApr", type: "uint256" },
              { name: "mamoUsdcApy", type: "uint256" }, { name: "netApyBps", type: "int256" }] },
  { name: "mUSDC", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "mamoStrategy", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const MAMO_STRATEGY_ABI = [
  { name: "splitMToken", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "splitVault", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "metaMorphoVault", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const CTOKEN_ABI = [
  { name: "supplyRatePerTimestamp", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const METAMORPHO_ABI = [
  { name: "supplyQueue", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { name: "fee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint96" }] },
] as const;

const MORPHO_BLUE_ABI = [
  { name: "market", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }] },
  { name: "idToMarketParams", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }],
    outputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }] },
] as const;

const IRM_ABI = [{
  name: "borrowRateView", type: "function", stateMutability: "view",
  inputs: [
    { name: "marketParams", type: "tuple", components: [
      { name: "loanToken", type: "address" }, { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" }, { name: "irm", type: "address" }, { name: "lltv", type: "uint256" },
    ]},
    { name: "market", type: "tuple", components: [
      { name: "totalSupplyAssets", type: "uint128" }, { name: "totalSupplyShares", type: "uint128" },
      { name: "totalBorrowAssets", type: "uint128" }, { name: "totalBorrowShares", type: "uint128" },
      { name: "lastUpdate", type: "uint128" }, { name: "fee", type: "uint128" },
    ]},
  ],
  outputs: [{ type: "uint256" }],
}] as const;

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address;
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
const STRATEGY_NAME = "Moonwell cbBTC Mamo Loop";

// ── Helpers ──

function fmt1e18Pct(value: bigint): string {
  const bps = value / 10n ** 14n;
  const whole = bps / 100n;
  const frac = bps % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}%`;
}

function fmtBpsPct(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}%`;
}

/**
 * Compute the MetaMorpho vault supply APY using Morpho's formula:
 *   supplyAPY = borrowAPY * utilization * (1 - fee)
 * Reads the vault's primary supply-queue market, then queries the IRM.
 */
async function fetchMorphoVaultApy(
  client: ReturnType<typeof getPublicClient>,
  vaultAddr: Address,
): Promise<number> {
  const marketId = (await client.readContract({
    address: vaultAddr, abi: METAMORPHO_ABI, functionName: "supplyQueue", args: [0n],
  })) as `0x${string}`;

  const [mktState, mktParams, vaultFee] = await client.multicall({
    contracts: [
      { address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "market", args: [marketId] },
      { address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "idToMarketParams", args: [marketId] },
      { address: vaultAddr, abi: METAMORPHO_ABI, functionName: "fee" },
    ],
  });

  if (mktState.status !== "success" || mktParams.status !== "success" || vaultFee.status !== "success") return 0;

  const state = mktState.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  const params = mktParams.result as readonly [Address, Address, Address, Address, bigint];
  const irmAddr = params[3];

  const borrowRate = (await client.readContract({
    address: irmAddr, abi: IRM_ABI, functionName: "borrowRateView",
    args: [
      { loanToken: params[0], collateralToken: params[1], oracle: params[2], irm: params[3], lltv: params[4] },
      { totalSupplyAssets: state[0], totalSupplyShares: state[1],
        totalBorrowAssets: state[2], totalBorrowShares: state[3],
        lastUpdate: state[4], fee: state[5] },
    ],
  })) as bigint;

  const borrowRateAnnual = Number(borrowRate) * Number(SECONDS_PER_YEAR);
  const borrowAPY = Math.exp(borrowRateAnnual / 1e18) - 1;
  const utilization = Number(state[0]) > 0 ? Number(state[2]) / Number(state[0]) : 0;
  const feeRate = Number(vaultFee.result as bigint) / 1e18;

  return borrowAPY * utilization * (1 - feeRate);
}

/**
 * Compute the blended Mamo USDC APY from the Mamo strategy's split between
 * Moonwell mUSDC (supplyRatePerTimestamp) and MetaMorpho (Morpho IRM formula).
 */
async function fetchMamoApy(
  client: ReturnType<typeof getPublicClient>,
  strategyAddr: Address,
  mUSDCAddr: Address,
): Promise<bigint> {
  const mamoAddr = (await client.readContract({
    address: strategyAddr, abi: CBBTC_LOOP_STRATEGY_ABI, functionName: "mamoStrategy",
  })) as Address;

  const [splitMResult, splitVResult, vaultResult, moonwellRateResult] = await client.multicall({
    contracts: [
      { address: mamoAddr, abi: MAMO_STRATEGY_ABI, functionName: "splitMToken" },
      { address: mamoAddr, abi: MAMO_STRATEGY_ABI, functionName: "splitVault" },
      { address: mamoAddr, abi: MAMO_STRATEGY_ABI, functionName: "metaMorphoVault" },
      { address: mUSDCAddr, abi: CTOKEN_ABI, functionName: "supplyRatePerTimestamp" },
    ],
  });

  if (splitMResult.status !== "success" || moonwellRateResult.status !== "success") return 0n;

  const splitM = splitMResult.result as bigint;
  const splitV = splitVResult.status === "success" ? (splitVResult.result as bigint) : 0n;
  const moonwellRate = moonwellRateResult.result as bigint;
  const moonwellApy = Number(moonwellRate * SECONDS_PER_YEAR) / 1e18;

  let morphoApy = 0;
  if (splitV > 0n && vaultResult.status === "success") {
    const vaultAddr = vaultResult.result as Address;
    try {
      morphoApy = await fetchMorphoVaultApy(client, vaultAddr);
    } catch {
      morphoApy = moonwellApy; // conservative fallback
    }
  }

  const blended = (Number(splitM) * moonwellApy + Number(splitV) * morphoApy) / 10000;
  return BigInt(Math.round(blended * 1e18));
}

// ── Main fetch ──

export async function fetchCbBTCLoopData(
  governorAddress: Address,
  proposalId: bigint,
  chainId: number,
): Promise<CbBTCLoopData | null> {
  const client = getPublicClient(chainId);

  try {
    const calls = (await client.readContract({
      address: governorAddress, abi: SYNDICATE_GOVERNOR_ABI,
      functionName: "getExecuteCalls", args: [proposalId],
    })) as { target: Address; data: `0x${string}`; value: bigint }[];

    if (!calls || calls.length < 2) return null;

    let strategyAddress: Address | null = null;
    for (let i = 1; i < calls.length; i++) {
      try {
        const name = await client.readContract({
          address: calls[i].target, abi: CBBTC_LOOP_STRATEGY_ABI, functionName: "name",
        });
        if (name === STRATEGY_NAME) { strategyAddress = calls[i].target; break; }
      } catch { /* not a strategy contract */ }
    }
    if (!strategyAddress) return null;

    const [yieldRaw, mUSDCRaw] = await client.multicall({
      contracts: [
        { address: strategyAddress, abi: CBBTC_LOOP_STRATEGY_ABI, functionName: "getYieldInfo" },
        { address: strategyAddress, abi: CBBTC_LOOP_STRATEGY_ABI, functionName: "mUSDC" },
      ],
    });

    if (yieldRaw.status !== "success" || mUSDCRaw.status !== "success") return null;

    const raw = yieldRaw.result as readonly [bigint, bigint, bigint, bigint];
    const mUSDCAddr = mUSDCRaw.result as Address;

    const mamoApy = await fetchMamoApy(client, strategyAddress, mUSDCAddr);

    const legs: CbBTCLoopYieldLegs = {
      cbBTCSupplyApy: raw[0],
      usdcBorrowApr: raw[1],
      mamoUsdcApy: mamoApy,
      netApyBps: raw[3],
    };

    let netDisplay: string;
    if (legs.mamoUsdcApy > 0n) {
      const supplyBps = legs.cbBTCSupplyApy / 10n ** 14n;
      const borrowBps = legs.usdcBorrowApr / 10n ** 14n;
      const mamoBps = legs.mamoUsdcApy / 10n ** 14n;
      netDisplay = fmtBpsPct(supplyBps + mamoBps - borrowBps);
    } else {
      netDisplay = "\u2014";
    }

    return {
      strategyAddress,
      legs,
      display: {
        cbBTCSupplyApyPct: fmt1e18Pct(legs.cbBTCSupplyApy),
        usdcBorrowAprPct: fmt1e18Pct(legs.usdcBorrowApr),
        mamoUsdcApyPct: legs.mamoUsdcApy > 0n ? fmt1e18Pct(legs.mamoUsdcApy) : "\u2014",
        netApyPct: netDisplay,
      },
    };
  } catch {
    return null;
  }
}
