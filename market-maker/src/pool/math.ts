/**
 * Tick/price math utilities for concentrated liquidity.
 * All BigInt where needed for on-chain precision.
 */

const LOG_1_0001 = Math.log(1.0001);
const Q96 = 2n ** 96n;
const Q192 = 2n ** 192n;

/** Convert a tick to a human-readable price (token1/token0) */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

/** Convert a price to the nearest tick */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / LOG_1_0001);
}

/** Convert sqrtPriceX96 to a human-readable price (C2: BigInt arithmetic to avoid precision loss) */
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * 10n**18n) / Q192;
  return Number(scaled) / 1e18;
}

/** Convert a human-readable price to sqrtPriceX96 (W8: higher precision intermediate) */
export function priceToSqrtPriceX96(price: number): bigint {
  // Use higher precision: compute sqrt, scale by 2^96 using BigInt for final step
  const sqrtPrice = Math.sqrt(price);
  // Use string conversion to avoid Number precision loss with large Q96
  const scaleFactor = 1e15; // intermediate scale
  const sqrtScaled = BigInt(Math.round(sqrtPrice * scaleFactor));
  const q96Scaled = Q96 / BigInt(scaleFactor);
  // sqrtPriceX96 = sqrtPrice * 2^96
  // = (sqrtScaled / scaleFactor) * Q96
  // = sqrtScaled * (Q96 / scaleFactor)  [integer division acceptable here]
  return sqrtScaled * q96Scaled;
}

/** Snap a tick to the nearest valid tick for the given spacing (rounds toward negative infinity) */
export function snapToTickSpacing(tick: number, spacing: number): number {
  // Floor division that handles negatives correctly
  let snapped = Math.floor(tick / spacing) * spacing;
  return snapped;
}

/** Snap tick toward positive infinity */
export function snapToTickSpacingUp(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing;
}

/**
 * Compute amount of token0 for a given liquidity, current price, and tick range.
 * amount0 = L * (1/sqrt(pLower) - 1/sqrt(pUpper)) when price < pLower
 * amount0 = L * (1/sqrt(price) - 1/sqrt(pUpper)) when pLower <= price < pUpper
 * amount0 = 0 when price >= pUpper
 */
export function computeAmount0ForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint,
): bigint {
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // All token0
    return (liquidity * Q96 * (sqrtPriceUpperX96 - sqrtPriceLowerX96)) /
      (sqrtPriceUpperX96 * sqrtPriceLowerX96);
  } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
    // Mixed
    return (liquidity * Q96 * (sqrtPriceUpperX96 - sqrtPriceX96)) /
      (sqrtPriceUpperX96 * sqrtPriceX96);
  }
  return 0n;
}

/**
 * Compute amount of token1 for a given liquidity, current price, and tick range.
 * amount1 = L * (sqrt(pUpper) - sqrt(pLower)) when price >= pUpper
 * amount1 = L * (sqrt(price) - sqrt(pLower)) when pLower <= price < pUpper
 * amount1 = 0 when price < pLower
 */
export function computeAmount1ForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint,
): bigint {
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    return 0n;
  } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
    return (liquidity * (sqrtPriceX96 - sqrtPriceLowerX96)) / Q96;
  }
  // All token1
  return (liquidity * (sqrtPriceUpperX96 - sqrtPriceLowerX96)) / Q96;
}

/**
 * Compute liquidity from desired amounts for a given tick range.
 * Returns the minimum of liquidity computed from each token.
 */
export function liquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // All token0
    if (amount0 === 0n) return 0n;
    return (amount0 * sqrtPriceLowerX96 * sqrtPriceUpperX96) /
      (Q96 * (sqrtPriceUpperX96 - sqrtPriceLowerX96));
  } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
    // Mixed - take minimum
    const liq0 = amount0 > 0n
      ? (amount0 * sqrtPriceX96 * sqrtPriceUpperX96) /
        (Q96 * (sqrtPriceUpperX96 - sqrtPriceX96))
      : 0n;
    const liq1 = amount1 > 0n
      ? (amount1 * Q96) / (sqrtPriceX96 - sqrtPriceLowerX96)
      : 0n;
    if (liq0 === 0n) return liq1;
    if (liq1 === 0n) return liq0;
    return liq0 < liq1 ? liq0 : liq1;
  }
  // All token1
  if (amount1 === 0n) return 0n;
  return (amount1 * Q96) / (sqrtPriceUpperX96 - sqrtPriceLowerX96);
}

/** Convert tick to sqrtPriceX96 */
export function tickToSqrtPriceX96(tick: number): bigint {
  const price = tickToPrice(tick);
  return priceToSqrtPriceX96(price);
}

/** Format a bigint wei value to ETH string */
export function formatEth(wei: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 6);
  return `${whole}.${fracStr}`;
}
