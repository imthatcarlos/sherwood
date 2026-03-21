"use client";

import { http } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { CHAINS, getRpcUrl } from "@/lib/contracts";
import type { Chain } from "viem";

const chains = Object.values(CHAINS).map((e) => e.chain) as [
  Chain,
  ...Chain[],
];

const transports = Object.fromEntries(
  Object.keys(CHAINS).map((id) => [Number(id), http(getRpcUrl(Number(id)))]),
);

export const wagmiConfig = getDefaultConfig({
  appName: "Sherwood",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  chains,
  transports,
});
