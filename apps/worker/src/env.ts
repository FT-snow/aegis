import type { EvaluationContext } from "@aegis/kit";

export interface Env {
  APP_ENV: "local" | "testnet" | "simulation" | string;
  LAB_ENABLED?: string;
  ALLOWED_CHAIN_IDS?: string;
  ARE_LOW_MAX?: string;
  ARE_MODERATE_MAX?: string;
  ARE_HIGH_MAX?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  BUNDLER_URL?: string;
  BUNDLER_FALLBACK_URL?: string;
  RPC_URL?: string;
  AEGIS_ACCOUNT_ADDRESS?: string;
  AEGIS_FACTORY_ADDRESS?: string;
  ENTRY_POINT_ADDRESS?: string;
  USDC_ADDRESS?: string;
  X402_PAY_TO?: string;
  X402_FACILITATOR_URL?: string;
  X402_PRICE?: string;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  AGENT_TOKEN_PEPPER?: string;
  SESSION_ENCRYPTION_KEY?: string;
  DASHBOARD_ORIGINS?: string;
  SIM_ARCHIVE?: R2Bucket;
  PASSPORT_LEDGER: DurableObjectNamespace;
  SIM_RUNS: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  WALLET_ROOMS: DurableObjectNamespace;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  sessionId: string;
}

export interface AgentObservation {
  agentId: string;
  balance: string;
  chainTimestamp: number;
  context: EvaluationContext;
  untrustedPageText?: string;
  lastActions: Array<{ action: string; decision: string; reason?: string }>;
}
