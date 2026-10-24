# Cloudflare deployment

The current dashboard and API are separate Cloudflare deployments. The Pages site serves the UI and proxies `/api/*` to the Worker so browser authentication stays same-origin.

## Dashboard on Cloudflare Pages

Connect `FT-snow/aegis` and use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `apps/dashboard` |
| Build command | `npm ci && npm run typecheck:functions && npm run build` |
| Build output directory | `dist` |
| Node.js version | `22` |

In the Pages project's Functions runtime variables, add `AEGIS_API_ORIGIN` with the API Worker origin only, for example `https://aegis-api.<your-account>.workers.dev`. Do not append `/api`. Do not set `VITE_API_BASE_URL` when using the Pages proxy. Pages includes the `/api/*` function and the SPA fallback from `public/_redirects`.

## API Worker

The production config is `apps/worker/wrangler.production.jsonc`; it locks the deployment to Base Sepolia (`84532`), disables lab endpoints, enables observability, and retains the existing Durable Object and R2 bindings. Before deploying:

1. Create the `aegis-sim-archives` R2 bucket in the same Cloudflare account.
2. Add the values from `deployment/cloudflare/worker.vars.example` and `worker.secrets.example` to the `aegis-api` Worker. Keep the dashboard origin exact (scheme + hostname, no path) in `DASHBOARD_ORIGINS`.
3. Apply the Turso migration using the production database credentials from a secure shell.
4. Validate and deploy from the repository root:

   ```sh
   npm ci
   npm run worker:production:dry-run
   npm run worker:deploy
   ```

The production config's fixed vars are in Wrangler. `keep_vars` preserves additional variables entered in the Cloudflare dashboard. Worker secrets are managed separately from Pages variables and survive normal redeploys.

## Environment files

The files in `deployment/cloudflare/` are **templates**: substitute actual origins, deployed addresses, and provider credentials before use. Pages and Worker settings are separate; never import Worker secrets into Pages build variables. The Pages template has only `AEGIS_API_ORIGIN`. Worker secret values are not available from Git and must be copied from your secure local secret store or provider dashboards.

For production testnet use, set `APP_ENV=production`, `LAB_ENABLED=false`, and `ALLOWED_CHAIN_IDS=84532`. Mainnet is not supported. The dashboard does not need any private key; signing material stays client-side.

## Common deployment/runtime failures

| Error or symptom | Likely fix |
| --- | --- |
| Pages returns 404 after refreshing `/overview` or another route | Keep `public/_redirects` and deploy with root directory `apps/dashboard`. |
| API reports `API_PROXY_NOT_CONFIGURED` | Set Pages Functions runtime variable `AEGIS_API_ORIGIN` to the deployed Worker origin. |
| API reports `API_PROXY_ORIGIN_INVALID` | Use only an `https://` Worker origin, without a path, query, or `/api` suffix. |
| Login/session does not persist | Use the Pages `/api` proxy and leave `VITE_API_BASE_URL` unset. Direct requests between default `pages.dev` and `workers.dev` are cross-site while auth cookies are `SameSite=Lax`. |
| `DATABASE_NOT_CONFIGURED` | Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the Worker, then apply the migration. |
| `RPC_NOT_CONFIGURED`, `BUNDLER_NOT_CONFIGURED`, or wallet enrollment errors | Set the Base Sepolia RPC, compatible bundler, and deployed `AEGIS_FACTORY_ADDRESS`; confirm the worker is on chain `84532`. |
| `AGENT_TOKEN_PEPPER_NOT_CONFIGURED` | Set a stable, random `AGENT_TOKEN_PEPPER` of at least 32 characters. |
| Wrangler reports the R2 bucket is missing | Create `aegis-sim-archives` before `worker:deploy`. |
| Agent payment is not submitted | The gateway checks intent and relays an agent-signed UserOperation; it does not sign it. The agent must sign locally, and the wallet's on-chain policy remains authoritative. |

Run `npm run dashboard:build`, `npm run worker:production:dry-run`, and `npm run check` before publishing. A successful bundle check does not verify live provider credentials or testnet settlement.
