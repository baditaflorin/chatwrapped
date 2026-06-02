#!/usr/bin/env bash
#
# Local-CI smoke gate (CPU only). Layers:
#   1. Vitest unit tests (pure logic)
#   2. Vite build → docs/
#   3. Sanity-check the build output
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d tests ] && ls tests/*.test.* > /dev/null 2>&1; then
  npm run test
fi

npm run build

test -s docs/index.html
grep -qi "<!doctype html" docs/index.html
test -s docs/404.html
test -d docs/assets

echo "[smoke] docs/ built and unit tests passed."
