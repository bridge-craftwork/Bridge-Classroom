// The table's current deal source (roadmap Phase 2): the DealSourceModal
// picks it, the "Next deal" button repeats it without reopening the modal.
// Descriptor, not payload — "next deal" from a scenario draws a FRESH deal
// (new random pick, or a fresh dealer-script run), not the same board.
//
// Singleton pattern (module-level state) per project convention.

import { ref } from 'vue'
import {
  fetchScenarioDeals,
  fetchScenarioScript,
  dealToMinimalPbn,
  randomItem,
} from '../utils/pbsScenarios.js'
import { useRemoteTable } from './useRemoteTable.js'

const STORAGE_KEY = 'bridgeTableDealSource'
const MODE_KEY = 'bridgeTableBoardMode'

// { kind: 'random' } | { kind: 'scenario', file, label, useScript } |
// { kind: 'pbn', text }   ('replay' is an action, never sticky)
const source = ref(loadSource())
// 'bid-and-play' | 'bid-only' | 'play-only' — rides on every deal.
const mode = ref(localStorage.getItem(MODE_KEY) || 'bid-and-play')
const dealing = ref(false)
const dealError = ref('')

function setMode(next) {
  mode.value = next
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch { /* private mode etc. */ }
}

function loadSource() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall through */ }
  return { kind: 'random' }
}

function setSource(next) {
  source.value = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* private mode etc. */ }
}

function label() {
  const s = source.value
  if (s.kind === 'scenario') return `${s.label}${s.useScript ? ' (fresh)' : ''}`
  if (s.kind === 'pbn') return 'pasted PBN'
  return 'random'
}

// Deal the next board from the current source. `rotate` is 0..3.
async function nextDeal(rotate = 0) {
  const table = useRemoteTable()
  const s = source.value
  dealing.value = true
  dealError.value = ''
  try {
    let payload
    if (s.kind === 'scenario' && s.useScript) {
      const script = await fetchScenarioScript(s.file)
      payload = { source: 'script', script, rotate }
    } else if (s.kind === 'scenario') {
      const pick = randomItem(await fetchScenarioDeals(s.file))
      payload = { source: 'pbn', pbn: dealToMinimalPbn(pick), rotate }
    } else if (s.kind === 'pbn') {
      payload = { source: 'pbn', pbn: s.text, rotate }
    } else {
      payload = { source: 'random' }
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
  return { source, setSource, mode, setMode, label, nextDeal, dealing, dealError }
}
