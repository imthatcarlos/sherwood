"use client";

import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, walletConnect, injected } from "wagmi/connectors";
import { robinhoodTestnet, getRpcUrl } from "@/lib/contracts";

const chains = [base, baseSepolia, robinhoodTestnet] as const;

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    coinbaseWallet({
      appName: "Sherwood",
      preference: "all", // smart wallet + EOA
    }),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
    }),
    injected(),
  ],
  transports: {
    [base.id]: http(getRpcUrl(8453)),
    [baseSepolia.id]: http(getRpcUrl(84532)),
    [robinhoodTestnet.id]: http(getRpcUrl(46630)),
  },
});
