/**
 * HyperliquidPerpStrategy call builder.
 *
 * InitParams (Solidity): (address keeper, address asset, uint256 depositAmount, uint256 minReturnAmount)
 */

import type { Address, Hex } from "viem";
import { encodeAbiParameters, encodeFunctionData } from "viem";
import { ERC20_ABI, BASE_STRATEGY_ABI } from "../lib/abis.js";
import type { BatchCall } from "../lib/batch.js";

export function buildInitData(
  keeper: Address,
  asset: Address,
  depositAmount: bigint,
  minReturnAmount: bigint,
): Hex {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [keeper, asset, depositAmount, minReturnAmount],
  );
}

export function buildExecuteCalls(
  clone: Address,
  asset: Address,
  amount: bigint,
): BatchCall[] {
  return [
    {
      target: asset,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [clone, amount],
      }),
      value: 0n,
    },
    {
      target: clone,
      data: encodeFunctionData({
        abi: BASE_STRATEGY_ABI,
        functionName: "execute",
      }),
      value: 0n,
    },
  ];
}

export function buildSettleCalls(clone: Address): BatchCall[] {
  return [
    {
      target: clone,
      data: encodeFunctionData({
        abi: BASE_STRATEGY_ABI,
        functionName: "settle",
      }),
      value: 0n,
    },
  ];
}
