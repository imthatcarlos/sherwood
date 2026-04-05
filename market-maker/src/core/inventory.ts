/**
 * Inventory tracking and skew management.
 *
 * The key asymmetry: WOOD is free to mint, ETH is scarce.
 * We track the ETH ratio and try to keep it above a floor.
 */

import type { Address } from 'viem';
import type { InventoryState, PoolState, Position } from '../types.js';
import { config } from '../config.js';
import {
  sqrtPriceX96ToPrice,
  computeAmount0ForLiquidity,
  computeAmount1ForLiquidity,
  tickToSqrtPriceX96,
  formatEth,
} from '../pool/math.js';
import { logger } from '../bot/logger.js';
import { SlipstreamPool } from '../pool/slipstream.js';

const SCALE = 10n ** 18n;

/**
 * Compute the full inventory state.
 * C7: Uses BigInt-scaled arithmetic for precision.
 */
export async function computeInventory(
  pool: SlipstreamPool,
  poolState: PoolState,
  position: Position | null,
  botAddress: Address,
  woodAddress: Address,
  wethAddress: Address,
  isToken0Wood: boolean,
): Promise<InventoryState> {
  // Get wallet balances
  const { balance0, balance1 } = await pool.getBalances(
    botAddress,
    poolState.token0,
    poolState.token1,
  );

  const price = sqrtPriceX96ToPrice(poolState.sqrtPriceX96);

  // Compute tokens locked in position
  let woodInPosition = 0n;
  let ethInPosition = 0n;

  if (position && position.liquidity > 0n) {
    const sqrtLower = tickToSqrtPriceX96(position.tickLower);
    const sqrtUpper = tickToSqrtPriceX96(position.tickUpper);

    const amount0InPos = computeAmount0ForLiquidity(
      position.liquidity,
      poolState.sqrtPriceX96,
      sqrtLower,
      sqrtUpper,
    );
    const amount1InPos = computeAmount1ForLiquidity(
      position.liquidity,
      poolState.sqrtPriceX96,
      sqrtLower,
      sqrtUpper,
    );

    if (isToken0Wood) {
      woodInPosition = amount0InPos;
      ethInPosition = amount1InPos;
    } else {
      ethInPosition = amount0InPos;
      woodInPosition = amount1InPos;
    }
  }

  // Wallet balances
  const woodBalance = isToken0Wood ? balance0 : balance1;
  const ethBalance = isToken0Wood ? balance1 : balance0;

  // C7: Total values using BigInt-scaled arithmetic
  // price = token1/token0. If WOOD is token0: price = ETH/WOOD
  // woodPriceInEth as a scaled BigInt (price * 10^18)
  const woodPriceScaled = isToken0Wood
    ? BigInt(Math.round(price * 1e18))
    : BigInt(Math.round((1 / price) * 1e18));

  const totalWoodWei = woodBalance + woodInPosition;
  const totalEthWei = ethBalance + ethInPosition;

  // totalWoodValue in ETH (scaled by 10^18): (totalWoodWei * woodPriceScaled) / SCALE
  // Both totalWoodWei and woodPriceScaled are already in wei/scaled, so:
  // woodValueWei = totalWoodWei * woodPriceScaled / SCALE
  const woodValueWei = (totalWoodWei * woodPriceScaled) / SCALE;

  // Convert to Number only at final step
  const totalWoodValue = Number(woodValueWei) / 1e18;
  const totalEthValue = Number(totalEthWei) / 1e18;

  // ethRatio computed in BigInt: ethWei / (ethWei + woodValueWei)
  const totalValueWei = totalEthWei + woodValueWei;
  let ethRatio: number;
  if (totalValueWei > 0n) {
    // Scale to get ratio: (ethWei * SCALE) / totalValueWei -> then /1e18
    ethRatio = Number((totalEthWei * SCALE) / totalValueWei) / 1e18;
  } else {
    ethRatio = 0.5;
  }
  const woodRatio = 1 - ethRatio;

  const state: InventoryState = {
    woodBalance,
    ethBalance,
    woodInPosition,
    ethInPosition,
    totalWoodValue,
    totalEthValue,
    ethRatio,
    woodRatio,
  };

  logger.info(
    {
      woodWallet: formatEth(woodBalance),
      ethWallet: formatEth(ethBalance),
      woodInPos: formatEth(woodInPosition),
      ethInPos: formatEth(ethInPosition),
      totalWoodETH: totalWoodValue.toFixed(6),
      totalETH: totalEthValue.toFixed(6),
      ethRatio: (ethRatio * 100).toFixed(1) + '%',
    },
    'Inventory state',
  );

  return state;
}

/**
 * Compute inventory skew for AS pricing.
 *
 * Returns a value in [-1, 1]:
 *   q > 0: excess WOOD (want to sell WOOD for ETH)
 *   q < 0: excess ETH (comfortable, less urgency)
 *
 * The target is configurable but defaults to keeping ~50% in ETH.
 */
export function computeInventorySkew(inventory: InventoryState): number {
  // Target ETH ratio is between MIN_ETH and (1 - MAX_WOOD)
  const targetEthRatio = (1 - config.maxWoodRatio + 0.2) / 2; // ~0.2 to 0.5, center

  // Skew: how far we are from target
  // If ethRatio < target: we have too much WOOD -> q > 0
  // If ethRatio > target: we have excess ETH -> q < 0
  const skew = (targetEthRatio - inventory.ethRatio) * 2; // Scale to [-1, 1]

  return Math.max(-1, Math.min(1, skew));
}

/**
 * Determine how much WOOD and ETH to deploy in the new position.
 * Respects ETH reserve floors.
 */
export function computeDeployAmounts(
  inventory: InventoryState,
  woodPriceInEth: number,
): { woodAmount: bigint; ethAmount: bigint } {
  const minEthReserve = config.minEthReserveWei;

  // Available ETH = wallet ETH - minimum reserve
  const availableEth = inventory.ethBalance >= minEthReserve
    ? inventory.ethBalance - minEthReserve
    : 0n;

  // Deploy all available WOOD (it's free to mint)
  const woodAmount = inventory.woodBalance;

  // Deploy available ETH (respecting reserve)
  const ethAmount = availableEth;

  if (ethAmount === 0n) {
    logger.warn(
      { ethBalance: formatEth(inventory.ethBalance), reserve: formatEth(minEthReserve) },
      'Available ETH is 0 after reserve — will deploy single-sided WOOD only',
    );
  }

  logger.info(
    {
      deployWood: formatEth(woodAmount),
      deployEth: formatEth(ethAmount),
      reserveEth: formatEth(minEthReserve),
    },
    'Deploy amounts computed',
  );

  return { woodAmount, ethAmount };
}
