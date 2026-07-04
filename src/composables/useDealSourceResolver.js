// Deal-source resolver: SourceRef -> board(s). The single source of truth for
// "where does the next board come from", replacing the per-kind switch that
// lived in useDealSource.nextDeal. See documentation/deal-source-implementation.md.
//
// A `selection` (deal-source-spec §2.2) is { items: SourceRef[], options }.
// Two resolvers bridge to every consumer:
//   nextBoard(selection)   -> { pbn, label }        STREAM: draw ONE board
//   materialize(selection) -> { boardsPbn, count }  STATIC: resolve the whole pool
//
// Set-refs (scenario/library/clubboard/pbn) contribute a fixed ordered board
// list; generators (random/script) yield a fresh board each draw. The pool is
// the ordered concatenation of each set-ref's boards plus one slot per
// generator; sequential (default) walks it with a per-pool cursor, random
// draws uniformly.

import { ref } from 'vue'
import {
  fetchScenarioDeals,
  fetchScenarioScript,
  dealToMinimalPbn,
  prettifyLabel,
} from '../utils/pbsScenarios.js'
import { clubGameBoards, boardToMinimalPbn } from '../utils/normalizedDeal.js'
import { parsePbn } from '../utils/pbnParser.js'
import { generateBoardPbn } from '../utils/dealerClient.js'
import { useDealLibrary } from './useDealLibrary.js'
import { useClubGames } from './useClubGames.js'

// ── Singleton state (module scope; shared across all callers) ────────────
const boardCache = ref({}) // cacheKey(ref) -> { pbn, label }[]   (set-refs only)
const scriptCache = ref({}) // pbs file -> raw .dlr text
const cursors = ref({}) // poolSignature -> next sequential index (unbounded; read mod len)

const GENERATOR_KINDS = new Set(['random', 'script'])
export function isGenerator(r) {
  return !!r && GENERATOR_KINDS.has(r.kind)
}

// ── Labels & identity ────────────────────────────────────────────────────

function labelFor(r) {
  if (r.label) return r.label
  switch (r.kind) {
    case 'scenario':
    case 'script':
      return r.file ? prettifyLabel(r.file) : r.kind
    case 'pbn':
      return 'Pasted PBN'
    case 'random':
      return 'Random'
    default:
      return r.kind
  }
}

// Stable id for a ref — drives the cache key and the pool signature so the
// sequential cursor survives across draws of the same selection.
function itemId(r) {
  switch (r.kind) {
    case 'scenario':
      return `sc:${r.repo}:${r.file}:${r.curated ? 'c' : 'p'}`
    case 'library':
      return `lib:${r.entryId}`
    case 'clubboard':
      return `cb:${r.origin}:${r.gameId}:${r.boardNumber}`
    case 'clubgame':
      return `cg:${r.origin}:${r.gameId}`
    case 'pbn':
      return `pbn:${(r.text || '').length}:${(r.text || '').slice(0, 24)}`
    case 'random':
      return 'rand'
    case 'script':
      return `scr:${r.file}`
    default:
      return r.kind
  }
}

// Only set-refs are cached (generators are fresh each draw; pbn is inline/cheap).
function cacheKey(r) {
  switch (r.kind) {
    case 'scenario':
      return `scenario:${r.repo}:${r.file}:${r.curated ? 'c' : 'p'}`
    case 'library':
      return `library:${r.entryId}`
    case 'clubboard':
      return `clubboard:${r.origin}:${r.gameId}:${r.boardNumber}`
    case 'clubgame':
      return `clubgame:${r.origin}:${r.gameId}`
    default:
      return null
  }
}

function poolSignature(items, drawOrder) {
  return `${drawOrder}|${items.map(itemId).join(',')}`
}

// ── Auto-generated set description (roadmap §Phase 3.1) ────────────────────
// A brief human-readable label for a selection, for the teacher console +
// server logs. One source → "<Category> - <name>" (Random/Paste stand alone);
// several → "Mix: a, b[, +N more]".
function categoryOf(r) {
  switch (r.kind) {
    case 'scenario':
      return r.curated ? 'Curated' : 'Scenarios'
    case 'script':
      return 'Scenarios'
    case 'clubgame':
    case 'clubboard':
      return 'Club'
    case 'library':
      return 'Library'
    case 'pbn':
      return 'Paste'
    case 'random':
      return 'Random'
    default:
      return 'Deal'
  }
}

