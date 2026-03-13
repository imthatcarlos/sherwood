import type { Address, Chain } from "viem";
import { base } from "viem/chains";
import type { LendingProvider, ProviderInfo, DepositParams, BorrowParams, RepayParams, WithdrawParams, TxResult, LendingPosition } from "../types.js";

// Moonwell Comptroller on Base
const MOONWELL_COMPTROLLER: Address = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";

// Moonwell markets on Base
export const MOONWELL_MARKETS = {
  USDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22" as Address,
  WETH: "0x628ff693426583D9a7FB391E54366292F509D457" as Address,
  cbETH: "0x3bf93770f2d4a0D62751aB98d2F1881eDBadc033" as Address,
} as const;

export class MoonwellProvider implements LendingProvider {
  info(): ProviderInfo {
    return {
      name: "moonwell",
      type: "lending",
      capabilities: [
        "lend.deposit",
        "lend.borrow",
        "lend.repay",
        "lend.withdraw",
        "lend.positions",
      ],
      supportedChains: [base],
    };
  }

  async depositCollateral(params: DepositParams): Promise<TxResult> {
    // TODO: Build and send tx via viem
    throw new Error("Not implemented — wire up viem client");
  }

  async borrow(params: BorrowParams): Promise<TxResult> {
    throw new Error("Not implemented");
  }

  async repay(params: RepayParams): Promise<TxResult> {
    throw new Error("Not implemented");
  }

  async withdrawCollateral(params: WithdrawParams): Promise<TxResult> {
    throw new Error("Not implemented");
  }

  async getPosition(account: Address): Promise<LendingPosition> {
    throw new Error("Not implemented");
  }
}
