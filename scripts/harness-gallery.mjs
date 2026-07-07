// Static gallery generator: walk gallery/components/** and emit one HTML page —
// per component, a grid of rows = specimens, columns = container widths. Each
// specimen cell enumerates what defines it (hand holding + props), imported
// straight from the specimen file. No app, no knobs; regenerating is the only
// edit path.
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const ROOT = 'gallery/components'
const SPEC_ROOT = 'src/harness/specimens'
const widths = Object.keys(JSON.parse(fs.readFileSync('src/harness/widths.json', 'utf8')))

if (!fs.existsSync(ROOT)) {
  console.error('no gallery output — run the walk first')
  process.exit(1)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const SUIT = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const fmtRank = (r) => (String(r).toUpperCase() === 'T' ? '10' : String(r))

// Holding as colored suit rows: "♠ K Q 10 2   ♥ A 8 4   ♦ Q J 9   ♣ K 6 3".
function formatHand(hand) {
  if (!hand) return ''
  return ['spades', 'hearts', 'diamonds', 'clubs']
    .map((s) => {
      const cards = (hand[s] || []).map(fmtRank).join(' ') || '—'
      const red = s === 'hearts' || s === 'diamonds'
      return `<span class="suit ${red ? 'red' : ''}">${SUIT[s]}</span>&nbsp;${esc(cards)}`
    })
    .join('&nbsp;&nbsp;&nbsp;')
}

// Config props as flags/badges: "seat S · showHcp · played: SA DT C2".
function formatProps(props) {
  const out = []
  if (props.seat) out.push(`seat ${esc(props.seat)}`)
  for (const flag of ['showHcp', 'showTotalPoints', 'compact', 'minimal', 'clickable', 'hidden', 'hidePlayedCards']) {
    if (props[flag]) out.push(flag)
  }
  if (Array.isArray(props.playedCards) && props.playedCards.length) {
    out.push(`played: ${esc(props.playedCards.join(' '))}`)
  }
  return out.map((p) => `<span class="flag">${p}</span>`).join(' ')
}

async function loadSpecimen(component, name) {
  const file = path.resolve(SPEC_ROOT, component, `${name}.js`)
  if (!fs.existsSync(file)) return null
  try {
    return (await import(pathToFileURL(file).href)).default
  } catch {
    return null
  }
}

let body = ''
for (const comp of fs.readdirSync(ROOT).sort()) {
  const compDir = path.join(ROOT, comp)
  if (!fs.statSync(compDir).isDirectory()) continue
  body += `<h2>${esc(comp)}</h2>\n<table>\n<thead><tr><th class="spec">specimen</th>${widths.map((w) => `<th>${esc(w)}</th>`).join('')}</tr></thead>\n<tbody>\n`
  for (const name of fs.readdirSync(compDir).sort()) {
    const spec = await loadSpecimen(comp, name)
    const specCell = `<div class="spec-name">${esc(spec?.label || name)}</div>`
      + (spec ? `<div class="spec-file">${esc(name)}.js</div>` : '')
      + (spec?.props?.hand ? `<div class="spec-hand">${formatHand(spec.props.hand)}</div>` : '')
      + (spec?.props ? `<div class="spec-props">${formatProps(spec.props)}</div>` : '')
    body += `<tr><td class="spec">${specCell}</td>`
    for (const w of widths) {
      const rel = `components/${comp}/${name}/${w}.png`
      body += fs.existsSync(path.join('gallery', rel))
        ? `<td><img src="${rel}" alt="${esc(name)} @ ${esc(w)}"></td>`
        : `<td class="missing">—</td>`
    }
    body += `</tr>\n`
  }
  body += `</tbody>\n</table>\n`
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Component Gallery</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 20px; } h2 { margin-top: 32px; font-size: 16px; color: #1D9E75; }
  table { border-collapse: collapse; } th, td { border: 1px solid #e2e2e2; padding: 8px; vertical-align: top; text-align: center; }
  th { background: #fafafa; font-weight: 600; } th.spec, td.spec { text-align: left; white-space: nowrap; }
  td.spec { min-width: 240px; }
  .spec-name { font-weight: 600; font-size: 13px; }
  .spec-file { font: 11px 'Courier New', monospace; color: #999; margin: 1px 0 6px; }
  .spec-hand { font: 14px 'Courier New', monospace; color: #222; line-height: 1.5; }
  .spec-hand .suit { color: #1a1a1a; } .spec-hand .suit.red { color: #d32f2f; }
  .spec-props { margin-top: 6px; }
  .spec-props .flag { display: inline-block; font: 11px 'Courier New', monospace; color: #555; background: #f0f0f0; border-radius: 3px; padding: 1px 5px; margin: 1px 2px 1px 0; }
  img { display: block; max-width: 320px; height: auto; } td.missing { color: #c00; }
</style></head><body>
<h1>Component Specimens <small style="color:#999;font-weight:400">Tier 1 · container widths</small></h1>
${body}</body></html>
`
fs.writeFileSync('gallery/index.html', html)
console.log('gallery → gallery/index.html')
