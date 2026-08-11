#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
RELEASE_DIR="$ROOT_DIR/build/releases/v$VERSION"
WEB_ARCHIVE="civil-ai-web-v$VERSION.zip"

if [ -z "$VERSION" ]; then
  echo "Unable to read the project version" >&2
  exit 1
fi

cd "$ROOT_DIR"
npm run web:build

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

(
  cd "$ROOT_DIR/web/dist"
  zip -q -r "$RELEASE_DIR/$WEB_ARCHIVE" .
)

(
  cd "$RELEASE_DIR"
  shasum -a 256 "$WEB_ARCHIVE" > SHA256SUMS.txt
)

echo "Release assets ready:"
echo "  $RELEASE_DIR/$WEB_ARCHIVE"
echo "  $RELEASE_DIR/SHA256SUMS.txt"
