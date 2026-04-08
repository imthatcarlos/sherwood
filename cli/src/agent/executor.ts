/**
 * Trade execution module — dry-run paper trading + live execution placeholder.
 */

import chalk from 'chalk';
import type { TradeDecision } from './scoring.js';
import type { Position } from './risk.js';
import { RiskManager } from './risk.js';
import { PortfolioTracker } from './portfolio.js';

export interface ExecutionConfig {
  dryRun: boolean;
  mevProtection: boolean;
  maxGasPrice?: bigint;
  chain: string;
}

export interface OrderParams {
  tokenId: string;
  side: 'buy' | 'sell';
  amountUsd: number;
  maxSlippage: number;
  stopLoss: number;
  takeProfit: number;
}

export class TradeExecutor {
  private config: ExecutionConfig;
  private riskManager: RiskManager;
  private portfolio: PortfolioTracker;

  constructor(config: ExecutionConfig, riskManager: RiskManager, portfolio: PortfolioTracker) {
    this.config = config;
    this.riskManager = riskManager;
    this.portfolio = portfolio;
  }

  /** Execute a trade based on a decision */
  async execute(
    decision: TradeDecision,
    tokenId: string,
    currentPrice: number,
  ): Promise<{
    success: boolean;
    position?: Position;
    error?: string;
    dryRun: boolean;
  }> {
    // Only execute on BUY or STRONG_BUY
    if (decision.action !== 'BUY' && decision.action !== 'STRONG_BUY') {
      return {
        success: false,
        error: `Action ${decision.action} does not trigger execution`,
        dryRun: this.config.dryRun,
      };
    }

    // Load portfolio to get current state
    const state = await this.portfolio.load();
    this.riskManager.updatePortfolio(state);

    // Calculate stop loss and take profit from current price
    const stopLossDistance = currentPrice * 0.08; // 8% default stop
    const stopLossPrice = currentPrice - stopLossDistance;
    const takeProfitPrice = currentPrice * (1 + 0.08 * 2.5); // 2.5:1 reward/risk

    // Size the position using risk management
    const sizing = this.riskManager.calculatePositionSize(
      currentPrice,
      stopLossPrice,
      state.totalValue,
    );

    if (sizing.quantity <= 0 || sizing.sizeUsd <= 0) {
      return {
        success: false,
        error: 'Position sizing returned zero — check portfolio value and stop distance',
        dryRun: this.config.dryRun,
      };
    }

    // Check if risk manager allows this trade
    const check = this.riskManager.canOpenPosition(tokenId, sizing.sizeUsd);
    if (!check.allowed) {
      return {
        success: false,
        error: `Risk check failed: ${check.reason}`,
        dryRun: this.config.dryRun,
      };
    }

    const order: OrderParams = {
      tokenId,
      side: 'buy',
      amountUsd: sizing.sizeUsd,
      maxSlippage: 0.015,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
    };

    if (this.config.dryRun) {
      try {
        const position = await this.executeDryRun(order, currentPrice);
        return { success: true, position, dryRun: true };
      } catch (err) {
        return {
          success: false,
          error: `Dry-run failed: ${(err as Error).message}`,
          dryRun: true,
        };
      }
    } else {
      try {
        const result = await this.executeLive(order);
        // If live execution succeeded, also track in portfolio
        const position = await this.portfolio.openPosition({
          tokenId,
          symbol: tokenId.toUpperCase(),
          entryPrice: result.executedPrice,
          currentPrice: result.executedPrice,
          quantity: sizing.quantity,
          entryTimestamp: Date.now(),
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          strategy: decision.signals[0]?.source ?? 'agent',
        });
        return { success: true, position, dryRun: false };
      } catch (err) {
        return {
          success: false,
          error: `Live execution failed: ${(err as Error).message}`,
          dryRun: false,
        };
      }
    }
  }

  /** Process all pending exits (stops, take profits, time stops) */
  async processExits(
    currentPrices: Record<string, number>,
  ): Promise<Array<{ position: Position; exitPrice: number; reason: string; pnl: number }>> {
    const state = await this.portfolio.load();
    this.riskManager.updatePortfolio(state);

    const { toClose, reasons } = this.riskManager.checkExits(state.positions, currentPrices);
    const results: Array<{ position: Position; exitPrice: number; reason: string; pnl: number }> = [];

    for (const pos of toClose) {
      const exitPrice = currentPrices[pos.tokenId] ?? pos.currentPrice;
      const reason = reasons[pos.tokenId] ?? 'Unknown';

      try {
        const closeResult = await this.portfolio.closePosition(pos.tokenId, exitPrice, reason);
        results.push({
          position: pos,
          exitPrice,
          reason,
          pnl: closeResult.pnl,
        });
      } catch (err) {
        console.error(chalk.red(`Failed to close ${pos.symbol}: ${(err as Error).message}`));
      }
    }

    return results;
  }

  /** Dry-run execution — paper trade */
  private async executeDryRun(order: OrderParams, currentPrice: number): Promise<Position> {
    const quantity = order.amountUsd / currentPrice;

    console.error(chalk.cyan(`[DRY RUN] Paper trade: BUY ${quantity.toFixed(6)} ${order.tokenId} @ $${currentPrice.toFixed(4)}`));
    console.error(chalk.cyan(`  Size: $${order.amountUsd.toFixed(2)} | SL: $${order.stopLoss.toFixed(4)} | TP: $${order.takeProfit.toFixed(4)}`));

    const position = await this.portfolio.openPosition({
      tokenId: order.tokenId,
      symbol: order.tokenId.toUpperCase(),
      entryPrice: currentPrice,
      currentPrice,
      quantity,
      entryTimestamp: Date.now(),
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      strategy: 'paper',
    });

    return position;
  }

  /** Live execution via DEX — placeholder */
  private async executeLive(_order: OrderParams): Promise<{ txHash: string; executedPrice: number }> {
    throw new Error(
      'Live execution not yet implemented. Use --dry-run for paper trading. ' +
      'Chain-specific DEX integration (Uniswap, Aerodrome, etc.) coming in Phase 4.',
    );
  }

  /** Format execution result for display */
  formatExecution(result: {
    success: boolean;
    position?: Position;
    error?: string;
    dryRun: boolean;
  }): string {
    const lines: string[] = [];
    const prefix = result.dryRun ? chalk.cyan('[DRY RUN]') : chalk.green('[LIVE]');

    if (result.success && result.position) {
      const p = result.position;
      lines.push('');
      lines.push(`${prefix} ${chalk.bold('Trade Executed')}`);
      lines.push(chalk.dim('─'.repeat(40)));
      lines.push(`Token: ${p.symbol}`);
      lines.push(`Entry: $${p.entryPrice.toFixed(4)}`);
      lines.push(`Quantity: ${p.quantity.toFixed(6)}`);
      lines.push(`Size: $${(p.quantity * p.entryPrice).toFixed(2)}`);
      lines.push(`Stop Loss: $${p.stopLoss.toFixed(4)}`);
      lines.push(`Take Profit: $${p.takeProfit.toFixed(4)}`);
      lines.push(`Strategy: ${p.strategy}`);
      lines.push('');
    } else {
      lines.push('');
      lines.push(`${prefix} ${chalk.red('Trade Failed')}`);
      lines.push(`Reason: ${result.error}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
