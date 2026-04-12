import {
  type ProposalData,
  formatDuration,
  formatTimeRemaining,
} from "@/lib/governor-data";
import { truncateAddress, formatAsset, formatBps } from "@/lib/contracts";
import PortfolioAllocation from "./PortfolioAllocation";
import PortfolioDashboard from "./PortfolioDashboard";
import type { CbBTCLoopData } from "@/lib/cbbtc-loop-data";
import type { Address } from "viem";

interface PortfolioAllocProps {
  allocations: { symbol: string; weightPct: number }[];
  totalAmount: string;
  assetSymbol: string;
}

interface EnrichedPortfolioProps {
  allocations: {
    token: Address;
    symbol: string;
    decimals: number;
    weightPct: number;
    tokenAmount: string;
    investedAmount: string;
    feeTier: number;
    logo: string | null;
    marketCap: number | null;
  }[];
  totalAmount: string;
  assetSymbol: string;
  assetAddress: Address;
  assetDecimals: number;
  chainId: number;
}

interface ActiveProposalProps {
  proposal: ProposalData | null;
  cooldownEnd: bigint;
  addressNames?: Record<string, string>;
  assetDecimals: number;
  assetSymbol: string;
  portfolioAllocations?: PortfolioAllocProps | null;
  enrichedPortfolio?: EnrichedPortfolioProps | null;
  cbbtcLoopData?: CbBTCLoopData | null;
}

export default function ActiveProposal({
  proposal,
  cooldownEnd,
  addressNames,
  assetDecimals,
  assetSymbol,
  portfolioAllocations,
  enrichedPortfolio,
  cbbtcLoopData,
}: ActiveProposalProps) {
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (!proposal) {
    const inCooldown = cooldownEnd > now;
    return (
      <div className="panel" style={{ borderColor: "var(--color-border)" }}>
        <div className="panel-title">
          <span>Active Strategy</span>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "2rem 0",
            color: "rgba(255,255,255,0.4)",
            fontFamily: "var(--font-plus-jakarta), sans-serif",
            fontSize: "12px",
          }}
        >
          {inCooldown ? (
            <>
              <div style={{ marginBottom: "0.5rem" }}>No active strategy</div>
              <div style={{ color: "#ff4d4d" }}>
                Cooldown: {formatTimeRemaining(cooldownEnd)}
              </div>
            </>
          ) : (
            "No active strategy"
          )}
        </div>
      </div>
    );
  }

  const strategyEnd =
    proposal.executedAt + proposal.strategyDuration;
  const timeLeft = strategyEnd > now ? strategyEnd - now : 0n;
  const title =
    proposal.metadata?.title || `Proposal #${proposal.id.toString()}`;

  return (
    <div
      className="panel"
      style={{
        borderColor: "var(--color-accent)",
        boxShadow: "0 0 15px rgba(46, 230, 166, 0.1)",
      }}
    >
      <div className="panel-title">
        <span>Active Strategy</span>
        <span style={{ color: "var(--color-accent)", fontSize: "9px" }}>
          LIVE
        </span>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "16px",
            color: "#fff",
            fontWeight: 500,
            marginBottom: "0.5rem",
          }}
        >
          {title}
        </div>
        {proposal.metadata?.description && (
          <div
            style={{
              fontSize: "12px",
              color: "rgba(255,255,255,0.5)",
              fontFamily: "var(--font-plus-jakarta), sans-serif",
              lineHeight: 1.5,
              maxHeight: "3em",
              overflow: "hidden",
            }}
          >
            {proposal.metadata.description}
          </div>
        )}
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="metric-card">
          <div className="metric-label">Agent</div>
          <div className="metric-val" style={{ fontSize: "1rem" }}>
            {addressNames?.[proposal.proposer.toLowerCase()] || truncateAddress(proposal.proposer)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Capital Deployed</div>
          <div className="metric-val" style={{ fontSize: "1rem" }}>
            {formatAsset(proposal.deployedCapital, assetDecimals)} {assetSymbol}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Time Remaining</div>
          <div
            className="metric-val"
            style={{
              fontSize: "1rem",
              color:
                timeLeft > 0n ? "var(--color-accent)" : "#ff4d4d",
            }}
          >
            {timeLeft > 0n
              ? formatDuration(timeLeft)
              : "Duration elapsed"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Performance Fee</div>
          <div className="metric-val" style={{ fontSize: "1rem" }}>
            {formatBps(proposal.performanceFeeBps)}
          </div>
        </div>
      </div>

      {/* Portfolio dashboard (enriched) or simple allocation chart */}
      {enrichedPortfolio ? (
        <PortfolioDashboard
          allocations={enrichedPortfolio.allocations}
          totalInvested={enrichedPortfolio.totalAmount}
          assetSymbol={enrichedPortfolio.assetSymbol}
          assetAddress={enrichedPortfolio.assetAddress}
          assetDecimals={enrichedPortfolio.assetDecimals}
          chainId={enrichedPortfolio.chainId}
        />
      ) : portfolioAllocations ? (
        <PortfolioAllocation
          allocations={portfolioAllocations.allocations}
          totalAmount={portfolioAllocations.totalAmount}
          assetSymbol={portfolioAllocations.assetSymbol}
        />
      ) : null}

      {cbbtcLoopData && (
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "rgba(255,255,255,0.02)",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.75rem",
            }}
          >
            Yield Breakdown
          </div>
          <div style={{ display: "grid", gap: "0.6rem", fontSize: "12px", fontFamily: "var(--font-plus-jakarta), sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>cbBTC supply APY (Moonwell)</span>
              <span style={{ color: "var(--color-accent)" }}>{cbbtcLoopData.display.cbBTCSupplyApyPct}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>USDC borrow APR (Moonwell)</span>
              <span>{cbbtcLoopData.display.usdcBorrowAprPct}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>USDC yield (Mamo)</span>
              <span>{cbbtcLoopData.display.mamoUsdcApyPct}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                paddingTop: "0.6rem",
                marginTop: "0.25rem",
                fontWeight: 600,
              }}
            >
              <span>Net APY</span>
              <span style={{ color: cbbtcLoopData.legs.mamoUsdcApy > 0n && cbbtcLoopData.legs.cbBTCSupplyApy + cbbtcLoopData.legs.mamoUsdcApy < cbbtcLoopData.legs.usdcBorrowApr ? "#ff4d4d" : "var(--color-accent)" }}>
                {cbbtcLoopData.display.netApyPct}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
