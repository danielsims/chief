#!/usr/bin/env bash
# One local loop: the existing Docker self-host stack and the normal Tauri app.
set -euo pipefail
cd "$(dirname "$0")/.."
export CHIEF_REPO_DIR="$(pwd)"

if command -v nvm >/dev/null 2>&1; then
  nvm use "$(cat .nvmrc)" >/dev/null
elif [ -x "$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin/node" ]; then
  export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
fi

if ! node -e 'require("node:child_process").execFileSync("docker",["info"],{stdio:"ignore",timeout:10000})' 2>/dev/null; then
  echo "Start Docker Desktop, then run pnpm dev again." >&2
  exit 1
fi

# Idempotent: existing secrets and local data are retained.
sh deploy/self-host/scripts/init.sh
compose=(docker compose --env-file deploy/self-host/.env --file deploy/self-host/compose.yaml --file deploy/self-host/compose.dev.yaml)

# Compose parses .env; never source it as shell code or print its credentials.
local_origin="$("${compose[@]}" config --format json | node -e '
let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{
 const value=JSON.parse(input).services.relay.environment.AUTH_UI_ORIGIN;
 const url=new URL(value);
 if(url.protocol!=="http:" || !["localhost","127.0.0.1"].includes(url.hostname) || url.username || url.password || url.pathname!=="/" || url.search || url.hash){
  console.error("pnpm dev requires a loopback CHIEF_PUBLIC_URL in deploy/self-host/.env. Production and remote relays are not started by this command.");process.exit(1);
 }
 process.stdout.write(url.origin);
});')"

# The invitation flow needs this checkout's CLI, not an older public release.
cargo build --quiet --manifest-path packages/chief-machine/Cargo.toml --features cli
node --input-type=module - "$local_origin" <<'JS'
import {copyFileSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
mkdirSync(".cache/chief-dev/dev",{recursive:true});
mkdirSync(".cache/chief-dev/install",{recursive:true});
copyFileSync("packages/chief-machine/target/debug/chief-machine",".cache/chief-dev/dev/chief-machine");
const sha=createHash("sha256").update(readFileSync(".cache/chief-dev/dev/chief-machine")).digest("hex");
writeFileSync(".cache/chief-dev/install/machine",`#!/bin/sh
set -eu
chief_dev_bin_dir="$HOME/.local/share/chief-dev/bin"
chief_dev_tmp=$(mktemp)
trap 'rm -f "$chief_dev_tmp"' EXIT
curl -fsSL '${process.argv[2]}/dev/chief-machine' -o "$chief_dev_tmp"
printf '%s  %s\\n' '${sha}' "$chief_dev_tmp" | shasum -a 256 -c - >/dev/null
mkdir -p "$chief_dev_bin_dir"
install -m 755 "$chief_dev_tmp" "$chief_dev_bin_dir/chief-machine"
printf 'DEV CLI installed at %s/chief-machine\\nUse that full path; your normal CLI is unchanged.\\n' "$chief_dev_bin_dir"
`);
JS

echo "Starting Chief locally at $local_origin (Docker data is preserved)."
# Build only missing base images; routine source edits use the bind mounts.
# Dependency or web changes can be rebuilt explicitly with pnpm self-host:up.
missing_images="$("${compose[@]}" config --format json | node -e '
const {spawnSync}=require("node:child_process");let input="";
process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{
 const config=JSON.parse(input);for(const service of ["relay","web","computer"]){
  if(spawnSync("docker",["image","inspect",config.services[service].image],{stdio:"ignore"}).status!==0)console.log(service);
 }
});')"
if [ -n "$missing_images" ]; then
  while IFS= read -r service; do "${compose[@]}" build "$service"; done <<< "$missing_images"
fi
"${compose[@]}" run --rm --no-deps relay-migrate

# The packaged first-party client includes localhost:3000. Register this local
# gateway's callback too, without changing any deployed OAuth clients.
callback_sql="UPDATE oauth_client SET redirect_uris = json_insert(redirect_uris, '\$[#]', '$local_origin/auth/desktop') WHERE client_id = 'chief-desktop' AND NOT EXISTS (SELECT 1 FROM json_each(oauth_client.redirect_uris) WHERE value = '$local_origin/auth/desktop');"
"${compose[@]}" run --rm --no-deps \
  --entrypoint /app/apps/relay/node_modules/.bin/wrangler relay-migrate \
  --cwd /app/apps/relay d1 execute AUTH_DB --local \
  --persist-to /var/lib/chief --command "$callback_sql"
"${compose[@]}" up --detach --wait --wait-timeout 180

export VITE_CHIEF_RELAY_URL="$local_origin"
export VITE_AUTH_BASE_URL="$local_origin"
export VITE_AUTH_UI_URL="$local_origin"
echo "Opening the normal desktop dev app against $local_origin."
echo "If you previously selected another relay, choose Connect a self-hosted relay in Chief and enter $local_origin."
echo "Ctrl+C stops the desktop; pnpm self-host:down stops the Docker services without deleting their data."
exec pnpm --filter @chief/desktop dev
