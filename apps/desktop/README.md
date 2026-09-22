# Chief desktop

The macOS and Windows desktop workspace. The normal release is a lightweight
relay client and does not bundle Node, Codex, Executor, or the local agent
runtime.

## Run locally

Start the relay and web app first, then run from the repository root:

```bash
pnpm desktop
```

The Vite interface runs on `http://localhost:1420` and opens inside the Tauri window.

## Configuration

Copy the sanitized example and add your own backend values:

```bash
cp apps/desktop/.env.example apps/desktop/.env.local
```

Both development and packaged builds default to Chief's hosted services:

- `VITE_CHIEF_RELAY_URL`: `https://relay.heychief.sh`
- `VITE_AUTH_BASE_URL`: `https://relay.heychief.sh`
- `VITE_AUTH_UI_URL`: `https://heychief.sh`

For local development, set all three values to your relay and authentication UI
URLs. Starting local services alone does not change these defaults. A relay
selected and saved in the app takes precedence over these defaults.

`VITE_WORKSPACE_APP_PATH` is optional. It points local deployment work at a
different Eve workspace.

Chief deploys one Eve project per workspace, containing the root Chief agent
and all declared specialists. Vercel deployment also requires workspace-vault
values for `VERCEL_TOKEN`, a hosted HTTPS `EXECUTOR_MCP_URL`, and
`EXECUTOR_MCP_TOKEN`. Localhost Executor URLs are rejected for cloud deploys,
and recurring schedules remain on the local scheduler.

## On-demand plugin runtime

The lightweight app downloads its plugin runtime the first time a local repository
or plugin needs it. Repository setup shows progress and continues automatically;
failed downloads leave the entered URL intact for retry. Public repositories need
no GitHub token. Private repositories still use the Mac's existing Git credentials.

Each desktop build pins the runtime URL and SHA-256 in
`src-tauri/plugin-runtime-release.json`. The native installer checks the digest,
rejects unsafe archive entries, and installs into a versioned application-data
cache. It never runs an unverified download. Offline packages use their bundled
runtime instead.

To prepare a new runtime on its target platform, run `pnpm runtime:bundle` from
this directory, then `node scripts/package-plugin-runtime.mjs`. macOS preparation
requires `APPLE_SIGNING_IDENTITY`; use the Node version in `.nvmrc`. The script
writes an archive under `.audit/runtime-release` and updates the pinned manifest.
Review and publish that immutable asset at its generated GitHub release URL
**before distributing the corresponding desktop build**. Do not replace an
existing asset: prepare a new digest and rebuild the app. Only platforms present
in the manifest support on-demand installation.

## Build

Install the platform prerequisites from the [Tauri documentation](https://v2.tauri.app/start/prerequisites/), then run:

```bash
pnpm --filter @chief/desktop build:app
```

This local packaging command creates the lightweight app and DMG without
requiring the private updater signing key. Release automation uses
`build:app:release` with its signing credentials.

On the Chief release Mac, the local development packaging loop is available
from the repository root. It selects the Developer ID identity, builds the
app and DMG, verifies the app signature, and reveals the DMG in Finder:

```bash
pnpm desktop:dmg
```

Tauri writes installers to `src-tauri/target/release/bundle`. Official signing and notarization values are supplied by the private release environment, not stored in this repository.

For a signed-capable offline/developer package with the compact local cell and
plugin hosts, use:

```bash
pnpm --filter @chief/desktop build:app:offline
```

The offline profile ships one target-native Node sidecar and the bundled worker
graphs. It does not include Codex, pnpm, deployment workspaces, or the source
repository.

Release builds also create signed updater artifacts. Forge must provide the
same Tauri updater signing key used by the public verification key in
`src-tauri/tauri.conf.json`; the private key must never be committed. Published
GitHub releases are discovered through `https://heychief.sh/api/update`.
