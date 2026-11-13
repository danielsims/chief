#!/usr/bin/env bash
# Cargo runs this instead of the binary for `cargo run` on macOS, which is
# what `tauri dev` uses. Release builds are signed by the bundler and never
# come through here.
#
# An unsigned debug build looks like a new app to macOS after every rebuild,
# so each Keychain item asks for the password again. Prefer the release Mac's
# Developer ID certificate and code-signing identifier so the dev and release
# apps share one Keychain identity. Otherwise, use an Apple Development
# certificate for a stable identity across dev rebuilds. The app still runs as
# "Chief Dev", the name the Dock shows.
set -euo pipefail

binary="$1"
shift

# Tests and other binaries just run.
if [ "$(basename "$binary")" != "desktop" ]; then
  exec "$binary" "$@"
fi

bundle="$(dirname "$binary")/Chief Dev.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
named="$bundle/Contents/MacOS/Chief Dev"
cp -f "$binary" "$named"
# UNUserNotificationCenter requires NSBundle.mainBundle.bundleIdentifier;
# signing a bare executable does not give the running process an app bundle.
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>sh.heychief.desktop.dev</string>
  <key>CFBundleExecutable</key><string>Chief Dev</string>
  <key>CFBundleName</key><string>Chief Dev</string>
  <key>CFBundleDisplayName</key><string>Chief Dev</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.4</string>
  <key>CFBundleIconFile</key><string>dev-icon.icns</string>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>Chief desktop</string>
    <key>CFBundleURLSchemes</key><array><string>chief-desktop</string></array>
  </dict></array>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
cp "$(dirname "$0")/../icons/dev-icon.icns" "$bundle/Contents/Resources/dev-icon.icns"

identity="${CHIEF_DEV_SIGNING_IDENTITY:-${CHIEF_APPLE_SIGNING_IDENTITY:-${APPLE_SIGNING_IDENTITY:-}}}"
if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/"Developer ID Application:/ { print $2; exit }')"
fi
if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/"Apple Development:/ { print $2; exit }')"
fi
if [ -n "$identity" ]; then
  identifier=sh.heychief.desktop.dev
  case "$identity" in
    *"Developer ID Application:"*) identifier=sh.heychief.desktop ;;
  esac
  codesign --force --sign "$identity" --identifier "$identifier" "$bundle" >/dev/null 2>&1 ||
    echo "Chief Dev: could not sign the dev build; Keychain will ask again after each rebuild." >&2
else
  echo "Chief Dev: no code-signing identity found; Keychain may ask again after each rebuild." >&2
fi

exec "$named" "$@"
