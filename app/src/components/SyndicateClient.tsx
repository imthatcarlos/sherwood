"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import SyndicateHeader, { type TabId } from "./SyndicateHeader";
import { SYNDICATE_VAULT_ABI, formatAsset } from "@/lib/contracts";

interface SyndicateClientProps {
  name: string;
  subdomain: string;
  vault: Address;
  creator: Address;
  creatorName?: string;
  paused: boolean;
  chainId: number;
  assetDecimals: number;
  assetSymbol: string;
  activeTab?: TabId;
  hideAgentsTab?: boolean;
}

export default function SyndicateClient({
  name,
  subdomain,
  vault,
  creator,
  creatorName,
  paused,
  chainId,
  assetDecimals,
  assetSymbol,
  activeTab = "vault",
  hideAgentsTab,
}: SyndicateClientProps) {
  const { address, isConnected } = useAccount();

  // User's vault shares
  const { data: userShares } = useReadContract({
    address: vault,
    abi: SYNDICATE_VAULT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Convert shares to assets
  const { data: userAssets } = useReadContract({
    address: vault,
    abi: SYNDICATE_VAULT_ABI,
    functionName: "convertToAssets",
    args: userShares ? [userShares] : undefined,
    query: { enabled: !!userShares && userShares > 0n },
  });

  const isUSD = assetSymbol === "USDC" || assetSymbol === "USDT";

  return (
    <>
      <SyndicateHeader
        name={name}
        subdomain={subdomain}
        vault={vault}
        creator={creator}
        creatorName={creatorName}
        paused={paused}
        chainId={chainId}
        activeTab={activeTab}
        hideAgentsTab={hideAgentsTab}
      />

      {/* User position — only shown on vault tab when connected and has shares */}
      {activeTab === "vault" && isConnected && !!userShares && userShares > 0n && (
        <div className="stats-bar" style={{ marginTop: "1rem" }}>
          <div className="stat-item">
            <div className="stat-label">Your Shares</div>
            <div className="stat-value">
              {parseFloat(formatUnits(userShares, assetDecimals * 2)).toLocaleString()}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Your Value</div>
            <div className="stat-value" style={{ color: "var(--color-accent)" }}>
              {userAssets
                ? isUSD
                  ? formatAsset(userAssets, assetDecimals, "USD")
                  : `${formatAsset(userAssets, assetDecimals)} ${assetSymbol}`
                : "—"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
