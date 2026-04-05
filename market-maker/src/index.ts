/**
 * Sherwood Market Maker - WOOD/WETH on Aerodrome Slipstream (Base)
 *
 * Avellaneda-Stoikov inspired concentrated liquidity management
 * with asymmetric inventory handling (WOOD is free, ETH is scarce).
 */

import 'dotenv/config';
import { logger } from './bot/logger.js';
import { MarketMakerBot } from './bot/runner.js';
import { config } from './config.js';

async function main(): Promise<void> {
  logger.info('=== Sherwood Market Maker ===');
  logger.info(
    {
      pool: config.poolAddress,
      nfpManager: config.nfpManagerAddress,
      wood: config.woodAddress,
      weth: config.wethAddress,
      tickSpacing: config.tickSpacing,
      dryRun: config.dryRun,
      gammaBase: config.gammaBase,
      tHorizon: config.tHorizonSeconds,
      pollInterval: config.pollIntervalMs,
      minEthReserve: config.minEthReserve,
      maxWoodRatio: config.maxWoodRatio,
      maxDrawdown: config.maxDrawdownPct,
    },
    'Configuration loaded',
  );

  if (config.dryRun) {
    logger.warn('DRY RUN MODE: transactions will NOT be submitted');
  }

  const bot = new MarketMakerBot();

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info('Shutdown signal received');
    bot.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initialize and run
  await bot.initialize();
  await bot.run();
}

main().catch((error) => {
  logger.fatal({ error }, 'Fatal error');
  process.exit(1);
});
