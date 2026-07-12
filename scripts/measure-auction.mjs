// One-off: measure the REAL rendered AuctionTable footprint at --table-scale 1.0
// from the a1 bidding scenes, to re-baseline auctionMetrics.headerRowPx/roundRowPx
// after the glyph-scale restyle. Prints header band + per-round marginal height.
import { chromium } from 'playwright'
const BASE = process.env.HARNESS_URL || 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const measure = async (scene) => {
  await page.goto(`${BASE}/#/harness/scene/${scene}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness-ready]', { state: 'attached', timeout: 15000 })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return await page.evaluate(() => {
    const at = document.querySelector('.a1-center-auction .auction-table')
    const wrap = document.querySelector('.a1-center-auction')
    const header = document.querySelector('.a1-center-auction .header')
    const rounds = [...document.querySelectorAll('.a1-center-auction .round')]
    const scale = getComputedStyle(document.querySelector('[data-region="center"]')).getPropertyValue('--table-scale')
    const h = (el) => (el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : null)
    return {
      scale: scale.trim(),
      wrapH: h(wrap),
      tableH: h(at),
      headerH: h(header),
      roundHs: rounds.map(h),
      nRounds: rounds.length,
    }
  })
}
for (const s of ['a1-bidding-len1', 'a1-bidding-len5', 'a1-bidding-len9']) {
  console.log(s, JSON.stringify(await measure(s)))
}
await browser.close()
