/**
 * Aerodrome Slipstream CL pool interaction.
 * Reads pool state, prices, ticks, and TWAP.
 */

import { type Address } from 'viem';
import { CLPoolABI, UniswapV3PoolABI } from '../abis/CLPool.js';
import { ERC20ABI } from '../abis/ERC20.js';
import type { PoolState } from '../types.js';
import { logger } from '../bot/logger.js';
import { config } from '../config.js';

export class SlipstreamPool {
  constructor(
    private client: any,
    private poolAddress: Address,
  ) {}

  /** Read full pool state from slot0 + auxiliary calls */
  async getPoolState(): Promise<PoolState> {
    // Use correct ABI based on protocol: V3 has 7-field slot0, Slipstream has 6-field
    const poolABI = config.useUniswapV3 ? UniswapV3PoolABI : CLPoolABI;
    const [slot0, liquidity, fee, tickSpacing, token0, token1] = await Promise.all([
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'slot0' }),
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'liquidity' }),
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'fee' }),
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'tickSpacing' }),
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'token0' }),
      this.client.readContract({ address: this.poolAddress, abi: poolABI, functionName: 'token1' }),
    ]);

    // V3 slot0: [sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, feeProtocol, unlocked]
    // Slipstream slot0: [sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, unlocked]
    const unlockedIndex = config.useUniswapV3 ? 6 : 5;

    return {
      sqrtPriceX96: (slot0 as any)[0],
      tick: Number((slot0 as any)[1]),
      observationIndex: Number((slot0 as any)[2]),
      observationCardinality: Number((slot0 as any)[3]),
      observationCardinalityNext: Number((slot0 as any)[4]),
      unlocked: (slot0 as any)[unlockedIndex],
      liquidity: liquidity as bigint,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
      token0: token0 as Address,
      token1: token1 as Address,
    };
  }

  /**
   * Get TWAP tick over a given period.
   * Uses the pool's observe() function.
   */
  async getTWAPTick(secondsAgo: number): Promise<number> {
    const poolABI = config.useUniswapV3 ? UniswapV3PoolABI : CLPoolABI;
    try {
      const result = await this.client.readContract({
        address: this.poolAddress,
        abi: poolABI,
        functionName: 'observe',
        args: [[secondsAgo, 0]],
      });
      const tickCumulatives = (result as any)[0] as bigint[];
      const tickDiff = Number(tickCumulatives[1] - tickCumulatives[0]);
      return Math.floor(tickDiff / secondsAgo);
    } catch (error) {
      logger.warn({ error }, 'Failed to get TWAP, observation may not be initialized');
      // Fall back to current tick
      const slot0 = await this.client.readContract({
        address: this.poolAddress,
        abi: poolABI,
        functionName: 'slot0',
      });
      return Number((slot0 as any)[1]);
    }
  }

  /** Get token balances for an address */
  async getBalances(
    address: Address,
    token0: Address,
    token1: Address,
  ): Promise<{ balance0: bigint; balance1: bigint; ethBalance: bigint }> {
    const [balance0, balance1, ethBalance] = await Promise.all([
      this.client.readContract({
        address: token0,
        abi: ERC20ABI,
        functionName: 'balanceOf',
        args: [address],
      }),
      this.client.readContract({
        address: token1,
        abi: ERC20ABI,
        functionName: 'balanceOf',
        args: [address],
      }),
      this.client.getBalance({ address }),
    ]);

    return {
      balance0: balance0 as bigint,
      balance1: balance1 as bigint,
      ethBalance: ethBalance as bigint,
    };
  }

  /** Check token allowance */
  async checkAllowance(
    tokenAddress: Address,
    owner: Address,
    spender: Address,
  ): Promise<bigint> {
    return this.client.readContract({
      address: tokenAddress,
      abi: ERC20ABI,
      functionName: 'allowance',
      args: [owner, spender],
    }) as Promise<bigint>;
  }
}
