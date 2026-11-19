#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$(cd -- "${1:-$ROOT_DIR/release}" && pwd)"
OUTPUT_DIR="$(cd -- "${2:-$ROOT_DIR}" && pwd)"
APP="$OUTPUT_DIR/Skill Manager.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This packaging script must run on macOS." >&2
  exit 1
fi
if [[ ! -x "$RELEASE_DIR/runtime/node" ]]; then
  echo "Missing bundled runtime: $RELEASE_DIR/runtime/node" >&2
  exit 1
fi
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ARTIFACT_ARCH="arm64" ;;
  x86_64) ARTIFACT_ARCH="x64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
DMG_LABEL="${RELEASE_TAG:-$VERSION}"
DMG="$OUTPUT_DIR/skill-manager-${DMG_LABEL}-macos-${ARTIFACT_ARCH}.dmg"
if [[ -e "$APP" || -e "$DMG" ]]; then
  echo "Output already exists. Choose a fresh output directory: $OUTPUT_DIR" >&2
  exit 1
fi

mkdir -p "$CONTENTS/MacOS" "$RESOURCES"
ditto "$RELEASE_DIR" "$RESOURCES/app"
MACOSX_DEPLOYMENT_TARGET=12.0 swiftc -parse-as-library -O -framework AppKit -framework WebKit \
  "$ROOT_DIR/macos/SkillManagerApp.swift" -o "$CONTENTS/MacOS/SkillManager"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Skill Manager</string>
  <key>CFBundleDisplayName</key><string>Skill Manager</string>
  <key>CFBundleIdentifier</key><string>com.lcdzzz.skillmanager</string>
  <key>CFBundleExecutable</key><string>SkillManager</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

chmod +x "$CONTENTS/MacOS/SkillManager" "$RESOURCES/app/runtime/node"
/usr/bin/codesign --force --deep --sign - "$APP"

/usr/bin/codesign --verify --deep --strict "$APP"

STAGING="$(mktemp -d "$OUTPUT_DIR/dmg-stage.XXXXXX")"
cleanup_shortcut() {
  if [[ -L "$STAGING/Applications" ]]; then
    unlink "$STAGING/Applications"
  fi
}
trap cleanup_shortcut EXIT
ditto "$APP" "$STAGING/Skill Manager.app"
ln -s /Applications "$STAGING/Applications"
/usr/bin/hdiutil create -volname "Skill Manager" -srcfolder "$STAGING" -format UDZO "$DMG"
/usr/bin/hdiutil verify "$DMG"
echo "Created $DMG"
