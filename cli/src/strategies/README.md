# Strategies

Purpose-built DeFi strategies that agents execute via the on-chain BatchExecutor.
Each strategy is a TypeScript module that constructs batched contract calls.

## How Strategies Work

```
Agent Brain (LLM + Messari data)
        ↓
Strategy Module (this directory)
  → Builds BatchCall[] from config
  → CLI simulates via eth_call
  → CLI shows preview to agent
        ↓
BatchExecutor Contract (on-chain)
  → Executes calls atomically
  → Target allowlist enforced
```

## Available Strategies

### Levered Swap (`levered-swap.ts`)

Leveraged long position using Moonwell + Uniswap on Base.

**Flow:**
1. Deposit USDC collateral into Moonwell
2. Borrow USDC against collateral
3. Swap borrowed USDC into target token on Uniswap
4. Monitor position (health factor, P&L, market sentiment)
5. Unwind: sell token → repay → withdraw

**Market Research:**
Uses [Messari API](https://docs.messari.io) for market intelligence:
- Signal API for sentiment + trending tokens
- Metrics API for price/volume data
- AI service for synthesis and research
- Auth: x402 (pay-per-request with USDC on Base) or API key

When the agent needs market research on a crypto project, it queries Messari.
See the [Messari OpenClaw skill](https://github.com/messari/skills) or
[Messari Claude skill](https://github.com/messari/skills/tree/master/claude).

**Required Allowlist Targets:**
- `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — USDC
- `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` — Moonwell mUSDC
- `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` — Moonwell Comptroller
- `0x2626664c2603336E57B271c5C0b26F421741e481` — Uniswap V3 SwapRouter
- Target token contract address

### Venice Fund (`venice-fund.ts`)

Swap vault profits to VVV, stake for sVVV, distribute to agents for Venice AI inference.
Used for **multi-agent** distribution via Uniswap routing.

**Flow:**
1. Approve SwapRouter to spend vault asset
2. Swap asset → WETH → VVV via Uniswap V3 (or single-hop if asset is WETH)
3. Approve Venice staking contract for VVV
4. Stake VVV directly to each agent's operator wallet (sVVV)
5. Agents provision Venice API keys with `sherwood venice provision`
6. Agents use `sherwood venice infer` for private inference

**Required Allowlist Targets:**
- Vault's deposit token (e.g., `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — USDC)
- `0x4200000000000000000000000000000000000006` — WETH
- `0x2626664c2603336E57B271c5C0b26F421741e481` — Uniswap V3 SwapRouter
- `0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf` — VVV Token
- `0x321b7ff75154472b18edb199033ff4d116f340ff` — Venice Staking (sVVV)

### Venice Inference Strategy (`VeniceInferenceStrategy.sol`)

On-chain ERC-1167 clonable strategy for **single-agent** VVV staking with governance proposal lifecycle.
Supports two execution paths:

1. **Direct:** Vault sends VVV → stake immediately (no swap infra needed)
2. **Swap:** Vault sends asset (e.g. USDC) → swap to VVV via Aerodrome → stake

**Lifecycle:**
```
Pending → execute() → Executed → settle() → Settled → claimVVV() → VVV back to vault
```

- **Execute:** pull asset → [swap if needed] → stake VVV to agent
- **Settle:** claw back sVVV → initiate unstake (cooldown begins)
- **Claim:** after cooldown, `claimVVV()` finalizes unstake, pushes VVV to vault

**Governance Proposal Path:**
```bash
sherwood venice fund --vault 0x... --amount 500 --write-calls ./calls.json
sherwood proposal create --execute-calls ./calls.json --settle-calls ./settle.json
```

**Batch calls (contract-level):**
- Execute: `[asset.approve(strategy, amount), strategy.execute()]`
- Settle: `[strategy.settle()]`
- Post-settlement: `strategy.claimVVV()` (anyone, after cooldown)

**Pre-requisite:** Agent must call `sVVV.approve(strategy, amount)` before proposal creation.

**Required Allowlist Targets (swap path):**
- Vault's deposit token (e.g., `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — USDC)
- `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` — Aerodrome Router
- `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` — Aerodrome Factory
- `0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf` — VVV Token
- `0x321b7ff75154472b18edb199033ff4d116f340ff` — Venice Staking (sVVV)
- Strategy clone address

## Adding New Strategies

1. Create a new `.ts` file in this directory
2. Export `buildEntryBatch()` and `buildExitBatch()` functions
3. Define the ABIs for protocols your strategy touches
4. Add required allowlist targets to the README
5. The on-chain contracts don't change — strategies are pure CLI code
