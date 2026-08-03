# Chief desktop

The macOS and Windows desktop workspace. It combines the React interface, Tauri shell, and bundled local agent runtime.

## Run locally

Start the backend and web app first, then run from the repository root:

```bash
pnpm desktop
```

The Vite interface runs on `http://localhost:1420` and opens inside the Tauri window.

## Configuration

Copy the sanitized example and add your own backend values:

```bash
cp apps/desktop/.env.example apps/desktop/.env.local
```

`VITE_CONVEX_URL` is required. `VITE_AUTH_BASE_URL` defaults to the local web
app during development and is required for packaged builds.
`VITE_WORKSPACE_APP_PATH` is optional. It points local deployment work at a
different Eve workspace.

Chief deploys one Eve project per workspace, containing the root Chief agent
and all declared specialists. Vercel deployment also requires workspace-vault
values for `VERCEL_TOKEN`, a hosted HTTPS `EXECUTOR_MCP_URL`, and
`EXECUTOR_MCP_TOKEN`. Localhost Executor URLs are rejected for cloud deploys,
and recurring schedules remain on the local scheduler.

## Build

Install the platform prerequisites from the [Tauri documentation](https://v2.tauri.app/start/prerequisites/), then run:

```bash
pnpm --filter @chief/desktop build:app
```

On the Chief release Mac, the local development packaging loop is available
from the repository root. It selects the Developer ID identity, builds the
app and DMG, verifies the app signature, and reveals the DMG in Finder:

```bash
pnpm desktop:dmg
```

Tauri writes installers to `src-tauri/target/release/bundle`. Official signing and notarization values are supplied by the private release environment, not stored in this repository.

Release builds also create signed updater artifacts. Forge must provide the
same Tauri updater signing key used by the public verification key in
`src-tauri/tauri.conf.json`; the private key must never be committed. Published
GitHub releases are discovered through `https://heychief.sh/api/update`.
