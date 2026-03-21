# Sherwood Contracts

Solidity smart contracts for agent-managed investment syndicates on Base. Built with Foundry and OpenZeppelin (UUPS upgradeable).

## Contracts

| Contract | Description |
|----------|-------------|
| **SyndicateVault** | ERC-4626 vault with two-layer permission model. Holds all positions via delegatecall. ERC721Holder (receives ENS subname NFTs). Depositor whitelist, agent management, syndicate-level + per-agent caps, daily spend tracking, ragequit. |
| **SyndicateFactory** | Deploys vault proxies in one tx. Registers ENS subnames. Verifies ERC-8004 agent identity on creation. Tracks active/inactive state. |
| **BatchExecutorLib** | Shared stateless library. Vault delegatecalls into it to execute batches of protocol calls (supply, borrow, swap, etc). Target allowlist enforced. |
| **StrategyRegistry** | On-chain registry of strategies. Permissionless registration with creator tracking (for future carry fees). |

### Interfaces

- `ISyndicateVault.sol` — Full vault interface including events
- `IStrategyRegistry.sol` — Strategy registration and lookup

### Architecture

```
                   ┌──────────────┐
                   │   Factory    │ ── creates vault proxies
                   └──────┬───────┘
                          │
              ┌───────────▼───────────┐
              │    SyndicateVault     │ ── ERC-4626, holds all positions
              │  (ERC1967 Proxy)      │
              │                       │
              │  delegatecall ───────►│── BatchExecutorLib (stateless)
              │                       │     target.call(data)
              └───────────────────────┘
```

- **Vault is the identity** — all DeFi positions (Moonwell supply/borrow, Uniswap LP, etc.) live on the vault address.
- **Delegatecall pattern** — vault calls the shared `BatchExecutorLib` via delegatecall. The lib is stateless; execution context is the vault.
- **Two-layer permissions** — on-chain caps (vault enforces maxPerTx, maxDailyTotal, maxBorrowRatio) + off-chain policies (Lit Actions).
- **UUPS upgradeable** — vault implementation can be upgraded. Never reorder storage slots.

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)

### Build

```bash
cd contracts
forge build
```

### Test

```bash
forge test           # Run all tests (66 tests)
forge test -vvv      # Verbose output with traces
forge test --match-test test_deposit   # Run specific tests
```

### Format

```bash
forge fmt            # Format all Solidity files
forge fmt --check    # Check formatting without modifying
```

### Deploy

Deploy to Base Sepolia (testnet):

```bash
forge script script/testnet/Deploy.s.sol:DeployTestnet \
  --rpc-url base_sepolia \
  --account sherwood-agent \
  --broadcast
```

The deploy script:
1. Deploys `BatchExecutorLib` (shared, stateless)
2. Deploys `SyndicateVault` implementation
3. Deploys `SyndicateFactory` (registers executor, vault impl, ENS registrar, agent registry)
4. Deploys `StrategyRegistry` (UUPS proxy)

Protocol addresses are hardcoded in `cli/src/lib/addresses.ts` (bundled with CLI).
Deployment records saved in `contracts/chains/{chainId}.json`.

### Gas Snapshots

```bash
forge snapshot
```

## Deployed Addresses

### Sherwood Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| SyndicateFactory | `0x2efD194ADb3Db40E0e6faAe06c4e602c7a3D9199` |
| SyndicateGovernor | `0x6fc67a9aD15eD3A9DE25c29CCe10D662079129E2` |
| BatchExecutorLib | `0xd5C4eE2E4c5B606b9401E69A3B3FeE169037C284` |

### Sherwood Contracts (Robinhood L2 Testnet)

| Contract | Address |
|----------|---------|
| SyndicateFactory | `0xea644E2Bc0215fC73B11f52CB16a87334B0922E6` |
| SyndicateGovernor | `0x5cBE8269CfF68D52329B8E0F9174F893627AFf0f` |
| BatchExecutorLib | `0x70d0E510454eE246BFCFD53F2204f2487B19a137` |

### External Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| WETH | `0x4200000000000000000000000000000000000006` |
| Moonwell Comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Moonwell mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` |
| Uniswap V3 SwapRouter | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

## Tests

66 tests across 2 test suites:

### SyndicateVault (49 tests)

- ERC-4626 deposits and withdrawals
- Agent registration (with ERC-8004 identity verification), removal, and cap enforcement
- Batch execution via delegatecall with target allowlist
- Syndicate-level and per-agent daily spend tracking
- Ragequit (pro-rata exit)
- Depositor whitelist (approve, remove, batch approve, open deposits toggle)
- Total deposited tracking (increments on deposit, decrements on withdraw/ragequit)
- Pause/unpause
- Simulation (dry-run via eth_call)
- Fuzz testing (cap enforcement)

### SyndicateFactory (17 tests)

- Syndicate creation with full config + ENS subname registration
- ERC-8004 agent identity verification on create
- Metadata updates
- Syndicate deactivation
- Vault functionality through factory-created proxies
- Depositor gating on factory-created vaults
- Storage isolation between syndicates
- Subdomain availability checks

## Subgraph

The Graph subgraph for indexed queries lives at `contracts/subgraph/`. See [docs/subgraph.md](../docs/subgraph.md) for available queries and schema reference.

### Build

```bash
cd contracts/subgraph
npm install
npx graph codegen && npx graph build
```

### Deploy

1. Create a subgraph at [The Graph Studio](https://thegraph.com/studio/) (network: Base)
2. Auth: `npx graph auth --studio <DEPLOY_KEY>`
3. Update `subgraph.yaml` with your factory address and deployment block
4. Deploy: `npx graph deploy --studio sherwood-syndicates`
5. Set `SUBGRAPH_URL` in `cli/.env` to the query endpoint from Studio

### Updating ABIs

The subgraph reads ABIs directly from Foundry output artifacts (`../out/SyndicateFactory.sol/SyndicateFactory.json`). After changing contracts:

```bash
forge build
cd subgraph && npx graph codegen && npx graph build
```

## Storage Layout (UUPS Safety)

When modifying `SyndicateVault`, always append new storage variables at the end. Never reorder or remove existing slots.

Current layout:
```
Slot  Variable
───── ─────────────────────────
inherited  ERC4626Upgradeable storage
inherited  OwnableUpgradeable storage
inherited  PausableUpgradeable storage
inherited  UUPSUpgradeable storage
1     _executorImpl (address)
2     _syndicateCaps (SyndicateCaps struct)
3     _agents (mapping)
4     _agentAddresses (address[])
5     _dailySpendTotal (uint256)
6     _lastResetDay (uint256)
7     _allowedTargets (EnumerableSet)
8     _approvedDepositors (EnumerableSet)
9     _openDeposits (bool)
```
