# Chief observability environments

Chief uses the same telemetry schema and dashboard definitions in development
and production, but never the same telemetry store.

| Environment            | Transport                          | Store                                                 |
| ---------------------- | ---------------------------------- | ----------------------------------------------------- |
| Local development      | Relay OTLP/HTTP                    | Docker Grafana, Loki, and Tempo in `deploy/self-host` |
| Chief Cloud            | Cloudflare native logs and traces  | A dedicated production Grafana Cloud stack            |
| Self-hosted production | Operator-selected OTLP destination | The operator's production Grafana stack               |

The stable `chief.relay.id` and `deployment.environment` resource attributes
make relays and environments queryable inside a store. They are not an
isolation boundary. Separate endpoints, credentials, and storage provide the
boundary.

## Shared dashboards

The versioned dashboard sources live in `deploy/self-host/grafana`. The local
Compose profile provisions them directly. Import the generated JSON files from
`deploy/self-host/grafana/dashboards/chief` into the production Grafana folder
named `Chief`. Do not export production data back to the laptop collector.

Regenerate the focused dashboards after editing the source dashboard:

```bash
node deploy/self-host/grafana/generate-chief-dashboards.mjs
```

## Production export

Create two Cloudflare Observability destinations against the production
Grafana Cloud stack: one ending in `/v1/logs` and one ending in `/v1/traces`.
Keep their authorization headers in Cloudflare's destination configuration,
not in Wrangler variables or repository files.

After those destinations exist, copy the `destinations` arrays from
`cloudflare-destinations.example.jsonc` into `apps/relay/wrangler.jsonc` and
deploy the Worker. Destination names must exactly match the names configured in
the Cloudflare dashboard.

The relay must keep `RELAY_TELEMETRY_MODE=off` in Chief Cloud. Cloudflare
exports native telemetry after execution, so no exporter fiber or periodic
flush keeps a Durable Object alive.
