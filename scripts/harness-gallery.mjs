// Static gallery generator: walk gallery/components/** and emit one HTML page —
// per component, a grid of rows = specimens, columns = container widths.
// No app, no knobs; specimens are files, so regenerating is the only edit path.
import fs from 'fs'
import path from 'path'

const ROOT = 'gallery/components'
const widths = Object.keys(JSON.parse(fs.readFileSync('src/harness/widths.json', 'utf8')))

if (!fs.existsSync(ROOT)) {
  console.error('no gallery output — run the walk first')
  process.exit(1)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
let body = ''
for (const comp of fs.readdirSync(ROOT).sort()) {
  const compDir = path.join(ROOT, comp)
  if (!fs.statSync(compDir).isDirectory()) continue
  body += `<h2>${esc(comp)}</h2>\n<table>\n<thead><tr><th class="spec">specimen</th>${widths.map((w) => `<th>${esc(w)}</th>`).join('')}</tr></thead>\n<tbody>\n`
  for (const spec of fs.readdirSync(compDir).sort()) {
    body += `<tr><td class="spec">${esc(spec)}</td>`
    for (const w of widths) {
      const rel = `components/${comp}/${spec}/${w}.png`
      body += fs.existsSync(path.join('gallery', rel))
        ? `<td><img src="${rel}" alt="${esc(spec)} @ ${esc(w)}"></td>`
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
  th { background: #fafafa; font-weight: 600; } td.spec, th.spec { text-align: left; font: 12px 'Courier New', monospace; color: #555; white-space: nowrap; }
  img { display: block; max-width: 320px; height: auto; } td.missing { color: #c00; }
</style></head><body>
<h1>Component Specimens <small style="color:#999;font-weight:400">Tier 1 · container widths</small></h1>
${body}</body></html>
`
fs.writeFileSync('gallery/index.html', html)
console.log('gallery → gallery/index.html')
