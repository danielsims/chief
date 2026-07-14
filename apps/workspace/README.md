# Chief workspace

The Eve workspace used to package an agent for cloud deployment. It combines an agent persona, brand context, playbooks, and approved cloud schedules.

## Inputs

Deployment inputs live in `workspace-input`:

- `context.md` contains the brand brief.
- `deployment.json` selects the agent.
- `playbooks.json` contains the selected playbooks.
- `automations.json` contains approved cloud schedules.

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
