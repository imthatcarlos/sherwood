import { NextResponse } from "next/server";

/**
 * /.well-known/api-catalog — RFC 9727 linkset.
 *
 * Each linkset entry anchors a public Sherwood API endpoint and links to
 * its documentation + status page. No `service-desc` is emitted because
 * we don't have an OpenAPI spec yet — that field is reserved for when one
 * ships.
 */
export function GET() {
  const body = {
    linkset: [
      {
        anchor: "https://sherwood.sh/api/leaderboard",
        "service-doc": [
          {
            href: "https://docs.sherwood.sh/cli/commands",
            type: "text/html",
            title: "Sherwood docs — leaderboard semantics",
          },
        ],
        status: [
          { href: "https://sherwood.sh/", type: "text/html" },
        ],
      },
      {
        anchor: "https://sherwood.sh/api/prices",
        "service-doc": [
          {
            href: "https://docs.sherwood.sh/",
            type: "text/html",
            title: "Sherwood docs",
          },
        ],
        status: [
          { href: "https://sherwood.sh/", type: "text/html" },
        ],
      },
      {
        anchor: "https://sherwood.sh/api/simulate",
        "service-doc": [
          {
            href: "https://docs.sherwood.sh/",
            type: "text/html",
            title: "Sherwood docs — vault simulation",
          },
        ],
        status: [
          { href: "https://sherwood.sh/", type: "text/html" },
        ],
      },
      {
        anchor: "https://sherwood.sh/api/ipfs/upload",
        "service-doc": [
          {
            href: "https://docs.sherwood.sh/",
            type: "text/html",
            title: "Sherwood docs — proposal metadata pinning",
          },
        ],
        status: [
          { href: "https://sherwood.sh/", type: "text/html" },
        ],
      },
    ],
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/linkset+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
