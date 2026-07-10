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
// Design-scale axis (--table-scale): capture each specimen×width at every scale.
const scales = JSON.parse(fs.readFileSync('src/harness/scales.json', 'utf8'))
// Tier 2 — view scenarios: fixtures walked at named viewports.
const FIXTURE_ROOT = 'src/harness/fixtures'
const SCENE_OUT = 'gallery/scenes'
const viewports = JSON.parse(fs.readFileSync('src/harness/viewports.json', 'utf8'))
const scenes = fs.existsSync(FIXTURE_ROOT)
  ? fs.readdirSync(FIXTURE_ROOT).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''))
  : []

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
    for (const sval of scales) {
      const page = await browser.newPage({
        // Give the frame room even when the scaled content grows past wpx.
        viewport: { width: Math.max(Math.ceil(wpx * sval) + 120, 600), height: 900 },
        deviceScaleFactor: 2,
      })
      const url = `${BASE}/#/harness/component/${component}/${specimen}?w=${wname}&scale=${sval}`
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-harness-ready]', { timeout: 15000 })
      await page.evaluate(() => document.fonts.ready)
      const frame = await page.$('.harness-frame')
      // Filename token: <width>@<scale>.png (e.g. panel@1.25.png).
      const out = path.join(OUT_ROOT, component, specimen, `${wname}@${sval}.png`)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      await frame.screenshot({ path: out })
      await page.close()
      shots++
    }
  }
}
console.log(`components: ${walk.length} specimens × ${Object.keys(widths).length} widths × ${scales.length} scales = ${shots} shots`)

// Tier 2: each fixture full-page at each named viewport.
let sceneShots = 0
for (const scene of scenes) {
  for (const [vpName, vp] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 })
    const url = `${BASE}/#/harness/scene/${scene}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-harness-ready]', { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    const out = path.join(SCENE_OUT, scene, `${vpName}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out, fullPage: true })
    await page.close()
    sceneShots++
  }
}

await browser.close()
console.log(`scenes: ${scenes.length} fixtures × ${Object.keys(viewports).length} viewports = ${sceneShots} shots`)
