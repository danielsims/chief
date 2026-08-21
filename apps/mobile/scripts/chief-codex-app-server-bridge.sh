#!/bin/bash

set -euo pipefail

CODEX_BIN="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex}"
PORT="${CHIEF_CODEX_BRIDGE_PORT:-4501}"
STATE_DIR="${CHIEF_CODEX_BRIDGE_STATE_DIR:-$HOME/Library/Application Support/Chief/CodexBridge}"
MODEL="${CHIEF_CODEX_BRIDGE_MODEL:-gpt-5.6-luna}"
TOKEN_FILE="$STATE_DIR/capability-token"
WORKSPACE_DIR="$STATE_DIR/empty-workspace"
BRIDGE_CODEX_HOME="$STATE_DIR/codex-home"
SOURCE_CODEX_HOME="${CODEX_SOURCE_HOME:-${CODEX_HOME:-$HOME/.codex}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QR_SCRIPT="$SCRIPT_DIR/chief-codex-bridge-qr.swift"
QR_FILE="$STATE_DIR/connect.png"
TUNNEL_LOG="$STATE_DIR/cloudflared.log"

if [[ ! -x "$CODEX_BIN" ]]; then
  CODEX_BIN="$(command -v codex || true)"
fi
if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  echo "Codex was not found. Set CODEX_BIN to the app-bundled Codex binary." >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "CHIEF_CODEX_BRIDGE_PORT must be a number from 1 through 65535." >&2
  exit 1
fi
if [[ -z "${MODEL//[[:space:]]/}" ]]; then
  echo "CHIEF_CODEX_BRIDGE_MODEL cannot be empty." >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required for the phone's secure wss:// connection." >&2
  exit 1
fi
if [[ ! -f "$QR_SCRIPT" ]]; then
  echo "The QR generator is missing at $QR_SCRIPT." >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR" "$BRIDGE_CODEX_HOME"
chmod 700 "$STATE_DIR" "$WORKSPACE_DIR" "$BRIDGE_CODEX_HOME"
if [[ ! -s "$TOKEN_FILE" ]]; then
  openssl rand -hex -out "$TOKEN_FILE" 32
fi
if [[ ! "$(tr -d '\r\n' < "$TOKEN_FILE")" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "The capability token must contain exactly 64 hexadecimal characters." >&2
  echo "Remove $TOKEN_FILE and rerun this script to generate a secure token." >&2
  exit 1
fi
chmod 600 "$TOKEN_FILE"

SOURCE_AUTH_FILE="$SOURCE_CODEX_HOME/auth.json"
BRIDGE_AUTH_FILE="$BRIDGE_CODEX_HOME/auth.json"
if [[ ! -f "$SOURCE_AUTH_FILE" ]]; then
  echo "Codex is not logged in at $SOURCE_CODEX_HOME." >&2
  echo "Sign in with the Codex app before starting this bridge." >&2
  exit 1
fi
if [[ -e "$BRIDGE_AUTH_FILE" || -L "$BRIDGE_AUTH_FILE" ]]; then
  if [[ ! -L "$BRIDGE_AUTH_FILE" || "$(readlink "$BRIDGE_AUTH_FILE")" != "$SOURCE_AUTH_FILE" ]]; then
    echo "$BRIDGE_AUTH_FILE must be a symlink to the source Codex login." >&2
    exit 1
  fi
else
  ln -s "$SOURCE_AUTH_FILE" "$BRIDGE_AUTH_FILE"
fi

server_pid=""
tunnel_pid=""
cleanup() {
  [[ -n "$tunnel_pid" ]] && kill "$tunnel_pid" 2>/dev/null || true
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$WORKSPACE_DIR"
  CODEX_HOME="$BRIDGE_CODEX_HOME" exec "$CODEX_BIN" app-server \
    --listen "ws://127.0.0.1:$PORT" \
    --ws-auth capability-token \
    --ws-token-file "$TOKEN_FILE"
) &
server_pid=$!

for _ in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid" || true
    echo "Codex app-server exited before becoming ready." >&2
    exit 1
  fi
  if curl --fail --silent "http://127.0.0.1:$PORT/readyz" >/dev/null; then
    break
  fi
  sleep 0.1
done
if ! curl --fail --silent "http://127.0.0.1:$PORT/readyz" >/dev/null; then
  echo "Codex app-server did not become ready." >&2
  exit 1
fi

: > "$TUNNEL_LOG"
chmod 600 "$TUNNEL_LOG"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$TUNNEL_LOG" 2>&1 &
tunnel_pid=$!

tunnel_url=""
for _ in {1..300}; do
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    wait "$tunnel_pid" || true
    echo "cloudflared exited before creating a tunnel:" >&2
    tail -n 12 "$TUNNEL_LOG" >&2
    exit 1
  fi
  tunnel_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1 || true)"
  [[ -n "$tunnel_url" ]] && break
  sleep 0.1
done
if [[ -z "$tunnel_url" ]]; then
  echo "cloudflared did not provide a tunnel URL:" >&2
  tail -n 12 "$TUNNEL_LOG" >&2
  exit 1
fi

endpoint="wss://${tunnel_url#https://}"
tr -d '\r\n' < "$TOKEN_FILE" | /usr/bin/env swift "$QR_SCRIPT" "$endpoint" "$MODEL" "$QR_FILE"
chmod 600 "$QR_FILE"
open "$QR_FILE" || true

echo
echo "Chief's development Codex bridge is ready at $endpoint"
echo "Scan the QR code with the iPhone Camera to connect this debug build."
echo "The capability token is imported directly into the phone's Keychain."
echo "Keep this terminal open while Chief uses Codex. Press Ctrl-C to stop."
echo

wait "$tunnel_pid"
