#!/usr/bin/env bash
# Cargo runs this instead of the binary for `cargo run` on macOS, which is
# what `tauri dev` uses. Release builds are signed by the bundler and never
# come through here.
#
# An unsigned debug build looks like a new app to macOS after every rebuild,
# so each Keychain item asks for the password again. Signing it with this
# Mac's Apple Development certificate keeps one identity across rebuilds, so
# "Always Allow" sticks. It also runs as "Chief Dev", the name the Dock shows.
set -euo pipefail

binary="$1"
shift

# Tests and other binaries just run.
if [ "$(basename "$binary")" != "desktop" ]; then
  exec "$binary" "$@"
fi

named="$(dirname "$binary")/Chief Dev"
cp -f "$binary" "$named"

identity="${CHIEF_DEV_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk '/"Apple Development/ { print $2; exit }')}"
if [ -n "$identity" ]; then
  codesign --force --sign "$identity" --identifier sh.heychief.desktop.dev "$named" >/dev/null 2>&1 ||
    echo "Chief Dev: could not sign the dev build; Keychain will ask again after each rebuild." >&2
else
  echo "Chief Dev: no Apple Development certificate found; Keychain will ask again after each rebuild." >&2
fi

exec "$named" "$@"
