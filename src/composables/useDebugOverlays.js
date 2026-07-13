// useDebugOverlays — live toggle for the grid arranger's bounding-box diagnostic
// (grid-arranger-spec §5.1), available in the app, not just the harness/gallery.
// Sets `data-bounding-boxes` on <html>, which the (now globally-imported)
// boundingBoxes.css keys off to draw grid tracks, region boxes, reserves, the
// growth-reserve band, and the ledger labels. Only affects the grid arrangement
// (the CSS targets `.grid-table`); inert on legacy.
//
// Enabled by `?bounding-boxes=1` (persisted to localStorage so it survives navigation,
// like the arrangement override) or toggled live with Alt+B. `?bounding-boxes=0` (or
// toggling off) clears it. Singleton so one flag drives the whole app.

import { ref } from 'vue'

export const DEBUG_OVERLAYS_KEY = 'bcBoundingBoxes'

const enabled = ref(false)
let initialized = false

const TRUE_RE = /^(1|true|on|yes)$/i
const FALSE_RE = /^(0|false|off|no)$/i

/** Read `?bounding-boxes=` from a location (search or hash query). true/false/null. */
export function readOverlaysParam(loc) {
  if (!loc) return null
  const get = (s) => new URLSearchParams(s || '').get('bounding-boxes')
  const hash = loc.hash || ''
  const qi = hash.indexOf('?')
  const raw = get(loc.search) ?? (qi >= 0 ? get(hash.slice(qi + 1)) : null)
  if (raw == null) return null
  if (FALSE_RE.test(raw)) return false
  if (TRUE_RE.test(raw)) return true
  return true // a bare `?bounding-boxes` (or any other value) means "on"
}

function readStored() {
  try { return localStorage.getItem(DEBUG_OVERLAYS_KEY) === '1' } catch { return false }
}
function writeStored(on) {
  try { on ? localStorage.setItem(DEBUG_OVERLAYS_KEY, '1') : localStorage.removeItem(DEBUG_OVERLAYS_KEY) } catch { /* private mode */ }
}
function applyAttr(on) {
  try { document.documentElement.toggleAttribute('data-bounding-boxes', on) } catch { /* no DOM */ }
}

/** Set the flag, persist it, and reflect it on <html>. */
export function setDebugOverlays(on) {
  enabled.value = !!on
  writeStored(enabled.value)
  applyAttr(enabled.value)
}
export function toggleDebugOverlays() { setDebugOverlays(!enabled.value) }

/** Resolve from URL + localStorage once, persisting a query override. Re-reads the
 *  param on hashchange so editing `?bounding-boxes=` in the URL takes effect LIVE (no
 *  refresh) — hash-position params fire hashchange (2026-07-12 report). */
export function initDebugOverlays(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (initialized) return
  initialized = true
  const param = readOverlaysParam(loc)
  const on = param != null ? param : readStored()
  enabled.value = on
  if (param != null) writeStored(on) // a query override persists across navigation
  applyAttr(on)
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      const p = readOverlaysParam(window.location)
      if (p != null) setDebugOverlays(p) // only act when the param is present; else leave the toggle alone
    })
  }
}

export function useDebugOverlays() {
  if (!initialized) initDebugOverlays()
  return { enabled, toggle: toggleDebugOverlays, setEnabled: setDebugOverlays }
}

// Test-only reset.
export function __resetDebugOverlaysForTests() {
  initialized = false
  enabled.value = false
  try { document.documentElement.removeAttribute('data-bounding-boxes') } catch { /* no DOM */ }
}
