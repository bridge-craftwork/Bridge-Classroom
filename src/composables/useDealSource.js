// The table's current deal source (roadmap Phase 2 / deal-source unification):
// the DealSourceModal picks a *selection* (deal-source-spec §2.2) via the shared
// DealSourcePicker, and the header's "Next deal" button repeats it without
// reopening the modal. "Next deal" from a scenario draws a FRESH board (new
// random pick, or a fresh dealer-script run), not the same one.
//
// Board resolution is delegated to useDealSourceResolver (impl-plan §2.4): this
// file is now just the sticky-selection + mode/rotate persistence plus the
// table's send-frame wrapping. Singleton pattern (module-level state).

import { ref } from 'vue'
import { nextBoard } from './useDealSourceResolver.js'
import { useRemoteTable } from './useRemoteTable.js'

const SELECTION_KEY = 'bridgeTableSelection'
const MODE_KEY = 'bridgeTableBoardMode'

// A DealSourceSelection: { items: SourceRef[], options: { drawOrder } }.
const selection = ref(loadSelection())
// 'bid-and-play' | 'bid-only' | 'play-only' — rides on every deal.
const mode = ref(localStorage.getItem(MODE_KEY) || 'bid-and-play')
const dealing = ref(false)
const dealError = ref('')

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s && Array.isArray(s.items) && s.items.length) return s
    }
  } catch { /* fall through */ }
  return { items: [{ kind: 'random', label: 'Random' }], options: { drawOrder: 'random' } }
}

function setSelection(next) {
  selection.value = next
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(next))
  } catch { /* private mode etc. */ }
}

function setMode(next) {
  mode.value = next
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch { /* private mode etc. */ }
}

function label() {
  const items = selection.value?.items || []
  if (!items.length) return 'random'
  const first = items[0].label || items[0].kind
  return items.length > 1 ? `${first} +${items.length - 1} more` : first
}

// A lone `random` ref lets the *server* do the shuffle + rotation
// ({source:'random'}); every other selection resolves browser-side to a
// concrete single-board PBN via the resolver.
function isLoneRandom(sel) {
  const items = sel?.items || []
  return items.length === 1 && items[0].kind === 'random'
}

// Deal one board from the current sticky selection. `rotate` is 0..3 (ignored
// on the server-shuffle path, which rotates itself).
async function nextDeal(rotate = 0) {
  const table = useRemoteTable()
  const sel = selection.value
  dealing.value = true
  dealError.value = ''
  try {
    let payload
    if (isLoneRandom(sel)) {
      payload = { source: 'random' }
    } else {
      const { pbn } = await nextBoard(sel)
      payload = { source: 'pbn', pbn, rotate }
    }
    payload.mode = mode.value
    if (!table.sendDeal(payload)) throw new Error('Not connected.')
    return true
  } catch (err) {
    dealError.value = err.message
    return false
  } finally {
    dealing.value = false
  }
}

export function useDealSource() {
  return { selection, setSelection, mode, setMode, label, nextDeal, dealing, dealError }
}
