/**
 * Main bot loop: read state, compute pricing, check triggers, rebalance.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

import { config } from '../config.js';
const chain = config.rpcUrl.includes('sepolia') ? baseSepolia : base;
import { logger } from './logger.js';
import { SlipstreamPool } from '../pool/slipstream.js';
import { PositionManager } from '../pool/positions.js';
import { computeASPricing, computeVolatility } from '../core/pricing.js';
import { computeInventory, computeInventorySkew, computeDeployAmounts } from '../core/inventory.js';
import { checkRisk, shouldHalt } from '../core/risk.js';
import {
  sqrtPriceX96ToPrice,
  formatEth,
} from '../pool/math.js';
import type { BotState, Position, MintParams, PnLData } from '../types.js';
import { loadState, saveState, defaultBotState } from './state.js';
import { updatePnL, computeFeesEth, computeGasCostEth, defaultPnL, type CyclePnL } from './pnl.js';
import { parseGwei } from 'viem';

/** Adjust tick range for single-sided deposits when one token amount is zero */
function adjustTicksForSingleSided(
  bidTick: number,
  askTick: number,
  currentTick: number,
  amount0: bigint,
  amount1: bigint,
  tickSpacing: number,
): { bidTick: number; askTick: number } {
  const snappedCurrentTick = Math.floor(currentTick / tickSpacing) * tickSpacing;

  if (amount0 === 0n && amount1 > 0n) {
    // Single-sided token1: range must be entirely below current tick
    if (askTick > snappedCurrentTick) {
      askTick = snappedCurrentTick;
      bidTick = Math.min(bidTick, askTick - tickSpacing * 2);
    }
  } else if (amount1 === 0n && amount0 > 0n) {
    // Single-sided token0: range must be entirely above current tick
    if (bidTick <= snappedCurrentTick) {
      bidTick = snappedCurrentTick + tickSpacing;
      askTick = Math.max(askTick, bidTick + tickSpacing * 2);
    }
  }

  return { bidTick, askTick };
}

export class MarketMakerBot {
  private publicClient: any;
  private walletClient: any;
  private pool: SlipstreamPool;
  private positionManager: PositionManager;
  private botAddress: Address;
  private isToken0Wood: boolean = false;
  private state: BotState;
  private running: boolean = false;
  private lastRebalanceTimestamp: number = 0; // W7: track actual rebalance time
  private feeCollectCounter: number = 0; // W2: periodic fee collection

