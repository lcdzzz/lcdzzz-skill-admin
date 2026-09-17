#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/build/server/index.js" ]; then
  ROOT_DIR="$SCRIPT_DIR"
else
  ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
fi
PORT="${PORT:-8787}"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请安装 Node.js 20.19+ 后重试。" >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)' >/dev/null 2>&1; then
  echo "Node.js 版本过低，需要 20.19+。当前版本：$(node --version)" >&2
  exit 1
fi

export NODE_ENV=production
export SKILL_MANAGER_ROOT="$ROOT_DIR"
node "$ROOT_DIR/build/server/index.js" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

sleep 1
URL="http://127.0.0.1:${PORT}"
if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"
