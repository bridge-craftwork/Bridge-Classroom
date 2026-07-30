// Emit the component manifest the live /dev gallery reads. Walks the same
// specimen tree the harness registry globs (src/harness/specimens/**), plus the
// width/scale axes, and writes a small JSON the vanilla-JS gallery shell and
// drill-down page consume — so neither has to import Vue/registry code.
//
// Output: { components: { Name: [specimen, …] }, widths, scales,
//           scenes: [{name,label,surface,group}], viewports }
// Component ORDER matches registry.js's COMPONENTS declaration (the curated
// order), with any stray specimen dirs not in the registry appended after.
// Scenes are the harness Tier-2 fixtures (both dirs), imported for their label/
// surface exactly like scripts/a1-gallery.mjs does.
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SPEC_ROOT = path.join(ROOT, 'src/harness/specimens')
const OUT = process.argv[2] || path.join(ROOT, 'dist/dev/components-manifest.json')

const widths = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/harness/widths.json'), 'utf8'))
const scales = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/harness/scales.json'), 'utf8'))
const viewports = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/harness/viewports.json'), 'utf8'))

// Curated component order, parsed from registry.js's `export const COMPONENTS = { … }`
// so the gallery lists components in the same order the audit gallery does.
function registryOrder() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/registry.js'), 'utf8')
    const m = src.match(/export const COMPONENTS\s*=\s*\{([^}]*)\}/)
    if (!m) return []
    return m[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean)
  } catch {
    return []
  }
}

const specimensByComponent = {}
for (const comp of fs.readdirSync(SPEC_ROOT).sort()) {
  const dir = path.join(SPEC_ROOT, comp)
  if (!fs.statSync(dir).isDirectory()) continue
  const specs = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''))
    .sort()
  if (specs.length) specimensByComponent[comp] = specs
}

const order = registryOrder()
const ordered = [
  ...order.filter((c) => specimensByComponent[c]),
  ...Object.keys(specimensByComponent).filter((c) => !order.includes(c)),
]

const components = {}
for (const c of ordered) components[c] = specimensByComponent[c]

// ── Scenes (Tier-2 fixtures) — a1 group first (the released app), then table ──
// Import each fixture for its label/surface (sibling-only imports resolve in
// node, same as a1-gallery.mjs). Fall back to the bare name if an import fails.
async function collectScenes(dir, group) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out = []
  for (const file of fs.readdirSync(abs).sort()) {
    if (!file.endsWith('.js')) continue
    const name = file.replace(/\.js$/, '')
    let label = name
    let surface = 'table'
    try {
      const mod = await import(pathToFileURL(path.join(abs, file)).href)
      label = mod.default?.label || name
      surface = mod.default?.surface || 'table'
    } catch { /* keep name-only */ }
    out.push({ name, label, surface, group })
  }
  return out
}
// Only FAITHFUL app-layout scenes: A1 (A1Scene) and the B-series practice tables
// (B1Scene etc. — the real grid arranger + shipped table.tableConfig). The
// `src/harness/fixtures` dir renders through TableScene/ServerTableScene, which
// are self-described "harness-only" component testbeds in a bespoke rail layout —
// NOT a shipped app layout — so they're excluded (still reachable directly at
// /dev/harness/#/harness/scene/<name>).
const scenes = [
  ...(await collectScenes('src/harness/fixtures-a1', 'a1')),
  ...(await collectScenes('src/harness/fixtures-b', 'b')),
  ...(await collectScenes('src/harness/fixtures-c', 'c')),
]

const manifest = { components, widths, scales, scenes, viewports }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2))
const total = Object.values(components).reduce((n, s) => n + s.length, 0)
console.log(`harness-manifest → ${path.relative(ROOT, OUT)} (${ordered.length} components, ${total} specimens, ${scenes.length} scenes)`)
