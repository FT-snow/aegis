export type Decision = "executed" | "blocked" | "pending" | "approved" | "denied";
export type Environment = "local" | "testnet" | "sim";
export type Rule = "per_tx_limit" | "daily_limit" | "recipient" | "contract" | "expiry" | "revoked";

export interface AegisEvent {
  schemaVersion: 1;
  timestamp: string;
  environment: Environment;
  agentId: string;
  userOpHash?: string;
  action: string;
  target: string;
  amount: string;
  decision: Decision;
  rule?: Rule;
  reason?: string;
  txHash?: string;
}

export type KeyStatus = "active" | "paused" | "revoked";
export type ConnectionState = "live" | "reconnecting" | "offline";

export interface WalletSummary {
  id: string;
  name: string;
  address: string;
  usdcBalance: string;
  ethBalance: string;
  deployed: boolean;
  agentCount: number;
  keyStatus: KeyStatus;
  chainId?: number;
}

export interface Policy {
  perTransactionLimit: string;
  dailyLimit: string;
  usedToday: string;
  recipients: string[];
  contracts: string[];
  functions: string[];
  expiresAt: string;
}

export interface PendingRequest {
  id: string;
  agentId: string;
  action: string;
  amount: string;
  recipient: string;
  reason: string;
  rule: Rule;
  expiresAt: string;
}

export interface AuditDecision {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  outcome: Decision;
  detail: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  purpose: string;
  model: string;
  walletId: string;
  status: "active" | "paused" | "revoked" | "draft";
  perTransactionLimit: string;
  dailyLimit: string;
}

export type ApprovalAction = "approve_once" | "approve_and_allow" | "deny";

export interface ArenaAgent {
  id: string;
  name: string;
  balance: number;
  days: number;
  status: "alive" | "dead";
  cause: string;
}

export interface ArenaSnapshot {
  day: number;
  balances: Record<string, number>;
}
