// What each Baker Bridge lesson covers: the conventions, natural methods and
// skills its boards practise, as bridge-common-conventions IDs. The
// collection says so itself, in its manifest (Baker-Bridge
// Tools/lesson-covers.toml → bridge-classroom/manifest.json, `covers`).
//
// A lesson is found under its own skill path, as always, and under each ID
// it covers: "Partnership: Stayman & Transfers" is practice for Stayman and
// for Jacoby transfers. That is how a lesson set stays findable once the
// conventions list no longer has an entry for the set itself.
import { BAKER_BRIDGE_TAXONOMY, getTaxonomyEntryBySubfolder } from './bakerBridgeTaxonomy.js'

const MANIFEST_URL = 'https://raw.githubusercontent.com/bridge-craftwork/Baker-Bridge/main/bridge-classroom/manifest.json'

/**
 * `{ id: [taxonomy entry] }` from a Baker-Bridge manifest: every lesson under
 * its own skill path, then under each ID it covers. A lesson the catalogue
 * does not know is left out.
 */
export function lessonsByCoveredId(manifest) {
  const out = {}
  const add = (id, entry) => { if (id && !(out[id] ||= []).includes(entry)) out[id].push(entry) }
  for (const entry of BAKER_BRIDGE_TAXONOMY) add(entry.path, entry)
  for (const [subfolder, lesson] of Object.entries(manifest?.lessons || {})) {
    const entry = getTaxonomyEntryBySubfolder(subfolder)
    if (!entry) continue
    for (const id of Array.isArray(lesson.covers) ? lesson.covers : []) add(id, entry)
  }
  return out
}

// Fetched once. Until it arrives, and if it never does, a lesson is found
// under its own skill path only, as it was before the manifest said more.
let loaded = lessonsByCoveredId(null)
let loading = null

/** The lessons by covered ID, with the manifest's `covers` once it has loaded. */
export function loadLessonCovers(fetchFn = globalThis.fetch) {
  loading ||= (async () => {
    try {
      const resp = await fetchFn(MANIFEST_URL)
      if (!resp.ok) throw new Error(`manifest fetch failed (${resp.status})`)
      loaded = lessonsByCoveredId(await resp.json())
    } catch (err) {
      console.warn('[baker-bridge] what the lessons cover could not be fetched:', err?.message || err)
    }
    return loaded
  })()
  return loading
}

/** What has loaded so far: never waits. Starts the fetch if nobody has. */
export function lessonCoversNow() {
  if (!loading && typeof globalThis.fetch === 'function') loadLessonCovers()
  return loaded
}
