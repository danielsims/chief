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
These overrides select the default connection; Chief Cloud keeps its own
identity in the relay switcher, separate from localhost and self-hosted relays.

`VITE_WORKSPACE_APP_PATH` is optional. It points local deployment work at a
different Eve workspace.

Chief deploys one Eve project per workspace, containing the root Chief agent
and all declared specialists. Vercel deployment also requires workspace-vault
values for `VERCEL_TOKEN`, a hosted HTTPS `EXECUTOR_MCP_URL`, and
`EXECUTOR_MCP_TOKEN`. Localhost Executor URLs are rejected for cloud deploys,
and recurring schedules remain on the local scheduler.

## On-demand plugin runtime

The lightweight app installs its plugin runtime silently in the background at
launch. Screens that need local tools simply wait for it; there is no separate
download step or progress UI. Network failures, server errors and corrupted
transfers are retried automatically, and the plugins page retries on its own if
setup still fails. Details go to `plugin-runtime.log` in the app log directory.
Runtimes from earlier builds are removed once the current one is installed.
Public repositories need no GitHub token. Private repositories still use the
Mac's existing Git credentials.

The runtime ships as an asset of the same GitHub release as the app. Release
builds run `scripts/package-plugin-runtime.mjs` before compiling: it bundles and
signs the runtime, writes
`src-tauri/target/release-assets/macos/chief-plugin-runtime-{version}-{target}.tar.gz`,
and pins that file's `v{version}` release URL and SHA-256 into the generated
(untracked) `src-tauri/plugin-runtime-release.json`. Forge uploads everything in
`release-assets` with the installers, and publishes the release only after
every upload succeeds, so an app release never points to a missing runtime.

The native installer checks the digest, rejects unsafe archive entries, and
installs into a versioned application-data cache. It never runs an unverified
download. Local packaged builds pin the existing published runtime for their app version;
offline packages bundle it, and hot-reload development uses the workspace runtime. Only targets listed in the
packaging script (currently Apple Silicon) support on-demand installation.

## Local desktop loop

Run `pnpm dev` from the repository root with Docker Desktop running. This starts
our existing self-host stack at `http://localhost:8080`, applies local migrations
and launches the normal desktop app with hot reload. There is no separate app
flavor or development DMG. Local accounts and workspaces survive restarts.
If the desktop has another relay selected, use **Connect a self-hosted relay**
and enter that URL. `pnpm desktop:dev` starts the same loop.

## Build

Install the platform prerequisites from the [Tauri documentation](https://v2.tauri.app/start/prerequisites/), then run:

```bash
pnpm --filter @chief/desktop build:app
```

This local packaging command creates the lightweight app and DMG without
requiring the private updater signing key. It pins the existing published
runtime by its GitHub release asset SHA-256, so local agents and plugins download
the same verified runtime as that release. An unpublished version must use the
explicit offline build. Release automation (Forge) packages a new runtime asset.

On the Chief release Mac, the local development packaging loop is available
from the repository root. It selects the Developer ID identity, builds the
lightweight app and DMG, verifies the app signature, smoke-loads the signed
agent worker's database, and checks the plugin host before creating the DMG:

```bash
pnpm desktop:dmg
```

The command uses `CHIEF_APPLE_SIGNING_IDENTITY` / `APPLE_SIGNING_IDENTITY`, or the
single installed Developer ID identity. It refuses ad-hoc signing. To embed the
current checkout's runtime for offline testing, use `pnpm desktop:dmg --offline`.

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
