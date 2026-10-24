# Aegis

Aegis is a policy-enforcing wallet prototype for AI agents. Its differentiator is the **Decision Passport**: a deterministic, hash-linked receipt that captures the policy snapshot, proposed action, decision trace, and optional Adaptive Risk Engine (ARE) assessment hash. The account contract—not an LLM or API response—remains the execution authority.

## Repository

- `packages/kit`: policy schemas/evaluator, Decision Passport verification, ARE scoring, and the permissionless.js adapter.
- `packages/sim-core`: seeded, deterministic policy simulation.
- `apps/worker`: Hono API for auth, wallet enrollment, transfer preparation, agent registration, gateway preflight, approvals, passports, and simulation.
- `contracts`: ERC-4337 v0.7 smart account and deterministic factory.
- `apps/dashboard`: current React + TypeScript product dashboard. Use this directory for the Cloudflare Pages deployment.
- `packages/web`: separate frontend package; it is not the current Cloudflare Pages dashboard target.

## Quick checks

Requirements: Node.js 20+, npm 10+, and Foundry for Solidity tests.

```sh
npm install
npm run check                 # TypeScript, package tests, optimized viaIR Solidity compile
npm run worker:dry-run        # Cloudflare Worker bundle/config validation
npm run dashboard:build       # Dashboard TypeScript check and production bundle
npm run worker:production:dry-run # Validate production Worker deployment config
npm run demo                  # Local deterministic passport demonstration
```

To start the Worker API:

```sh
cp .env.example apps/worker/.dev.vars
# Fill only the test/local values described in docs/setup-and-live-demo.md.
npm run dev
```

For Cloudflare Pages and Worker deployment settings, environment templates, and known deployment caveats, see [`apps/dashboard/README.md`](apps/dashboard/README.md) and [`deployment/cloudflare/`](deployment/cloudflare/).

## Trust and chain limits

1. Model output and browser-provided state are untrusted proposals; owner/session signing keys stay in the browser.
2. Worker policy evaluation and ARE scores are preflight/advisory. Only account validation authorizes a session operation.
3. Session operations bind a Decision Passport hash into the UserOperation signature.
4. ARE restriction proposals are **not active** until separately signed by the configured risk controller and confirmed on-chain. The controller can only tighten/freeze; owner recovery is required to clear restrictions.
5. Supported chains are Base Sepolia (`84532`) and local `31337` only when `APP_ENV=local`. Mainnet is intentionally rejected.

## Prototype limits

The gateway evaluates against RPC-derived account/session state and returns `allow`, `needs_approval`, or `deny` plus a call proposal. That response is not an authorization. Owner and agent relays accept signed UserOperations; the owner relay supports counterfactual deployment only through the enrolled factory and exact owner/salt data. `/api/userops/:hash/sync` checks the bundler receipt, waits for five confirmations, and then indexes Aegis account logs for submitted operations. This is request-driven receipt indexing, not a background chain-wide indexer. Approval endpoints prepare owner-signed calls; they do not sign them. WalletRoom live updates, Foundry security tests, and authenticated live-chain acceptance remain outstanding. Do not treat this prototype as audited or production-ready.

## Setup and demo

See [`docs/setup-and-live-demo.md`](docs/setup-and-live-demo.md) for local/testnet configuration, Turso migration, wallet enrollment, credentials, risk-controller boundaries, and the current live-demo checklist.
