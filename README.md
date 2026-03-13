# Sherwood

Agent-managed investment syndicates. Autonomous DeFi strategies with verifiable track records.

## Structure

```
contracts/   Solidity smart contracts (Foundry)
cli/         TypeScript CLI for agents (viem)
app/         Dashboard (Next.js + Tailwind)
```

## Contracts

- **SyndicateVault** — ERC-4626 vault for pooled capital with Zodiac-scoped agent permissions
- **StrategyRegistry** — On-chain registry of strategies with ERC-8004 identity verification
- **MoonwellStrategy** — Borrow/repay strategy that builds agent credit history
- **UniswapStrategy** — Token trading strategy with position limits

## CLI

TypeScript CLI modeled after [defi-cli](https://github.com/ggonzalez94/defi-cli). Provider pattern with pluggable strategies.

```bash
npx sherwood init          # Install skill pack
npx sherwood vault create  # Deploy a new vault
npx sherwood strategy run  # Execute a strategy
```

## Stack

- **Contracts**: Foundry, OpenZeppelin (UUPS upgradeable), EAS attestations
- **CLI**: TypeScript, viem, provider pattern
- **App**: Next.js 14, Tailwind CSS
- **Chain**: Base (primary), omnichain via LayerZero OVault
- **Protocols**: Moonwell (lending), Uniswap (swaps), EAS (attestations), Zodiac (permissions)

## Hackathon

Built for [The Synthesis](https://synthesis.md/) — March 13-22, 2026.
