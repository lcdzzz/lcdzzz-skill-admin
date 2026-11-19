#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title skill-admin 停止
# @raycast.mode silent
# @raycast.icon ⏹️
# @raycast.packageName Skill Admin
# @raycast.description 停止由本启动器启动的后台服务
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$ROOT/skill-admin.sh" stop
