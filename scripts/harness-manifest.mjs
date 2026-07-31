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

// Which of those are SHELL parts (the chrome around the table) rather than table
// components. Parsed from registry.js the same way the order is, so the list lives
// in one place. The dev gallery renders them as their own tab.
function shellList() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/registry.js'), 'utf8')
    const m = src.match(/export const SHELL_COMPONENTS\s*=\s*\[([^\]]*)\]/)
    if (!m) return []
    return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  } catch { return [] }
}
const shell = shellList().filter((c) => components[c])

// Which components declare that they resize with --table-scale. Parsed from
// registry.js exactly like the shell list, so the declaration lives in one place and
// this script still never has to import Vue.
function scaleableList() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/registry.js'), 'utf8')
    const m = src.match(/export const SCALEABLE\s*=\s*\[([^\]]*)\]/)
    if (!m) return []
    return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  } catch { return [] }
}
const scaleable = scaleableList()

// Every .vue under src/components that is NOT registered in the gallery. Listed (name
// only, no preview) so the gallery says "these exist, nobody has given them specimens"
// rather than quietly implying the registered set is all there is.
//
// That silence had a cost: DoubleDummyTable was extracted 2026-07-05, two days before
// the gallery existed, and simply never joined it — so the one component whose sizing
// was broken was also the one nobody could see. Absence should be visible.
function unregisteredComponents() {
  const registered = new Set(registryOrder())
  // Scoped to the two directories the registry actually draws from — `src/components`
  // (top level) and `src/components/table`. Walking everything turns up 80 files, most
  // of them lobby/admin/convention-card views that were never candidates for a TABLE
  // gallery; 80 rows of noise would bury the handful that matter.
  const DIRS = ['src/components', 'src/components/table']
  const found = []
  for (const rel of DIRS) {
    const dir = path.join(ROOT, rel)
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.vue')) continue
      const name = e.name.replace(/\.vue$/, '')
      if (!registered.has(name)) found.push({ name, path: `${rel}/${e.name}` })
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}
const unregistered = unregisteredComponents()

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

const manifest = { components, shell, scaleable, unregistered, widths, scales, scenes, viewports }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2))
const total = Object.values(components).reduce((n, s) => n + s.length, 0)
console.log(`harness-manifest → ${path.relative(ROOT, OUT)} (${ordered.length} components incl. ${shell.length} shell, ${total} specimens, ${scenes.length} scenes, ${unregistered.length} unregistered)`)