export function describeSelection(selection) {
  const items = selection?.items || []
  if (!items.length) return ''
  if (items.length === 1) {
    const r = items[0]
    const cat = categoryOf(r)
    // Random/Paste read fine on their own — no "Random - Random".
    if (r.kind === 'random' || r.kind === 'pbn') return cat
    return `${cat} - ${r.label || r.kind}`
  }
  const names = items.map((r) => r.label || r.kind)
  const shown = names.slice(0, 3).join(', ')
  return `Mix: ${shown}${names.length > 3 ? `, +${names.length - 3} more` : ''}`
}

// ── Set-ref resolution (ref -> ordered { pbn, label }[]) ──────────────────

// Load + parse a club game's normalized boards (shared by clubboard/clubgame).
async function loadClubGameBoards(r) {
  if (r.origin === 'local') {
    throw new Error('Local (browser) club games are not yet wired in the resolver (M2).')
  }
  const game = await useClubGames().fetchGame(r.gameId)
  if (!game || !game.payload) throw new Error('Club game is unavailable.')
  let normalized
  try {
    normalized = JSON.parse(game.payload)
  } catch {
    throw new Error('Club game data is corrupt.')
  }
  return clubGameBoards(normalized)
}

async function resolveSetRef(r) {
  const label = labelFor(r)
  switch (r.kind) {
    case 'scenario': {
      if (r.repo === 'baker') {
        throw new Error('Baker scenarios are not yet wired in the resolver (deal-source-implementation §1).')
      }
      const deals = await fetchScenarioDeals(r.file, { curated: !!r.curated })
      return deals.map((d, i) => ({ pbn: dealToMinimalPbn(d, i + 1), label }))
    }
    case 'library': {
      const entry = await useDealLibrary().fetchEntry(r.entryId)
      if (!entry || !entry.payload) throw new Error('Library file is unavailable.')
      if (entry.kind && entry.kind !== 'file') throw new Error('That library entry is not a board file.')
      const deals = parsePbn(entry.payload).filter((d) => d.dealString)
      if (!deals.length) throw new Error('That library file has no boards.')
      return deals.map((d, i) => ({ pbn: dealToMinimalPbn(d, i + 1), label }))
    }
    case 'clubboard': {
      const boards = await loadClubGameBoards(r)
      const board = boards.find((b) => b.number === r.boardNumber)
      if (!board) throw new Error(`Board ${r.boardNumber} was not found in that club game.`)
      const pbn = boardToMinimalPbn(board)
      if (!pbn) throw new Error(`Board ${r.boardNumber} is unusable.`)
      return [{ pbn, label }]
    }
    case 'clubgame': {
      // The whole event → every playable board, in order.
      const boards = await loadClubGameBoards(r)
      const out = []
      for (const b of boards) {
        const pbn = boardToMinimalPbn(b)
        if (pbn) out.push({ pbn, label: `${label} · Board ${b.number}` })
      }
      if (!out.length) throw new Error('That club game has no usable boards.')
      return out
    }
    case 'pbn': {
      const deals = parsePbn(r.text).filter((d) => d.dealString)
      if (!deals.length) throw new Error('That PBN has no boards.')
      return deals.map((d, i) => ({ pbn: dealToMinimalPbn(d, i + 1), label }))
    }
    case 'userColl':
      throw new Error('User Collections are not yet wired in the resolver (deal-source-spec §7).')
    default:
      throw new Error(`Unknown source kind: ${r.kind}`)
  }
}

// Resolve one set-ref to its ordered boards, cached.
export async function refBoards(r) {
  const key = cacheKey(r)
  if (key && boardCache.value[key]) return boardCache.value[key]
  const boards = await resolveSetRef(r)
  if (key) boardCache.value = { ...boardCache.value, [key]: boards }
  return boards
}

// ── Generators (fresh board each call) ────────────────────────────────────

const SUITS = ['S', 'H', 'D', 'C']
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

