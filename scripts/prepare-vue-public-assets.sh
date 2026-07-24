#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LEGACY_SRC_DIR="$ROOT_DIR/backend/static/mobile"
LEGACY_DST_DIR="$ROOT_DIR/web/public/legacy"

if [ "${ZHANGL_VUE_BUNDLE_LEGACY:-0}" = "1" ]; then
  if [ ! -d "$LEGACY_SRC_DIR" ]; then
    echo "Missing legacy mobile assets: $LEGACY_SRC_DIR" >&2
    exit 1
  fi
  mkdir -p "$LEGACY_DST_DIR"
  rsync -a --delete "$LEGACY_SRC_DIR/" "$LEGACY_DST_DIR/"
  echo "Prepared Vue legacy fallback assets:"
  echo "  source: $LEGACY_SRC_DIR"
  echo "  target: $LEGACY_DST_DIR"
else
  rm -rf "$LEGACY_DST_DIR"
  echo "Prepared Vue public assets without legacy fallback"
fi
