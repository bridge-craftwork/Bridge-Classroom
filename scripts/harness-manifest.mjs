// Emit the component manifest the live /dev gallery reads. Walks the same
// specimen tree the harness registry globs (src/harness/specimens/**), plus the
// width/scale axes, and writes a small JSON the vanilla-JS gallery shell and
// drill-down page consume — so neither has to import Vue/registry code.
//
// Output: { components: { Name: [specimen, …] }, widths: {name:px}, scales: [..] }
// Component ORDER matches registry.js's COMPONENTS declaration (the curated
// order), with any stray specimen dirs not in the registry appended after.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SPEC_ROOT = path.join(ROOT, 'src/harness/specimens')
const OUT = process.argv[2] || path.join(ROOT, 'dist/dev/components-manifest.json')

const widths = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/harness/widths.json'), 'utf8'))
const scales = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/harness/scales.json'), 'utf8'))

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

const manifest = { components, widths, scales }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2))
const total = Object.values(components).reduce((n, s) => n + s.length, 0)
console.log(`harness-manifest → ${path.relative(ROOT, OUT)} (${ordered.length} components, ${total} specimens)`)
