"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function WalletButton() {
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
