#!/usr/bin/env bash
set -euo pipefail

mobile_root="$(cd "$(dirname "$0")/.." && pwd)"
device_id="$(python3 - <<'PY'
import json
import subprocess

devices = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"]))["devices"]
for runtime_devices in devices.values():
    for device in runtime_devices:
        if device.get("isAvailable") and device.get("deviceTypeIdentifier", "").endswith("iPhone-16-Pro-Max"):
            print(device["udid"])
            raise SystemExit
PY
)"

if [[ -z "$device_id" ]]; then
  runtime="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; rows=json.load(sys.stdin)["runtimes"]; print(next(row["identifier"] for row in reversed(rows) if row["isAvailable"] and row["platform"] == "iOS"))')"
  device_id="$(xcrun simctl create "Chief Mobile Tests" "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max" "$runtime")"
fi

if ! xcrun simctl list devices | grep "$device_id" | grep -q '(Booted)'; then
  xcrun simctl boot "$device_id"
  xcrun simctl bootstatus "$device_id" -b
fi

cd "$mobile_root"
xcodegen generate
xcodebuild \
  -project ChiefMobile.xcodeproj \
  -scheme Chief \
  -destination "platform=iOS Simulator,id=$device_id" \
  -parallel-testing-enabled NO \
  test
