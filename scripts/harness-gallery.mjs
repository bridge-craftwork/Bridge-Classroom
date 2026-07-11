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
// Container widths as { name: px }. We display each capture at its TRUE px
// width (native scale — 1 CSS px = 1 container px) so a 160px tile reads
// physically smaller than a 480px drill and font-size judgments are meaningful.
const widthsMap = JSON.parse(fs.readFileSync('src/harness/widths.json', 'utf8'))
const widths = Object.keys(widthsMap)
// Design scale axis (--table-scale). Only 1.0 is captured today; item 2 adds
// [1.0, 1.25, 1.5] as a real axis. Shown in each caption badge now so the
// format is stable when the axis lands.
const SCALE = 1.0

// `--inline` embeds every PNG as a base64 data: URI and writes a SELF-CONTAINED
// gallery/index-inline.html — the form a claude.ai Artifact needs (its CSP
// blocks external image requests). Default (no flag) writes index.html with
// relative <img src> for fast local browsing.
const INLINE = process.argv.includes('--inline') || process.env.INLINE === '1'
function imgSrc(rel) {
  if (!INLINE) return rel
  const abs = path.join('gallery', rel)
  return `data:image/png;base64,${fs.readFileSync(abs).toString('base64')}`
}
// Tier 2 — view scenarios.
const SCENE_ROOT = 'gallery/scenes'
const FIXTURE_ROOT = 'src/harness/fixtures'
const viewportsJson = JSON.parse(fs.readFileSync('src/harness/viewports.json', 'utf8'))
const viewportNames = Object.keys(viewportsJson)

