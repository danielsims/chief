# Chief workspace

The Eve workspace used to package one workspace-level Chief deployment and its five private specialists. It combines the canonical personas, brand context, and playbooks.

## Inputs

Deployment inputs live in `workspace-input`:

- `context.md` contains the brand brief.
- `playbooks.json` contains the selected playbooks.
- `automations.json` is accepted only to detect active cloud schedules and fail the build. Schedules remain local until Executor has schedule-scoped capabilities.

The desktop app normally writes these files. Do not commit customer workspace inputs or generated runtime data.

## Generate and run

```bash
pnpm --filter @chief/workspace generate
pnpm --filter @chief/workspace dev
```

Build the deployable workspace with:

```bash
pnpm --filter @chief/workspace build
```

The source build is intentionally secret-free and uses a non-routable Executor URL when `EXECUTOR_MCP_URL` is absent. A real deployment requires a hosted HTTPS `EXECUTOR_MCP_URL` and `EXECUTOR_MCP_TOKEN`; Executor calls fail closed when either is missing.
