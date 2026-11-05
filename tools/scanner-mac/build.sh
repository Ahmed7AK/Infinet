#!/bin/bash
# Build "Infinet Scanner.app" (ad-hoc signed) with the simulation inside it, so the booth runs fully offline.
#   tools/scanner-mac/build.sh            build the site (npm run build), then the app
#   tools/scanner-mac/build.sh --no-site  the app only (run it with --site <dist folder>)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP="$HERE/build/Infinet Scanner.app"
rm -rf "$HERE/build"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework CoreWLAN -framework CoreLocation -framework Network -framework Security \
  -o "$APP/Contents/MacOS/InfinetScanner" "$HERE/Sources/main.swift"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
if [ "${1:-}" != "--no-site" ]; then
  if command -v npm >/dev/null; then (cd "$ROOT" && npm run build)
  else (cd "$ROOT" && ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit && ./node_modules/.bin/vite build); fi
  cp -R "$ROOT/dist" "$APP/Contents/Resources/site"
fi
# ad-hoc signature: enough for macOS to remember the Location permission for this build
codesign --force --deep --sign - "$APP"
echo "Built: $APP"
