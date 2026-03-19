# Contracts

Solidity smart contracts for Sherwood, built with Foundry and OpenZeppelin (UUPS upgradeable). Contracts deploy on Base and Robinhood L2. See [Deployments](deployments.md) for the full chain matrix.

## Architecture

```
                   ┌──────────────┐
                   │   Factory    │ ── deploys vault proxies, registers ENS subnames
                   └──────┬───────┘
                          │
              ┌───────────▼───────────┐
              │    SyndicateVault     │ ── ERC-4626, holds all DeFi positions
              │  (ERC1967 Proxy)      │
              │                       │
              │  delegatecall ───────►│── BatchExecutorLib (stateless)
              │                       │     target.call(data)
              └───────────────────────┘
```

The vault is the identity — all DeFi positions (Moonwell supply/borrow, Uniswap swaps, Venice staking) live on the vault address. Agents execute through the vault via delegatecall into a shared stateless library.

## Contracts

### SyndicateVault

ERC-4626 vault with two-layer permission model. Extends `ERC4626Upgradeable`, `OwnableUpgradeable`, `PausableUpgradeable`, `UUPSUpgradeable`, `ERC721Holder`.

**Permissions:**
- **Layer 1 (onchain):** Syndicate caps (`maxPerTx`, `maxDailyTotal`, `maxBorrowRatio`) + per-agent caps + target allowlist
- **Layer 2 (offchain):** Lit Action policies on agent PKP wallets

**Key functions:**
- `executeBatch(calls, assetAmount)` — delegatecalls to BatchExecutorLib. Enforces caps and target allowlist.
- `simulateBatch(calls)` — dry-run via `eth_call`, returns success/failure per call without submitting onchain
- `ragequit(receiver)` — LP emergency exit, burns all shares for pro-rata assets
- `registerAgent(agentId, pkp, eoa, limits)` — registers agent with ERC-8004 identity verification
- `deposit(assets, receiver)` / `withdraw(assets, receiver, owner)` — standard ERC-4626 with `totalDeposited` tracking

**Storage:**
- `_syndicateCaps` — syndicate-wide spending limits
- `_agents` mapping — pkp address → `AgentConfig` (agentId, operatorEOA, limits, active)
- `_allowedTargets` — `EnumerableSet` of whitelisted protocol addresses
- `_approvedDepositors` — `EnumerableSet` of whitelisted depositor addresses
- `_openDeposits` — bool toggle for permissionless deposits
- `_dailySpendTotal` / `_lastResetDay` — rolling daily spend tracking
- `totalDeposited` — cumulative deposits minus withdrawals (for profit calculation)

### SyndicateFactory

Deploys vault proxies (ERC1967) in one transaction. Optionally registers ENS subnames and verifies ERC-8004 identity (skipped when registries are `address(0)`, e.g. on Robinhood L2).

**Storage:**
- `syndicates[]` — syndicate ID → struct (vault, creator, metadata, subdomain, active)
- `vaultToSyndicate` — reverse lookup from vault address
- `subdomainToSyndicate` — reverse lookup from ENS subdomain

### BatchExecutorLib

Shared stateless library. Vault delegatecalls into it to execute batches of protocol calls (supply, borrow, swap, stake). Each call's target must be in the vault's allowlist.

### StrategyRegistry

Onchain registry of strategy implementations. Permissionless registration with creator tracking (for future carry fees). UUPS upgradeable.

## Deployed Addresses

See [Deployments](deployments.md) for the complete multi-chain address table, feature matrix, and token availability.

## Testing

70 tests across 2 test suites.

```bash
cd contracts
forge build        # compile
forge test         # run all tests
forge test -vvv    # verbose with traces
forge fmt          # format before committing
```

**SyndicateVault (49 tests):** ERC-4626 deposits/withdrawals, agent registration with ERC-8004 verification, batch execution with target allowlist, syndicate + per-agent daily spend tracking, ragequit, depositor whitelist, total deposited tracking, pause/unpause, simulation, fuzz testing.

**SyndicateFactory (21 tests):** Syndicate creation with ENS subname registration, ERC-8004 verification on create, metadata updates, deactivation, proxy storage isolation, subdomain availability, no-registry deployment (Robinhood L2).

## Deployment

Base Sepolia:
```bash
forge script script/testnet/Deploy.s.sol:DeployTestnet \
  --rpc-url base_sepolia \
  --account sherwood-agent \
  --broadcast
```

Robinhood L2 testnet (no ENS, no ERC-8004 — registries set to `address(0)`):
```bash
forge script script/robinhood-testnet/Deploy.s.sol:DeployRobinhoodTestnet \
  --rpc-url robinhood_testnet \
  --account sherwood-agent \
  --broadcast
```

Deployment records saved in `contracts/chains/{chainId}.json`.

## Storage Layout (UUPS Safety)

When modifying `SyndicateVault`, always append new storage variables at the end. Never reorder or remove existing slots. See `contracts/README.md` for the full slot map.
