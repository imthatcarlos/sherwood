# Sherwood Market Maker

Avellaneda-Stoikov inspired concentrated liquidity market maker for the WOOD/WETH pool on Aerodrome Slipstream (Base).

## Key Design

- **Asymmetric inventory**: WOOD is the protocol's token (free to mint), ETH is scarce. The strategy protects ETH at all costs while being liberal with WOOD deployment.
- **Adaptive gamma**: Higher gamma when holding excess WOOD (eager to sell), lower when holding excess ETH (comfortable).
- **Risk management**: Kill switch on ETH floor, drawdown limits, TWAP manipulation detection, cooldown between rebalances.

## Setup

1. Copy `.env.example` to `.env` and fill in values:

```
cp .env.example .env
```

2. Required env vars:
   - `PRIVATE_KEY` - Bot wallet private key (with 0x prefix)
   - `POOL_ADDRESS` - WOOD/WETH Slipstream pool address
   - `WOOD_ADDRESS` - WOOD token contract address

3. Install dependencies:

```
npm install
```

4. Run in dry-run mode (default):

```
npx tsx src/index.ts
```

5. For live trading, set `DRY_RUN=false` in `.env`.

## Architecture

```
src/
  index.ts          - Entry point
  config.ts         - Configuration from env vars
  types.ts          - TypeScript interfaces
  core/
    pricing.ts      - Avellaneda-Stoikov pricing engine
    inventory.ts    - Inventory tracking and skew
    risk.ts         - Risk management and kill switch
  pool/
    slipstream.ts   - Pool state reading
    positions.ts    - NFT position management
    math.ts         - Tick/price math
  bot/
    runner.ts       - Main bot loop
    logger.ts       - Pino structured logging
  abis/             - Contract ABIs
```

## Strategy

Every 30 seconds:
1. Read pool state and current position
2. Compute realized volatility (EWMA)
3. Compute inventory skew (WOOD vs ETH ratio)
4. Run Avellaneda-Stoikov to get optimal bid/ask ticks
5. Check rebalance triggers (price exit, range shift, time)
6. If rebalance needed and risk checks pass: burn old → mint new
7. Otherwise: collect accrued fees

## Risk Controls

- **ETH floor**: Halts if ETH drops below minimum reserve
- **Max drawdown**: Halts if portfolio drops >X% from peak
- **TWAP deviation**: Pauses if spot deviates >Y% from TWAP
- **Cooldown**: Minimum 5 min between rebalances
- **Dry run**: Default mode computes everything without submitting txs
