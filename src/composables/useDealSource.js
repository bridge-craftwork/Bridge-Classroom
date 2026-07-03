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
import { parsePbn } from '../utils/pbnParser.js'
import { clubGameBoards, boardToMinimalPbn } from '../utils/normalizedDeal.js'
import { useRemoteTable } from './useRemoteTable.js'
import { useDealLibrary } from './useDealLibrary.js'
import { useClubGames } from './useClubGames.js'

const STORAGE_KEY = 'bridgeTableDealSource'
const MODE_KEY = 'bridgeTableBoardMode'

// { kind: 'random' } | { kind: 'scenario', file, label, useScript } |
// { kind: 'pbn', text } | { kind: 'library', entryId, name } |
// { kind: 'clubgame', gameId, name }
// ('replay' is an action, never sticky)
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
  if (s.kind === 'library') return s.name || 'library file'
  if (s.kind === 'clubgame') return s.name || 'club game'
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
    } else if (s.kind === 'library') {
      // Materialized PBN from the teacher's library: fetch the entry's
      // payload and draw a fresh random board each "Next deal", the same
      // way scenarios do.
      const entry = await useDealLibrary().fetchEntry(s.entryId)
      if (!entry || !entry.payload) throw new Error('Library file is unavailable.')
      const deals = parsePbn(entry.payload).filter((d) => d.dealString)
      if (!deals.length) throw new Error('That library file has no boards.')
      payload = { source: 'pbn', pbn: dealToMinimalPbn(randomItem(deals)), rotate }
    } else if (s.kind === 'clubgame') {
      // A club game's native normalized JSON: fetch it, draw a fresh random
      // board each "Next deal", convert to PBN (same as the library flow).
      const game = await useClubGames().fetchGame(s.gameId)
      if (!game || !game.payload) throw new Error('Club game is unavailable.')
      let normalized
      try { normalized = JSON.parse(game.payload) } catch { throw new Error('Club game data is corrupt.') }
      const boards = clubGameBoards(normalized)
      if (!boards.length) throw new Error('That club game has no boards.')
      payload = { source: 'pbn', pbn: boardToMinimalPbn(randomItem(boards)), rotate }
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
