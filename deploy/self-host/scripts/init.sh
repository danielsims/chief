#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
stack_dir="$(dirname -- "$script_dir")"
secrets_dir="$stack_dir/secrets"

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate relay secrets." >&2
  exit 69
fi

mkdir -p "$secrets_dir"
chmod 0700 "$secrets_dir"

if [ ! -f "$stack_dir/.env" ]; then
  cp "$stack_dir/.env.example" "$stack_dir/.env"
  chmod 0600 "$stack_dir/.env"
fi

if [ ! -s "$secrets_dir/better_auth_secret" ]; then
  openssl rand -base64 48 | tr -d '\n' > "$secrets_dir/better_auth_secret"
fi

if [ ! -s "$secrets_dir/bootstrap_token" ]; then
  openssl rand -base64 48 | tr -d '\n' > "$secrets_dir/bootstrap_token"
fi

if [ ! -s "$secrets_dir/bootstrap_token_sha256" ]; then
  openssl dgst -sha256 -r "$secrets_dir/bootstrap_token" \
    | awk '{print $1}' > "$secrets_dir/bootstrap_token_sha256"
fi

for generated_secret in computer_auth_secret computer_browser_encryption_key computer_browser_stream_secret relay_secret_key; do
  if [ ! -s "$secrets_dir/$generated_secret" ]; then
    openssl rand -base64 48 | tr -d '\n' > "$secrets_dir/$generated_secret"
  fi
done

# This is a public installation identifier, not a credential. Keeping it in
# the persisted secrets directory gives every self-hosted relay a stable ID
# across container rebuilds without requiring another operator setting.
if [ ! -s "$secrets_dir/relay_id" ]; then
  printf 'relay_%s' "$(openssl rand -hex 16)" > "$secrets_dir/relay_id"
fi

for optional_secret in google_client_secret cloudflare_tunnel_token; do
  if [ ! -f "$secrets_dir/$optional_secret" ]; then
    : > "$secrets_dir/$optional_secret"
  fi
done

chmod 0600 "$secrets_dir"/*

echo "Chief self-host configuration is ready at $stack_dir/.env."
echo "Add a Google client secret only if Google sign-in is enabled."
