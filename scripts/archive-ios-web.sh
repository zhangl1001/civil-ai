#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build/ios/vue-release"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

if [ ! -f "$ROOT_DIR/ios/App/App/public/index.html" ]; then
  echo "Missing iOS public index.html. Run: npm run ios:sync:web" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/verify-capacitor-ios.js"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

xcodebuild \
  -project "$ROOT_DIR/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  -archivePath "$ARCHIVE_PATH" \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$ROOT_DIR/ios/export-options/Development.plist"

IPA_PATH="$EXPORT_DIR/App.ipa"
if [ ! -f "$IPA_PATH" ]; then
  echo "IPA export failed: $IPA_PATH not found" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/verify-ios-ipa.js" "$IPA_PATH"

APP_INFO_PLIST="$ARCHIVE_PATH/Products/Applications/App.app/Info.plist"
if [ ! -f "$APP_INFO_PLIST" ]; then
  echo "Archived App Info.plist is missing: $APP_INFO_PLIST" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_INFO_PLIST")"
BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_INFO_PLIST")"
if [ -z "${OTA_IPA_URL:-}" ]; then
  echo "OTA_IPA_URL is required (for example: https://downloads.example.org/App.ipa)" >&2
  exit 1
fi
OTA_MANIFEST_PATH="$EXPORT_DIR/manifest.plist"
cp "$ROOT_DIR/ios/App/ota/manifest.plist" "$OTA_MANIFEST_PATH"
/usr/libexec/PlistBuddy -c "Set :items:0:assets:0:url $OTA_IPA_URL" "$OTA_MANIFEST_PATH"
/usr/libexec/PlistBuddy -c "Set :items:0:metadata:bundle-identifier $BUNDLE_ID" "$OTA_MANIFEST_PATH"
/usr/libexec/PlistBuddy -c "Set :items:0:metadata:bundle-version $BUNDLE_VERSION" "$OTA_MANIFEST_PATH"

rm -rf "$ARCHIVE_PATH" "$BUILD_DIR/DerivedData"
find "$EXPORT_DIR" -mindepth 1 -maxdepth 1 -type f ! -name 'App.ipa' ! -name 'manifest.plist' -delete

echo "Vue release IPA: $IPA_PATH"
echo "OTA manifest: $OTA_MANIFEST_PATH"
