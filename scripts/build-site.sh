#!/usr/bin/env bash
#
# Restructure the Vite build output (dist/) into the public site layout that
# bridge-classroom.com and bridge-classroom.org both serve. Idempotent.
#
# Pre-requisite: `npm run build` has already produced dist/ with the SPA
# entry at dist/index.html and assets at dist/assets/.
#
# Output (publishable as-is):
#   dist/index.html           — static landing hub (from docs/)
#   dist/<page>.html          — static detail pages (from docs/)
#   dist/solo-practice-app/   — Vue SPA (the renamed dist/index.html)
#   dist/bidding-practice/    — redirect into the SPA
#   dist/curator/, dist/screenshots/, dist/site.js, dist/styles.css, etc.
#
# Used by both .github/workflows/deploy.yml (GitHub Pages → .com) and the
# Cloudflare Pages build for bridge-classroom.org so both domains stay in
# sync from the same source.

set -euo pipefail

echo "==== build-site.sh: START (cwd=$(pwd)) ===="

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "build-site.sh: working from $ROOT"

if [ ! -f dist/index.html ]; then
  echo "scripts/build-site.sh: dist/index.html not found — did you run 'npm run build' first?" >&2
  exit 1
fi

# Move the SPA entry into /solo-practice-app/. Keep dist/assets/ at the root
# so the absolute /assets/<chunk>.js URLs in the HTML resolve.
mkdir -p dist/solo-practice-app
mv dist/index.html dist/solo-practice-app/index.html

# Static landing hub + detail pages. Keep this list in sync as new pages
# are added under docs/.
cp docs/index.html             dist/index.html
cp docs/favicon.svg            dist/favicon.svg
cp docs/styles.css             dist/styles.css
cp docs/site.js                dist/site.js
cp docs/about.html             dist/about.html
cp docs/privacy.html           dist/privacy.html
# (the noindex dev gallery is assembled under dist/dev/ below — not a flat file)
cp docs/solo-practice.html     dist/solo-practice.html
cp docs/classrooms.html        dist/classrooms.html
cp docs/game-analysis.html     dist/game-analysis.html
cp docs/game-analysis-guide.html dist/game-analysis-guide.html
cp docs/bbo-scenarios.html     dist/bbo-scenarios.html
cp docs/lesson-materials.html  dist/lesson-materials.html
cp docs/teacher-utilities.html dist/teacher-utilities.html
cp docs/hand-curator.html      dist/hand-curator.html
cp docs/deal-library.html      dist/deal-library.html
cp docs/bidding-practice.html  dist/bidding-practice.html
cp docs/sitemap.xml            dist/sitemap.xml
cp docs/robots.txt             dist/robots.txt

# Static directories.
cp -r docs/curator           dist/curator
cp -r docs/bidding-practice  dist/bidding-practice
cp -r docs/screenshots       dist/screenshots
# The bc-ingest receiver — the extension's hand-off target. Top-level and
# use-case neutral by design (ADR 0001 Decision 2): the extension points at
# /ingest and nothing beyond it, and this page routes onward to whichever
# consumer was asked for. The directory name is load-bearing — the extension's
# ingest content script matches the whole origin but self-gates on a path
# ending in /ingest.
cp -r docs/ingest            dist/ingest

# ── Co-locate the Game Analysis app under /game-analysis/ (same-origin) ──────
# app-architecture.md M1: serve club-game-analysis from the SPA origin so it
# shares identity + localStorage and the table can pull cached club games.
# Source is the sibling Bridge-Game-Analysis repo — a self-contained index.html
# + static/. CI clones it and points GAME_ANALYSIS_SRC at the checkout; local
# runs default to the sibling working copy. Non-fatal if absent, so a local
# build-site.sh without the sibling repo still succeeds (just no /game-analysis/).
GAME_ANALYSIS_SRC="${GAME_ANALYSIS_SRC:-../Bridge-Game-Analysis}"
if [ -f "$GAME_ANALYSIS_SRC/index.html" ]; then
  echo "build-site.sh: co-locating game-analysis from $GAME_ANALYSIS_SRC"
  mkdir -p dist/game-analysis
  cp "$GAME_ANALYSIS_SRC/index.html" dist/game-analysis/index.html
  if [ -d "$GAME_ANALYSIS_SRC/static" ]; then
    cp -r "$GAME_ANALYSIS_SRC/static" dist/game-analysis/static
  fi
else
  echo "build-site.sh: NOTE game-analysis source not at $GAME_ANALYSIS_SRC — skipping /game-analysis/ (non-fatal)"
fi

# ── Dev gallery under /dev/ (noindex) ───────────────────────────────────────
# The tabbed dev hub: launcher + entry-point screenshots + LIVE component
# library. The Components tab renders real components through a SEPARATE harness
# bundle (VITE_HARNESS=1) served at /dev/harness/. Built with base=/dev/harness/
# so its /assets URLs are self-contained (no collision with the main app's).
#
# GUARDED / non-fatal (like the game-analysis co-location above): a harness
# build break must never fail the .com/.org publish — the components tab just
# goes blank until it's fixed.
echo "build-site.sh: assembling dev gallery → dist/dev/"
mkdir -p dist/dev
cp docs/dev/index.html dist/dev/index.html
cp docs/dev/drill.html dist/dev/drill.html
cp docs/dev/scene.html dist/dev/scene.html
[ -d docs/dev/shots ] && cp -r docs/dev/shots dist/dev/shots || mkdir -p dist/dev/shots

if node scripts/harness-manifest.mjs dist/dev/components-manifest.json; then
  :
else
  echo "build-site.sh: NOTE harness manifest failed — components tab will be empty (non-fatal)"
fi

if VITE_HARNESS=1 npx vite build --base=/dev/harness/ --outDir dist/dev/harness --emptyOutDir >/tmp/harness-build.log 2>&1; then
  echo "build-site.sh: dev harness bundle → dist/dev/harness/"
else
  echo "build-site.sh: NOTE harness bundle build FAILED — live components tab will be blank (non-fatal). See /tmp/harness-build.log" >&2
fi

echo "==== build-site.sh: DONE — dist/ ready to publish ===="
ls -1 dist/ | sed 's/^/  dist\//'
