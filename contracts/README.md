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
forge test           # Run all tests (70 tests)
forge test -vvv      # Verbose output with traces
forge test --match-test test_deposit   # Run specific tests
```

### Format

```bash
forge fmt            # Format all Solidity files
forge fmt --check    # Check formatting without modifying
```

### Deploy

Deploy to Base Sepolia:

```bash
forge script script/testnet/Deploy.s.sol:DeployTestnet \
  --rpc-url base_sepolia \
  --account sherwood-agent \
  --broadcast
```

Deploy to Robinhood L2 testnet (no ENS, no ERC-8004):

```bash
forge script script/robinhood-testnet/Deploy.s.sol:DeployRobinhoodTestnet \
  --rpc-url robinhood_testnet \
  --account sherwood-agent \
  --broadcast
```

The deploy scripts:
1. Deploy `BatchExecutorLib` (shared, stateless)
2. Deploy `SyndicateVault` implementation
3. Deploy `SyndicateGovernor` (UUPS proxy)
4. Deploy `SyndicateFactory` (registers executor, vault impl, ENS registrar, agent registry)
5. Deploy `StrategyRegistry` (UUPS proxy)

On chains without ENS or ERC-8004 (e.g. Robinhood L2), the factory and vault accept `address(0)` for optional registries and skip identity/ENS checks.

Protocol addresses are resolved at runtime in `cli/src/lib/addresses.ts`.
Deployment records saved in `contracts/chains/{chainId}.json`.

### Gas Snapshots

```bash
forge snapshot
```

## Deployed Addresses

See [docs/deployments.md](../docs/deployments.md) for the full multi-chain address table.

### Sherwood Contracts

| Contract | Base Sepolia | Robinhood L2 Testnet |
|----------|-------------|---------------------|
| SyndicateFactory | `0x60bf54dDce61ece85BE5e66CBaA17cC312DEa6C8` | `0xD348524c66e209DfcC76b9a3208a05B82F6948D6` |
| StrategyRegistry | `0xf1e6E9bd1a735B54F383b18ad6603Ddd566C71cE` | `0xC6744E4941f4810fDadB72c795aD3EE7cb55D925` |
| SyndicateGovernor | `0xB478cdb99260F46191C9e5Da405F7E70eEA23dE4` | `0x866996c808E6244216a3d0df15464FCF5d495394` |

## Tests

70 tests across 2 test suites:

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

### SyndicateFactory (21 tests)

- Syndicate creation with full config + ENS subname registration
- ERC-8004 agent identity verification on create
- Metadata updates
- Syndicate deactivation
- Vault functionality through factory-created proxies
- Depositor gating on factory-created vaults
- Storage isolation between syndicates
- Subdomain availability checks
- No-registry deployment (address(0) for ENS/ERC-8004, e.g. Robinhood L2)

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
