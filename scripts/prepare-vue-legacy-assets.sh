#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/backend/static/mobile"
DST_DIR="$ROOT_DIR/web/public/legacy"

if [ ! -d "$SRC_DIR" ]; then
  echo "Missing legacy mobile assets: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DST_DIR"
rsync -a --delete "$SRC_DIR/" "$DST_DIR/"

echo "Prepared Vue legacy assets:"
echo "  source: $SRC_DIR"
echo "  target: $DST_DIR"
