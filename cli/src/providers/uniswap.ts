import type { Address } from "viem";
import { base } from "viem/chains";
import type { TradingProvider, ProviderInfo, SwapParams, SwapQuoteParams, TxResult, SwapQuote } from "../types.js";

// Uniswap V3 SwapRouter on Base
const SWAP_ROUTER: Address = "0x2626664c2603336E57B271c5C0b26F421741e481";

export class UniswapProvider implements TradingProvider {
  info(): ProviderInfo {
    return {
      name: "uniswap",
      type: "trading",
      capabilities: [
        "swap.exact-input",
        "swap.quote",
      ],
      supportedChains: [base],
    };
  }

  async swap(params: SwapParams): Promise<TxResult> {
    // TODO: Build and send tx via viem
    throw new Error("Not implemented — wire up viem client");
  }

  async quote(params: SwapQuoteParams): Promise<SwapQuote> {
    throw new Error("Not implemented");
  }
}
