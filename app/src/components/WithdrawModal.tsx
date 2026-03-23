"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  SYNDICATE_VAULT_ABI,
  getAddresses,
  truncateAddress,
} from "@/lib/contracts";

interface WithdrawModalProps {
  vault: Address;
  vaultName: string;
  redemptionsLocked: boolean;
  paused: boolean;
  assetDecimals: number;
  assetSymbol: string;
  shareBalance: bigint;
  onClose: () => void;
}

type Step = "input" | "withdrawing" | "success" | "error";

export default function WithdrawModal({
  vault,
  vaultName,
  redemptionsLocked,
  paused,
  assetDecimals,
  assetSymbol,
  shareBalance,
  onClose,
}: WithdrawModalProps) {
  const { address } = useAccount();
  const addresses = getAddresses();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState("");

  // Parse asset amount to raw units
  const parsedAmount = (() => {
    try {
      if (!amount || parseFloat(amount) <= 0) return 0n;
      return parseUnits(amount, assetDecimals);
    } catch {
      return 0n;
    }
  })();

  // Convert share balance to asset value for MAX button
  const { data: maxAssets } = useReadContract({
    address: vault,
    abi: SYNDICATE_VAULT_ABI,
    functionName: "convertToAssets",
    args: shareBalance > 0n ? [shareBalance] : undefined,
    query: { enabled: shareBalance > 0n },
  });

  // Preview: convert desired assets to shares needed
  const { data: previewShares } = useReadContract({
    address: vault,
    abi: SYNDICATE_VAULT_ABI,
    functionName: "convertToShares",
    args: parsedAmount > 0n ? [parsedAmount] : undefined,
    query: { enabled: parsedAmount > 0n },
  });

  // Withdraw tx
  const {
    writeContract: withdraw,
    data: withdrawHash,
    isPending: isWithdrawPending,
  } = useWriteContract();

  const { isSuccess: isWithdrawConfirmed } = useWaitForTransactionReceipt({
    hash: withdrawHash,
  });

  const maxAssetsValue = maxAssets ?? 0n;
  const canWithdraw =
    !paused &&
    !redemptionsLocked &&
    parsedAmount > 0n &&
    parsedAmount <= maxAssetsValue;

  // Handle withdraw confirmation
  useEffect(() => {
    if (isWithdrawConfirmed && step === "withdrawing") {
      setStep("success");
    }
  }, [isWithdrawConfirmed, step]);

  function handleWithdraw() {
    if (!address) return;
    setStep("withdrawing");
    withdraw(
      {
        address: vault,
        abi: SYNDICATE_VAULT_ABI,
        functionName: "withdraw",
        args: [parsedAmount, address, address],
      },
      {
        onError: (err) => {
          const msg = (err as any).shortMessage || "Transaction was rejected or reverted.";
          setErrorMsg(msg);
          setStep("error");
        },
      },
    );
  }

  const maxFormatted = maxAssets
    ? parseFloat(formatUnits(maxAssets, assetDecimals)).toLocaleString()
    : "0";

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
      onClick={onClose}
    >
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <span id="withdraw-modal-title">Withdraw {assetSymbol}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            x
          </button>
        </div>

        <div
          className="font-[family-name:var(--font-plus-jakarta)]"
          style={{
            fontSize: "10px",
            color: "rgba(255,255,255,0.4)",
            marginBottom: "1.5rem",
          }}
        >
          {vaultName} &middot; {truncateAddress(vault)}
        </div>

        {redemptionsLocked && (
          <div className="modal-warning">
            Redemptions are locked while a strategy is active
          </div>
        )}

        {paused && (
          <div className="modal-warning">Vault is paused — withdrawals disabled</div>
        )}

        {step === "success" ? (
          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <div
              className="font-[family-name:var(--font-plus-jakarta)] text-lg"
              style={{ color: "var(--color-accent)", marginBottom: "1rem" }}
            >
              Withdrew {amount} {assetSymbol}
            </div>
            {withdrawHash && (
              <a
                href={`${addresses.blockExplorer}/tx/${withdrawHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="attestation-link"
                style={{ fontSize: "12px" }}
              >
                View transaction
              </a>
            )}
          </div>
        ) : step === "error" ? (
          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <div
              className="font-[family-name:var(--font-plus-jakarta)] text-sm"
              style={{ color: "#ff4d4d", marginBottom: "1rem" }}
            >
              Transaction failed
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.5)",
                marginBottom: "0.5rem",
              }}
            >
              {errorMsg}
            </div>
            <details
              style={{
                fontSize: "10px",
                color: "rgba(255,255,255,0.3)",
                maxHeight: "100px",
                overflow: "auto",
                wordBreak: "break-all",
              }}
            >
              <summary style={{ cursor: "pointer", marginBottom: "0.25rem" }}>
                Technical details
              </summary>
              {errorMsg}
            </details>
            <button
              className="btn-follow"
              style={{ marginTop: "1rem" }}
              onClick={() => setStep("input")}
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            {/* Available balance */}
            <div
              className="flex justify-between font-[family-name:var(--font-plus-jakarta)]"
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.5)",
                marginBottom: "0.5rem",
              }}
            >
              <span>Available</span>
              <span>{maxFormatted} {assetSymbol}</span>
            </div>

            {/* Asset amount input */}
            <div className="deposit-input-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = val.split(".");
                  if (parts.length > 2) val = parts[0] + "." + parts.slice(1).join("");
                  setAmount(val);
                }}
                className="deposit-input"
                disabled={step !== "input"}
              />
              <span
                className="font-[family-name:var(--font-plus-jakarta)]"
                style={{
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.5)",
                  marginRight: "0.5rem",
                }}
              >
                {assetSymbol}
              </span>
              <button
                className="btn-follow"
                style={{ fontSize: "9px", padding: "0.3rem 0.6rem" }}
                onClick={() => {
                  if (maxAssets) {
                    const full = formatUnits(maxAssets, assetDecimals);
                    const dot = full.indexOf(".");
                    setAmount(dot >= 0 ? full.slice(0, dot + 7) : full); // max 6 decimals
                  }
                }}
              >
                MAX
              </button>
            </div>

            {/* Action button */}
            <div style={{ marginTop: "1.5rem" }}>
              <button
                className="btn-action"
                style={{ width: "100%" }}
                onClick={handleWithdraw}
                disabled={!canWithdraw || isWithdrawPending || step === "withdrawing"}
              >
                {step === "withdrawing"
                  ? "Withdrawing..."
                  : `Withdraw ${amount ? (amount.includes(".") ? amount.slice(0, amount.indexOf(".") + 7) : amount) : "0"} ${assetSymbol}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
