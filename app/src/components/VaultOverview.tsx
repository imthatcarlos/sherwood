import { formatBps } from "@/lib/contracts";

interface VaultOverviewProps {
  openDeposits: boolean;
  totalSupply: bigint;
  paused: boolean;
  redemptionsLocked: boolean;
  managementFeeBps: bigint;
  assetDecimals: number;
}

export default function VaultOverview({
  openDeposits,
  totalSupply,
  paused,
  redemptionsLocked,
  managementFeeBps,
  assetDecimals,
}: VaultOverviewProps) {
  return (
    <div className="panel">
      <div className="panel-title">Vault Configuration</div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Open Deposits</div>
          <div
            className="metric-val"
            style={{ color: openDeposits ? "var(--color-accent)" : "var(--color-loss, #FF5000)" }}
          >
            {openDeposits ? "YES" : "NO"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Management Fee</div>
          <div className="metric-val">{formatBps(managementFeeBps)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Redemptions</div>
          <div
            className="metric-val"
            style={{ color: redemptionsLocked ? "var(--color-loss, #FF5000)" : "var(--color-accent)" }}
          >
            {redemptionsLocked ? "LOCKED" : "OPEN"}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Status</div>
          <div
            className="metric-val"
            style={paused ? { color: "var(--color-loss, #FF5000)" } : { color: "var(--color-accent)" }}
          >
            {paused ? "PAUSED" : "ACTIVE"}
          </div>
        </div>
      </div>

      <div className="param-list" style={{ marginTop: "1.5rem" }}>
        <div className="param-row">
          <span className="param-key">Total Shares</span>
          <span className="param-val">
            {(Number(totalSupply) / 10 ** (assetDecimals * 2)).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
