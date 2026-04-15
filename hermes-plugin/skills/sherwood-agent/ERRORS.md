# Error Handling

Common errors, causes, and fixes when using the Sherwood CLI.

## Setup Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Private key not found` | No key in config | `sherwood config set --private-key 0x...` |
| `Agent identity required` | No agentId saved | `sherwood identity mint --name "..."` |

## Permission Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `NotCreator` | Wallet isn't the syndicate creator | Use the creator wallet |
| `NotAllowedTarget` | Contract not in vault allowlist | `sherwood vault add-target --target 0x...` |
| `DepositorNotApproved` | LP not whitelisted | `sherwood syndicate approve-depositor --depositor 0x...` |

## Execution Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CapExceeded` | Batch exceeds vault caps | Lower amounts or update caps |
| `Simulation failed` | Batch would revert on-chain | Check caps, allowlist, token balances |
| `ERC721InvalidReceiver` | Vault can't receive NFTs | Vault includes ERC721Holder — redeploy if on old version |
| `Could not read decimals` | Invalid token address | Verify address is a valid ERC20 on Base |
| `Pinata upload failed` | IPFS metadata upload error | Check network; override with `PINATA_API_KEY` env var |

## Governance Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ProposalNotApproved` | Tried to execute a proposal that isn't approved | Wait for voting to end (optimistic = auto-passes) or check veto threshold |
| `ProposalNotVetoable` | Tried to veto a proposal that's already Executed/Settled/Cancelled | Can only veto Pending or Approved proposals |
| `NotVaultOwner` | Non-owner tried to veto or emergency settle | Must use the vault owner wallet |
| `StrategyAlreadyActive` | Tried to execute while another strategy is live | Wait for current strategy to settle first |
| `CooldownNotElapsed` | Tried to execute too soon after last settlement | Wait for cooldown period to pass |
| `ExecutionWindowExpired` | Tried to execute after the window closed | Proposal expired — submit a new one |

## Strategy Template Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `AlreadyInitialized` | Tried to initialize a strategy clone twice | Each clone can only be initialized once |
| `NotVault` | Non-vault address called `execute()` or `settle()` | Strategy must be called by the vault via batch calls |
| `NotProposer` | Non-proposer tried to `updateParams()` | Only the original proposer can tune parameters |
| `NotExecuted` | Tried to settle or update params before execution | Strategy must be in Executed state |
| `AlreadyExecuted` | Tried to execute an already-executed strategy | Each strategy executes once |
| `MintFailed` | Moonwell `mint()` returned non-zero error code | Check Moonwell market status, supply caps, approval |
| `RedeemFailed` | Moonwell `redeem()` returned non-zero error code | Check mToken balance, market liquidity |
| `GaugeMismatch` | Gauge's staking token doesn't match LP token | Verify gauge address corresponds to the correct pool |
| `InvalidAmount` | Zero supply amount or redeem below minimum | Check amounts; for settlement, update `minRedeemAmount` via `updateParams()` |

## Factory Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `InsufficientCreationFee` | Didn't send enough creation fee token | Check `creationFee()` and approve the fee token |
| `CreationFeeTransferFailed` | Fee token transfer failed | Ensure sufficient balance and approval |

## XMTP / Chat Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Conversation not found` | Stale XMTP installation — group welcome targeted old KeyPackage | Revoke stale installations, get re-added (see steps below) |
| `numSynced: 0` after sync | Welcome encrypted for wrong installation (db was nuked/reinstalled) | Same as above — revoke + re-add |
| `PRAGMA key or salt has incorrect value` | DB encryption key mismatch (`~/.xmtp/.env` was overwritten) | Delete `~/.xmtp/xmtp-db*` files (keep `.env`), re-run any chat command, then get re-added |
| `Association error: Missing identity update` | Wallet never registered on XMTP production | Non-fatal — run `sherwood chat <name> --chain base` to force registration |

### Stale installation fix (most common XMTP issue)

```bash
# 1. Find XMTP CLI bundled with sherwood
XMTP_CLI=$(find /usr/local/lib/node_modules/@sherwoodagent -name "run.js" -path "*xmtp*cli*" | head -1)

# 2. Get your current installation ID
node $XMTP_CLI client info --log-level off --env production

# 3. Check all installations — if >1 exists, stale ones must go
node $XMTP_CLI inbox-states <inbox-id> --log-level off --env production

# 4. Revoke stale installations (keep only current)
node $XMTP_CLI revoke-installations <inbox-id> -i <stale-id> --force --env production

# 5. Creator removes and re-adds you
#    sherwood chat <name> add <your-address> --chain base

# 6. Sync + clear stale group cache
node $XMTP_CLI conversations sync-all --env production --log-level off
# Edit ~/.sherwood/config.json → set "groupCache": {}
```

**Golden rule:** Never delete `~/.xmtp/` after being added to a group. Reinstalling the CLI (`npm i -g`) does NOT touch `~/.xmtp/`. If you must reset, only delete `xmtp-db*` files — never `.env` (contains your db encryption key). After any db reset you must get re-added to the group.
