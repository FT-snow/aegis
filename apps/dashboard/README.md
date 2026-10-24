# AEGIS dashboard

The React + TypeScript dashboard for AEGIS. Deploy this directory to Cloudflare Pages; do not use `packages/web` for the current dashboard.

## Local development

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8787` by default. Run the Worker separately with `npm run dev` from the repository root. To point the dashboard at a different local API, set `VITE_API_BASE_URL` to its origin before starting Vite.

## Cloudflare Pages

Connect `FT-snow/aegis`, production branch `main`, and set:

- Root directory: `apps/dashboard`
- Build command: `npm ci && npm run typecheck:functions && npm run build`
- Build output directory: `dist`
- Node.js version: `22`

The `functions/api/[[path]].ts` Pages Function proxies `/api/*` to the Worker, keeping authentication cookies same-origin in the browser. Add `AEGIS_API_ORIGIN` as a **Pages Functions runtime variable** and set it to the Worker origin, for example `https://aegis-api.<your-account>.workers.dev` (no `/api` suffix). Leave `VITE_API_BASE_URL` unset for this deployment. `public/_redirects` provides SPA route fallback on refresh.

Deploy the API Worker separately with `npm run worker:production:dry-run` followed by `npm run worker:deploy`. Create the `aegis-sim-archives` R2 bucket before deploying. Set the Worker variables and secrets in `deployment/cloudflare/`; never put Worker secrets in Pages build variables.

For a direct browser-to-Worker API connection instead of the Pages proxy, set `VITE_API_BASE_URL` to the Worker origin and configure `DASHBOARD_ORIGINS` to the exact dashboard origin. Use Pages and Worker custom domains under the same parent domain for reliable session cookies; the default `pages.dev` and `workers.dev` domains are cross-site.

## Environment templates

- [`deployment/cloudflare/pages.env.example`](../../deployment/cloudflare/pages.env.example): Pages Functions runtime variable.
- [`deployment/cloudflare/worker.vars.example`](../../deployment/cloudflare/worker.vars.example): Worker non-secret variables.
- [`deployment/cloudflare/worker.secrets.example`](../../deployment/cloudflare/worker.secrets.example): Worker secrets. Replace every placeholder with real deployment values; these templates are not valid production credentials.
