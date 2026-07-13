// useArrangement — the live per-client arrangement axis (a1 grid-flip 1.6a).
// Singleton: read the URL/localStorage ONCE at first use, persist a query override,
// and expose the resolved arrangement + provenance as shared reactive state.
//
// Reading once (not per-navigation) is deliberate — the override is meant to stick
// for the session so navigating within the app doesn't shed it. A client reverts by
// visiting `?arrangement=legacy` (which clears the key) or clearing localStorage.

import { ref } from 'vue'
import {
  ARRANGEMENT_STORAGE_KEY, DEFAULT_ARRANGEMENT,
  readArrangementParam, resolveArrangement,
} from '../utils/arrangement.js'

const arrangement = ref(DEFAULT_ARRANGEMENT)
const arrangementSource = ref('default')
let initialized = false

function readStored() {
  try { return localStorage.getItem(ARRANGEMENT_STORAGE_KEY) } catch { return null }
}
function writeStored(value) {
  try {
    // Persist a grid override; a legacy override (or default) CLEARS the key, so
    // "revert" leaves no residue — the client is byte-identical to a fresh one.
    if (value === DEFAULT_ARRANGEMENT) localStorage.removeItem(ARRANGEMENT_STORAGE_KEY)
    else localStorage.setItem(ARRANGEMENT_STORAGE_KEY, value)
  } catch { /* private mode / no storage — fall back to in-memory only */ }
}

/** Resolve from the live URL + localStorage exactly once, persisting a query override. */
export function initArrangement(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (initialized) return { arrangement: arrangement.value, source: arrangementSource.value }
  initialized = true
  const param = readArrangementParam(loc)
  const stored = readStored()
  const r = resolveArrangement({ param, stored })
  arrangement.value = r.arrangement
  arrangementSource.value = r.source
  // A query override is the persist trigger (grid sticks; legacy clears).
  if (r.source === 'query') writeStored(r.arrangement)
  return r
}

export function useArrangement() {
  if (!initialized) initArrangement()
  return { arrangement, arrangementSource }
}

// Test-only: reset the singleton so each test resolves fresh.
export function __resetArrangementForTests() {
  initialized = false
  arrangement.value = DEFAULT_ARRANGEMENT
  arrangementSource.value = 'default'
}
