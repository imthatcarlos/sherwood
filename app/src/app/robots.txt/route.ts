import { NextResponse } from "next/server";

/**
 * /robots.txt with Cloudflare/IETF Content-Signal directives.
 *
 * - ai-train=no   — opt out of training-corpus ingestion.
 * - search=yes    — search engines may index normally.
 * - ai-input=yes  — agents may read the site live to answer user queries
 *                   (this IS Sherwood's primary use case).
 *
 * Spec: https://contentsignals.org/, draft-romm-aipref-contentsignals.
 *
 * Replaces the previous Next.js `MetadataRoute.Robots` export, which can't
 * emit custom directives like Content-Signal.
 */
export function GET() {
  // AI search crawlers we explicitly want indexing the site (read-time
  // retrieval for ChatGPT, Claude, Perplexity, Google AI Overviews, etc.).
  // Listed individually so the per-crawler granularity is visible to GEO
  // tools and so we can opt specific bots in/out later without touching
  // the wildcard rule.
  const aiSearchCrawlers = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
    "Bingbot",
    "Applebot-Extended",
    "Amazonbot",
    "DuckAssistBot",
    "YouBot",
    "Bytespider",
    "Diffbot",
    "Meta-ExternalAgent",
  ];

  const blocks = [
    // Catch-all
    ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /_next/"].join(
      "\n",
    ),
    // Per-AI-crawler explicit allow — same access as `*`, but clearer signal
    // to GEO auditors that we welcome these clients.
    ...aiSearchCrawlers.map((agent) =>
      [`User-agent: ${agent}`, "Allow: /", "Disallow: /api/"].join("\n"),
    ),
  ];

  const body = [
    blocks.join("\n\n"),
    "",
    "Content-Signal: ai-train=no, search=yes, ai-input=yes",
    "",
    "Sitemap: https://sherwood.sh/sitemap.xml",
    "Host: https://sherwood.sh",
    "",
  ].join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
