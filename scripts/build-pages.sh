#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_APP_VERSION="${VITE_APP_VERSION:-$(node -p "require('./package.json').version")}"
export VITE_GIT_COMMIT="${VITE_GIT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || printf local)}"

npx tsc --noEmit
npx vite build

# GitHub Pages 404 fallback — SPA-style single page.
cp docs/index.html docs/404.html
echo "[build] docs/ ready (v$VITE_APP_VERSION · $VITE_GIT_COMMIT)"
