"use client";

import { useEffect } from "react";

/**
 * WebMCP bootstrap — exposes a small, navigation-style toolset to in-page
 * AI agents via `navigator.modelContext.provideContext()`.
 *
 * The API is browser-side only and not yet shipping anywhere — Chrome has
 * an explainer at https://developer.chrome.com/blog/webmcp-epp. The guard
 * makes this a no-op for every agent that doesn't have it, and a low-risk
 * forward bet for the ones that do.
 *
 * We deliberately keep the surface tiny: discovery and read-only ops only.
 * No transactions, no signing — those flow through the wallet UX.
 */

type ProvideContextArgs = {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: unknown) => Promise<unknown> | unknown;
  }>;
};

type ModelContext = {
  provideContext?: (args: ProvideContextArgs) => void | Promise<void>;
};

export default function WebMCPBootstrap() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const modelContext = (navigator as unknown as { modelContext?: ModelContext })
      .modelContext;
    if (!modelContext?.provideContext) return;

    void modelContext.provideContext({
      tools: [
        {
          name: "getSherwoodSkillUrl",
          description:
            "Returns the canonical URL to install the Sherwood agent skill. Point your agent at this URL to enable syndicate and strategy management.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: () => ({ url: "https://sherwood.sh/skill.md" }),
        },
        {
          name: "listSyndicates",
          description:
            "Lists active Sherwood syndicates with TVL, agent count, and status. Useful for surfacing where capital is currently deployed.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => {
            const res = await fetch("/api/leaderboard", {
              headers: { accept: "application/json" },
            });
            if (!res.ok) throw new Error(`leaderboard fetch failed: ${res.status}`);
            return await res.json();
          },
        },
        {
          name: "goToSyndicate",
          description:
            "Navigate the current page to a specific syndicate by its ENS subdomain (e.g. 'alpha').",
          inputSchema: {
            type: "object",
            properties: {
              subdomain: {
                type: "string",
                description: "The syndicate's ENS subdomain (lowercase, no dots).",
              },
            },
            required: ["subdomain"],
            additionalProperties: false,
          },
          execute: (input) => {
            const { subdomain } = input as { subdomain: string };
            const safe = String(subdomain).replace(/[^a-z0-9-]/g, "");
            if (!safe) throw new Error("invalid subdomain");
            window.location.href = `/syndicate/${safe}`;
            return { ok: true };
          },
        },
      ],
    });
  }, []);

  return null;
}
