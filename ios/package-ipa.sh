#!/usr/bin/env bash
set -euo pipefail

# Convenience IPA wrapper for agents working from the ios/ directory.
#
# Usage:
#   ./package-ipa.sh                 # build the current Vue IPA
#   ./package-ipa.sh vue             # same as default
#   ./package-ipa.sh vue --skip-smoke
#
# Outputs:
#   build/ios/vue-release/export/App.ipa
#
# Notes:
#   - The repository has one frontend bundle and one iOS archive path.
#   - Packaging runs smoke:vue before archive unless --skip-smoke is passed.
#   - xcodebuild needs normal Xcode/codesign access. In Codex or other sandboxed
#     runners, request unsandboxed/escalated execution if Swift Package
#     resolution or sandbox-exec errors occur.

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$IOS_DIR/.." && pwd)"
RUN_SMOKE="1"

usage() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    vue|web)
      ;;
    --keep-public)
      ;;
    --skip-smoke)
      RUN_SMOKE="0"
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

if [ "$RUN_SMOKE" = "1" ]; then
  npm run smoke:vue
fi

npm run ios:archive

echo "Vue IPA ready: $ROOT_DIR/build/ios/vue-release/export/App.ipa"
