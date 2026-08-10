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

Google sign-in uses a Web application OAuth client because the callback is
handled by the hosted Better Auth server, not by the desktop binary. Configure
the client with the callback for the environment it belongs to:

```text
Development: http://localhost:3000/api/auth/callback/google
Production:  https://heychief.sh/api/auth/callback/google
```

Keep development and production OAuth clients separate. Set production values
on the production Convex deployment rather than in the web or desktop app:

```bash
pnpm --filter @chief/backend exec convex env set AUTH_GOOGLE_ID --prod
pnpm --filter @chief/backend exec convex env set AUTH_GOOGLE_SECRET --prod
pnpm --filter @chief/backend exec convex env set BASE_URL https://heychief.sh --prod
openssl rand -base64 32 | pnpm --filter @chief/backend exec convex env set AUTH_SECRET --prod
```

Omit secret values from the command line and paste them into the interactive
prompt so they do not enter shell history.

The website and packaged desktop app only receive public routing values. Both
must point at the same production deployment as the credentials above:

```text
Web hosting
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site

Packaged desktop build
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_AUTH_BASE_URL=https://<your-domain>
```

Do not put `AUTH_GOOGLE_SECRET` in either app. `NEXT_PUBLIC_*` and `VITE_*`
values are embedded into client bundles and are intentionally public.

Billing also uses `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. `STRIPE_TRIAL_DAYS` is optional and defaults to 14.

Deploy with:

```bash
pnpm --filter @chief/backend deploy
```
