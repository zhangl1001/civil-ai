#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/backend/static/mobile"
DST_DIR="$ROOT_DIR/ios/App/App/public"

if [ ! -d "$SRC_DIR" ]; then
  echo "Missing source directory: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

rsync -a --delete \
  --exclude 'cordova.js' \
  --exclude 'cordova_plugins.js' \
  "$SRC_DIR/" "$DST_DIR/"

echo "Synced mobile web assets:"
echo "  source: $SRC_DIR"
echo "  target: $DST_DIR"
