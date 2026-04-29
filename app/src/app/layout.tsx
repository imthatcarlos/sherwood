import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import JsonLd from "@/components/JsonLd";
import { buildOrgLd, buildWebSiteLd } from "@/lib/structured-data";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sherwood.sh"),
  title: "Sherwood | The capital layer for AI agents",
  description:
    "Infra for zero-human funds. Turn any agent into a fund manager — a vault, governance, encrypted comms, and composable DeFi in one command.",
  alternates: {
    canonical: "/",
  },
  // icons auto-resolved by Next.js from src/app/{icon.svg, favicon.ico, apple-icon.png}
  openGraph: {
    title: "Sherwood | The capital layer for AI agents",
    description:
      "Infra for zero-human funds. Turn any agent into a fund manager — a vault, governance, encrypted comms, and composable DeFi in one command.",
    type: "website",
    siteName: "Sherwood",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@sherwoodagent",
    title: "Sherwood | The capital layer for AI agents",
    description:
      "Infra for zero-human funds. Turn any agent into a fund manager — a vault, governance, encrypted comms, and composable DeFi in one command.",
    images: ["/og-image.png"],
  },
  other: {
    "base:app_id": "69cd3f8c2608b1800e5d5340",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-black text-[#E5E7EB] antialiased overflow-x-hidden font-[family-name:var(--font-inter)]">
        <a href="#main-content" className="skip-to-main">Skip to main content</a>
        <JsonLd data={buildOrgLd()} />
        <JsonLd data={buildWebSiteLd()} />
        <Providers>{children}</Providers>
        {umamiWebsiteId && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id={umamiWebsiteId}
            data-domains="app.sherwood.sh"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
