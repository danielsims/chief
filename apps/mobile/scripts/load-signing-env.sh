#!/usr/bin/env bash
# Loads local signing configuration for XcodeGen.
#
# The Apple team ID and bundle identifier are not committed, because they are
# real account identifiers rather than build configuration. Copy
# .env.example to .env, fill in your own values, and source this file before
# running xcodegen.
#
# Exported variables:
#   CHIEF_APPLE_TEAM_ID         Apple Developer team identifier
#   CHIEF_BUNDLE_ID             app bundle identifier prefix
#
# Usage:  source "$(dirname "$0")/load-signing-env.sh"

set -euo pipefail

mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$mobile_root/.env"

if [[ -f "$env_file" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$env_file"
  set +a
fi

# Leave missing values unset rather than substituting an empty string. XcodeGen
# then emits the ${CHIEF_...} placeholder verbatim, so the generated project
# shows what is missing instead of silently resolving to an empty build setting.
if [[ -z "${CHIEF_APPLE_TEAM_ID:-}" ]]; then
  echo "warning: CHIEF_APPLE_TEAM_ID is unset; DEVELOPMENT_TEAM will be blank." >&2
  echo "         Copy apps/mobile/.env.example to apps/mobile/.env and fill it in," >&2
  echo "         or export CHIEF_APPLE_TEAM_ID before running xcodegen." >&2
fi

if [[ -z "${CHIEF_BUNDLE_ID:-}" ]]; then
  echo "warning: CHIEF_BUNDLE_ID is unset; PRODUCT_BUNDLE_IDENTIFIER will be blank." >&2
  echo "         Copy apps/mobile/.env.example to apps/mobile/.env and fill it in," >&2
  echo "         or export CHIEF_BUNDLE_ID before running xcodegen." >&2
fi

for signing_var in CHIEF_APPLE_TEAM_ID CHIEF_BUNDLE_ID; do
  if [[ -n "${!signing_var:-}" ]]; then
    export "$signing_var"
  else
    unset "$signing_var"
  fi
done