if (!fs.existsSync(ROOT)) {
  console.error('no gallery output — run the walk first')
  process.exit(1)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Config props as flags/badges: "seat S · showHcp · played: SA DT C2". The
// holding itself isn't listed — it reads well enough in the renders alongside.
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

async function loadFixture(name) {
  const file = path.resolve(FIXTURE_ROOT, `${name}.js`)
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
  // Column headers carry the true px width; cells render at native scale so
  // columns are physically sized to their container widths.
  body += `<h2>${esc(comp)}</h2>\n<table>\n<thead><tr><th class="spec">specimen</th>${widths.map((w) => `<th>${esc(w)}<span class="th-px">${widthsMap[w]}px</span></th>`).join('')}</tr></thead>\n<tbody>\n`
  for (const name of fs.readdirSync(compDir).sort()) {
    const spec = await loadSpecimen(comp, name)
    const specCell = `<div class="spec-name">${esc(spec?.label || name)}</div>`
      + (spec ? `<div class="spec-file">${esc(name)}.js</div>` : '')
      + (spec?.props ? `<div class="spec-props">${formatProps(spec.props)}</div>` : '')
    body += `<tr><td class="spec">${specCell}</td>`
    for (const w of widths) {
      const px = widthsMap[w]
      const rel = `components/${comp}/${name}/${w}.png`
      body += fs.existsSync(path.join('gallery', rel))
        ? `<td style="width:${px}px"><img class="spec-img" style="width:${px}px" src="${imgSrc(rel)}" alt="${esc(name)} @ ${esc(w)}"><div class="cap">${px}px · ${SCALE.toFixed(2)}×</div></td>`
        : `<td class="missing">—</td>`
    }
    body += `</tr>\n`
  }
  body += `</tbody>\n</table>\n`
}

// Tier 2 — view scenarios: each fixture full-page across the named viewports.
let scenesBody = ''
if (fs.existsSync(SCENE_ROOT)) {
  for (const scene of fs.readdirSync(SCENE_ROOT).sort()) {
    const sceneDir = path.join(SCENE_ROOT, scene)
    if (!fs.statSync(sceneDir).isDirectory()) continue
    const fx = await loadFixture(scene)
    scenesBody += `<div class="scene-block"><div class="scene-title">${esc(fx?.label || scene)}<span class="scene-file">${esc(scene)}.js</span></div><div class="vp-row">`
    for (const vp of viewportNames) {
      const rel = `scenes/${scene}/${vp}.png`
      if (!fs.existsSync(path.join('gallery', rel))) continue
      scenesBody += `<figure class="vp"><img loading="lazy" src="${imgSrc(rel)}" alt="${esc(scene)} @ ${esc(vp)}"><figcaption>${esc(vp)}<span>${viewportsJson[vp].w}×${viewportsJson[vp].h}</span></figcaption></figure>`
    }
    scenesBody += `</div></div>`
  }
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Component Gallery</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 20px; } h2 { margin-top: 32px; font-size: 16px; color: #1D9E75; }
  table { border-collapse: collapse; } th, td { border: 1px solid #e2e2e2; padding: 8px; vertical-align: top; text-align: center; }
  th { background: #fafafa; font-weight: 600; } th.spec, td.spec { text-align: left; white-space: nowrap; }
  .th-px { display: block; font: 11px 'Courier New', monospace; color: #999; font-weight: 400; }
  .spec-name { font-weight: 600; font-size: 13px; }
  .spec-file { font: 11px 'Courier New', monospace; color: #999; margin: 1px 0 6px; }
  .spec-props { margin-top: 6px; }
  .spec-props .flag { display: inline-block; font: 11px 'Courier New', monospace; color: #555; background: #f0f0f0; border-radius: 3px; padding: 1px 5px; margin: 1px 2px 1px 0; }
  /* Tier-1 specimens render at NATIVE SCALE: each image is displayed at its
     true container px width (captured at 2× DSF for crispness), so tile/narrow/
     panel/drill are physically different sizes and font judgments are real.
     No shared clamp — that was the normalization bug. */
  .spec-img { display: block; height: auto; cursor: zoom-in; }
  .cap { font: 10px 'Courier New', monospace; color: #b0b4ac; margin-top: 4px; text-align: center; }
  td.missing { color: #c00; }
  /* Click-to-zoom lightbox — any gallery image (specimen or scene) opens full
     size; click anywhere / Esc to close. Lives in the generator so it survives
     regeneration and image-inlining. */
  #lightbox { position: fixed; inset: 0; z-index: 1000; display: none; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,0.85); cursor: zoom-out; }
  #lightbox.open { display: flex; }
  #lightbox img { max-width: 96vw; max-height: 96vh; width: auto; height: auto; cursor: zoom-out; background: #fff; border-radius: 6px; box-shadow: 0 6px 40px rgba(0,0,0,0.5); }
  h2.tier { margin-top: 44px; padding-top: 22px; border-top: 2px solid #e2e2e2; font-size: 16px; color: #1D9E75; }
  h2.tier small { color: #999; font-weight: 400; font-size: 12px; }
  .scene-block { margin: 20px 0 30px; }
  .scene-title { font-weight: 600; font-size: 14px; margin-bottom: 10px; }
  .scene-title .scene-file { font: 11px 'Courier New', monospace; color: #a6aca4; margin-left: 8px; }
  .vp-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .vp { margin: 0; }
  .vp img { max-width: 300px; max-height: 380px; width: auto; border: 1px solid #e2e2e2; border-radius: 6px; background: #f5f5f3; cursor: zoom-in; }
  .vp figcaption { font: 11px 'Courier New', monospace; color: #777; margin-top: 5px; }
  .vp figcaption span { color: #b7bdb6; margin-left: 6px; }
</style></head><body>
<h1>Component Specimens <small style="color:#999;font-weight:400">Tier 1 · container widths</small></h1>
${body}${scenesBody ? `<h2 class="tier">View scenarios <small>Tier 2 · fixtures × viewports</small></h2>${scenesBody}` : ''}
<div id="lightbox"><img alt="zoomed render"></div>
<script>
(function () {
  var lb = document.getElementById('lightbox');
  var lbImg = lb.firstElementChild;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.tagName === 'IMG' && !lb.contains(t)) {
      lbImg.src = t.currentSrc || t.src;
      lb.classList.add('open');
    } else if (lb.classList.contains('open')) {
      lb.classList.remove('open');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') lb.classList.remove('open');
  });
})();
</script>
</body></html>
`
const outFile = INLINE ? 'gallery/index-inline.html' : 'gallery/index.html'
fs.writeFileSync(outFile, html)
console.log(`gallery → ${outFile}${INLINE ? ' (self-contained, artifact-ready)' : ''}`)
