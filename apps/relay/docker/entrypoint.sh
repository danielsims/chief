#!/bin/sh
set -eu

state_dir="${CHIEF_STATE_DIR:-/var/lib/chief}"
runtime_dir="${CHIEF_RUNTIME_DIR:-/run/chief}"
runtime_env="$runtime_dir/worker.env"
wrangler_binary="/app/apps/relay/node_modules/.bin/wrangler"

read_secret() {
  variable_name="$1"
  file_variable_name="${variable_name}_FILE"
  eval "file_path=\${$file_variable_name:-}"
  eval "current_value=\${$variable_name:-}"

  if [ -n "$file_path" ]; then
    if [ ! -r "$file_path" ]; then
      echo "Chief relay cannot read $file_variable_name." >&2
      exit 78
    fi
    current_value="$(tr -d '\r\n' < "$file_path")"
  fi

  single_line_value="$(printf '%s' "$current_value" | tr -d '\r\n')"
  if [ "$single_line_value" != "$current_value" ]; then
    echo "Chief relay secrets must be single-line values." >&2
    exit 78
  fi

  eval "export $variable_name=\$current_value"
}

require_value() {
  variable_name="$1"
  eval "current_value=\${$variable_name:-}"
  if [ -z "$current_value" ]; then
    echo "Chief relay requires $variable_name." >&2
    exit 78
  fi
}

write_binding() {
  variable_name="$1"
  eval "current_value=\${$variable_name:-}"
  if [ -n "$current_value" ]; then
    printf '%s=%s\n' "$variable_name" "$current_value" >> "$runtime_env"
  fi
}

read_secret BETTER_AUTH_SECRET
read_secret BOOTSTRAP_TOKEN_SHA256
read_secret GOOGLE_CLIENT_SECRET

require_value BETTER_AUTH_SECRET
require_value BOOTSTRAP_TOKEN_SHA256
require_value AUTH_BASE_URL
require_value AUTH_UI_ORIGIN

mkdir -p "$state_dir" "$runtime_dir"
umask 077
: > "$runtime_env"

for binding in \
  RELAY_DEPLOYMENT \
  ACCOUNT_IDENTITY_MODE \
  AUTH_BASE_URL \
  AUTH_UI_ORIGIN \
  AUTH_GOOGLE_REDIRECT_URI \
  BETTER_AUTH_SECRET \
  BOOTSTRAP_TOKEN_SHA256 \
  GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET
do
  write_binding "$binding"
done

case "${1:-serve}" in
  migrate)
    exec "$wrangler_binary" --cwd /app/apps/relay d1 migrations apply AUTH_DB \
      --local \
      --persist-to "$state_dir"
    ;;
  serve)
    exec "$wrangler_binary" dev \
      --cwd /app/apps/relay \
      --env-file "$runtime_env" \
      --local \
      --ip 0.0.0.0 \
      --port 8787 \
      --persist-to "$state_dir" \
      --log-level "${CHIEF_LOG_LEVEL:-info}" \
      --show-interactive-dev-session false
    ;;
  *)
    echo "Chief relay command must be 'serve' or 'migrate'." >&2
    exit 64
    ;;
esac
