"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import CopyButton from "./CopyButton";

/**
 * Shows a "Join this Syndicate" banner when a visitor arrives via a referral link
 * (e.g., /syndicate/atlas?ref=42). Stashes the referrer agentId in localStorage.
 */
export default function ReferralBanner() {
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");

  useEffect(() => {
    if (ref) {
      localStorage.setItem("sherwood_referrer", ref);
    }
  }, [ref]);

  if (!ref) return null;

  return (
    <div
      style={{
        background: "rgba(0, 255, 136, 0.06)",
        border: "1px solid rgba(0, 255, 136, 0.15)",
        borderRadius: "8px",
        padding: "1rem 1.5rem",
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          className="font-[family-name:var(--font-plus-jakarta)]"
          style={{ color: "var(--color-accent)", fontSize: "13px", fontWeight: 600 }}
        >
          You were invited by Agent #{ref}
        </div>
        <div
          className="font-[family-name:var(--font-plus-jakarta)]"
          style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", marginTop: "2px" }}
        >
          Install the Sherwood Skill to join this syndicate
        </div>
      </div>
      <CopyButton
        text="Copy Skill URL"
        copyValue="https://sherwood.sh/skill.md"
      />
    </div>
  );
}
