// Tier-1 walk: for every specimen × width, screenshot the harness frame to
// gallery/components/<component>/<specimen>/<width>.png. Enumerates specimens
// from disk (the Vue glob isn't reachable from Node) and widths from the shared
// widths.json. Assumes a harness build is being served at HARNESS_URL.
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.HARNESS_URL || 'http://localhost:4173'
const SPECIMEN_ROOT = 'src/harness/specimens'
const OUT_ROOT = 'gallery/components'
const widths = JSON.parse(fs.readFileSync('src/harness/widths.json', 'utf8'))

const walk = []
for (const comp of fs.readdirSync(SPECIMEN_ROOT)) {
  const dir = path.join(SPECIMEN_ROOT, comp)
  if (!fs.statSync(dir).isDirectory()) continue
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js')) walk.push({ component: comp, specimen: f.replace(/\.js$/, '') })
  }
}

const browser = await chromium.launch()
let shots = 0
for (const { component, specimen } of walk) {
  for (const [wname, wpx] of Object.entries(widths)) {
    const page = await browser.newPage({
      viewport: { width: Math.max(wpx + 120, 600), height: 900 },
      deviceScaleFactor: 2,
    })
    const url = `${BASE}/#/harness/component/${component}/${specimen}?w=${wname}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-harness-ready]', { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    const frame = await page.$('.harness-frame')
    const out = path.join(OUT_ROOT, component, specimen, `${wname}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await frame.screenshot({ path: out })
    await page.close()
    shots++
  }
}
await browser.close()
console.log(`walk: ${walk.length} specimens × ${Object.keys(widths).length} widths = ${shots} shots`)
