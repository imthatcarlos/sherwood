/**
 * Risk management: kill switch, drawdown limits, cooldowns, manipulation detection.
 */

import type { RiskCheck, BotState, PoolState, InventoryState } from '../types.js';
import { config } from '../config.js';
import { sqrtPriceX96ToPrice, tickToPrice } from '../pool/math.js';
import { logger } from '../bot/logger.js';

/**
 * Run all risk checks. Returns whether the bot should proceed with rebalancing.
 */
export function checkRisk(
  poolState: PoolState,
  inventory: InventoryState,
  botState: BotState,
  twapTick: number,
): RiskCheck {
  const ethBalanceTotal = inventory.ethBalance + inventory.ethInPosition;
  const currentPrice = sqrtPriceX96ToPrice(poolState.sqrtPriceX96);
  const totalValue = inventory.totalEthValue + inventory.totalWoodValue;

  // 1. Kill switch: absolute ETH minimum
  if (ethBalanceTotal < config.minEthReserveWei) {
    logger.error(
      { ethBalance: ethBalanceTotal.toString(), minimum: config.minEthReserveWei.toString() },
      'KILL SWITCH: ETH below absolute minimum',
    );
    return {
      allowed: false,
      reason: `ETH balance ${ethBalanceTotal} below minimum ${config.minEthReserveWei}`,
      ethBalance: ethBalanceTotal,
      drawdownPct: 0,
      twapDeviationPct: 0,
    };
  }

  // 2. Max drawdown from peak
  if (botState.peakPortfolioValue > 0) {
    const drawdownPct = ((botState.peakPortfolioValue - totalValue) / botState.peakPortfolioValue) * 100;
    if (drawdownPct > config.maxDrawdownPct) {
      logger.error(
        { drawdownPct: drawdownPct.toFixed(2), maxAllowed: config.maxDrawdownPct },
        'HALT: Max drawdown exceeded',
      );
      return {
        allowed: false,
        reason: `Drawdown ${drawdownPct.toFixed(2)}% exceeds max ${config.maxDrawdownPct}%`,
        ethBalance: ethBalanceTotal,
        drawdownPct,
        twapDeviationPct: 0,
      };
    }
  }

  // 3. TWAP deviation check (manipulation detection)
  const currentTick = poolState.tick;
  const twapPrice = tickToPrice(twapTick);
  const spotPrice = tickToPrice(currentTick);
  const deviationPct = Math.abs((spotPrice - twapPrice) / twapPrice) * 100;

  if (deviationPct > config.twapDeviationPct) {
    logger.warn(
      {
        spotTick: currentTick,
        twapTick,
        deviationPct: deviationPct.toFixed(2),
        maxAllowed: config.twapDeviationPct,
      },
      'PAUSE: Price deviates significantly from TWAP (possible manipulation)',
    );
    return {
      allowed: false,
      reason: `TWAP deviation ${deviationPct.toFixed(2)}% exceeds max ${config.twapDeviationPct}%`,
      ethBalance: ethBalanceTotal,
      drawdownPct: 0,
      twapDeviationPct: deviationPct,
    };
  }

  // 4. Cooldown check
  const timeSinceLastRebalance = Date.now() - botState.lastRebalanceTime;
  if (timeSinceLastRebalance < config.minRebalanceIntervalMs) {
    logger.debug(
      {
        timeSince: timeSinceLastRebalance,
        cooldown: config.minRebalanceIntervalMs,
      },
      'Cooldown active, skipping rebalance',
    );
    return {
      allowed: false,
      reason: `Cooldown: ${timeSinceLastRebalance}ms < ${config.minRebalanceIntervalMs}ms`,
      ethBalance: ethBalanceTotal,
      drawdownPct: 0,
      twapDeviationPct: deviationPct,
    };
  }

  // W10: Compute actual drawdown percentage
  const actualDrawdownPct = botState.peakPortfolioValue > 0
    ? ((botState.peakPortfolioValue - totalValue) / botState.peakPortfolioValue) * 100
    : 0;

  logger.debug('Risk checks passed');
  return {
    allowed: true,
    ethBalance: ethBalanceTotal,
    drawdownPct: actualDrawdownPct,
    twapDeviationPct: deviationPct,
  };
}

/**
 * Check if the bot should halt completely (unrecoverable state).
 */
export function shouldHalt(
  inventory: InventoryState,
  botState: BotState,
): { halt: boolean; reason?: string } {
  // Total ETH (wallet + position) below kill threshold
  const totalEth = inventory.ethBalance + inventory.ethInPosition;
  if (totalEth < config.minEthReserveWei / 2n) {
    return {
      halt: true,
      reason: `Total ETH ${totalEth} below critical threshold`,
    };
  }

  // Already halted
  if (botState.halted) {
    return { halt: true, reason: botState.haltReason };
  }

  return { halt: false };
}
