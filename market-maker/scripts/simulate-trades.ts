import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  formatUnits,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// ── Config ──────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY missing from .env');

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';

const WOOD = '0x7865eEA4063c22d0F55FdD412D345495c7b73f64' as Address;
const WETH = '0xe8c19B62b80C9d2574c291923c1a12C3edf15bA5' as Address;
const SWAP_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as Address;
const POOL_FEE = 500; // 0.05%

// ── ABIs ────────────────────────────────────────────────────────────────
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// SwapRouter02 ABI (no deadline in struct - deadline is handled via multicall)
const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
]);

const POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
]);

const POOL_ADDRESS = '0xfc3409f7090e09937f64e2390995395c5367647c' as Address;

// ── Clients ─────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

// ── Helpers ─────────────────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min;
  const rand = BigInt(Math.floor(Math.random() * Number(range)));
  return min + rand;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  // price = (sqrtPriceX96 / 2^96)^2
  // This gives price of token1 in terms of token0 (WOOD per WETH)
  const num = Number(sqrtPriceX96);
  const denom = Number(2n ** 96n);
  const ratio = num / denom;
  return ratio * ratio;
}

async function getPrice(): Promise<number> {
  const slot0 = await publicClient.readContract({
    address: POOL_ADDRESS,
    abi: POOL_ABI,
    functionName: 'slot0',
  });
  const sqrtPriceX96 = slot0[0];
  // token0=WETH, token1=WOOD
  // sqrtPriceX96 gives price = token1/token0 (WOOD per WETH)
  // We want WETH per WOOD = 1/price
  const priceWoodPerWeth = sqrtPriceX96ToPrice(sqrtPriceX96);
  const priceWethPerWood = 1 / priceWoodPerWeth;
  return priceWethPerWood;
}

// ── Approvals ───────────────────────────────────────────────────────────
async function ensureApproval(token: Address, label: string) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, SWAP_ROUTER],
  });

  const MAX = 2n ** 256n - 1n;
  if (allowance < MAX / 2n) {
    console.log(`Approving ${label} to SwapRouter...`);
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SWAP_ROUTER, MAX],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${label} approved: ${hash}`);
  } else {
    console.log(`${label} already approved`);
  }
}

// ── Swap ────────────────────────────────────────────────────────────────
async function doSwap(sellWood: boolean) {
  const tokenIn = sellWood ? WOOD : WETH;
  const tokenOut = sellWood ? WETH : WOOD;

  let amountIn: bigint;
  if (sellWood) {
    // Sell 1 - 10 WOOD (18 decimals) - small amounts to preserve balance
    const woodAmount = randomInt(1, 5);
    amountIn = BigInt(woodAmount) * 10n ** 18n;
    console.log(`\nSelling ${woodAmount} WOOD for ETH...`);
  } else {
    // Buy with 0.000003 - 0.000015 ETH (matches ~1-5 WOOD sell value)
    // 3e12 - 15e12 wei
    amountIn = randomBigInt(3000000000000n, 15000000000000n);
    console.log(`\nBuying WOOD with ${formatEther(amountIn)} ETH...`);
  }

  try {
    const hash = await walletClient.writeContract({
      address: SWAP_ROUTER,
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee: POOL_FEE,
          recipient: account.address,
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    console.log(`  tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  status: ${receipt.status}, gas: ${receipt.gasUsed}`);

    const price = await getPrice();
    console.log(`  WOOD price: ${price.toExponential(6)} ETH`);
    console.log(`  timestamp: ${new Date().toISOString()}`);
  } catch (err: any) {
    console.error(`  Swap failed: ${err.shortMessage || err.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== WOOD/WETH Price Simulator ===');
  console.log(`Wallet: ${account.address}`);
  console.log(`Pool:   ${POOL_ADDRESS}`);
  console.log(`Router: ${SWAP_ROUTER}`);
  console.log('');

  // Check balances
  const woodBal = await publicClient.readContract({
    address: WOOD,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const ethBal = await publicClient.getBalance({ address: account.address });
  console.log(`WOOD balance: ${formatUnits(woodBal, 18)}`);
  console.log(`ETH balance:  ${formatEther(ethBal)}`);
  console.log('');

  // Get initial price
  const initialPrice = await getPrice();
  console.log(`Initial WOOD price: ${initialPrice.toExponential(6)} ETH`);
  console.log('');

  // Approve tokens
  await ensureApproval(WOOD, 'WOOD');
  // Small delay to avoid nonce collision
  await sleep(3000);
  await ensureApproval(WETH, 'WETH');
  console.log('');

  console.log('Starting swap loop (Ctrl+C to stop)...\n');

  let swapCount = 0;
  while (true) {
    swapCount++;

    // 50/50 sell/buy for balanced price action
    const sellWood = Math.random() < 0.5;

    console.log(`--- Swap #${swapCount} ---`);
    await doSwap(sellWood);

    // Random interval 15-30 seconds
    const delayMs = randomInt(15000, 30000);
    console.log(`  Next swap in ${(delayMs / 1000).toFixed(0)}s...`);
    await sleep(delayMs);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
