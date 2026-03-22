/**
 * Shared types for the multi-agent simulation orchestrator.
 */

export interface SimConfig {
  mnemonic: string; // from SIM_MNEMONIC env
  agentCount: number; // default 12
  syndicateCount: number; // default 5
  baseDir: string; // default /tmp/sherwood-sim/agents
  stateFile: string; // default /tmp/sherwood-sim/state.json
  sherwoodBin: string; // path to CLI entry (cli/src/index.ts)
  rpcUrl: string; // from BASE_RPC_URL
  dryRun: boolean; // from SIM_DRY_RUN
  fundAmountEth: string; // default "0.002"
  fundAmountUsdc: string; // default "50"
}

export interface AgentState {
  index: number;
  address: string;
  privateKey: string;
  role: "creator" | "joiner";
  persona: string;
  agentId?: number; // ERC-8004 token ID
  syndicateSubdomain?: string;
  syndicateVault?: string;
  funded: boolean;
  identityMinted: boolean;
  syndicateCreated: boolean;
  joinRequested: boolean;
  approved: boolean;
  deposited: boolean;
  lastHeartbeat?: number;
}

export interface SyndicateState {
  subdomain: string;
  name: string;
  creatorIndex: number;
  vault?: string;
  members: number[]; // agent indices
  proposals: ProposalState[];
}

export interface ProposalState {
  id?: number;
  proposerIndex: number;
  strategy: string;
  state: "proposed" | "voted" | "executed" | "settled";
}

export interface SimState {
  agents: AgentState[];
  syndicates: SyndicateState[];
  phase: number;
  lastRun: number;
}
