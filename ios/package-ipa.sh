#!/usr/bin/env bash
set -euo pipefail

# Convenience IPA wrapper for agents working from the ios/ directory.
#
# Usage:
#   ./package-ipa.sh                 # build Vue IPA without legacy fallback assets
#   ./package-ipa.sh vue             # same as default
#   ./package-ipa.sh legacy          # build current legacy IPA
#   ./package-ipa.sh vue --with-legacy-fallback
#   ./package-ipa.sh vue --keep-public
#   ./package-ipa.sh vue --skip-smoke
#
# Outputs:
#   Vue:    build/ios/vue-release/export/App.ipa
#   Legacy: build/ios/release/export/App.ipa
#
# Notes:
#   - Vue is the migration target. App Store packaging defaults to the pure Vue
#     bundle; pass --with-legacy-fallback only for rollback/parity testing.
#   - Vue packaging runs smoke:vue before archive unless --skip-smoke is passed.
#   - Vue packaging keeps ios/App/App/public on the pure Vue build by default.
#     Pass --restore-legacy only when you explicitly want Xcode to return to the
#     old HTML debug flow after export.
#   - xcodebuild needs normal Xcode/codesign access. In Codex or other sandboxed
#     runners, request unsandboxed/escalated execution if Swift Package
#     resolution or sandbox-exec errors occur.

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$IOS_DIR/.." && pwd)"
MODE="vue"
RESTORE_LEGACY="0"
RUN_SMOKE="1"
BUNDLE_LEGACY_FALLBACK="0"

usage() {
  sed -n '3,31p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    vue|web)
      MODE="vue"
      ;;
    legacy)
      MODE="legacy"
      ;;
    --keep-public)
      RESTORE_LEGACY="0"
      ;;
    --restore-legacy)
      RESTORE_LEGACY="1"
      ;;
    --skip-smoke)
      RUN_SMOKE="0"
      ;;
    --with-legacy-fallback)
      BUNDLE_LEGACY_FALLBACK="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$ROOT_DIR"

if [ "$MODE" = "legacy" ]; then
  npm run ios:archive:legacy
  echo "Legacy IPA ready: $ROOT_DIR/build/ios/release/export/App.ipa"
  exit 0
fi

if [ "$RUN_SMOKE" = "1" ]; then
  npm run smoke:vue
fi

if [ "$BUNDLE_LEGACY_FALLBACK" = "1" ]; then
  ZHANGL_VUE_BUNDLE_LEGACY=1 VITE_ENABLE_LEGACY_FALLBACK=1 npm run ios:archive:web
else
  npm run ios:archive:web
fi

if [ "$RESTORE_LEGACY" = "1" ]; then
  npm run ios:sync:legacy
fi

echo "Vue IPA ready: $ROOT_DIR/build/ios/vue-release/export/App.ipa"
