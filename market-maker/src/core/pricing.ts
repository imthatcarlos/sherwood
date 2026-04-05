/**
 * Avellaneda-Stoikov pricing engine adapted for asymmetric inventory.
 *
 * Key insight: WOOD is free to mint (protocol token), ETH is scarce.
 * When holding excess WOOD, we're eager to sell it for ETH (high gamma).
 * When holding excess ETH, we're comfortable (low gamma).
 */

import type { PricingResult, PricePoint } from '../types.js';
import { config } from '../config.js';
import { priceToTick, snapToTickSpacing, tickToPrice } from '../pool/math.js';
import { logger } from '../bot/logger.js';

/**
 * Compute realized volatility using EWMA of log returns.
 * Uses recent price observations.
 */
export function computeVolatility(priceHistory: PricePoint[], lookbackCount: number): number {
  if (priceHistory.length < 2) {
    // Default volatility when not enough data (50% annualized -> per-second)
    // sigma_annual = 0.5, sigma_second = 0.5 / sqrt(365.25 * 24 * 3600)
    return 0.5 / Math.sqrt(365.25 * 24 * 3600);
  }

  const prices = priceHistory.slice(-lookbackCount);
  const lambda = 0.94; // EWMA decay factor

  let ewmaVariance = 0;
  // C5: Fixed weight ordering - oldest observations get smallest weight, newest get largest
  let weight = Math.pow(lambda, prices.length - 2); // start small for oldest
  let totalWeight = 0;

  for (let i = 1; i < prices.length; i++) {
    const logReturn = Math.log(prices[i].price / prices[i - 1].price);
    const dt = Math.max(prices[i].timestamp - prices[i - 1].timestamp, 1);
    // Normalize log return to per-second
    const normalizedReturn = logReturn / Math.sqrt(dt);

    ewmaVariance += weight * normalizedReturn * normalizedReturn;
    totalWeight += weight;
    weight /= lambda; // weight increases for newer observations
  }

  if (totalWeight === 0) return 0.5 / Math.sqrt(365.25 * 24 * 3600);

  const variance = ewmaVariance / totalWeight;
  return Math.sqrt(variance);
}

/**
 * Compute the asymmetric effective gamma.
 *
 * @param gammaBase - Base gamma parameter
 * @param inventorySkew - Normalized inventory skew:
 *   q > 0 means excess WOOD (want to sell)
 *   q < 0 means excess ETH (comfortable)
 */
export function computeEffectiveGamma(gammaBase: number, inventorySkew: number): number {
  if (inventorySkew > 0) {
    // Excess WOOD: increase gamma to widen spread and push reservation price down
    // This makes us eager to sell WOOD for ETH
    return gammaBase * 1.5;
  } else if (inventorySkew < 0) {
    // Excess ETH: decrease gamma, tighter spreads, less urgency
    return gammaBase * 0.5;
  }
  return gammaBase;
}

/**
 * Main Avellaneda-Stoikov pricing computation.
 *
 * @param midPrice - Current mid-market price (token1 per token0, e.g. ETH per WOOD)
 * @param inventorySkew - Normalized inventory skew in [-1, 1]
 * @param sigma - Realized volatility (per second)
 * @param timeRemainingFraction - (T - t) / T, fraction of horizon remaining
 * @param tickSpacing - Pool tick spacing for snapping
 * @returns PricingResult with bid/ask ticks
 */
export function computeASPricing(
  midPrice: number,
  inventorySkew: number,
  sigma: number,
  timeRemainingFraction: number,
  tickSpacing: number,
): PricingResult {
  const { gammaBase, kOrderIntensity, tHorizonSeconds } = config;
  const k = kOrderIntensity;

  // Effective gamma with asymmetric adjustment
  const gammaEff = computeEffectiveGamma(gammaBase, inventorySkew);

  // Time remaining in seconds
  const tau = timeRemainingFraction * tHorizonSeconds;

  // Prevent division by zero
  const safeTau = Math.max(tau, 1);
  const safeSigma = Math.max(sigma, 1e-10);
  const safeGamma = Math.max(gammaEff, 1e-6);

  // Reservation price: r = s - q * gamma * sigma^2 * tau
  const reservationPrice = midPrice - inventorySkew * safeGamma * safeSigma * safeSigma * safeTau;

  // Optimal spread: delta = gamma * sigma^2 * tau + (2/gamma) * ln(1 + gamma/k)
  const spread =
    safeGamma * safeSigma * safeSigma * safeTau +
    (2 / safeGamma) * Math.log(1 + safeGamma / k);

  // Ensure minimum spread of 2 tick spacings
  const minSpreadPrice = tickToPrice(tickSpacing * 2) - 1; // Approximate minimum spread in price terms
  const effectiveSpread = Math.max(spread, midPrice * minSpreadPrice);

  // Bid and ask
  const bidPrice = reservationPrice - effectiveSpread / 2;
  const askPrice = reservationPrice + effectiveSpread / 2;

  // Convert to ticks and snap to tick spacing
  const bidTick = snapToTickSpacing(priceToTick(Math.max(bidPrice, 1e-18)), tickSpacing);
  const askTick = snapToTickSpacing(priceToTick(askPrice), tickSpacing);

  // Ensure ask > bid by at least 1 tick spacing
  const finalAskTick = Math.max(askTick, bidTick + tickSpacing);

  const result: PricingResult = {
    midPrice,
    reservationPrice,
    spread: effectiveSpread,
    bidPrice,
    askPrice,
    bidTick,
    askTick: finalAskTick,
    gammaEff,
    sigma: safeSigma,
    inventorySkew,
  };

  logger.debug(
    {
      midPrice: midPrice.toFixed(12),
      reservation: reservationPrice.toFixed(12),
      spread: effectiveSpread.toFixed(12),
      bidTick,
      askTick: finalAskTick,
      gammaEff: gammaEff.toFixed(4),
      sigma: safeSigma.toExponential(4),
      skew: inventorySkew.toFixed(4),
    },
    'AS pricing computed',
  );

  return result;
}
