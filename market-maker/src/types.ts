import type { Address, Hash } from 'viem';

/** Pool state from slot0 + liquidity */
export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  unlocked: boolean;
  liquidity: bigint;
  fee: number;
  tickSpacing: number;
  token0: Address;
  token1: Address;
}

/** A concentrated liquidity position */
export interface Position {
  tokenId: bigint;
  nonce: bigint;
  operator: Address;
  token0: Address;
  token1: Address;
  tickSpacing: number;
  fee?: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/** Inventory snapshot */
export interface InventoryState {
  woodBalance: bigint;
  ethBalance: bigint;
  woodInPosition: bigint;
  ethInPosition: bigint;
  totalWoodValue: number;
  totalEthValue: number;
  ethRatio: number;
  woodRatio: number;
}

/** Avellaneda-Stoikov pricing output */
export interface PricingResult {
  midPrice: number;
  reservationPrice: number;
  spread: number;
  bidPrice: number;
  askPrice: number;
  bidTick: number;
  askTick: number;
  gammaEff: number;
  sigma: number;
  inventorySkew: number;
}

/** Risk check result */
export interface RiskCheck {
  allowed: boolean;
  reason?: string;
  ethBalance: bigint;
  drawdownPct: number;
  twapDeviationPct: number;
}

/** Rebalance action */
export interface RebalanceAction {
  type: 'mint' | 'burn_and_mint' | 'collect' | 'none' | 'halt';
  reason: string;
  oldTokenId?: bigint;
  newTickLower?: number;
  newTickUpper?: number;
  amount0Desired?: bigint;
  amount1Desired?: bigint;
}

/** Bot state persisted across loops */
export interface BotState {
  activeTokenId: bigint | null;
  lastRebalanceTime: number;
  peakPortfolioValue: number;
  priceHistory: PricePoint[];
  cycleCount: number;
  halted: boolean;
  haltReason?: string;
}

/** Price observation for volatility computation */
export interface PricePoint {
  timestamp: number;
  price: number;
  tick: number;
  blockNumber: bigint;
}

/** Mint parameters for NFP Manager */
export interface MintParams {
  token0: Address;
  token1: Address;
  tickSpacing?: number;
  fee?: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  deadline: bigint;
  sqrtPriceX96: bigint;
}
