/**
 * FIX 6: State persistence - save/load bot state to JSON file.
 * Handles missing/corrupt files gracefully by starting fresh.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from './logger.js';
import type { BotState, PricePoint, PnLData } from '../types.js';

// Resolve relative to project root (2 levels up from src/bot/)
const STATE_DIR = resolve(import.meta.dirname ?? '.', '../../data');
const STATE_FILE = resolve(STATE_DIR, 'bot-state.json');

/** Serializable version of BotState (bigints as strings) */
interface SerializedBotState {
  activeTokenId: string | null;
  lastRebalanceTime: number;
  peakPortfolioValue: number;
  priceHistory: Array<{
    timestamp: number;
    price: number;
    tick: number;
    blockNumber: string;
  }>;
  cycleCount: number;
  halted: boolean;
  haltReason?: string;
  pnl: PnLData;
}

function defaultPnL(): PnLData {
  return {
    totalFeesEth: 0,
    totalGasEth: 0,
    netPnlEth: 0,
    cyclesTracked: 0,
    firstCycleTime: 0,
    lastCycleTime: 0,
  };
}

export function defaultBotState(): BotState {
  return {
    activeTokenId: null,
    lastRebalanceTime: 0,
    peakPortfolioValue: 0,
    priceHistory: [],
    cycleCount: 0,
    halted: false,
    pnl: defaultPnL(),
  };
}

/** Serialize BotState for JSON (convert bigints to strings) */
function serialize(state: BotState): SerializedBotState {
  return {
    activeTokenId: state.activeTokenId !== null ? state.activeTokenId.toString() : null,
    lastRebalanceTime: state.lastRebalanceTime,
    peakPortfolioValue: state.peakPortfolioValue,
    priceHistory: state.priceHistory.slice(-200).map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      tick: p.tick,
      blockNumber: p.blockNumber.toString(),
    })),
    cycleCount: state.cycleCount,
    halted: state.halted,
    haltReason: state.haltReason,
    pnl: state.pnl,
  };
}

/** Deserialize JSON back to BotState (convert strings to bigints) */
function deserialize(data: SerializedBotState): BotState {
  return {
    activeTokenId: data.activeTokenId !== null ? BigInt(data.activeTokenId) : null,
    lastRebalanceTime: data.lastRebalanceTime,
    peakPortfolioValue: data.peakPortfolioValue,
    priceHistory: (data.priceHistory || []).slice(-200).map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      tick: p.tick,
      blockNumber: BigInt(p.blockNumber),
    })),
    cycleCount: data.cycleCount || 0,
    halted: data.halted || false,
    haltReason: data.haltReason,
    pnl: data.pnl || defaultPnL(),
  };
}

/** Load state from disk. Returns default state if file missing or corrupt. */
export function loadState(): BotState {
  try {
    if (!existsSync(STATE_FILE)) {
      logger.info({ path: STATE_FILE }, 'No state file found, starting fresh');
      return defaultBotState();
    }

    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SerializedBotState;
    const state = deserialize(parsed);

    logger.info(
      {
        cycleCount: state.cycleCount,
        activeTokenId: state.activeTokenId?.toString() ?? 'none',
        halted: state.halted,
      },
      'Loaded persisted state',
    );

    return state;
  } catch (error) {
    logger.warn({ error, path: STATE_FILE }, 'Failed to load state file, starting fresh');
    return defaultBotState();
  }
}

/** Save state to disk. Creates data/ directory if needed. */
export function saveState(state: BotState): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }

    const serialized = serialize(state);
    writeFileSync(STATE_FILE, JSON.stringify(serialized, null, 2), 'utf-8');

    logger.debug({ path: STATE_FILE, cycle: state.cycleCount }, 'State saved');
  } catch (error) {
    logger.error({ error, path: STATE_FILE }, 'Failed to save state file');
  }
}
