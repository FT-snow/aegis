# AEGIS dashboard

The React + TypeScript dashboard for AEGIS. Deploy this directory as the `aegis` Cloudflare Worker; do not use `packages/web`.

## Local development

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8787` by default. Run the Worker separately with `npm run dev` from the repository root. To point the dashboard at a different local API, set `VITE_API_BASE_URL` to its origin before starting Vite.

## Cloudflare Workers Builds

Connect `FT-snow/aegis`, production branch `main`, and set under **Workers & Pages → aegis → Settings → Builds**:

- Root directory: `apps/dashboard`
- Build command: `npm ci && npm run typecheck:functions && npm run build`
- Deploy command: `npm run deploy`
- Build environment variable: `NODE_VERSION=22` (Production and Preview)

`wrangler.jsonc` deploys `dist` as static assets, provides SPA route fallback, and routes `/api/*` through a service binding to the `aegis-api` Worker. No dashboard API-origin variable is needed. Leave `VITE_API_BASE_URL` unset. API secrets and variables remain on the separate `aegis-api` Worker; set its `DASHBOARD_ORIGINS` to the dashboard Worker's exact public origin.

Deploy the API Worker separately with `npm run worker:production:dry-run` followed by `npm run worker:deploy`. Create the `aegis-sim-archives` R2 bucket before deploying. Set the Worker variables and secrets in `deployment/cloudflare/`; never put Worker secrets in Pages build variables.

The Pages-specific `functions/api/[[path]].ts` and `public/_redirects` are retained for compatibility; Wrangler deploys the Worker and assets configured in `wrangler.jsonc`.

## Environment templates

- [`deployment/cloudflare/pages.env.example`](../../deployment/cloudflare/pages.env.example): Pages Functions runtime variable.
- [`deployment/cloudflare/worker.vars.example`](../../deployment/cloudflare/worker.vars.example): Worker non-secret variables.
- [`deployment/cloudflare/worker.secrets.example`](../../deployment/cloudflare/worker.secrets.example): Worker secrets. Replace every placeholder with real deployment values; these templates are not valid production credentials.
