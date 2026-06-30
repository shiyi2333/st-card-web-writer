#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

export PORT="${PORT:-5678}"
export HOST="${HOST:-127.0.0.1}"

if ! command -v node >/dev/null 2>&1; then
  echo "[st-card-web-writer] Node.js was not found. Please install Node.js 20 or newer." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[st-card-web-writer] npm was not found. Please install npm." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[st-card-web-writer] Installing dependencies..."
  npm install
fi

echo "[st-card-web-writer] Starting on http://$HOST:$PORT"
(
  sleep 2
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "http://$HOST:$PORT"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://$HOST:$PORT" >/dev/null 2>&1 || true
  fi
) &

npm run start
