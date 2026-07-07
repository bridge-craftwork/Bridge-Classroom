#!/usr/bin/env bash
# One command → the Tier-1 component gallery. Builds a SEPARATE harness bundle
# (VITE_HARNESS=1) into dist-harness so the real dist/ never contains harness
# code, serves it, walks every specimen × width, and regenerates the page.
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_HARNESS=1
echo "==== harness-gallery: build ===="
npx vite build --outDir dist-harness --emptyOutDir >/dev/null

echo "==== harness-gallery: serve ===="
npx vite preview --outDir dist-harness --port 4173 >/tmp/harness-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT
# wait for the server
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:4173/ && break || sleep 0.5; done

echo "==== harness-gallery: walk ===="
HARNESS_URL=http://localhost:4173 node scripts/harness-walk.mjs

echo "==== harness-gallery: generate ===="
node scripts/harness-gallery.mjs
echo "==== harness-gallery: DONE → gallery/index.html ===="
