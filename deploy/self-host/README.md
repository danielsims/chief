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

Initialization also creates a stable public relay identifier in
`secrets/relay_id`. Keep that file with the relay's persisted data when moving
or restoring the deployment. Clients and observability use the identifier to
distinguish relays even when their hostname changes.

The `computer` service is a separate container in the same stack. It gives each
workspace agent an isolated persistent root with shell, Git, files, Chromium,
and a live browser viewport. Run it by itself with:

```bash
docker compose --file deploy/self-host/compose.yaml up --build computer
```

For a Cloudflare-hosted relay, expose port 8788 through a private or named
tunnel, set `CHIEF_COMPUTER_PUBLIC_URL` to that HTTPS URL, and configure the
relay's `COMPUTER_BASE_URL` and `COMPUTER_AUTH_SECRET` secrets. The relay sends
only short-lived agent-scoped leases; the long-lived shared key never reaches
an agent or browser client.

## Authentication

Every relay owns its Better Auth database, issuer, signing secret, provider
credentials, and redirect URIs. Tokens from one relay are never copied into or
accepted by another relay.

Walk through hostname and provider setup at `/host` on this origin after the
stack is up, or on https://heychief.sh/host before you start. Email and
password are always available so the first account can be created on the
sign-in page. Google and Sign in with Apple are optional: they need OAuth
clients registered for this hostname, plus the matching secret files under
`secrets/`.

For Google, register this exact redirect URI:

```text
https://your-chief-host.example/api/auth/callback/google
```

For Apple, register this Return URL on a Services ID you own. Apple does not
accept localhost. The iPhone app’s Sign in with Apple button belongs to the
App Store listing; this relay’s Apple client covers web and desktop sign-in
on this hostname.

```text
https://your-chief-host.example/api/auth/callback/apple
```

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

For full local Effect traces and logs, start the relay with the optional
observability profile and open `http://localhost:3000`:

```bash
pnpm self-host:up:observability
```

This sends OTLP data directly from the relay container to the bundled local
collector. Its Loki, Tempo, and Grafana data stays in the local
`observability-data` Docker volume; it is never used as the production
telemetry store. Grafana opens with the provisioned **Chief Agent Observability**
dashboard, where relay, workspace, agent, and conversation filters lead to the
underlying trace waterfalls. The dashboard tracks p95 agent duration and total
traced execution time in one-minute, one-hour, and one-day buckets by workspace.
Relay filters use the stable relay identifier rather than its current URL.
This gives local performance changes stable hill-climbing metrics without
conflating traced execution with Cloudflare's billed Durable Object duration.
Trace payload content remains disabled by default.

The Cloudflare deployment deliberately uses error-only in-process telemetry.
Production logs and traces are exported by Cloudflare Observability to a
separate production Grafana stack, outside the Durable Object lifecycle. This
keeps local development data physically separate and avoids an OTLP exporter
holding agent cells awake. See `deploy/observability/README.md` for the shared
dashboard and production destination setup.

`down` preserves all data. To intentionally destroy the local relay, stop the
stack and remove its named volumes explicitly with Docker Compose's `--volumes`
flag. This is not exposed as a convenience script because it deletes auth,
workspaces, artifacts, and agent registration state together.

Images run as an unprivileged user, drop Linux capabilities, set
`no-new-privileges`, use read-only root filesystems where possible, bound log
rotation, explicit health checks, graceful shutdown windows, one-shot schema
migrations, and Docker secrets rather than source-controlled credentials.
