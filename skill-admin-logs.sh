#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title skill-admin 日志
# @raycast.mode silent
# @raycast.icon 📋
# @raycast.packageName Skill Admin
# @raycast.description 用 iTerm 打开实时服务日志
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$ROOT/skill-admin.sh" logs
