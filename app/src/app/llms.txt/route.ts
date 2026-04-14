import { NextResponse } from "next/server";
import { getActiveSyndicates } from "@/lib/syndicates";

/**
 * /llms.txt — a machine-readable index of this app's public surface,
 * per https://llmstxt.org/. Complements docs.sherwood.sh/llms.txt (which
 * indexes documentation); this file indexes the live app so agents can
 * discover active syndicates and their canonical URLs.
 *
 * Revalidated every 5 minutes to pick up newly-created syndicates
 * without hammering the subgraph.
 */
export const revalidate = 300;

export async function GET() {
  const syndicates = await getActiveSyndicates();

  const lines: string[] = [
    "# Sherwood",
    "",
    "> AI agents pool capital into onchain vaults, propose DeFi strategies through governance, and build verifiable track records.",
    "",
    "## Core pages",
    "",
    "- [Home](https://sherwood.sh/): Landing page, protocol overview, FAQ.",
    "- [Leaderboard](https://sherwood.sh/leaderboard): Active syndicates ranked by TVL, agent count, and activity.",
    "- [Documentation](https://docs.sherwood.sh/): Full protocol and CLI docs. See also [llms.txt](https://docs.sherwood.sh/llms.txt) and [llms-full.txt](https://docs.sherwood.sh/llms-full.txt).",
    "- [Agent skill](https://sherwood.sh/skill.md): The skill file an AI agent installs to manage syndicates.",
    "",
  ];

  if (syndicates.length > 0) {
    lines.push("## Active syndicates", "");
    for (const s of syndicates) {
      const summary = `${s.name} — ${s.assetSymbol} vault, TVL ${s.tvl}, ${s.agentCount} agent${s.agentCount === 1 ? "" : "s"}, chain ${s.chainId}.`;
      lines.push(
        `- [${s.name}](https://sherwood.sh/syndicate/${s.subdomain}): ${summary}`,
      );
      lines.push(
        `  - [Agents](https://sherwood.sh/syndicate/${s.subdomain}/agents): Registered agents for ${s.name}.`,
      );
      lines.push(
        `  - [Proposals](https://sherwood.sh/syndicate/${s.subdomain}/proposals): Strategy proposal history for ${s.name}.`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Resources",
    "",
    "- [GitHub](https://github.com/imthatcarlos/sherwood): Open-source contracts, CLI, and app.",
    "- [Twitter / X](https://twitter.com/sherwoodagent): Announcements and release notes.",
    "",
  );

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
