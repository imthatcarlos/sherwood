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
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /_next/",
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
