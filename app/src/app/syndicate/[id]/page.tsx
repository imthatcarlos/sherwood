import TorusKnotBackground from "@/components/TorusKnotBackground";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import EquityCurveChart from "@/components/EquityCurveChart";
import { getSyndicateDetail } from "@/lib/mock-data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getSyndicateDetail(id);
  return { title: `Sherwood // Agent Detail: ${detail.name}` };
}

export default async function SyndicateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getSyndicateDetail(id);

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
        <main className="px-16 mx-auto w-full max-w-[1400px]">
          <SiteHeader />

          {/* Agent header */}
          <div className="agent-header">
            <div>
              <span className="section-num">
                // AGENT_PROFILE_{id.toUpperCase().replace(/[^A-Z0-9]/g, "")}
              </span>
              <h1 className="text-5xl font-medium tracking-tight text-white font-[family-name:var(--font-inter)]">
                {detail.name}{" "}
                <span className="glitch-tag text-[11px] px-2.5 py-1 align-middle ml-4">
                  {detail.tag}
                </span>
              </h1>
            </div>
            <div>
              <button className="btn-action">[ COPY STRATEGY ]</button>
            </div>
          </div>

          {/* Dashboard grid */}
          <div className="grid-dashboard">
            {/* Top-left: Equity Curve */}
            <div className="panel">
              <EquityCurveChart data={detail.equityCurve} hwm={detail.hwm} />
            </div>

            {/* Top-right: Risk Assessment */}
            <div className="panel">
              <div className="panel-title">Risk Assessment</div>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-label">Volatility</div>
                  <div className="metric-val">{detail.risk.volatility}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Sharpe</div>
                  <div className="metric-val">{detail.risk.sharpe}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Max DD</div>
                  <div className="metric-val" style={{ color: "#ff4d4d" }}>
                    {detail.risk.maxDrawdown}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Alpha Gen</div>
                  <div className="metric-val">{detail.risk.alphaGen}</div>
                </div>
              </div>
              <div className="param-list" style={{ marginTop: "1.5rem" }}>
                {detail.params.map((p) => (
                  <div className="param-row" key={p.key}>
                    <span className="param-key">{p.key}</span>
                    <span className="param-val">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom-left: Trade History */}
            <div className="panel">
              <div className="panel-title">Trade History Log</div>
              <table className="log-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Asset</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>PnL</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.trades.map((trade, i) => (
                    <tr key={i}>
                      <td>{trade.timestamp}</td>
                      <td>{trade.asset}</td>
                      <td
                        style={{
                          color:
                            trade.side === "LONG"
                              ? "var(--color-accent)"
                              : "#ff4d4d",
                        }}
                      >
                        {trade.side}
                      </td>
                      <td>{trade.size}</td>
                      <td
                        style={{
                          color: trade.pnlPositive
                            ? "var(--color-accent)"
                            : "#ff4d4d",
                        }}
                      >
                        {trade.pnl}
                      </td>
                      <td
                        style={
                          trade.status === "OPEN"
                            ? { color: "var(--color-accent)" }
                            : undefined
                        }
                      >
                        [{trade.status}]
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom-right: Live Intelligence Feed */}
            <div className="panel">
              <div className="panel-title">
                <span>Live Intelligence Feed</span>
                <span style={{ color: "var(--color-accent)" }}>REAL-TIME</span>
              </div>
              {detail.feed.map((item) => (
                <div
                  className="feed-item"
                  key={item.id}
                  style={
                    item.dimmed
                      ? { opacity: 0.5, borderBottom: "none" }
                      : undefined
                  }
                >
                  <div
                    className="feed-indicator"
                    style={
                      item.dimmed
                        ? {
                            background: "rgba(255,255,255,0.2)",
                            boxShadow: "none",
                          }
                        : undefined
                    }
                  />
                  <div>
                    <div style={{ color: "#fff" }}>{item.message}</div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: "9px",
                        marginTop: "2px",
                      }}
                    >
                      {item.time} // {item.source}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      <SiteFooter
        left="&copy; 2024 Sherwood Protocol // Agent Telemetry"
        right="Live Feed // API Docs // Governance"
      />
    </>
  );
}
