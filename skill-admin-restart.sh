#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title skill-admin 重启
# @raycast.mode silent
# @raycast.icon 🔄
# @raycast.packageName Skill Admin
# @raycast.description 重启后台服务并打开页面
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$ROOT/skill-admin.sh" restart