  constructor() {
    const account = privateKeyToAccount(config.privateKey);
    this.botAddress = account.address;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });

    this.pool = new SlipstreamPool(this.publicClient, config.poolAddress);

    this.positionManager = new PositionManager(
      this.publicClient,
      this.walletClient,
      config.nfpManagerAddress,
      this.botAddress,
    );

    // FIX 6: Load persisted state from disk (or start fresh)
    this.state = loadState();
  }

  /** Initialize: detect token ordering, find existing positions */
  async initialize(): Promise<void> {
    logger.info(
      {
        bot: this.botAddress,
        pool: config.poolAddress,
        dryRun: config.dryRun,
      },
      'Initializing market maker bot',
    );

    // Read pool to determine token ordering
    const poolState = await this.pool.getPoolState();
    this.isToken0Wood =
      poolState.token0.toLowerCase() === config.woodAddress.toLowerCase();

    logger.info(
      {
        token0: poolState.token0,
        token1: poolState.token1,
        isToken0Wood: this.isToken0Wood,
        currentTick: poolState.tick,
        tickSpacing: poolState.tickSpacing,
        fee: poolState.fee,
      },
      'Pool state loaded',
    );

    // Find existing positions
    const tokenIds = await this.positionManager.getOwnedTokenIds();
    if (tokenIds.length > 0) {
      // Find positions in our pool
      for (const tokenId of tokenIds) {
        const pos = await this.positionManager.getPosition(tokenId);
        if (
          (config.useUniswapV3 ? pos.fee === config.poolFee : pos.tickSpacing === config.tickSpacing) &&
          pos.token0.toLowerCase() === poolState.token0.toLowerCase() &&
          pos.token1.toLowerCase() === poolState.token1.toLowerCase()
        ) {
          this.state.activeTokenId = tokenId;
          logger.info(
            {
              tokenId: tokenId.toString(),
              tickLower: pos.tickLower,
              tickUpper: pos.tickUpper,
              liquidity: pos.liquidity.toString(),
            },
            'Found existing position',
          );
          break;
        }
      }
    }

    if (!this.state.activeTokenId) {
      logger.info('No existing position found, will create on first cycle');
    }
  }

  /** Main loop: runs until stopped */
  async run(): Promise<void> {
    this.running = true;

    logger.info(
      { pollInterval: config.pollIntervalMs },
      'Starting main loop',
    );

    while (this.running) {
      try {
        await this.cycle();
      } catch (error) {
        logger.error({ error }, 'Error in bot cycle');
      }

      await this.sleep(config.pollIntervalMs);
    }

    logger.info('Bot stopped');
  }

  /** Stop the bot */
  stop(): void {
    this.running = false;
    logger.info('Stop signal received');
  }

  /** Single bot cycle */
  private async cycle(): Promise<void> {
    this.state.cycleCount++;
    this.feeCollectCounter++;
    const cycleStart = Date.now();

    logger.info({ cycle: this.state.cycleCount }, '--- Cycle start ---');

    // 1. Read pool state
    const poolState = await this.pool.getPoolState();
    const currentPrice = sqrtPriceX96ToPrice(poolState.sqrtPriceX96);

    logger.info(
      {
        tick: poolState.tick,
        price: currentPrice.toFixed(12),
        liquidity: poolState.liquidity.toString(),
      },
      'Pool state',
    );

    // 2. Record price observation
    const blockNumber = await this.publicClient.getBlockNumber();
    this.state.priceHistory.push({
      timestamp: cycleStart / 1000,
      price: currentPrice,
      tick: poolState.tick,
      blockNumber,
    });

    // Keep only last 1000 observations
    if (this.state.priceHistory.length > 1000) {
      this.state.priceHistory = this.state.priceHistory.slice(-1000);
    }

    // 3. Read current position
    let activePosition: Position | null = null;
    if (this.state.activeTokenId) {
      try {
        activePosition = await this.positionManager.getPosition(this.state.activeTokenId);
      } catch {
        logger.warn('Active position not found, may have been burned');
        this.state.activeTokenId = null;
      }
    }

    // 4. Compute inventory
    const inventory = await computeInventory(
      this.pool,
      poolState,
      activePosition,
      this.botAddress,
      config.woodAddress,
      config.wethAddress,
      this.isToken0Wood,
    );

    // Update peak portfolio value
    const totalValue = inventory.totalEthValue + inventory.totalWoodValue;
    if (totalValue > this.state.peakPortfolioValue) {
      this.state.peakPortfolioValue = totalValue;
    }

    // 5. Check halt condition
    const haltCheck = shouldHalt(inventory, this.state);
    if (haltCheck.halt) {
      logger.error({ reason: haltCheck.reason }, 'BOT HALTED');
      this.state.halted = true;
      this.state.haltReason = haltCheck.reason;

      // Emergency: burn all positions
      if (this.state.activeTokenId && activePosition && activePosition.liquidity > 0n) {
        logger.warn('Emergency: burning active position');
        await this.positionManager.burnPosition(this.state.activeTokenId);
        this.state.activeTokenId = null;
      }

      this.running = false;
      return;
    }

    // 6. Compute volatility
    const sigma = computeVolatility(
      this.state.priceHistory,
      config.sigmaLookbackBlocks,
    );

    // 7. Compute inventory skew
    const skew = computeInventorySkew(inventory);

    // 8. W7: Time fraction based on time since last rebalance (not wall clock modulo)
    const timeSinceLastRebalance = this.lastRebalanceTimestamp > 0
      ? (cycleStart / 1000 - this.lastRebalanceTimestamp)
      : config.tHorizonSeconds; // first cycle: assume full horizon elapsed
    const timeRemainingFraction = Math.max(0.01, 1 - timeSinceLastRebalance / config.tHorizonSeconds);

    // 9. AS pricing
    const pricing = computeASPricing(
      currentPrice,
      skew,
      sigma,
      timeRemainingFraction,
      config.tickSpacing,
    );

    // 10. Get TWAP for risk check
    let twapTick: number;
    try {
      twapTick = await this.pool.getTWAPTick(300); // 5 min TWAP
    } catch (error) {
      logger.error({ error }, 'TWAP oracle unavailable — halting bot to prevent unsafe pricing');
      this.state.halted = true;
      this.state.haltReason = 'TWAP oracle unavailable';
      return;
    }

    // 11. Check if rebalance is needed
    const needsRebalance = this.shouldRebalance(
      poolState,
      activePosition,
      pricing.bidTick,
      pricing.askTick,
    );

    if (!needsRebalance) {
      // W2: Collect fees periodically (every 10 cycles) instead of checking stale tokensOwed
      if (this.state.activeTokenId && activePosition && this.feeCollectCounter >= 10) {
        logger.info('Periodic fee collection');
        await this.positionManager.collectFees(this.state.activeTokenId);
        this.feeCollectCounter = 0;
      }

      // FIX 6: Save state even on no-rebalance cycles
      saveState(this.state);

      logger.info(
        { elapsed: Date.now() - cycleStart },
        '--- Cycle end (no rebalance) ---',
      );
      return;
    }

    // 12. Risk checks
    const riskCheck = checkRisk(poolState, inventory, this.state, twapTick);
    if (!riskCheck.allowed) {
      logger.info({ reason: riskCheck.reason }, 'Rebalance blocked by risk check');
      logger.info(
        { elapsed: Date.now() - cycleStart },
        '--- Cycle end (risk blocked) ---',
      );
      return;
    }

    // FIX 5: Gas price check - skip cycle if gas too high
    try {
      const gasPrice = await this.publicClient.getGasPrice();
      const maxGasWei = parseGwei(String(config.maxGasPriceGwei));
      if (gasPrice > maxGasWei) {
        const gasPriceGwei = Number(gasPrice) / 1e9;
        logger.warn(
          { currentGwei: gasPriceGwei.toFixed(2), maxGwei: config.maxGasPriceGwei },
          'Gas price too high, skipping rebalance this cycle',
        );
        // FIX 6: Save state even when skipping
        saveState(this.state);
        return;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to check gas price, proceeding with caution');
    }

    // 13. Execute rebalance
    logger.info(
      {
        oldTokenId: this.state.activeTokenId?.toString(),
        newBidTick: pricing.bidTick,
        newAskTick: pricing.askTick,
      },
      'Executing rebalance',
    );

    // C4: Use atomic multicall for burn+mint when we have an existing position
    if (this.state.activeTokenId && activePosition && activePosition.liquidity > 0n) {
     try {
      // W3: Re-read pool state after deciding to rebalance (will be fresh for mint calc)
      const freshPoolState = await this.pool.getPoolState();
      const freshPrice = sqrtPriceX96ToPrice(freshPoolState.sqrtPriceX96);

      // Re-read balances (estimate what we'll have after burn)
      const freshInventory = await computeInventory(
        this.pool,
        freshPoolState,
        activePosition, // include position tokens since we'll get them back
        this.botAddress,
        config.woodAddress,
        config.wethAddress,
        this.isToken0Wood,
      );

      const woodPriceInEth = this.isToken0Wood ? freshPrice : 1 / freshPrice;
      const { woodAmount, ethAmount } = computeDeployAmounts(freshInventory, woodPriceInEth);

      const amount0 = this.isToken0Wood ? woodAmount : ethAmount;
      const amount1 = this.isToken0Wood ? ethAmount : woodAmount;

      if (amount0 === 0n && amount1 === 0n) {
        logger.warn('Both deploy amounts are 0, skipping rebalance');
        return;
      }

      // Adjust range for single-sided deposits
      const { bidTick: finalBidTick, askTick: finalAskTick } = adjustTicksForSingleSided(
        pricing.bidTick, pricing.askTick, freshPoolState.tick, amount0, amount1, config.tickSpacing,
      );
      if (finalBidTick !== pricing.bidTick || finalAskTick !== pricing.askTick) {
        logger.info(
          { originalBid: pricing.bidTick, originalAsk: pricing.askTick, adjustedBid: finalBidTick, adjustedAsk: finalAskTick, currentTick: freshPoolState.tick },
          'Adjusted range for single-sided deposit',
        );
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      // FIX 4: Configurable slippage protection on mint
      const slippageMultiplier = 10000n - BigInt(config.slippageBps);
      const mintParams: MintParams = {
        token0: freshPoolState.token0,
        token1: freshPoolState.token1,
        tickSpacing: config.tickSpacing,
        tickLower: finalBidTick,
        tickUpper: finalAskTick,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: amount0 * slippageMultiplier / 10000n,
        amount1Min: amount1 * slippageMultiplier / 10000n,
        recipient: this.botAddress,
        deadline,
        sqrtPriceX96: 0n,
      };

      const result = await this.positionManager.rebalanceMulticall(
        this.state.activeTokenId,
        activePosition.liquidity,
        mintParams,
        freshPoolState.sqrtPriceX96,
      );

      if (result.tokenId > 0n) {
        this.state.activeTokenId = result.tokenId;
      } else {
        this.state.activeTokenId = null;
      }
     } catch (error) {
      logger.error({ error }, 'Rebalance (multicall) failed');
      return;
     }
    } else {
      // No existing position - just mint new one
     try {
      // W3: Re-read pool state before computing new position
      const freshPoolState = await this.pool.getPoolState();
      const freshPrice = sqrtPriceX96ToPrice(freshPoolState.sqrtPriceX96);

      const freshInventory = await computeInventory(
        this.pool,
        freshPoolState,
        null,
        this.botAddress,
        config.woodAddress,
        config.wethAddress,
        this.isToken0Wood,
      );

      const woodPriceInEth = this.isToken0Wood ? freshPrice : 1 / freshPrice;
      const { woodAmount, ethAmount } = computeDeployAmounts(freshInventory, woodPriceInEth);

      const amount0 = this.isToken0Wood ? woodAmount : ethAmount;
      const amount1 = this.isToken0Wood ? ethAmount : woodAmount;

      if (amount0 === 0n && amount1 === 0n) {
        logger.warn('Both deploy amounts are 0, skipping rebalance');
        return;
      }

      // Adjust range for single-sided deposits
      const { bidTick: finalBidTick, askTick: finalAskTick } = adjustTicksForSingleSided(
        pricing.bidTick, pricing.askTick, freshPoolState.tick, amount0, amount1, config.tickSpacing,
      );
      if (finalBidTick !== pricing.bidTick || finalAskTick !== pricing.askTick) {
        logger.info(
          { originalBid: pricing.bidTick, originalAsk: pricing.askTick, adjustedBid: finalBidTick, adjustedAsk: finalAskTick, currentTick: freshPoolState.tick },
          'Adjusted range for single-sided deposit',
        );
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      // FIX 4: Configurable slippage protection on mint
      const slippageMultiplier2 = 10000n - BigInt(config.slippageBps);
      const mintParams: MintParams = {
        token0: freshPoolState.token0,
        token1: freshPoolState.token1,
        tickSpacing: config.tickSpacing,
        tickLower: finalBidTick,
        tickUpper: finalAskTick,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: amount0 * slippageMultiplier2 / 10000n,
        amount1Min: amount1 * slippageMultiplier2 / 10000n,
        recipient: this.botAddress,
        deadline,
        sqrtPriceX96: 0n,
      };

      const result = await this.positionManager.mint(mintParams);

      if (result.tokenId > 0n) {
        this.state.activeTokenId = result.tokenId;
      }
     } catch (error) {
      logger.error({ error }, 'Mint failed');
      return;
     }
    }

    this.state.lastRebalanceTime = Date.now();
    this.lastRebalanceTimestamp = Date.now() / 1000; // W7: track for time fraction
    this.feeCollectCounter = 0; // reset fee counter after rebalance

    // FIX 7: Track PnL for this cycle
    const cyclePnl: CyclePnL = {
      portfolioValueEth: totalValue,
      feesCollectedEth: 0, // TODO: integrate with fee collection receipts
      gasSpentEth: 0, // TODO: integrate with tx receipt gas tracking
      netPnlEth: 0,
    };
    cyclePnl.netPnlEth = cyclePnl.feesCollectedEth - cyclePnl.gasSpentEth;
    updatePnL(this.state, cyclePnl);

    // FIX 6: Persist state after each cycle
    saveState(this.state);

    logger.info(
      {
        newTokenId: this.state.activeTokenId?.toString(),
        bidTick: pricing.bidTick,
        askTick: pricing.askTick,
        elapsed: Date.now() - cycleStart,
      },
      '--- Rebalance complete ---',
    );
  }

  /** Determine if rebalance is needed */
  private shouldRebalance(
    poolState: { tick: number },
    position: Position | null,
    newBidTick: number,
    newAskTick: number,
  ): boolean {
    // No active position -> need to mint
    if (!position || position.liquidity === 0n) {
      logger.info('No active position, need to mint');
      return true;
    }

    // Price exited range
    if (poolState.tick < position.tickLower || poolState.tick >= position.tickUpper) {
      logger.info(
        {
          currentTick: poolState.tick,
          posLower: position.tickLower,
          posUpper: position.tickUpper,
        },
        'Price exited range',
      );
      return true;
    }

    // New range differs significantly (> 2 * tickSpacing)
    const tickDiffLower = Math.abs(newBidTick - position.tickLower);
    const tickDiffUpper = Math.abs(newAskTick - position.tickUpper);
    const threshold = config.tickSpacing * 2;

    if (tickDiffLower > threshold || tickDiffUpper > threshold) {
      logger.info(
        {
          tickDiffLower,
          tickDiffUpper,
          threshold,
        },
        'Optimal range shifted significantly',
      );
      return true;
    }

    // Time-based: rebalance every T/2
    const timeSinceRebalance = Date.now() - this.state.lastRebalanceTime;
    const halfHorizon = (config.tHorizonSeconds * 1000) / 2;
    if (this.state.lastRebalanceTime > 0 && timeSinceRebalance > halfHorizon) {
      logger.info(
        {
          timeSinceMs: timeSinceRebalance,
          halfHorizonMs: halfHorizon,
        },
        'Time-based rebalance trigger',
      );
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
