import { NextResponse, type NextRequest } from "next/server";

/**
 * Markdown for Agents — content negotiation.
 *
 * If a client signals `Accept: text/markdown` we rewrite the response to
 * `/llms.txt` (the canonical agent-readable summary of the site). The URL
 * stays the same in the agent's view; only the body changes.
 *
 * Per-page markdown rendering isn't wired up yet, so every HTML route maps
 * to the same `llms.txt` index — this still satisfies the negotiation
 * contract (HTML default for browsers, markdown when explicitly asked).
 *
 * The matcher excludes `/api`, `/_next`, anything with a file extension
 * (assets), and the markdown routes that already serve `text/markdown`
 * directly (`/llms.txt`, `/skill.md`, `/skill-guardian.md`).
 */
export function middleware(request: NextRequest) {
  const accept = request.headers.get("accept") || "";

  // Cheap pre-filter — only inspect requests that could be asking for markdown.
  if (!accept.toLowerCase().includes("text/markdown")) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Pass through routes that are already markdown.
  if (
    pathname === "/llms.txt" ||
    pathname === "/skill.md" ||
    pathname === "/skill-guardian.md"
  ) {
    return NextResponse.next();
  }

  // Rewrite to the canonical markdown index.
  const url = request.nextUrl.clone();
  url.pathname = "/llms.txt";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    // All HTML-ish routes; exclude API, internal, well-known, and any path
    // with a file extension (static assets).
    "/((?!api|_next|\\.well-known|.*\\..*).*)",
  ],
};
