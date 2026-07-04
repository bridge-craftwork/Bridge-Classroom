// Local-only memory for the deal-source picker: Favorites (starred sources) and
// History (recent picks). Stored in localStorage — device/browser-bound, never
// synced to the backend (by design; see the "local to this browser" notes in the
// Favorites/History tabs). Singleton module-scope state.

import { ref } from 'vue'

const FAV_KEY = 'dsp-favorites'
const HIST_KEY = 'dsp-history'
const HIST_CAP = 24

function load(key) {
  try {
    const s = localStorage.getItem(key)
    const v = s ? JSON.parse(s) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* quota / disabled storage — memory just won't persist */
  }
}

const favorites = ref(load(FAV_KEY))
const history = ref(load(HIST_KEY))

// Stable identity for dedup. Treats a scenario and its "fresh"(script) variant as
// the same thing — you favorite the scenario, and apply Fresh when you pick it.
export function refKey(r) {
  if (!r) return ''
  switch (r.kind) {
    case 'scenario':
    case 'script':
      return `sc:${r.repo}:${r.file}:${r.curated ? 'c' : 'p'}`
    case 'clubboard':
      return `cb:${r.origin}:${r.gameId}:${r.boardNumber}`
    case 'library':
      return `lib:${r.entryId}`
    case 'pbn':
      return `pbn:${(r.text || '').length}:${(r.text || '').slice(0, 24)}`
    case 'random':
      return 'random'
    default:
      return r.kind
  }
}

// Compact stored copy; scenarios stored as 'scenario' (not 'script').
function normalize(r) {
  if (r.kind === 'script') {
    return { kind: 'scenario', repo: r.repo, file: r.file, label: r.label, ...(r.curated ? { curated: true } : {}) }
  }
  return { ...r }
}

export function useDealSourceMemory() {
  const isFavorite = (r) => favorites.value.some((f) => refKey(f) === refKey(r))

  function toggleFavorite(r) {
    const k = refKey(r)
    const i = favorites.value.findIndex((f) => refKey(f) === k)
    if (i >= 0) favorites.value = favorites.value.filter((_, j) => j !== i)
    else favorites.value = [normalize(r), ...favorites.value]
    save(FAV_KEY, favorites.value)
  }
  function removeFavorite(r) {
    favorites.value = favorites.value.filter((f) => refKey(f) !== refKey(r))
    save(FAV_KEY, favorites.value)
  }

  // Record one or more picks — most-recent-first, de-duped, capped.
  function recordHistory(refs) {
    const list = Array.isArray(refs) ? refs : [refs]
    let next = history.value
    for (const r of list) {
      if (!r) continue
      const k = refKey(r)
      next = [normalize(r), ...next.filter((h) => refKey(h) !== k)]
    }
    history.value = next.slice(0, HIST_CAP)
    save(HIST_KEY, history.value)
  }
  function clearHistory() {
    history.value = []
    save(HIST_KEY, [])
  }

  return { favorites, history, isFavorite, toggleFavorite, removeFavorite, recordHistory, clearHistory }
}
