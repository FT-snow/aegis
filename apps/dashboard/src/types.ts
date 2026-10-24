export interface User {
  id: string;
  email: string;
}

export interface TokenBalance {
  token: string;
  symbol: string;
  decimals: number;
  atomic: string;
}

export interface Wallet {
  id: string;
  chain_id?: number;
  chainId?: number;
  address: string;
  owner_address?: string;
  ownerAddress?: string;
  env?: string;
  created_at?: number;
  deployment_status?: string | null;
  deploymentStatus?: string | null;
  deployment_tx_hash?: string | null;
  balance?: TokenBalance | null;
  balanceError?: string | null;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  wallet_id?: string;
  walletId?: string;
  name: string;
  session_key_address?: string;
  sessionKeyAddress?: string;
  profile: string;
  status: string;
  died_at?: number | null;
  death_cause?: string | null;
  created_at?: number;
  wallet_address?: string;
  chain_id?: number;
}

export interface Approval {
  id: string;
  request_id: string | number;
  agent_id?: string;
  target: string;
  amount: string;
  reason: string;
  status: string;
  created_at?: number;
  expires_at?: number;
  decided_by?: string | null;
  decided_at?: number | null;
  decision_tx?: string | null;
}

export interface RuleTrace {
  id: string;
  status: string;
  severity: string;
  expected: string;
  observed: string;
  explanation: string;
}

export interface Passport {
  sequence?: number;
  previousHash?: string | null;
  policyHash?: string;
  passportHash?: string;
  issuedAt?: number;
  policy?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  context?: Record<string, unknown>;
  evaluation?: {
    result?: string;
    dispatch?: string;
    trace?: RuleTrace[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SimulationRun {
  id?: string;
  config?: Record<string, unknown>;
  events?: Array<Record<string, unknown>>;
  passports?: Passport[];
  summary?: {
    seed?: number;
    ticks?: number;
    alive?: boolean;
    endingBalance?: string;
    totalBurned?: string;
    decisions?: { allow: number; needs_approval: number; deny: number };
    blockedAttacks?: number;
    eventHash?: string;
    passportHead?: string | null;
  };
}
