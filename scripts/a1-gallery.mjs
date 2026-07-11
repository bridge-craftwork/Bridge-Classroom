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
const browser = await chromium.launch()
let shots = 0
for (const { name } of fixtures) {
  for (const [vp, dim] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport: { width: dim.w, height: dim.h }, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/#/harness/scene/${name}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-harness-ready]', { state: 'attached', timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const out = path.join(OUT, 'scenes', name, `${vp}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: true })
    await page.close()
    shots++
  }
}
await browser.close()
console.log(`a1 scenes: ${fixtures.length} fixtures × ${Object.keys(viewports).length} viewports = ${shots} shots`)

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
    body += `<figure><figcaption>${vp} · ${dim.w}×${dim.h}<br><span class="rep">${dim.represents}</span></figcaption><div class="shot"><img src="${imgSrc(rel)}" alt="${name} ${vp}" loading="lazy"></div></figure>`
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
.shot { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.shot img { display:block; max-height:520px; width:auto; }
</style></head><body>
<header><h1>A1 Scene Gallery <span class="ph">Scenario Mastery target composition</span></h1>
<p>The three A1 states modeled from frozen fixtures — AuctionTable in center, BiddingBox at SE, TableInfo at NW, pinned auction at NE (play/review), narrative floated right. Separate from the component gallery. Walked across the five named viewports.</p></header>
${body}</body></html>`

const outFile = path.join(OUT, INLINE ? 'index-inline.html' : 'index.html')
fs.writeFileSync(outFile, html)
console.log(`gallery-a1 → ${outFile}${INLINE ? ' (self-contained, artifact-ready)' : ''}`)
