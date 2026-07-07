// Harness registry (Tier 1 — component specimens). Maps component names to the
// renderable leaf, and loads every specimen prop-file via a Vite glob so they
// are bundled (no fetch, no async loading states). Imported only by the harness
// view, which is itself behind VITE_HARNESS — so none of this reaches prod.

import HandDisplay from '../components/HandDisplay.vue'

export const COMPONENTS = { HandDisplay }

const modules = import.meta.glob('./specimens/**/*.js', { eager: true })

// SPECIMENS[component][name] = { label, props }
export const SPECIMENS = {}
for (const [pathKey, mod] of Object.entries(modules)) {
  const m = pathKey.match(/\.\/specimens\/([^/]+)\/([^/]+)\.js$/)
  if (!m) continue
  const [, comp, name] = m
  ;(SPECIMENS[comp] ||= {})[name] = mod.default
}
