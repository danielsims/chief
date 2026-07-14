#!/usr/bin/env bash
# The local dev loop: run the deployable eve workspace on this Mac with tools
# served by the local Executor daemon's HTTP MCP endpoint.
#
#   CHIEF_ORG_ID=<better-auth org id> ./scripts/dev-local.sh
#
# Requires Node >= 24 on PATH (eve's requirement) and jq.
set -euo pipefail

if [ -z "${CHIEF_ORG_ID:-}" ]; then
  echo "Set CHIEF_ORG_ID to the workspace's organization id." >&2
  exit 1
fi

WS_HASH="$(node -e 'const c=require("node:crypto");console.log(c.createHash("sha256").update(process.argv[1]).digest("hex").slice(0,24))' "$CHIEF_ORG_ID")"
MANIFEST="$HOME/.chief/executor/workspaces/$WS_HASH/data/server-control/server.json"
if [ ! -f "$MANIFEST" ]; then
  echo "No Executor daemon manifest at $MANIFEST — open the workspace in Chief once first." >&2
  exit 1
fi

EXECUTOR_MCP_URL="$(jq -r .connection.origin "$MANIFEST")/mcp"
EXECUTOR_MCP_TOKEN="$(jq -r .connection.auth.token "$MANIFEST")"
export EXECUTOR_MCP_URL EXECUTOR_MCP_TOKEN

CONTEXT="$HOME/.chief/workspaces/$WS_HASH/context.md"
mkdir -p workspace-input
if [ -f "$CONTEXT" ]; then cp "$CONTEXT" workspace-input/context.md; fi

pnpm generate
exec pnpm exec eve dev "$@"
