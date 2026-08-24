#!/usr/bin/env bash
# Restores the vendored cell build artifacts the mobile app needs at build time.
# libworker_core.a is an 84MB compiled static library and agent.js is the
# embedded worker bundle. Both are produced from the ios-durable-agent project
# and are intentionally not committed to this repository.
set -euo pipefail

IAROOT="${IAROOT:-$HOME/Documents/Development/ios-durable-agent}"
MOBILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

LIB_SRC="$IAROOT/rust/worker-core/target/current/release/libworker_core.a"
WORKER_SRC="$IAROOT/ios/DurableAgent/agent.js"

mkdir -p "$MOBILE/Chief/Vendored/lib"
mkdir -p "$MOBILE/Chief/Resources"

if [[ -f "$LIB_SRC" ]]; then
  cp "$LIB_SRC" "$MOBILE/Chief/Vendored/lib/libworker_core.a"
  echo "vendored libworker_core.a"
else
  echo "WARN: libworker_core.a not found at $LIB_SRC (device builds need it)" >&2
fi

if [[ -f "$WORKER_SRC" ]]; then
  cp "$WORKER_SRC" "$MOBILE/Chief/Resources/agent.js"
  echo "vendored agent.js worker"
else
  echo "WARN: agent.js not found at $WORKER_SRC" >&2
fi

echo "done"
