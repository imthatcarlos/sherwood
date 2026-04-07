import 'dotenv/config';
import type { Address } from 'viem';

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function envNum(key: string, defaultValue?: number): number {
  const raw = process.env[key];
  if (raw !== undefined) return Number(raw);
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing required env var: ${key}`);
}

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw === 'true' || raw === '1';
}

// W11: Validate numeric config values
function validatePositive(value: number, name: string): number {
  if (value <= 0 || !Number.isFinite(value)) {
    throw new Error(`Config ${name} must be a positive finite number, got: ${value}`);
  }
  return value;
}

function validateRange(value: number, min: number, max: number, name: string): number {
  if (value < min || value > max || !Number.isFinite(value)) {
    throw new Error(`Config ${name} must be between ${min} and ${max}, got: ${value}`);
  }
  return value;
}

export const config = {
  // RPC
  rpcUrl: env('RPC_URL', 'https://mainnet.base.org'),
  chainId: 8453,

  // C6: Private key with no default - crash if missing
  privateKey: (() => {
    const key = process.env.PRIVATE_KEY;
    if (!key) throw new Error('PRIVATE_KEY env var is required');
    return key as `0x${string}`;
  })(),

  // Contracts
  poolAddress: env('POOL_ADDRESS', '0x0000000000000000000000000000000000000000') as Address,
  nfpManagerAddress: env('NFP_MANAGER_ADDRESS', '0x827922686190790b37229fd06084350E74485b72') as Address,
  clFactoryAddress: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A' as Address,
  swapRouterAddress: '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5' as Address,
  woodAddress: env('WOOD_ADDRESS', '0x0000000000000000000000000000000000000000') as Address,
  wethAddress: env('WETH_ADDRESS', '0x4200000000000000000000000000000000000006') as Address,

  // Pool - W11: validated
  tickSpacing: validatePositive(envNum('TICK_SPACING', 100), 'TICK_SPACING'),

  // Protocol mode
  useUniswapV3: envBool('USE_UNISWAP_V3', false),
  poolFee: envNum('POOL_FEE', 3000),

  // AS parameters - W11: validated
  gammaBase: validatePositive(envNum('GAMMA_BASE', 0.5), 'GAMMA_BASE'),
  sigmaLookbackBlocks: validatePositive(envNum('SIGMA_LOOKBACK_BLOCKS', 100), 'SIGMA_LOOKBACK_BLOCKS'),
  tHorizonSeconds: validatePositive(envNum('T_HORIZON_SECONDS', 1800), 'T_HORIZON_SECONDS'),
  kOrderIntensity: validatePositive(envNum('K_ORDER_INTENSITY', 0.05), 'K_ORDER_INTENSITY'),

  // Bot - W11: validated
  pollIntervalMs: validatePositive(envNum('POLL_INTERVAL_MS', 30000), 'POLL_INTERVAL_MS'),
  minRebalanceIntervalMs: validatePositive(envNum('MIN_REBALANCE_INTERVAL_MS', 300000), 'MIN_REBALANCE_INTERVAL_MS'),

  // Risk - W11: validated with ranges
  minEthReserve: validatePositive(envNum('MIN_ETH_RESERVE', 0.5), 'MIN_ETH_RESERVE'),
  maxWoodRatio: validateRange(envNum('MAX_WOOD_RATIO', 0.8), 0.01, 0.99, 'MAX_WOOD_RATIO'),
  maxDrawdownPct: validateRange(envNum('MAX_DRAWDOWN_PCT', 20), 0.1, 100, 'MAX_DRAWDOWN_PCT'),
  twapDeviationPct: validateRange(envNum('TWAP_DEVIATION_PCT', 10), 0.1, 100, 'TWAP_DEVIATION_PCT'),
  targetEthRatio: validateRange(envNum('TARGET_ETH_RATIO', 0.5), 0.01, 0.99, 'TARGET_ETH_RATIO'),

  // Slippage protection (FIX 4) - basis points, 200 = 2%
  slippageBps: validateRange(envNum('SLIPPAGE_BPS', 200), 10, 1000, 'SLIPPAGE_BPS'),

  // Gas price limit (FIX 5) - max gas price in gwei, skip cycle if exceeded
  maxGasPriceGwei: validatePositive(envNum('MAX_GAS_PRICE_GWEI', 50), 'MAX_GAS_PRICE_GWEI'),

  // Mode
  dryRun: envBool('DRY_RUN', true),

  // Derived constants
  get minEthReserveWei(): bigint {
    return BigInt(Math.floor(this.minEthReserve * 1e18));
  },
} as const;

export type Config = typeof config;
