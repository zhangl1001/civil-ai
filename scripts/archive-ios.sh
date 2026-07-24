#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build/ios/release"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

"$ROOT_DIR/scripts/sync-ios-public.sh"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

xcodebuild \
  -project "$ROOT_DIR/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  -archivePath "$ARCHIVE_PATH" \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$ROOT_DIR/build/ios/ExportOptions.plist"

IPA_PATH="$EXPORT_DIR/App.ipa"
if [ ! -f "$IPA_PATH" ]; then
  echo "IPA export failed: $IPA_PATH not found" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/verify-ios-ipa.js" "$IPA_PATH"

# The archive and DerivedData are reproducible intermediates. Keep release
# output deterministic: only the verified IPA remains under release/export.
rm -rf "$ARCHIVE_PATH" "$BUILD_DIR/DerivedData"
find "$EXPORT_DIR" -mindepth 1 -maxdepth 1 -type f ! -name 'App.ipa' -delete

echo "Release IPA: $IPA_PATH"
