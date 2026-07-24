#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/web/dist"
DST_DIR="$ROOT_DIR/ios/App/App/public"

if [ ! -d "$SRC_DIR" ]; then
  echo "Missing Vue build directory: $SRC_DIR" >&2
  echo "Run: npm run web:build" >&2
  exit 1
fi

cd "$ROOT_DIR"
npx cap sync ios
node "$ROOT_DIR/scripts/verify-capacitor-ios.js"

echo "Synced Vue web assets:"
echo "  source: $SRC_DIR"
echo "  target: $DST_DIR"
