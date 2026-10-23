/**
 * Installs `chief-machine` from the latest Chief release on GitHub, where
 * Forge publishes a binary for each supported machine with its SHA-256. The
 * download is checked against that digest before anything is installed.
 *
 *   curl -fsSL https://relay.heychief.sh/install/machine | sh
 *   irm https://relay.heychief.sh/install/machine.ps1 | iex
 */
const repository = "danielsims/chief";

export const machineInstallScript = `#!/bin/sh
# Installs chief-machine, which lends this machine's connection to Chief agents.
set -eu

case "$(uname -s)-$(uname -m)" in
  Linux-aarch64|Linux-arm64) target=aarch64-unknown-linux-musl ;;
  Linux-armv7l|Linux-armv6l) target=armv7-unknown-linux-musleabihf ;;
  Linux-x86_64|Linux-amd64) target=x86_64-unknown-linux-musl ;;
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  *) echo "chief-machine isn't built for $(uname -s) $(uname -m) yet." >&2; exit 1 ;;
esac

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
if [ -w "$dir" ]; then mv "$tmp/chief-machine" "$dir/chief-machine"
else sudo mv "$tmp/chief-machine" "$dir/chief-machine"; fi

echo "Installed chief-machine \${tag#v} to $dir."
echo "Next: run the pair command from Chief → Settings → Machines, then chief-machine serve."
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
