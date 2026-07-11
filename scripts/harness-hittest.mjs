// Hit-area proof for the HandDisplay truncation chip (amendment acceptance).
// On the clickable 11-card specimen (spade row truncated → dressed pill chip):
//   1. a tap in the row's TRAILING SLACK (right of the pill, inside its extended
//      hit area) OPENS the popup and plays nothing;
//   2. a tap on the LAST VISIBLE RANK PLAYS that card (emits card-click) and does
//      NOT open the popup — truncation never reroutes a rank tap;
//   3. a tap in the GAP between the last rank and the pill is inert (neither) —
//      the boundary can't ambiguously play-vs-open.
// Assumes a harness build is served at HARNESS_URL (see harness-gallery.sh).
import { chromium } from 'playwright'

const BASE = process.env.HARNESS_URL || 'http://localhost:4173'
// tile (160px) is the width where the 11-card suit actually truncates → chip.
const URL = `${BASE}/#/harness/component/HandDisplay/eleven-card-clickable?w=tile&scale=1`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 1 })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-harness-ready]', { state: 'attached', timeout: 15000 })
await page.evaluate(() => document.fonts.ready)
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

// Rects of the first (spade) row's last visible rank cell and the chip pill.
const geom = await page.evaluate(() => {
  // The first row that actually truncated (has a chip) — the long spade suit.
  const row = [...document.querySelectorAll('.suits .suit-row')].find((r) => r.querySelector('.cell.chip'))
  if (!row) throw new Error('no truncated row/chip at this width — nothing to hit-test')
  const chip = row.querySelector('.cell.chip')
  const ranks = [...row.querySelectorAll('.cards .cell:not(.chip)')]
  const last = ranks[ranks.length - 1]
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, cy: b.top + b.height / 2 } }
  return { chip: r(chip), last: r(last), lastRank: last.textContent.trim() }
})

const results = []
async function trial(name, x, y, fn) {
  await page.evaluate(() => { window.__harnessEvents = [] })
  await page.mouse.click(x, y)
  await page.waitForTimeout(120)
  const state = await page.evaluate(() => ({
    popup: !!document.querySelector('.cs-popup'),
    events: window.__harnessEvents || [],
  }))
  const ok = fn(state)
  results.push({ name, ok, popup: state.popup, events: state.events.map((e) => e.payload) })
  // Dismiss any popup before the next trial.
  if (state.popup) { await page.keyboard.press('Escape').catch(() => {}); await page.mouse.click(5, 5); await page.waitForTimeout(60) }
}

// 1. Trailing slack: right of the pill body, inside the extended hit area.
await trial('trailing-slack→popup', geom.chip.right + 12, geom.chip.cy,
  (s) => s.popup === true && s.events.length === 0)

// 2. Last visible rank: plays it, no popup.
await trial('last-rank→plays', (geom.last.left + geom.last.right) / 2, geom.last.cy,
  (s) => s.popup === false && s.events.some((e) => e.type === 'card-click'))

// 3. Gap between last rank and pill: inert (real slack, no ambiguity).
const gapX = (geom.last.right + geom.chip.left) / 2
await trial('boundary-gap→inert', gapX, geom.last.cy,
  (s) => s.popup === false && s.events.length === 0)

await browser.close()

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}  popup=${r.popup} events=${JSON.stringify(r.events)}`)
  if (!r.ok) failed++
}
console.log(failed === 0 ? `\nhit-area: ${results.length}/${results.length} passed` : `\nhit-area: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
