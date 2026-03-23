"use client";

import { useEffect, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { trackWalletConnect } from "@/lib/analytics";

export default function WalletButton() {
  const { chainId, isConnected } = useAccount();
  const prevConnected = useRef(false);

  useEffect(() => {
    if (isConnected && !prevConnected.current && chainId) {
      trackWalletConnect(chainId);
    }
    prevConnected.current = isConnected;
  }, [isConnected, chainId]);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            {...(!mounted && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none", userSelect: "none" },
            })}
          >
            {connected ? (
              <button onClick={openAccountModal} type="button" className="btn-follow">
                {account.displayName}
              </button>
            ) : (
              <button onClick={openConnectModal} type="button" className="btn-follow">
                Connect
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
