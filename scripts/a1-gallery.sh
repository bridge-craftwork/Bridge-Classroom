#!/usr/bin/env bash
# One command → the A1 scene gallery (separate from the component gallery).
# Builds the harness bundle, serves it, walks only the fixtures-a1 scenes across
# the named viewports, and emits gallery-a1/index.html (+ --inline artifact form).
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_HARNESS=1
echo "==== a1-gallery: build ===="
npx vite build --outDir dist-harness --emptyOutDir >/dev/null

echo "==== a1-gallery: serve ===="
npx vite preview --outDir dist-harness --port 4173 >/tmp/a1-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:4173/ && break || sleep 0.5; done

echo "==== a1-gallery: walk + generate ===="
HARNESS_URL=http://localhost:4173 node scripts/a1-gallery.mjs
HARNESS_URL=http://localhost:4173 node scripts/a1-gallery.mjs --inline
echo "==== a1-gallery: DONE → gallery-a1/index.html ===="
