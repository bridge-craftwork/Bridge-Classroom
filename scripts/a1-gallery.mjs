// A1 scene gallery — SEPARATE from the (large) component gallery. Walks only the
// A1 target-composition fixtures (`src/harness/fixtures-a1/`) across the five
// named viewports and emits its own page: `gallery-a1/index.html` (links PNGs)
// and `gallery-a1/index-inline.html` (base64, self-contained → publishable as an
// Artifact). Assumes a harness build is served at HARNESS_URL (see a1-gallery.sh).
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const BASE = process.env.HARNESS_URL || 'http://localhost:4173'
const FIX_DIR = 'src/harness/fixtures-a1'
const OUT = 'gallery-a1'
const viewports = JSON.parse(fs.readFileSync('src/harness/viewports.json', 'utf8'))

const fixtures = []
for (const file of fs.readdirSync(FIX_DIR)) {
  if (!file.endsWith('.js')) continue
  const name = file.replace(/\.js$/, '')
  const mod = await import(pathToFileURL(path.resolve(FIX_DIR, file)).href)
  fixtures.push({ name, label: mod.default?.label || name, phase: mod.default?.phase || '' })
}

// ── Walk ────────────────────────────────────────────────────────────────────
const boundingBoxesAll = process.argv.includes('--bounding-boxes')
const browser = await chromium.launch()
let shots = 0
const capText = {} // `${name}/${vp}` → "center 1.50 · seats 1.15 · ne 1.00 · se 1.00"
const rects = {}   // `${name}/${vp}` → { 'seat-s': {top,left,bottom}, se: {…} } — hand/BB screen positions (bottom-anchor acceptance)
for (const { name } of fixtures) {
  for (const [vp, dim] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport: { width: dim.w, height: dim.h }, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/#/harness/scene/${name}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-harness-ready]', { state: 'attached', timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    // The §3 clamp's computed per-region scales, straight off the arranger's
    // data-region-scale attributes — turns review from impressions into params.
    const scales = await page.evaluate(() => {
      const out = {}
      document.querySelectorAll('[data-region-scale]').forEach((el) => {
        const r = el.getAttribute('data-region'); const s = el.getAttribute('data-region-scale')
        if (r && s && out[r] == null) out[r] = s
      })
      return out
    })
    const order = ['center', 'seat-s', 'ne', 'se', 'nw']
    const label = { 'seat-s': 'seats' }
    capText[`${name}/${vp}`] = order.filter((r) => scales[r] != null)
      .map((r) => `${label[r] || r} ${scales[r]}×`).join(' · ')
    // Auction top + hand (seat-s) + BiddingBox (se) screen positions — the
    // top-anchor acceptance measures these across auction lengths 1/5/9 (same
    // viewport): auction top stable, hand/BB push DOWN one round each round.
    rects[`${name}/${vp}`] = await page.evaluate(() => {
      const out = {}
      const rect = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
      for (const sel of ['seat-s', 'se']) {
        const el = document.querySelector(`[data-region="${sel}"]`)
        if (el) out[sel] = rect(el)
      }
      const auc = document.querySelector('.a1-center-auction')
      if (auc) out.auction = rect(auc)
      return out
    })
    const out = path.join(OUT, 'scenes', name, `${vp}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: true })
    // Bounding-box variant (grid-arranger-spec §5.1): the arranger's ledger made
    // visible. Always for the bidding triptych (the reserve-band demo); all scenes
    // with --bounding-boxes. Toggled via <html data-bounding-boxes> — no re-nav.
    if (boundingBoxesAll || /^a1-bidding-len/.test(name)) {
      await page.evaluate(() => document.documentElement.toggleAttribute('data-bounding-boxes', true))
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await page.screenshot({ path: path.join(OUT, 'scenes', name, `${vp}__bounding-boxes.png`), fullPage: true })
    }
    await page.close()
    shots++
  }
}
await browser.close()
console.log(`a1 scenes: ${fixtures.length} fixtures × ${Object.keys(viewports).length} viewports = ${shots} shots`)

// ── Bottom-anchor + reserve acceptance (A1 reserveRounds = 1) ─────────────────
// Same deal, three auction lengths (1/5/9 calls = 1/2/3 call-rounds). The stage is
// sized to a single-row reserve, so the auction's TOP is fixed just below the
// status strip, and each extra round takes the MONOTONE DISPLACEMENT path: the
// auction bottom, hand (seat-s) and BB (se) are pushed DOWN one round at a time.
// Pass gate: auction top stable AND hand/BB strictly rise (len1 < len5 < len9).
const TRIP = ['a1-bidding-len1', 'a1-bidding-len5', 'a1-bidding-len9']
const haveTrip = TRIP.every((n) => fixtures.some((f) => f.name === n))
const acceptance = { model: 'bottom-anchor+reserve(1)', pass: null, rows: [] }
if (haveTrip) {
  console.log('\n── bottom-anchor acceptance (auction top fixed; hand/BB non-decreasing) ──')
  let allPass = true
  for (const [vp] of Object.entries(viewports)) {
    const r = (n) => rects[`${n}/${vp}`] || {}
    const top = (n, sel) => (r(n)[sel] ? r(n)[sel].top : null)
    const aucTops = TRIP.map((n) => (r(n).auction ? r(n).auction.top : null))
    const handTops = TRIP.map((n) => top(n, 'seat-s'))
    const bbTops = TRIP.map((n) => top(n, 'se'))
    // ±2px tolerance absorbs sub-pixel layout rounding. The contract: the auction
    // top is FIXED, and the hand/BB are MONOTONE NON-DECREASING (they never move up
    // as the auction grows). Actual downward displacement happens once the auction
    // exceeds the top-band (status) height — required when it does, not at every
    // viewport (a small auction that stays within the status band's height doesn't
    // push, which is correct).
    const stable = (a) => a.every((v) => v != null && Math.abs(v - a[0]) <= 2)
    const rising = (a) => a.every((v, i) => v != null && (i === 0 || v - a[i - 1] >= -2))
    const aucTopStable = stable(aucTops)
    const handPush = rising(handTops)
    const bbPush = rising(bbTops)
    const ok = aucTopStable && handPush && bbPush
    allPass = allPass && ok
    const step = handTops[1] != null && handTops[0] != null ? handTops[1] - handTops[0] : null
    acceptance.rows.push({ viewport: vp, auctionTop: aucTops, hand: handTops, bb: bbTops, aucTopStable, handPush, bbPush, pushPerRound: step, ok })
    console.log(
      `  ${vp.padEnd(18)} auc-top ${JSON.stringify(aucTops).padEnd(18)} hand ${JSON.stringify(handTops).padEnd(18)}` +
      ` bb ${JSON.stringify(bbTops).padEnd(18)} push/round≈${step} ${ok ? 'PASS' : 'FAIL'}`,
    )
  }
  acceptance.pass = allPass
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'anchor-acceptance.json'), JSON.stringify(acceptance, null, 2))
  console.log(`  → ${allPass ? 'ALL PASS' : 'FAILURES'} · wrote ${OUT}/anchor-acceptance.json`)
} else {
  console.log('(bottom-anchor acceptance skipped — len1/5/9 fixtures not all present)')
}

// ── Generate ──────────────────────────────────────────────────────────────────
const INLINE = process.argv.includes('--inline')
const imgSrc = (rel) => {
  if (!INLINE) return rel
  const abs = path.join(OUT, rel)
  return fs.existsSync(abs) ? `data:image/png;base64,${fs.readFileSync(abs).toString('base64')}` : rel
}

const vpEntries = Object.entries(viewports)
let body = ''
for (const { name, label, phase } of fixtures) {
  body += `<section class="fx"><h2>${label}${phase ? ` <span class="ph">${phase}</span>` : ''}</h2><div class="row">`
  for (const [vp, dim] of vpEntries) {
    const rel = `scenes/${name}/${vp}.png`
    const relBb = `scenes/${name}/${vp}__bounding-boxes.png`
    const hasBb = fs.existsSync(path.join(OUT, relBb))
    const caps = capText[`${name}/${vp}`] || ''
    const bbImg = hasBb ? `<div class="shot bounding-boxes"><span class="bounding-box-label">bounding boxes</span><img src="${imgSrc(relBb)}" alt="${name} ${vp} bounding boxes" loading="lazy"></div>` : ''
    body += `<figure><figcaption>${vp} · ${dim.w}×${dim.h}<br><span class="rep">${dim.represents}</span>${caps ? `<br><span class="scales">${caps}</span>` : ''}</figcaption><div class="shot"><img src="${imgSrc(rel)}" alt="${name} ${vp}" loading="lazy"></div>${bbImg}</figure>`
  }
  body += `</div></section>`
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>A1 Scene Gallery</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --bg:#f5f5f3; --card:#fff; --ink:#1a2420; --mut:#6a726c; --line:#e2e5df; }
@media (prefers-color-scheme: dark){ :root { --bg:#12140f; --card:#1b1e18; --ink:#e8ebe4; --mut:#9aa39a; --line:#2c312a; } }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 'DM Sans',system-ui,sans-serif; }
header { padding:22px 26px; border-bottom:1px solid var(--line); }
header h1 { margin:0; font-size:20px; } header p { margin:6px 0 0; color:var(--mut); max-width:70ch; }
.fx { padding:22px 26px; border-bottom:1px solid var(--line); }
.fx h2 { margin:0 0 14px; font-size:16px; } .ph { font-size:12px; color:var(--mut); background:var(--line); border-radius:999px; padding:2px 9px; vertical-align:middle; }
.row { display:flex; gap:18px; overflow-x:auto; padding-bottom:6px; }
figure { margin:0; flex:0 0 auto; }
figcaption { font-size:11px; color:var(--mut); margin-bottom:6px; } .rep { opacity:.7; }
.scales { display:inline-block; margin-top:3px; font-weight:700; color:#1d8a5f; font-variant-numeric:tabular-nums; }
@media (prefers-color-scheme: dark){ .scales { color:#5fd39b; } }
.shot { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.shot img { display:block; max-height:520px; width:auto; }
.shot.bounding-boxes { margin-top:8px; position:relative; }
.bounding-box-label { position:absolute; top:6px; right:6px; z-index:2; font:700 10px/1 ui-monospace,monospace; color:#fff; background:rgba(160,92,12,.92); padding:3px 6px; border-radius:5px; }
</style></head><body>
<header><h1>A1 Scene Gallery <span class="ph">Scenario Mastery target composition</span></h1>
<p>The three A1 states modeled from frozen fixtures — AuctionTable in center, BiddingBox at SE, TableInfo at NW, pinned auction at NE (play/review), narrative floated right. Separate from the component gallery. Walked across the five named viewports.</p></header>
${body}</body></html>`

const outFile = path.join(OUT, INLINE ? 'index-inline.html' : 'index.html')
fs.writeFileSync(outFile, html)
console.log(`gallery-a1 → ${outFile}${INLINE ? ' (self-contained, artifact-ready)' : ''}`)
