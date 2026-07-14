# Chief backend

The Convex schema and server functions for workspaces, authentication, billing, schedules, runs, and shared product data.

## Run locally

```bash
pnpm --filter @chief/backend dev
```

Convex will create or connect a deployment and generate the client bindings.

## Configuration

Set these values in the Convex deployment:

```bash
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
BASE_URL=http://localhost:3000
```

Billing also uses `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. `STRIPE_TRIAL_DAYS` is optional and defaults to 14.

Deploy with:

```bash
pnpm --filter @chief/backend deploy
```
