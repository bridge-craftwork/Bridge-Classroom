#!/usr/bin/env bash
# Capture the /dev gallery entry-point screenshots (Tab 2).
#
# Two modes:
#   • BASE_URL set  → walk that already-running origin (a live .org, a preview
#                     you're already serving). No build. CI points here.
#   • BASE_URL unset → build the published site tree, serve dist/ on :4173, walk it.
#
# Env passthrough: ONLY (surface ids), BC_SESSION (cookie for server surfaces).
# Default target set is the LOCAL surfaces (A1, B1); server-backed ones need a
# live session (see the plan follow-up) and stay as committed placeholders.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${BASE_URL:-}" ]; then
  echo "==== dev-shots: walk $BASE_URL ===="
  node scripts/dev-shots.mjs
  exit $?
fi

echo "==== dev-shots: build published site ===="
npm run build >/dev/null
bash scripts/build-site.sh >/dev/null

echo "==== dev-shots: serve dist/ on :4173 ===="
npx serve dist -l 4173 >/tmp/dev-shots-serve.log 2>&1 &
SERVE_PID=$!
trap 'kill "$SERVE_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:4173/solo-practice-app/" && break || sleep 0.5
done

echo "==== dev-shots: walk ===="
BASE_URL=http://localhost:4173 node scripts/dev-shots.mjs
echo "==== dev-shots: DONE → docs/dev/shots/ ===="
