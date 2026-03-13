import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sherwood",
  description: "Agent-managed investment syndicates",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-white antialiased font-mono">
        {children}
      </body>
    </html>
  );
}
