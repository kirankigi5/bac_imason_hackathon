#!/bin/sh
set -eu
umask 077
ROOT=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
export RUNTIME_ROOT=${RUNTIME_ROOT:-/app/runtime}
export PORT=${PORT:-3000}
export NODE_ENV=production

node "$ROOT/scripts/verify-deployment.mjs" --paths
# Railway mounts volumes as root. Prepare ownership, then run the app unprivileged.
if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
  chown -R node:node "$RUNTIME_ROOT"
  exec gosu node sh "$ROOT/scripts/start_railway.sh"
fi
sh "$ROOT/scripts/restore_runtime_data.sh"
node "$ROOT/scripts/verify-deployment.mjs" --startup
cd "$ROOT/apps/web"
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