// Local client shuffle → one random-deal PBN (dealer N, none vul). The table
// consumer uses server-side {source:'random'} instead; this is for local play.
export function makeRandomDealPbn() {
  const deck = []
  for (const s of SUITS) for (const r of RANKS) deck.push(s + r)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const order = ['N', 'E', 'S', 'W']
  const hands = { N: [], E: [], S: [], W: [] }
  deck.forEach((c, i) => hands[order[i % 4]].push(c))
  const handStr = (h) =>
    SUITS.map((s) =>
      h
        .filter((c) => c[0] === s)
        .map((c) => c[1])
        .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
        .join(''),
    ).join('.')
  const dealStr = `N:${order.map((d) => handStr(hands[d])).join(' ')}`
  return ['[Board "1"]', '[Dealer "N"]', '[Vulnerable "None"]', `[Deal "${dealStr}"]`, ''].join('\n')
}

async function generateOne(r, { seed } = {}) {
  const label = labelFor(r)
  if (r.kind === 'random') {
    return { pbn: makeRandomDealPbn(), label }
  }
  if (r.kind === 'script') {
    if (r.repo && r.repo !== 'pbs') throw new Error('Only PBS dealer scripts are supported.')
    let script = scriptCache.value[r.file]
    if (!script) {
      script = await fetchScenarioScript(r.file)
      scriptCache.value = { ...scriptCache.value, [r.file]: script }
    }
    const { pbn } = await generateBoardPbn(script, { seed })
    return { pbn, label }
  }
  throw new Error(`Not a generator: ${r.kind}`)
}

// ── Resolvers ─────────────────────────────────────────────────────────────

// Build the ordered pool: each set-ref's boards (concrete) then one slot per
// generator (resolved fresh when drawn).
async function buildPool(items) {
  const pool = []
  for (const r of items) {
    if (isGenerator(r)) {
      pool.push({ type: 'gen', ref: r })
    } else {
      for (const b of await refBoards(r)) pool.push({ type: 'board', board: b })
    }
  }
  return pool
}

// STREAM: draw one board from the whole pool.
export async function nextBoard(selection) {
  const items = selection?.items || []
  if (!items.length) throw new Error('No deal source selected.')
  const drawOrder = selection?.options?.drawOrder || 'sequential'
  const seed = selection?.options?.seed

  const pool = await buildPool(items)
  if (!pool.length) throw new Error('The selected source produced no boards.')

  let idx
  if (drawOrder === 'random') {
    idx = Math.floor(Math.random() * pool.length)
  } else {
    const sig = poolSignature(items, drawOrder)
    idx = (cursors.value[sig] || 0) % pool.length
    cursors.value = { ...cursors.value, [sig]: idx + 1 }
  }

  const slot = pool[idx]
  return slot.type === 'board' ? slot.board : generateOne(slot.ref, { seed })
}

// Renumber a single-board PBN so a concatenated multi-board file is well-formed.
function renumberBoard(pbn, n) {
  return pbn.replace(/\[Board "[^"]*"\]/, `[Board "${n}"]`)
}

// STATIC: resolve the whole pool NOW into an ordered multi-board PBN.
// Generators contribute `options.count` boards each (default 1).
export async function materialize(selection) {
  const items = selection?.items || []
  if (!items.length) throw new Error('No deal source selected.')
  const count = selection?.options?.count ?? 1
  const seed = selection?.options?.seed

  const boards = []
  for (const r of items) {
    if (isGenerator(r)) {
      for (let i = 0; i < count; i++) {
        boards.push(await generateOne(r, { seed: seed != null ? seed + i : undefined }))
      }
    } else {
      for (const b of await refBoards(r)) boards.push(b)
    }
  }
  if (!boards.length) throw new Error('The selected source produced no boards.')

  const boardsPbn = boards.map((b, i) => renumberBoard(b.pbn, i + 1)).join('\n')
  return { boardsPbn, count: boards.length, label: describeSelection(selection) }
}

// Reset caches + cursors (owner switch, tests).
export function clearResolverCache() {
  boardCache.value = {}
  scriptCache.value = {}
  cursors.value = {}
}

export function useDealSourceResolver() {
  return {
    refBoards,
    nextBoard,
    materialize,
    describeSelection,
    isGenerator,
    makeRandomDealPbn,
    clearResolverCache,
  }
}
