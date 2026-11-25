#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

npx --no-install tauri build --target universal-apple-darwin --bundles app
bundle=src-tauri/target/universal-apple-darwin/release/bundle/macos/pure-point.app
lipo "$bundle/Contents/MacOS/pure-point" -verify_arch arm64 x86_64
codesign --force --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
mkdir -p release
ditto -c -k --sequesterRsrc --keepParent "$bundle" release/pure-point-macOS.zip
