/**
 * Installs `chief-machine` from the latest Chief release on GitHub, where
 * Forge publishes a binary for each supported machine with its SHA-256. The
 * download is checked against that digest before anything is installed.
 *
 *   curl -fsSL https://relay.heychief.sh/install/machine | sh
 *   curl -fsSL https://relay.heychief.sh/install/machine | sh -s -- <token>
 *
 * With a pairing token it also sets the machine up: cloudflared, a browser,
 * pairing, and a service that starts it on boot.
 *   irm https://relay.heychief.sh/install/machine.ps1 | iex
 */
const repository = "danielsims/chief";

export const machineInstallScript = `#!/bin/sh
# Installs chief-machine, which lends this machine's connection to Chief agents.
# With the pairing token Chief shows, it also sets the machine up: its browser
# and Cloudflare tunnel, pairing, and starting on every boot.
#   curl -fsSL <relay>/install/machine | sh -s -- <pairing token>
set -eu

token=""
[ $# -gt 0 ] && token=$1
step() { printf '\\n\\033[1m%s\\033[0m\\n' "$1"; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

os=$(uname -s)
arch=$(uname -m)
case "$os-$arch" in
  Linux-aarch64|Linux-arm64) target=aarch64-unknown-linux-musl; tunnel=cloudflared-linux-arm64 ;;
  Linux-armv7l|Linux-armv6l) target=armv7-unknown-linux-musleabihf; tunnel=cloudflared-linux-arm ;;
  Linux-x86_64|Linux-amd64) target=x86_64-unknown-linux-musl; tunnel=cloudflared-linux-amd64 ;;
  Darwin-arm64) target=aarch64-apple-darwin; tunnel=cloudflared-darwin-arm64.tgz ;;
  Darwin-x86_64) target=x86_64-apple-darwin; tunnel=cloudflared-darwin-amd64.tgz ;;
  *) echo "chief-machine isn't built for $os $arch yet." >&2; exit 1 ;;
esac

step "Installing chief-machine"
tag=$(curl -fsSL https://api.github.com/repos/${repository}/releases/latest \\
  | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -n 1)
[ -n "$tag" ] || { echo "Couldn't find the latest Chief release." >&2; exit 1; }
name="chief-machine-\${tag#v}-$target"
base="https://github.com/${repository}/releases/download/$tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$name" -o "$tmp/chief-machine" \\
  || { echo "Chief $tag has no chief-machine for $target." >&2; exit 1; }
curl -fsSL "$base/$name.sha256" -o "$tmp/sha256"
expected=$(cut -d ' ' -f 1 "$tmp/sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/chief-machine" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp/chief-machine" | cut -d ' ' -f 1)
fi
[ "$expected" = "$actual" ] || { echo "The download didn't match its checksum; nothing was installed." >&2; exit 1; }
chmod 755 "$tmp/chief-machine"

dir="\${CHIEF_MACHINE_DIR:-/usr/local/bin}"
install_bin() { if [ -w "$dir" ]; then mv "$1" "$dir/$2"; else as_root mv "$1" "$dir/$2"; fi; }
install_bin "$tmp/chief-machine" chief-machine
echo "Installed chief-machine \${tag#v} to $dir."

if [ -z "$token" ]; then
  echo "Next: run the pair command from Chief → Settings → Machines, then chief-machine serve."
  exit 0
fi

if [ "$os" = Linux ]; then
step "Installing cloudflared, for the live browser view"
if command -v cloudflared >/dev/null 2>&1; then
  echo "Already installed."
else
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/$tunnel"
  case "$tunnel" in
    *.tgz) curl -fsSL "$url" | tar -xz -C "$tmp" ;;
    *) curl -fsSL "$url" -o "$tmp/cloudflared" ;;
  esac
  chmod 755 "$tmp/cloudflared"
  install_bin "$tmp/cloudflared" cloudflared
  echo "Installed cloudflared to $dir."
fi
fi

step "Setting up the browser"
chrome=""
if [ "$os" = Linux ]; then
  find_chrome() {
    for candidate in /usr/bin/google-chrome /usr/bin/google-chrome-stable \\
      /usr/bin/chromium /usr/bin/chromium-browser; do
      [ -x "$candidate" ] && { echo "$candidate"; return 0; }
    done
    return 0
  }
  # Each session runs Chrome on its own virtual display (Xvfb) with its own
  # sound server (PipeWire and WirePlumber).
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -qq >/dev/null
    [ -n "$(find_chrome)" ] || as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium >/dev/null 2>&1 || true
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \\
      xvfb pipewire pipewire-pulse wireplumber >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    [ -n "$(find_chrome)" ] || as_root dnf install -y -q chromium >/dev/null 2>&1 || true
    as_root dnf install -y -q xorg-x11-server-Xvfb pipewire pipewire-pulseaudio wireplumber >/dev/null 2>&1 || true
  fi
  chrome=$(find_chrome)
  command -v Xvfb >/dev/null 2>&1 || { echo "Xvfb isn't installed, so agents can fetch pages through this machine but not browse."; chrome=""; }
  # Agents act in the page with agent-browser, pinned and checked like chief-machine.
  agent_browser_version=v0.41.2
  case "$arch" in
    aarch64|arm64) agent_browser=agent-browser-linux-musl-arm64; agent_browser_sha256=730a5168153e27ad1243ebe960157e69de0f24531fbbac9a040856a491bf491f ;;
    x86_64|amd64) agent_browser=agent-browser-linux-musl-x64; agent_browser_sha256=5d452d57772330fe4cef9b7aeb5e7137890dde20bbb65e82b990e0bc0b35d9cd ;;
    *) agent_browser="" ;;
  esac
  if [ -z "$agent_browser" ]; then
    echo "Browsing needs a 64-bit machine; agents can fetch pages through this one but not browse."
    chrome=""
  elif [ -n "$chrome" ]; then
    curl -fsSL "https://github.com/vercel-labs/agent-browser/releases/download/$agent_browser_version/$agent_browser" -o "$tmp/agent-browser"
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/agent-browser" | cut -d ' ' -f 1)
    else
      actual=$(shasum -a 256 "$tmp/agent-browser" | cut -d ' ' -f 1)
    fi
    if [ "$actual" = "$agent_browser_sha256" ]; then
      chmod 755 "$tmp/agent-browser"
      install_bin "$tmp/agent-browser" agent-browser
    else
      echo "agent-browser didn't match its checksum, so this machine won't browse."
      chrome=""
    fi
  fi
  [ -n "$chrome" ] && echo "Using $chrome."
else
  echo "Browsing runs on Linux machines for now; this one lends its connection."
fi

step "Pairing with your workspace"
"$dir/chief-machine" pair "$token" --name "$(hostname -s 2>/dev/null || hostname)"
if [ -n "$chrome" ]; then
  "$dir/chief-machine" browser enable --chrome "$chrome"
elif [ "$os" = Linux ]; then
  echo "No browser set up, so agents can fetch pages through this machine but not browse."
  echo "Install Chrome or Chromium and Xvfb, then run: chief-machine browser enable --chrome <path to Chrome>"
fi

step "Keeping it running"
if [ "$os" = Darwin ]; then
  plist="$HOME/Library/LaunchAgents/sh.heychief.machine.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>sh.heychief.machine</string>
  <key>ProgramArguments</key><array><string>$dir/chief-machine</string><string>serve</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$dir:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "Starts when you log in, and restarts if it stops."
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/chief-machine.service" <<UNIT
[Unit]
Description=Chief machine: lends this computer's connection and browser to a Chief workspace
After=network-online.target

[Service]
ExecStart=$dir/chief-machine serve
Restart=always
RestartSec=10
Environment=PATH=$dir:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now chief-machine.service
  # Keeps running with nobody logged in, and comes back after a reboot.
  as_root loginctl enable-linger "$(id -un)" 2>/dev/null || true
  echo "Starts on boot, and restarts if it stops."
else
  echo "Couldn't set it to start on boot here. Run chief-machine serve to start it."
fi

step "Done"
"$dir/chief-machine" status
`;

export const machineInstallPowerShell = `# Installs chief-machine, which lends this machine's connection to Chief agents.
$ErrorActionPreference = "Stop"
$release = Invoke-RestMethod "https://api.github.com/repos/${repository}/releases/latest"
$tag = $release.tag_name
$name = "chief-machine-$($tag.TrimStart('v'))-x86_64-pc-windows-gnu.exe"
$base = "https://github.com/${repository}/releases/download/$tag"
$dir = Join-Path $env:LOCALAPPDATA "chief-machine"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir "chief-machine.exe"
$download = "$exe.download"
Invoke-WebRequest "$base/$name" -OutFile $download
$expected = ((Invoke-WebRequest "$base/$name.sha256").Content -split " ")[0].Trim()
$actual = (Get-FileHash $download -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $download; throw "The download didn't match its checksum; nothing was installed." }
Move-Item -Force $download $exe
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($path -split ";" -contains $dir)) {
  [Environment]::SetEnvironmentVariable("Path", "$path;$dir", "User")
}
Write-Host "Installed chief-machine $($tag.TrimStart('v')) to $dir. Open a new terminal, then run the pair command from Chief."
`;
