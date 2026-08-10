#!/usr/bin/env bash
# Chief desktop dev loop — no DMG rebuild needed.
#
# Runs `tauri dev`, which:
#   - serves the desktop UI from Vite (port 1420, HMR on)
#   - spawns the agent runtime from source via `tsx watch src/server.ts`
#     (the debug runtime launcher in src-tauri/src/lib.rs runs
#     `pnpm --filter @chief/agent-runtime dev`, so runtime edits hot-reload)
#
# Requires Node 24 (matches .nvmrc) for the shell driving pnpm/vite/tauri.
set -euo pipefail
cd "$(dirname "$0")/.."

export CHIEF_REPO_DIR="$(pwd)"

if command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh" 2>/dev/null || source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
if [ -f .nvmrc ]; then
  if command -v nvm >/dev/null 2>&1; then
    nvm use "$(cat .nvmrc)" >/dev/null
  elif [ -x "$HOME/.nvm/versions/node/v24.18.1/bin/node" ]; then
    export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"
  fi
fi

node --version
pnpm --filter @chief/desktop dev
