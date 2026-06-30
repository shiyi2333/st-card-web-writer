#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

export PORT="${PORT:-5678}"
export HOST="${HOST:-127.0.0.1}"
APP_URL="http://$HOST:$PORT"

open_app() {
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$APP_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "[st-card-web-writer] Node.js was not found. Please install Node.js 20 or newer." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[st-card-web-writer] npm was not found. Please install npm." >&2
  exit 1
fi

if node -e "fetch(process.argv[1] + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "$APP_URL" >/dev/null 2>&1; then
  echo "[st-card-web-writer] Already running on $APP_URL"
  open_app
  exit 0
fi

if ! node -e "const net=require('node:net'); const host=process.argv[1]; const port=Number(process.argv[2]); const s=net.createServer(); s.once('error', () => process.exit(1)); s.once('listening', () => s.close(() => process.exit(0))); s.listen(port, host);" "$HOST" "$PORT" >/dev/null 2>&1; then
  echo "[st-card-web-writer] Port $HOST:$PORT is already in use by another process." >&2
  echo "[st-card-web-writer] Open $APP_URL if it is the writer, or start with another port:" >&2
  echo "  PORT=5679 ./start-writer.sh" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[st-card-web-writer] Installing dependencies..."
  npm install
fi

echo "[st-card-web-writer] Starting on $APP_URL"
(
  sleep 2
  open_app
) &

npm run start
