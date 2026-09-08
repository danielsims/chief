# Chief relay

The relay is Chief's portable backend: authentication, tenant-isolated
workspace cells, conversation cells, agent mailboxes, live sockets, and
artifact storage. Production runs on Cloudflare, while the same Worker and
storage bindings run locally through Wrangler's workerd/Miniflare runtime.

## Local development

Prepare the persistent local D1 database once:

```bash
pnpm --filter @chief/relay dev:local:prepare
```

Start an entirely local relay on `http://127.0.0.1:8787`:

```bash
pnpm --filter @chief/relay dev:local
```

Use `dev:local:tunnel` when a physical phone needs an HTTPS endpoint. Wrangler
prints the temporary tunnel URL. Local state lives under
`apps/relay/.wrangler/local-state` and is separate from every hosted relay.

The local profile uses key-native identity: every human or agent is identified
by the NIP-98 public key that signs the request. Production uses Chief account
binding and Better Auth. Both profiles run the same workspace authorization,
permission, cell, socket, and storage code.

Authentication and relay routing are separate client settings. A development
client may authenticate with the hosted Chief issuer while sending workspace
traffic to a local relay, but credentials are never copied between issuers. A
self-hosted production relay owns its Better Auth database, provider choices,
redirect URIs, and signing secrets; clients learn those endpoints through relay
discovery before starting PKCE.

Desktop development can target the printed URL without changing source:

```bash
VITE_CHIEF_RELAY_URL=https://example.trycloudflare.com \
VITE_AUTH_BASE_URL=https://relay.heychief.sh \
pnpm --filter @chief/desktop dev
```

## Effect observability

`RELAY_TELEMETRY_MODE` controls Effect telemetry independently of relay
placement:

- `off` exports nothing.
- `errors` writes only structured failures to the runtime console. This is the
  default.
- `full` exports Effect traces and logs over OTLP/HTTP to
  `RELAY_OTLP_ENDPOINT`.

Prompt bodies, tool arguments, and tool results remain excluded unless
`RELAY_TELEMETRY_INCLUDE_CONTENT=true` is also set. Use
`RELAY_OTLP_AUTHORIZATION` when the collector requires an Authorization header.

The self-hosted Docker stack can start a local Grafana, Tempo, Loki, and OTEL
Collector at `http://localhost:3000`:

```bash
pnpm self-host:up:observability
```

A Cloudflare-deployed relay uses the same `full` mode, but its OTLP endpoint
must be publicly reachable. Cloudflare Workers Observability is disabled; the
Effect exporter is the only detailed telemetry path.

An installed debug iOS build can be launched from Xcode or `devicectl` with a
`CHIEF_RELAY_URL` process environment variable. This keeps local relay routing
explicit and prevents a development build from silently shipping with a local
endpoint.

## Self-hosting

The production-shaped single-node stack lives in
`deploy/self-host/compose.yaml`. It packages this exact Worker with persistent
D1, Durable Object, and R2 bindings, the Chief auth UI, schema migrations, and a
TLS/WebSocket gateway. See `deploy/self-host/README.md` for its operational and
scaling boundaries.
