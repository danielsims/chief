# Self-host Chief

This stack runs the same relay Worker, Better Auth server, Drizzle-managed D1
schema, Durable Object classes, R2 artifact API, and WebSocket protocol used by
the Cloudflare deployment. Wrangler hosts the Worker on `workerd` and persists
its D1, Durable Object, and R2 bindings in one host volume. Encrypt that volume
at the host or storage-provider layer in production.

The current self-host profile is deliberately single-node. Upstream `workerd`
still marks local-disk Durable Object storage as experimental and it does not
coordinate multiple replicas, so do not scale the `relay` service horizontally.
Back up the `relay-data` volume and restore it as one unit. Multi-node
self-hosting requires a distributed cell placement and object-store adapter; it
must not be approximated with shared SQLite files.

## Start locally

```bash
pnpm self-host:init
pnpm self-host:up
curl http://localhost:8080/health
```

The default is an HTTP loopback environment at `http://localhost:8080`. Edit
`.env` before starting when native devices or external clients need a stable
HTTPS origin.

## Authentication

Every relay owns its Better Auth database, issuer, signing secret, provider
credentials, and redirect URIs. Tokens from one relay are never copied into or
accepted by another relay.

For Google sign-in, create an OAuth client specifically for this deployment,
set `GOOGLE_CLIENT_ID` in `.env`, write the client secret to
`secrets/google_client_secret`, and register this exact redirect URI:

```text
https://your-chief-host.example/api/auth/callback/google
```

The auth package already enables email/password when Google is absent. The
operator-facing first-user/bootstrap experience and additional Better Auth
providers remain product work; they are not silently emulated by this stack.

## Public TLS

For a directly reachable server, set `CHIEF_SITE_ADDRESS` to the hostname and
`CHIEF_PUBLIC_URL` to its `https://` URL; Caddy obtains and renews TLS
certificates. For a Cloudflare named tunnel, place its token in
`secrets/cloudflare_tunnel_token` and start the tunnel profile:

```bash
pnpm self-host:up:tunnel
```

Configure the named tunnel to forward the public hostname to
`http://gateway:80` and use the same hostname in `CHIEF_PUBLIC_URL`.

## Operations

```bash
pnpm self-host:logs
pnpm self-host:down
pnpm self-host:config
```

`down` preserves all data. To intentionally destroy the local relay, stop the
stack and remove its named volumes explicitly with Docker Compose's `--volumes`
flag. This is not exposed as a convenience script because it deletes auth,
workspaces, artifacts, and agent registration state together.

Images run as an unprivileged user, drop Linux capabilities, set
`no-new-privileges`, use read-only root filesystems where possible, bound log
rotation, explicit health checks, graceful shutdown windows, one-shot schema
migrations, and Docker secrets rather than source-controlled credentials.
