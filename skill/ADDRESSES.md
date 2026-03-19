# Contract Addresses

Resolved at runtime in `cli/src/lib/addresses.ts` based on `--chain` flag. See [docs/deployments.md](../docs/deployments.md) for the full feature matrix.

## Sherwood Protocol

| Contract | Base Sepolia | Robinhood L2 Testnet |
|----------|-------------|---------------------|
| SyndicateFactory | `0x60bf54dDce61ece85BE5e66CBaA17cC312DEa6C8` | `0xD348524c66e209DfcC76b9a3208a05B82F6948D6` |
| StrategyRegistry | `0xf1e6E9bd1a735B54F383b18ad6603Ddd566C71cE` | `0xC6744E4941f4810fDadB72c795aD3EE7cb55D925` |
| SyndicateGovernor | `0xB478cdb99260F46191C9e5Da405F7E70eEA23dE4` | `0x866996c808E6244216a3d0df15464FCF5d495394` |

## Base Mainnet

| Contract | Address |
|----------|---------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| WETH | `0x4200000000000000000000000000000000000006` |
| Moonwell Comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Moonwell mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` |
| Moonwell mWETH | `0x628ff693426583D9a7FB391E54366292F509D457` |
| Uniswap SwapRouter | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Uniswap QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| VVV | `0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf` |
| VVV Staking (sVVV) | `0x321b7ff75154472b18edb199033ff4d116f340ff` |

## Base Sepolia

| Contract | Address |
|----------|---------|
| USDC (test) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| WETH | `0x4200000000000000000000000000000000000006` |
| Uniswap SwapRouter | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |

## Robinhood L2 Testnet

| Contract | Address |
|----------|---------|
| WETH | `0x7943e237c7F95DA44E0301572D358911207852Fa` |

No USDC, Moonwell, Uniswap, Venice, ENS, ERC-8004, or EAS on this chain.

## EAS (Ethereum Attestation Service)

Base predeploys (same on mainnet and Sepolia, not available on Robinhood L2):

| Contract | Address |
|----------|---------|
| EAS | `0x4200000000000000000000000000000000000021` |
| SchemaRegistry | `0x4200000000000000000000000000000000000020` |

Schema UIDs differ per network — stored in `cli/src/lib/addresses.ts`.

## ERC-8004 Identity (Base only)

| Contract | Base Mainnet | Base Sepolia |
|----------|-------------|--------------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Allowlist Targets by Strategy

### Levered Swap (Moonwell + Uniswap) — Base only

```bash
sherwood vault add-target --target 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  # USDC
sherwood vault add-target --target 0x4200000000000000000000000000000000000006  # WETH
sherwood vault add-target --target 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22  # Moonwell mUSDC
sherwood vault add-target --target 0x628ff693426583D9a7FB391E54366292F509D457  # Moonwell mWETH
sherwood vault add-target --target 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C  # Moonwell Comptroller
sherwood vault add-target --target 0x2626664c2603336E57B271c5C0b26F421741e481  # Uniswap SwapRouter
```

### Venice Funding (VVV Staking) — Base only

```bash
sherwood vault add-target --target 0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf  # VVV token
sherwood vault add-target --target 0x321b7ff75154472b18edb199033ff4d116f340ff  # VVV Staking (sVVV)
```
