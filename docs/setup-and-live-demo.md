# Setup and live-demo checklist

## Local prerequisites

- Node.js 20+ and npm 10+
- Foundry (`forge`) for contract tests; Foundry is not needed for the TypeScript/solc checks
- A local RPC and deployed EntryPoint v0.7, Aegis factory/account, and USDC mock for local-chain flows
- For Base Sepolia: an RPC, a v0.7-compatible bundler, deployed Aegis contracts, test USDC, test ETH, and a Turso database

There is no mainnet configuration. Worker chain selection accepts Base Sepolia, or `31337` only when `APP_ENV=local`.

### Base Sepolia access

- Network name: **Base Sepolia**; chain ID: **84532**; currency: **ETH**.
- Public RPC: [`https://sepolia.base.org`](https://sepolia.base.org) (rate-limited; use a provider URL for sustained development).
- Explorer: [`https://sepolia.basescan.org`](https://sepolia.basescan.org).
- Test ETH/USDC faucet options are listed in the [official Base funding guide](https://docs.base.org/get-started/get-funds); the guide links the Coinbase Developer Platform faucet and Circle's USDC faucet.
- Base's [network reference](https://docs.base.org/chain/network-information) lists network endpoints and IDs.

## Install and validate

```sh
npm install
npm run check
npm run worker:dry-run
npm run demo
```

`npm run check` covers TypeScript, kit/simulation/Worker tests, and an optimized `viaIR` Solidity compilation. `npm run contracts:test` invokes Foundry when installed. A successful local check is not an audit or a testnet acceptance result.

## Worker configuration

Copy `.env.example` to `apps/worker/.dev.vars`. Keep real credentials out of source control. Configure:

- `APP_ENV=local` and `ALLOWED_CHAIN_IDS=84532,31337` for local development. Use only `84532` for testnet.
- `RPC_URL` for the one selected chain, `AEGIS_FACTORY_ADDRESS`, and `ENTRY_POINT_ADDRESS` (EntryPoint v0.7).
- `USDC_ADDRESS`: the official Base Sepolia USDC address for chain `84532`; use a deployed local mock and allow only `31337` for local tests.
- `BUNDLER_URL` for relaying signed UserOperations. Gateway intent preflight checks policy and returns a prepared call; `/api/gateway/intent/submit` relays an agent-signed operation but never signs on the agent's behalf.
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for persistent user, wallet, agent, policy, risk, and event records.
- `AGENT_TOKEN_PEPPER` as a high-entropy secret of at least 32 characters. Only a keyed digest of an agent bearer credential is stored.
- Optional OpenRouter and x402 variables only for those integrations.

The risk-controller private key is not a Worker secret and is not accepted by an API handler. Keep it in the separate controller signer; owner keys and session-key private material stay client-side.

Apply the initial Turso migration using a local shell with the database credentials set:

```sh
TURSO_DATABASE_URL='libsql://...' TURSO_AUTH_TOKEN='...' npx tsx apps/worker/scripts/migrate.ts
```

For deployed simulation archives, create the R2 bucket named in `apps/worker/wrangler.jsonc` before deployment. The Durable Object remains the primary simulation store; R2 export recovery verifies deterministic event/passport hashes before restoring an archived run.

## Enrollment and demo boundaries

1. Start the Worker and dashboard; register/sign in with a test account.
2. Deploy the factory and account using the configured test chain. Wallet enrollment predicts the account from the factory/owner/salt and requires an owner-signed enrollment challenge. Undeployed counterfactual addresses can be enrolled; the owner relay can deploy them only with the exact enrolled factory and `createAccount(owner, salt)` factory data.
3. Add a session key using an owner-signed on-chain call. Register an agent only after the Worker verifies the confirmed `KeyAdded` event and active on-chain key configuration.
4. Send an authenticated agent intent to `/api/gateway/intent`. The returned decision, passport, and call are preflight artifacts. `allow` does not mean submitted or confirmed.
5. High/critical ARE output is advisory. A controller call is only a proposal; restrictions are active only after a separate controller-signed UserOperation is included and confirmed.
6. Approval actions return calldata for the owner wallet to sign. Relay the signed operation, then call `POST /api/userops/:hash/sync`; UI/API status must remain pending until its receipt has five confirmations and is indexed.
7. Run the deterministic simulation separately. Its ledger is simulated; it does not transfer tokens.

## Acceptance still required

- Foundry: bundle-ordering regression tests **pass** (stale-controller epoch invalidation, execution-time session validity recheck). Broader coverage — session budget reservation/direct bundler bypass, approval bounds, ARE monotonicity, ownership — still to be written.
- Local bundler simulation plus Base Sepolia acceptance for counterfactual deployment, owner/session UserOperations, approvals, restrictions, receipt sync, and event indexing.
- Turso migration/recovery exercise, WalletRoom/indexer finality, and R2 archive/replay checks.

Until those are completed, do not present controller activation or testnet settlement as verified. Receipt indexing currently runs only when the owner calls the sync endpoint; no background indexer or live update channel is configured.
