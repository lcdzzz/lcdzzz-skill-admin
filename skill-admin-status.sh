#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title skill-admin 状态
# @raycast.mode compact
# @raycast.icon ℹ️
# @raycast.packageName Skill Admin
# @raycast.description 查看服务状态、地址和日志位置
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec /bin/bash "$ROOT/skill-admin.sh" status
