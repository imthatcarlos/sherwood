/**
 * Position management: mint, burn, rebalance, collect fees.
 * Interacts with the Slipstream NonfungiblePositionManager.
 */

import {
  type Address,
  type Hash,
  maxUint128,
  maxUint256,
  encodeFunctionData,
} from 'viem';
import { getNFPManagerABI } from '../abis/NonfungiblePositionManager.js';
import { ERC20ABI } from '../abis/ERC20.js';
import type { Position, MintParams } from '../types.js';
import { logger } from '../bot/logger.js';
import { config } from '../config.js';
import { computeAmount0ForLiquidity, computeAmount1ForLiquidity, tickToSqrtPriceX96 } from '../pool/math.js';

const MAX_UINT128 = maxUint128;

// Resolve the ABI once at module load
const NonfungiblePositionManagerABI = getNFPManagerABI();

export class PositionManager {
  constructor(
    private publicClient: any,
    private walletClient: any,
    private nfpManagerAddress: Address,
    private botAddress: Address,
  ) {}

  /** Get all position token IDs owned by the bot */
  async getOwnedTokenIds(): Promise<bigint[]> {
    const balance = await this.publicClient.readContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'balanceOf',
      args: [this.botAddress],
    }) as bigint;
    const count = Number(balance);
    const tokenIds: bigint[] = [];

    for (let i = 0; i < count; i++) {
      const tokenId = await this.publicClient.readContract({
        address: this.nfpManagerAddress,
        abi: NonfungiblePositionManagerABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [this.botAddress, BigInt(i)],
      }) as bigint;
      tokenIds.push(tokenId);
    }

    return tokenIds;
  }

  /** Read position details from NFP Manager */
  async getPosition(tokenId: bigint): Promise<Position> {
    const result = await this.publicClient.readContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'positions',
      args: [tokenId],
    }) as any[];

    return {
      tokenId,
      nonce: BigInt(result[0]),
      operator: result[1],
      token0: result[2],
      token1: result[3],
      // Uni V3 returns fee at index 4, Slipstream returns tickSpacing
      tickSpacing: config.useUniswapV3 ? 0 : Number(result[4]),
      fee: config.useUniswapV3 ? Number(result[4]) : undefined,
      tickLower: Number(result[5]),
      tickUpper: Number(result[6]),
      liquidity: result[7],
      feeGrowthInside0LastX128: result[8],
      feeGrowthInside1LastX128: result[9],
      tokensOwed0: result[10],
      tokensOwed1: result[11],
    };
  }

  /** Ensure token approval for the NFP Manager (W6: maxUint256, check first) */
  async ensureApproval(tokenAddress: Address, amount: bigint): Promise<void> {
    const allowance = await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20ABI,
      functionName: 'allowance',
      args: [this.botAddress, this.nfpManagerAddress],
    }) as bigint;

    if (allowance < amount) {
      logger.info(
        { token: tokenAddress, current: allowance.toString(), needed: amount.toString() },
        'Approving token spend (maxUint256)',
      );

      if (config.dryRun) {
        logger.info('[DRY RUN] Would approve token');
        return;
      }

      const hash = await this.walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20ABI,
        functionName: 'approve',
        args: [this.nfpManagerAddress, maxUint256],
        chain: null,
        account: this.walletClient.account,
        gas: 100_000n,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      logger.info({ hash, status: receipt.status }, 'Approval confirmed');
    }
  }

  /** Mint a new concentrated liquidity position */
  async mint(params: MintParams): Promise<{ tokenId: bigint; liquidity: bigint; hash?: Hash }> {
    logger.info(
      {
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0: params.amount0Desired.toString(),
        amount1: params.amount1Desired.toString(),
      },
      'Minting new position',
    );

    if (config.dryRun) {
      logger.info('[DRY RUN] Would mint position');
      return { tokenId: 0n, liquidity: 0n };
    }

    // Ensure approvals
    await this.ensureApproval(params.token0, params.amount0Desired);
    await this.ensureApproval(params.token1, params.amount1Desired);

    const hash = await this.walletClient.writeContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'mint',
      args: [
        config.useUniswapV3
          ? {
              token0: params.token0,
              token1: params.token1,
              fee: params.fee ?? config.poolFee,
              tickLower: params.tickLower,
              tickUpper: params.tickUpper,
              amount0Desired: params.amount0Desired,
              amount1Desired: params.amount1Desired,
              amount0Min: params.amount0Min,
              amount1Min: params.amount1Min,
              recipient: params.recipient,
              deadline: params.deadline,
            }
          : {
              token0: params.token0,
              token1: params.token1,
              tickSpacing: params.tickSpacing ?? config.tickSpacing,
              tickLower: params.tickLower,
              tickUpper: params.tickUpper,
              amount0Desired: params.amount0Desired,
              amount1Desired: params.amount1Desired,
              amount0Min: params.amount0Min,
              amount1Min: params.amount1Min,
              recipient: params.recipient,
              deadline: params.deadline,
              sqrtPriceX96: params.sqrtPriceX96,
            },
      ],
      chain: null,
      account: this.walletClient.account,
      gas: 500_000n,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    logger.info({ hash, status: receipt.status }, 'Mint confirmed');

    if (receipt.status === 'reverted') {
      logger.error({ hash }, 'Mint transaction REVERTED');
      throw new Error(`Mint transaction reverted: ${hash}`);
    }

    // Find the new tokenId from Transfer event in receipt logs
    const newTokenId = this.parseTokenIdFromReceipt(receipt, params.recipient);

    let liquidity = 0n;
    if (newTokenId > 0n) {
      const pos = await this.getPosition(newTokenId);
      liquidity = pos.liquidity;
    }

    return { tokenId: newTokenId, liquidity, hash };
  }

  /** Parse ERC721 Transfer event to extract tokenId from receipt logs */
  private parseTokenIdFromReceipt(receipt: any, recipient: Address): bigint {
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientPadded = ('0x' + recipient.slice(2).toLowerCase().padStart(64, '0')) as `0x${string}`;

    for (const log of receipt.logs) {
      if (
        log.topics[0] === TRANSFER_TOPIC &&
        log.topics[2]?.toLowerCase() === recipientPadded
      ) {
        return BigInt(log.topics[3]);
      }
    }

    logger.warn('Could not find Transfer event in receipt, falling back to 0');
    return 0n;
  }

  /** Burn (close) a position: decrease liquidity -> collect -> burn NFT (W5: retry collect) */
  async burnPosition(tokenId: bigint): Promise<{ amount0: bigint; amount1: bigint; hash?: Hash }> {
    logger.info({ tokenId: tokenId.toString() }, 'Burning position');

    if (config.dryRun) {
      logger.info('[DRY RUN] Would burn position');
      return { amount0: 0n, amount1: 0n };
    }

    const position = await this.getPosition(tokenId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    // W1: Simulate decreaseLiquidity to get expected amounts for slippage protection
    let expectedAmount0 = 0n;
    let expectedAmount1 = 0n;

    if (position.liquidity > 0n) {
      try {
        const simResult = await this.publicClient.simulateContract({
          address: this.nfpManagerAddress,
          abi: NonfungiblePositionManagerABI,
          functionName: 'decreaseLiquidity',
          args: [
            {
              tokenId,
              liquidity: position.liquidity,
              amount0Min: 0n,
              amount1Min: 0n,
              deadline,
            },
          ],
          account: this.walletClient.account,
        });
        expectedAmount0 = (simResult.result as any)[0] as bigint;
        expectedAmount1 = (simResult.result as any)[1] as bigint;
      } catch (e) {
        logger.warn({ error: e }, 'Failed to simulate decreaseLiquidity, using 0 slippage');
      }
    }

    // 1. Decrease liquidity to zero (FIX 4: configurable slippage protection)
    const slippageMultiplier = 10000n - BigInt(config.slippageBps);
    if (position.liquidity > 0n) {
      try {
        const hash1 = await this.walletClient.writeContract({
          address: this.nfpManagerAddress,
          abi: NonfungiblePositionManagerABI,
          functionName: 'decreaseLiquidity',
          args: [
            {
              tokenId,
              liquidity: position.liquidity,
              amount0Min: expectedAmount0 * slippageMultiplier / 10000n,
              amount1Min: expectedAmount1 * slippageMultiplier / 10000n,
              deadline,
            },
          ],
          chain: null,
          account: this.walletClient.account,
          gas: 300_000n,
        });
        const receipt1 = await this.publicClient.waitForTransactionReceipt({ hash: hash1 });
        if (receipt1.status === 'reverted') {
          logger.error({ hash: hash1 }, 'TX reverted');
          throw new Error('Transaction reverted: ' + hash1);
        }
        logger.info({ hash: hash1 }, 'Decreased liquidity');
      } catch (error) {
        logger.error({ error }, 'Failed to decrease liquidity');
        throw error;
      }
    }

    // 2. Collect all tokens (W5: retry on failure)
    let collectAmount0 = 0n;
    let collectAmount1 = 0n;
    let hash2: Hash | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // W1: Simulate collect to get actual amounts
        try {
          const simCollect = await this.publicClient.simulateContract({
            address: this.nfpManagerAddress,
            abi: NonfungiblePositionManagerABI,
            functionName: 'collect',
            args: [
              {
                tokenId,
                recipient: this.botAddress,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128,
              },
            ],
            account: this.walletClient.account,
          });
          collectAmount0 = (simCollect.result as any)[0] as bigint;
          collectAmount1 = (simCollect.result as any)[1] as bigint;
        } catch {
          // simulation failed, amounts stay 0
        }

        hash2 = await this.walletClient.writeContract({
          address: this.nfpManagerAddress,
          abi: NonfungiblePositionManagerABI,
          functionName: 'collect',
          args: [
            {
              tokenId,
              recipient: this.botAddress,
              amount0Max: MAX_UINT128,
              amount1Max: MAX_UINT128,
            },
          ],
          chain: null,
          account: this.walletClient.account,
          gas: 300_000n,
        });
        const receipt2 = await this.publicClient.waitForTransactionReceipt({ hash: hash2 });
        if (receipt2.status === 'reverted') {
          logger.error({ hash: hash2 }, 'TX reverted');
          throw new Error('Transaction reverted: ' + hash2);
        }
        logger.info({ hash: hash2 }, 'Collected tokens');
        break;
      } catch (error) {
        logger.error({ error, attempt }, 'Failed to collect tokens, retrying...');
        if (attempt === 2) throw error;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // 3. Burn the NFT
    const hash3 = await this.walletClient.writeContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'burn',
      args: [tokenId],
      chain: null,
      account: this.walletClient.account,
      gas: 300_000n,
    });
    const receipt3 = await this.publicClient.waitForTransactionReceipt({ hash: hash3 });
    if (receipt3.status === 'reverted') {
      logger.error({ hash: hash3 }, 'TX reverted');
      throw new Error('Transaction reverted: ' + hash3);
    }
    logger.info({ hash: hash3 }, 'Burned NFT');

    return { amount0: collectAmount0, amount1: collectAmount1, hash: hash2 };
  }

  /** Collect fees from an active position without closing it */
  async collectFees(tokenId: bigint): Promise<{ amount0: bigint; amount1: bigint }> {
    logger.info({ tokenId: tokenId.toString() }, 'Collecting fees');

    if (config.dryRun) {
      logger.info('[DRY RUN] Would collect fees');
      return { amount0: 0n, amount1: 0n };
    }

    // W1: Simulate to get expected amounts
    let amount0 = 0n;
    let amount1 = 0n;
    try {
      const simResult = await this.publicClient.simulateContract({
        address: this.nfpManagerAddress,
        abi: NonfungiblePositionManagerABI,
        functionName: 'collect',
        args: [
          {
            tokenId,
            recipient: this.botAddress,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
        ],
        account: this.walletClient.account,
      });
      amount0 = (simResult.result as any)[0] as bigint;
      amount1 = (simResult.result as any)[1] as bigint;
    } catch {
      // simulation failed, will still execute
    }

    const hash = await this.walletClient.writeContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'collect',
      args: [
        {
          tokenId,
          recipient: this.botAddress,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        },
      ],
      chain: null,
      account: this.walletClient.account,
      gas: 300_000n,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      logger.error({ hash }, 'TX reverted');
      throw new Error('Transaction reverted: ' + hash);
    }
    logger.info({ hash, status: receipt.status, amount0: amount0.toString(), amount1: amount1.toString() }, 'Fee collection confirmed');

    return { amount0, amount1 };
  }

  /** C4: Atomic rebalance via multicall - decreaseLiquidity + collect + mint in one tx */
  async rebalanceMulticall(
    oldTokenId: bigint,
    oldLiquidity: bigint,
    mintParams: MintParams,
    sqrtPriceX96: bigint,
  ): Promise<{ tokenId: bigint; liquidity: bigint; hash?: Hash }> {
    logger.info(
      {
        oldTokenId: oldTokenId.toString(),
        tickLower: mintParams.tickLower,
        tickUpper: mintParams.tickUpper,
      },
      'Atomic rebalance via multicall',
    );

    if (config.dryRun) {
      logger.info('[DRY RUN] Would rebalance via multicall');
      return { tokenId: 0n, liquidity: 0n };
    }

    // Ensure approvals before multicall
    await this.ensureApproval(mintParams.token0, mintParams.amount0Desired);
    await this.ensureApproval(mintParams.token1, mintParams.amount1Desired);

    const deadline = mintParams.deadline;

    // Encode the individual calls
    const calls: `0x${string}`[] = [];

    // 1. Decrease liquidity with configurable slippage protection (FIX 4)
    const slippageMultiplier = 10000n - BigInt(config.slippageBps);
    if (oldLiquidity > 0n) {
      // Compute expected amounts from the old position's tick range
      const oldPosition = await this.getPosition(oldTokenId);
      const sqrtPriceLowerX96 = tickToSqrtPriceX96(oldPosition.tickLower);
      const sqrtPriceUpperX96 = tickToSqrtPriceX96(oldPosition.tickUpper);
      const expectedAmount0 = computeAmount0ForLiquidity(oldLiquidity, sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96);
      const expectedAmount1 = computeAmount1ForLiquidity(oldLiquidity, sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96);

      calls.push(
        encodeFunctionData({
          abi: NonfungiblePositionManagerABI,
          functionName: 'decreaseLiquidity',
          args: [
            {
              tokenId: oldTokenId,
              liquidity: oldLiquidity,
              amount0Min: expectedAmount0 * slippageMultiplier / 10000n,
              amount1Min: expectedAmount1 * slippageMultiplier / 10000n,
              deadline,
            },
          ],
        }),
      );
    }

    // 2. Collect all tokens
    calls.push(
      encodeFunctionData({
        abi: NonfungiblePositionManagerABI,
        functionName: 'collect',
        args: [
          {
            tokenId: oldTokenId,
            recipient: this.botAddress,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
        ],
      }),
    );

    // 3. Burn old NFT
    calls.push(
      encodeFunctionData({
        abi: NonfungiblePositionManagerABI,
        functionName: 'burn',
        args: [oldTokenId],
      }),
    );

    // 4. Mint new position
    const mintArgs = config.useUniswapV3
      ? {
          token0: mintParams.token0,
          token1: mintParams.token1,
          fee: mintParams.fee ?? config.poolFee,
          tickLower: mintParams.tickLower,
          tickUpper: mintParams.tickUpper,
          amount0Desired: mintParams.amount0Desired,
          amount1Desired: mintParams.amount1Desired,
          amount0Min: mintParams.amount0Min,
          amount1Min: mintParams.amount1Min,
          recipient: mintParams.recipient,
          deadline: mintParams.deadline,
        }
      : {
          token0: mintParams.token0,
          token1: mintParams.token1,
          tickSpacing: mintParams.tickSpacing ?? config.tickSpacing,
          tickLower: mintParams.tickLower,
          tickUpper: mintParams.tickUpper,
          amount0Desired: mintParams.amount0Desired,
          amount1Desired: mintParams.amount1Desired,
          amount0Min: mintParams.amount0Min,
          amount1Min: mintParams.amount1Min,
          recipient: mintParams.recipient,
          deadline: mintParams.deadline,
          sqrtPriceX96: mintParams.sqrtPriceX96,
        };
    calls.push(
      encodeFunctionData({
        abi: NonfungiblePositionManagerABI,
        functionName: 'mint',
        args: [mintArgs] as any,
      }),
    );

    const hash = await this.walletClient.writeContract({
      address: this.nfpManagerAddress,
      abi: NonfungiblePositionManagerABI,
      functionName: 'multicall',
      args: [calls],
      chain: null,
      account: this.walletClient.account,
      gas: 800_000n,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    logger.info({ hash, status: receipt.status }, 'Multicall rebalance confirmed');

    if (receipt.status === 'reverted') {
      logger.error({ hash }, 'Mint transaction REVERTED');
      throw new Error(`Mint transaction reverted: ${hash}`);
    }

    // Find the new tokenId from Transfer event in receipt logs
    const newTokenId = this.parseTokenIdFromReceipt(receipt, mintParams.recipient);

    let liquidity = 0n;
    if (newTokenId > 0n) {
      const pos = await this.getPosition(newTokenId);
      liquidity = pos.liquidity;
    }

    return { tokenId: newTokenId, liquidity, hash };
  }
}
