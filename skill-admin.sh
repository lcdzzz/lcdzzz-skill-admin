#!/bin/bash
set -euo pipefail

# @raycast.schemaVersion 1
# @raycast.title skill-admin
# @raycast.mode silent
# @raycast.icon 🤖
# @raycast.description 后台启动本地 Skill 管理器并打开页面
# @raycast.author 1473220649
# @raycast.authorURL https://raycast.com/1473220649

PROJECT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [[ -n "${SKILL_ADMIN_NODE:-}" ]]; then
  CANDIDATES=("$SKILL_ADMIN_NODE")
else
  CANDIDATES=("$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node)
  for CANDIDATE in "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node; do
    CANDIDATES+=("$CANDIDATE")
  done
fi
for NODE_BIN in "${CANDIDATES[@]}"; do
  if [[ -x "$NODE_BIN" ]] && "$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)' >/dev/null 2>&1; then
    exec "$NODE_BIN" "$PROJECT/scripts/local-tool.mjs" "${@:-start}"
  fi
done
echo "未找到 Node.js 20.19+。请安装 Node，或用 SKILL_ADMIN_NODE 指定 Node 可执行文件。" >&2
exit 1
