#!/usr/bin/env bash
# Restores the vendored native cell library the mobile app needs at build time.
# Chief owns its embedded worker bundle; only the compiled native library is
# synchronized from the ios-durable-agent project.
set -euo pipefail

IAROOT="${IAROOT:-$HOME/Documents/Development/ios-durable-agent}"
MOBILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEVICE_LIB_SRC="$IAROOT/rust/worker-core/target/aarch64-apple-ios/release/libworker_core.a"
CURRENT_LIB_SRC="$IAROOT/rust/worker-core/target/current/release/libworker_core.a"
mkdir -p "$MOBILE/Chief/Vendored/lib"

if [[ -f "$DEVICE_LIB_SRC" ]]; then
  cp "$DEVICE_LIB_SRC" "$MOBILE/Chief/Vendored/lib/libworker_core.a"
  echo "vendored libworker_core.a"
elif [[ -f "$CURRENT_LIB_SRC" ]]; then
  cp "$CURRENT_LIB_SRC" "$MOBILE/Chief/Vendored/lib/libworker_core.a"
  echo "vendored libworker_core.a"
else
  echo "WARN: libworker_core.a not found in the device build outputs" >&2
fi

echo "done"
