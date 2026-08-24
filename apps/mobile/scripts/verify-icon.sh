#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source_icon="$repo_root/apps/desktop/src-tauri/icons/icon-source.png"
app_icon="$repo_root/apps/mobile/Chief/Resources/Assets.xcassets/AppIcon.appiconset/Chief-1024.png"
runtime_mark="$repo_root/apps/mobile/Chief/Resources/Assets.xcassets/ChiefMark.imageset/ChiefMark.png"

cmp --silent "$source_icon" "$runtime_mark"

icon_properties="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$app_icon")"
grep -q "pixelWidth: 1024" <<<"$icon_properties"
grep -q "pixelHeight: 1024" <<<"$icon_properties"
grep -q "hasAlpha: no" <<<"$icon_properties"
