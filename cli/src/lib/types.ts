/**
 * Chat message types for XMTP syndicate communication.
 *
 * All messages are JSON-encoded ChatEnvelope objects sent via XMTP groups.
 */

export type MessageType =
  // Ops (auto-posted by agent)
  | "TRADE_EXECUTED" // batch executed (tx hash, calls, outcome)
  | "TRADE_SIGNAL" // opportunity being evaluated
  | "POSITION_UPDATE" // current positions, P&L, health factor
  | "RISK_ALERT" // health factor low, stop loss near
  | "LP_REPORT" // periodic performance summary
  // Governance (require response)
  | "APPROVAL_REQUEST" // agent needs human sign-off above threshold
  | "STRATEGY_PROPOSAL" // add new strategy to syndicate
  // Lifecycle (events)
  | "MEMBER_JOIN"
  | "RAGEQUIT_NOTICE"
  | "AGENT_REGISTERED"
  // Human
  | "MESSAGE";

export interface ChatEnvelope {
  type: MessageType;
  from?: string; // sender address
  text?: string; // human messages
  agent?: { erc8004Id?: number; address: string };
  syndicate?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}
