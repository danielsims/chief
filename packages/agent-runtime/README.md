# Chief agent runtime

The local Node.js service that runs agents, tools, schedules, channels, and durable local work. The desktop build packages this service and its required binaries as a sidecar.

## Run locally

```bash
pnpm --filter @chief/agent-runtime dev
```

The runtime chooses an available local port unless `CHIEF_RUNTIME_PORT` is set.

## Useful commands

```bash
pnpm --filter @chief/agent-runtime typecheck
pnpm --filter @chief/agent-runtime db:generate
pnpm --filter @chief/agent-runtime build:desktop-sidecar
```

`build:desktop-sidecar` is normally called by the Tauri build. Official release signing values are supplied by the private build environment.
