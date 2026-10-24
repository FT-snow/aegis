# Aegis dashboard (temporary)

A plain React + TypeScript API test dashboard for the Aegis Worker. This workspace is intended to be replaced by the product frontend.

## Development

From this directory:

```sh
npm install --workspaces=false --package-lock=false
npm run dev
```

Build and preview:

```sh
npm run build
npm run preview
```

The dashboard calls relative `/api` paths by default. When the Worker is hosted separately, set `VITE_API_BASE_URL` to its origin or API base before starting/building the dashboard. For example:

```sh
VITE_API_BASE_URL=https://aegis-api.example.com npm run dev
```

If the value already ends in `/api`, it is used as-is. The API must allow credentialed requests from the dashboard origin when hosted separately. Authenticated write requests send the `aegis_csrf` cookie value in the `X-CSRF-Token` header.

## Notes

- Login and registration use the existing Worker auth endpoints.
- Wallet transfers and approval actions only prepare calls. This dashboard does not sign, submit, or confirm them.
- Lab passports are sample evidence, not on-chain transactions. Passport verification uses the Worker verifier endpoint.
- Simulations are deterministic API runs and do not represent live chain activity.
- ARE/agent proposals are advisory only and have no signing or execution authority.
- Wallet enrollment, agent enrollment, and revocation are not included in this temporary UI.
