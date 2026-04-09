"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { quoteAllTokenPrices, type TokenPrice } from "@/lib/price-quote";
import type { Address } from "viem";

ChartJS.register(ArcElement, Tooltip);

const PALETTE = [
  "#2EE6A6", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
];

interface Allocation {
  token: Address;
  symbol: string;
  decimals: number;
  weightPct: number;
  tokenAmount: string;
  investedAmount: string;
  feeTier: number;
  logo: string | null;
  marketCap: number | null;
}

interface PortfolioDashboardProps {
  allocations: Allocation[];
  totalInvested: string;
  assetSymbol: string;
  assetAddress: Address;
  assetDecimals: number;
  chainId: number;
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(1)}B`;
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
  return `$${mcap.toFixed(0)}`;
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}%`;
}

/** Dim a hex color to a given opacity. */
function dimColor(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export default function PortfolioDashboard({
  allocations,
  totalInvested,
  assetSymbol,
  assetAddress,
  assetDecimals,
  chainId,
}: PortfolioDashboardProps) {
  const [prices, setPrices] = useState<Map<string, TokenPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartRef = useRef<ChartJS<"doughnut">>(null);

  // Fetch prices
  const fetchPrices = useCallback(async () => {
    const tokens = allocations.map((a) => ({
      token: a.token,
      decimals: a.decimals,
      feeTier: a.feeTier,
    }));
    const result = await quoteAllTokenPrices(chainId, tokens, assetAddress, assetDecimals);
    setPrices(result);
    setLoading(false);
  }, [allocations, chainId, assetAddress, assetDecimals]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 30_000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // Compute portfolio value
  const totalInvestedNum = parseFloat(totalInvested.replace(/,/g, ""));
  let portfolioValue = 0;
  const tokenValues: { symbol: string; value: number; invested: number; price: number }[] = [];

  for (const a of allocations) {
    const tp = prices.get(a.token.toLowerCase());
    const tokenAmt = parseFloat(a.tokenAmount);
    const invested = parseFloat(a.investedAmount);
    const price = tp?.price ?? 0;
    const value = tokenAmt * price;
    portfolioValue += value;
    tokenValues.push({ symbol: a.symbol, value, invested, price });
  }

  const overallDelta = totalInvestedNum > 0
    ? ((portfolioValue - totalInvestedNum) / totalInvestedNum) * 100
    : 0;

  // Doughnut — on hover, dim non-hovered segments
  const borderColors = allocations.map((_, i) => {
    const color = PALETTE[i % PALETTE.length];
    if (hoveredIndex === null) return color;
    return i === hoveredIndex ? color : dimColor(color, 0.2);
  });

  const doughnutData = {
    labels: allocations.map((a) => a.symbol),
    datasets: [{
      data: allocations.map((a) => a.weightPct),
      backgroundColor: "transparent",
      borderColor: borderColors,
      borderWidth: 3,
      hoverOffset: 0,
    }],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: "72%",
    animation: { duration: 0 },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    onHover: (_event: unknown, elements: { index: number }[]) => {
      setHoveredIndex(elements.length > 0 ? elements[0].index : null);
    },
  };

  return (
    <div className="portfolio-dashboard-compact">
      {/* Doughnut */}
      <div
        style={{ width: "56px", height: "56px", flexShrink: 0 }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <Doughnut ref={chartRef} data={doughnutData} options={doughnutOptions} />
      </div>

      {/* Portfolio value + delta (same row) */}
      <div className="portfolio-value-inline">
        <span className="portfolio-value-amount">
          {loading ? "—" : `${portfolioValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${assetSymbol}`}
        </span>
        {!loading && (
          <span className={`portfolio-value-delta ${overallDelta >= 0 ? "delta-positive" : "delta-negative"}`}>
            {formatDelta(overallDelta)}
          </span>
        )}
      </div>

      {/* Ticker strip */}
      <div className="ticker-strip-horizontal">
        {allocations.map((a, i) => {
          const tv = tokenValues[i];
          const delta = tv && tv.invested > 0
            ? ((tv.value - tv.invested) / tv.invested) * 100
            : 0;
          const hasPrices = !loading && tv?.price > 0;
          const color = PALETTE[i % PALETTE.length];

          return (
            <div key={a.token} className="ticker-item">
              <div className="ticker-header">
                <span className="ticker-logo-ring" style={{ borderColor: color }}>
                  {a.logo ? (
                    <img src={a.logo} alt={a.symbol} width={14} height={14} style={{ borderRadius: "50%", display: "block" }} />
                  ) : (
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: color, display: "block" }} />
                  )}
                </span>
                <span className="ticker-symbol">{a.symbol}</span>
                <span className="ticker-weight">{a.weightPct.toFixed(0)}%</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="ticker-mcap">
                  {a.marketCap ? formatMarketCap(a.marketCap) : "—"}
                </span>
                {hasPrices && (
                  <span className={`ticker-delta ${delta >= 0 ? "delta-positive" : "delta-negative"}`}>
                    {formatDelta(delta)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
