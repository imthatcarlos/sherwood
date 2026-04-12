import { notFound } from "next/navigation";
import TorusKnotBackground from "@/components/TorusKnotBackground";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SyndicateClient from "@/components/SyndicateClient";
import ActiveProposal from "@/components/proposals/ActiveProposal";
import ProposalCard from "@/components/proposals/ProposalCard";
import ProposalHistory from "@/components/proposals/ProposalHistory";
import AgentStats from "@/components/proposals/AgentStats";
import { resolveSyndicateBySubdomain } from "@/lib/syndicate-data";
import {
  fetchGovernorData,
  ProposalState,
  type ProposalData,
  type GovernorData,
} from "@/lib/governor-data";
import { formatBps, getAddresses } from "@/lib/contracts";
import { formatDuration } from "@/lib/governor-data";
import { fetchPortfolioData } from "@/lib/portfolio-data";
import { fetchCbBTCLoopData, type CbBTCLoopData } from "@/lib/cbbtc-loop-data";
import type { Address } from "viem";

// ── Page ────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const data = await resolveSyndicateBySubdomain(subdomain);
  const name = data?.metadata?.name || subdomain;
  return { title: `Sherwood // ${name} — Proposals` };
}

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const data = await resolveSyndicateBySubdomain(subdomain);

  if (!data) {
    notFound();
  }

  const name =
    data.metadata?.name || `Syndicate #${data.syndicateId.toString()}`;

  // Build address → display name map from agent identities
  const addressNames: Record<string, string> = {};
  for (const agent of data.agents) {
    const displayName = agent.identity?.name || `Agent #${agent.agentId.toString()}`;
    addressNames[agent.agentAddress.toLowerCase()] = displayName;
  }
  const creatorKey = data.creator.toLowerCase();
  const hasIdentityRegistry = getAddresses(data.chainId).identityRegistry !== "0x0000000000000000000000000000000000000000";

  const governor = await fetchGovernorData(data.vault, data.chainId);

  // Enrich proposals with P&L from activity feed
  if (governor && data.activity.length > 0) {
    for (const proposal of governor.proposals) {
      const settled = data.activity.find(
        (a) => a.type === "settled" && a.proposalId === proposal.id,
      );
      if (settled && settled.pnl !== undefined) {
        proposal.pnl = settled.pnl;
      }
    }
  }

  const activeProposal =
    governor?.proposals.find(
      (p) => p.computedState === ProposalState.Executed,
    ) ?? null;

  // Fetch portfolio strategy data if active proposal exists
  let portfolioAllocations: {
    allocations: { symbol: string; weightPct: number }[];
    totalAmount: string;
    assetSymbol: string;
  } | null = null;

  let enrichedPortfolio: {
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
  } | null = null;

  // Detector for the bespoke MoonwellCbBTCLoopMamoStrategy (agent-authored loop).
  // Returns null unless the active proposal's execute calls hit a clone whose
  // name() matches. Non-loop proposals are unaffected.
  let cbbtcLoopData: CbBTCLoopData | null = null;

  if (activeProposal && governor) {
    cbbtcLoopData = await fetchCbBTCLoopData(
      governor.governorAddress,
      activeProposal.id,
      data.chainId,
    );

    const portfolioData = await fetchPortfolioData(
      governor.governorAddress,
      activeProposal.id,
      data.chainId,
      data.assetDecimals,
      data.assetSymbol,
    );
    if (portfolioData) {
      portfolioAllocations = {
        allocations: portfolioData.allocations.map((a) => ({
          symbol: a.symbol,
          weightPct: a.targetWeightBps / 100,
        })),
        totalAmount: portfolioData.totalAmount,
        assetSymbol: portfolioData.assetSymbol,
      };

      // Build enriched data for PortfolioDashboard
      enrichedPortfolio = {
        allocations: portfolioData.allocations.map((a) => ({
          token: a.token,
          symbol: a.symbol,
          decimals: a.decimals,
          weightPct: a.targetWeightBps / 100,
          tokenAmount: a.tokenAmount,
          investedAmount: a.investedAmount,
          feeTier: a.feeTier,
          logo: a.logo,
          marketCap: a.marketCap,
        })),
        totalAmount: portfolioData.totalAmount,
        assetSymbol: portfolioData.assetSymbol,
        assetAddress: portfolioData.assetAddress,
        assetDecimals: portfolioData.assetDecimals,
        chainId: data.chainId,
      };
    }
  }

  const votingQueue = governor?.proposals.filter(
    (p) =>
      p.computedState === ProposalState.Pending ||
      p.computedState === ProposalState.Approved,
  ) ?? [];

  return (
    <>
      <TorusKnotBackground
        radius={10}
        tube={0.2}
        tubularSegments={128}
        radialSegments={16}
        p={3}
        q={4}
        opacity={0.15}
        fogDensity={0.08}
      />
      <div className="scanlines" style={{ opacity: 0.2 }} />

      <div className="layout layout-normal">
        <main className="px-4 md:px-8 lg:px-16 mx-auto w-full max-w-[1400px]">
          <SiteHeader />

          <SyndicateClient
            name={name}
            subdomain={subdomain}
            vault={data.vault}
            creator={data.creator}
            creatorName={addressNames[creatorKey]}
            paused={data.paused}
            chainId={data.chainId}
            assetDecimals={data.assetDecimals}
            assetSymbol={data.assetSymbol}
            activeTab="proposals"
            hideAgentsTab={!hasIdentityRegistry}
          />

          {/* Governor params bar */}
          {governor && (
            <div className="stats-bar">
              <div className="stat-item">
                <div className="stat-label">Voting Period</div>
                <div className="stat-value" style={{ fontSize: "1.2rem" }}>
                  {formatDuration(governor.params.votingPeriod)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Veto Threshold</div>
                <div className="stat-value" style={{ fontSize: "1.2rem" }}>
                  {formatBps(governor.params.vetoThresholdBps)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Max Fee</div>
                <div className="stat-value" style={{ fontSize: "1.2rem" }}>
                  {formatBps(governor.params.maxPerformanceFeeBps)}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Cooldown</div>
                <div className="stat-value" style={{ fontSize: "1.2rem" }}>
                  {formatDuration(governor.params.cooldownPeriod)}
                </div>
              </div>
            </div>
          )}

          {/* Active Strategy */}
          <div>
            <ActiveProposal
              proposal={activeProposal}
              cooldownEnd={governor?.cooldownEnd ?? 0n}
              addressNames={addressNames}
              assetDecimals={data.assetDecimals}
              assetSymbol={data.assetSymbol}
              portfolioAllocations={portfolioAllocations}
              enrichedPortfolio={enrichedPortfolio}
              cbbtcLoopData={cbbtcLoopData}
            />
          </div>

          {/* Voting Queue */}
          {votingQueue.length > 0 && (
            <div style={{ marginTop: "1.5rem" }}>
              <div
                className="panel-title"
                style={{ marginBottom: "1rem" }}
              >
                <span>Voting Queue</span>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "9px" }}>
                    {votingQueue.length} PENDING
                  </span>
                </div>
              </div>
              {votingQueue.map((p) => (
                <ProposalCard
                  key={p.id.toString()}
                  proposal={p}
                  governorAddress={governor!.governorAddress}
                  params={governor!.params}
                  assetDecimals={data.assetDecimals}
                  addressNames={addressNames}
                />
              ))}
            </div>
          )}

          {/* History + Agent Stats grid */}
          {governor && (
            <div className="grid-dashboard" style={{ marginTop: "1.5rem" }}>
              <ProposalHistory
                proposals={governor.proposals}
                assetDecimals={data.assetDecimals}
                assetSymbol={data.assetSymbol}
                addressNames={addressNames}
              />
              <AgentStats
                proposals={governor.proposals}
                assetDecimals={data.assetDecimals}
                assetSymbol={data.assetSymbol}
                addressNames={addressNames}
              />
            </div>
          )}
        </main>
      </div>

      <SiteFooter />
    </>
  );
}
