PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_enrollment_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  chain_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  factory_address TEXT NOT NULL,
  salt TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_deployments (
  wallet_id TEXT PRIMARY KEY REFERENCES wallets(id),
  factory_address TEXT NOT NULL,
  salt TEXT NOT NULL,
  account_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('undeployed', 'submitted', 'deployed', 'failed')),
  userop_hash TEXT,
  transaction_hash TEXT,
  deployed_at INTEGER,
  failure_reason TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('local', 'testnet', 'simulation')),
  created_at INTEGER NOT NULL,
  UNIQUE (chain_id, address)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  name TEXT NOT NULL,
  session_key_address TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'dead')),
  died_at INTEGER,
  death_cause TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  key_address TEXT NOT NULL,
  version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (wallet_id, key_address, version)
);

CREATE TABLE IF NOT EXISTS passports (
  passport_hash TEXT PRIMARY KEY,
  wallet_id TEXT,
  agent_id TEXT,
  sequence INTEGER NOT NULL,
  previous_hash TEXT,
  policy_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'needs_approval', 'deny')),
  intent_json TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  userop_hash TEXT,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT,
  log_index INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (wallet_id, sequence)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  request_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  target TEXT NOT NULL,
  amount TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  decision_tx TEXT,
  UNIQUE (wallet_id, request_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  schema_ver INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  env TEXT NOT NULL,
  wallet_id TEXT,
  agent_id TEXT,
  userop_hash TEXT,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT,
  target TEXT,
  amount TEXT,
  token TEXT,
  decision TEXT,
  rule TEXT,
  reason TEXT,
  trace_json TEXT,
  passport_hash TEXT,
  tx_hash TEXT,
  log_index INTEGER,
  block_number INTEGER,
  UNIQUE (env, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS user_operations (
  userop_hash TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  agent_id TEXT REFERENCES agents(id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 84532 OR chain_id = 31337),
  entry_point TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'included', 'confirmed', 'failed', 'dropped')),
  transaction_hash TEXT,
  block_number INTEGER,
  actual_gas_used TEXT,
  actual_gas_cost_wei TEXT,
  failure_reason TEXT,
  passport_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  agent_id TEXT REFERENCES agents(id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 84532 OR chain_id = 31337),
  tx_hash TEXT,
  userop_hash TEXT,
  log_index INTEGER,
  block_number INTEGER,
  token TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'included', 'confirmed', 'failed')),
  source TEXT NOT NULL,
  passport_hash TEXT REFERENCES passports(passport_hash),
  created_at INTEGER NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index),
  UNIQUE (wallet_id, passport_hash)
);
CREATE INDEX IF NOT EXISTS transactions_wallet_time ON transactions(wallet_id, created_at);
CREATE INDEX IF NOT EXISTS transactions_recipient ON transactions(wallet_id, recipient, status);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  passport_hash TEXT,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  level TEXT NOT NULL CHECK (level IN ('low', 'moderate', 'high', 'critical')),
  action TEXT NOT NULL,
  factors_json TEXT NOT NULL,
  base_limits_json TEXT NOT NULL,
  effective_limits_json TEXT NOT NULL,
  proposed_restriction_json TEXT,
  restriction_status TEXT NOT NULL CHECK (restriction_status IN ('not_required', 'proposal_only', 'submitted', 'confirmed', 'failed')),
  controller_userop_hash TEXT,
  controller_tx_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS risk_assessments_wallet_time ON risk_assessments(wallet_id, created_at);

CREATE TABLE IF NOT EXISTS gateway_intents (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 84532 OR chain_id = 31337),
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'needs_approval', 'deny')),
  dispatch TEXT NOT NULL CHECK (dispatch IN ('execute', 'request_approval', 'reject')),
  call_to TEXT,
  call_value TEXT,
  call_data TEXT,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),
  passport_hash TEXT NOT NULL REFERENCES passports(passport_hash),
  risk_assessment_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('denied', 'prepared', 'submitted', 'included', 'confirmed', 'failed')),
  userop_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, intent_id)
);
CREATE INDEX IF NOT EXISTS gateway_intents_wallet_time ON gateway_intents(wallet_id, created_at);
CREATE INDEX IF NOT EXISTS gateway_intents_status ON gateway_intents(status, created_at);

CREATE TABLE IF NOT EXISTS risk_recipient_intelligence (
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('trusted', 'known', 'unknown', 'malicious')),
  source TEXT NOT NULL,
  evidence_hash TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user_time ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id INTEGER NOT NULL,
  indexer TEXT NOT NULL,
  last_scanned_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, indexer)
);
CREATE INDEX IF NOT EXISTS events_wallet_ts ON events(wallet_id, ts);
CREATE INDEX IF NOT EXISTS events_agent_ts ON events(agent_id, ts);
CREATE INDEX IF NOT EXISTS events_userop_hash ON events(userop_hash);
CREATE INDEX IF NOT EXISTS passports_wallet_sequence ON passports(wallet_id, sequence);

CREATE TABLE IF NOT EXISTS sim_runs (
  id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  replay_key TEXT,
  summary_json TEXT
);

CREATE TRIGGER IF NOT EXISTS events_append_only_update
BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_delete
BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS passports_append_only_update
BEFORE UPDATE ON passports BEGIN SELECT RAISE(ABORT, 'passports are append-only'); END;
CREATE TRIGGER IF NOT EXISTS passports_append_only_delete
BEFORE DELETE ON passports BEGIN SELECT RAISE(ABORT, 'passports are append-only'); END;
