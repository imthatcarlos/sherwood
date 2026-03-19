# Deployments

Sherwood deploys across multiple chains. Vaults and governance are chain-native. Identity (ERC-8004) and attestations (EAS) live on Base.

## Supported Chains

| Chain | ID | Type | Status |
|-------|----|------|--------|
| Base | 8453 | Mainnet | Pending |
| Base Sepolia | 84532 | Testnet | Active |
| Robinhood L2 | 46630 | Testnet | Active |

### CLI chain selection

```bash
sherwood --chain base              # default
sherwood --chain base-sepolia      # Base Sepolia testnet
sherwood --chain robinhood-testnet # Robinhood L2 testnet
sherwood --testnet                 # alias for --chain base-sepolia (deprecated)
```

Testnets require `ENABLE_TESTNET=true` in your environment.

## Feature Matrix

Not all chains have the same protocol integrations. The CLI handles this gracefully — commands that depend on unavailable features fail with a clear error.

| Feature | Base | Base Sepolia | Robinhood L2 |
|---------|------|-------------|--------------|
| Vaults + Factory | Pending | Yes | Yes |
| Governor (proposals, voting) | Pending | Yes | Yes |
| Strategy Registry | Pending | Yes | Yes |
| ERC-8004 Identity | Yes | Yes | No |
| EAS Attestations | Yes | Yes | No |
| ENS Subnames (Durin) | Pending | Yes | No |
| Moonwell (lending) | Yes | No | No |
| Uniswap V3 (swaps) | Yes | Yes | No |
| Venice (sVVV staking) | Yes | No | No |
| XMTP Chat | Yes | Yes | Yes |
| USDC | Yes | Yes | No |
| WETH | Yes | Yes | Yes |

### Key differences

**Base / Base Sepolia** — Full-featured. Identity (ERC-8004), attestations (EAS), ENS subnames, DeFi integrations (Moonwell, Uniswap, Venice). USDC is the default vault asset.

**Robinhood L2 (Arbitrum Orbit, chain 46630)** — Vaults and governance only. No identity verification, no EAS, no ENS registration, no DeFi integrations. Contracts accept `address(0)` for optional registries and skip those checks. WETH is the default vault asset (no USDC deployed). Useful for testing vault mechanics and governance in isolation.

## Deployed Addresses

### Sherwood Contracts

| Contract | Base Sepolia | Robinhood L2 Testnet |
|----------|-------------|---------------------|
| SyndicateFactory | `0x60bf54dDce61ece85BE5e66CBaA17cC312DEa6C8` | `0xD348524c66e209DfcC76b9a3208a05B82F6948D6` |
| StrategyRegistry | `0xf1e6E9bd1a735B54F383b18ad6603Ddd566C71cE` | `0xC6744E4941f4810fDadB72c795aD3EE7cb55D925` |
| SyndicateGovernor | `0xB478cdb99260F46191C9e5Da405F7E70eEA23dE4` | `0x866996c808E6244216a3d0df15464FCF5d495394` |
| SyndicateVault (impl) | — | `0xdEA3c33e2e2E115D2546b20C1d99944dF398853B` |
| BatchExecutorLib | — | `0x2483E3CF74c61314770F4313D4Cb745211076aa1` |

### Tokens

| Token | Base | Base Sepolia | Robinhood L2 |
|-------|------|-------------|--------------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | N/A |
| WETH | `0x4200000000000000000000000000000000000006` | `0x4200000000000000000000000000000000000006` | `0x7943e237c7F95DA44E0301572D358911207852Fa` |

### Infrastructure

| Contract | All Chains |
|----------|-----------|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

### External Protocols (Base only)

| Contract | Address |
|----------|---------|
| Moonwell Comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Uniswap V3 SwapRouter | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| VVV Token | `0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf` |

### Identity & Attestations (Base only)

| Contract | Base | Base Sepolia |
|----------|------|-------------|
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| EAS | `0x4200000000000000000000000000000000000021` | `0x4200000000000000000000000000000000000021` |

## Deployment Records

Per-chain deployment records are stored in `contracts/chains/{chainId}.json`. These contain deployer address, contract addresses, and deployment date.

## Address Resolution

All addresses are resolved at runtime in `cli/src/lib/addresses.ts` based on the active `--chain`. Each address family is a `Record<Network, ...>` map:

```
TOKENS()           → USDC, WETH, cbETH, etc.
MOONWELL()         → Comptroller, mTokens
UNISWAP()          → SwapRouter, QuoterV2
SHERWOOD()         → Factory, StrategyRegistry, Governor
AGENT_REGISTRY()   → IdentityRegistry, ReputationRegistry
EAS_CONTRACTS()    → EAS, SchemaRegistry
EAS_SCHEMAS()      → Schema UIDs
VENICE()           → VVV, Staking, DIEM
ENS()              → L2Registrar, L2Registry
INFRA()            → Multicall3
```

Zero addresses (`0x000...000`) indicate the protocol is not deployed on that chain. Commands that depend on zeroed addresses fail with a clear error at runtime.

## Adding a New Chain

1. Define the chain in `cli/src/lib/network.ts` (add to `ChainConfig` registry)
2. Add address entries in `cli/src/lib/addresses.ts` (all `Record<Network, ...>` maps)
3. If contracts skip registries: ensure `SyndicateFactory` and `SyndicateVault` handle `address(0)` (already supported)
4. Create deployment script in `contracts/script/<chain>/Deploy.s.sol`
5. Add RPC endpoint to `contracts/foundry.toml`
6. Deploy and save record to `contracts/chains/{chainId}.json`
