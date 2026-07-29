import { describe, it, expect, beforeEach, vi } from 'vitest'

// Network arms are mocked; the draw logic (pool/cursor/materialize) and the
// pbn/random paths run for real. See documentation/deal-source-implementation.md §8.

const { fetchEntryMock, fetchGameMock } = vi.hoisted(() => ({
  fetchEntryMock: vi.fn(),
  fetchGameMock: vi.fn(),
}))

vi.mock('@/utils/pbsScenarios.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, fetchScenarioDeals: vi.fn(), fetchScenarioScript: vi.fn() }
})
vi.mock('@/utils/dealerClient.js', () => ({ generateBoardPbn: vi.fn() }))
vi.mock('@/composables/useDealLibrary.js', () => ({ useDealLibrary: () => ({ fetchEntry: fetchEntryMock }) }))
vi.mock('@/composables/useClubGames.js', () => ({ useClubGames: () => ({ fetchGame: fetchGameMock }) }))

import {
  refBoards, nextBoard, materialize, isGenerator, describeSelection,
  makeRandomDealPbn, clearResolverCache, usePbnBoardNumbers,
} from '../useDealSourceResolver.js'
import { fetchScenarioDeals, fetchScenarioScript, dealToMinimalPbn } from '@/utils/pbsScenarios.js'
import { boardToMinimalPbn } from '@/utils/normalizedDeal.js'
import { parsePbn } from '@/utils/pbnParser.js'
import { generateBoardPbn } from '@/utils/dealerClient.js'

const DEAL = 'N:KQJ942.J.AK83.AK 7653.AQ9853.J.72 AT.K762.7542.JT9 8.T4.QT96.Q86543'
const board = (n) => `[Board "${n}"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "${DEAL}"]\n`
const pbnRef = (n, label) => ({ kind: 'pbn', label, text: board(n) })
const deals = (n) => Array.from({ length: n }, (_, i) => ({ dealString: DEAL, dealer: 'N', vulnerable: 'None', boardNumber: i + 1 }))

beforeEach(() => {
  vi.clearAllMocks()
  clearResolverCache()
})

describe('refBoards', () => {
  it('parses a single-board pbn ref', async () => {
    const b = await refBoards(pbnRef(1, 'A'))
    expect(b).toHaveLength(1)
    expect(b[0].label).toBe('A')
    expect(b[0].pbn).toContain('[Deal ')
  })

  it('parses a multi-board pbn ref in order', async () => {
    const ref = { kind: 'pbn', label: 'T', text: [1, 2, 3].map(board).join('\n') }
    expect(await refBoards(ref)).toHaveLength(3)
  })

  it('resolves a scenario ref and caches it (one fetch across two calls)', async () => {
    fetchScenarioDeals.mockResolvedValue(deals(2))
    const ref = { kind: 'scenario', repo: 'pbs', file: 'Stayman', label: 'Stayman' }
    expect(await refBoards(ref)).toHaveLength(2)
    await refBoards(ref)
    expect(fetchScenarioDeals).toHaveBeenCalledTimes(1)
  })

  it('curated:true forces the bba-filtered set (no /pbn fallback) — D-A', async () => {
    fetchScenarioDeals.mockResolvedValue(deals(1))
    await refBoards({ kind: 'scenario', repo: 'pbs', file: 'Stayman', curated: true })
    expect(fetchScenarioDeals).toHaveBeenCalledWith('Stayman', { curated: true })
  })

  it('resolves a library file entry', async () => {
    fetchEntryMock.mockResolvedValue({ kind: 'file', payload: [1, 2].map(board).join('\n') })
    expect(await refBoards({ kind: 'library', entryId: 'lib1' })).toHaveLength(2)
  })

  it('resolves a clubboard to the SPECIFIC board number, not a random one — D-C', async () => {
    const normalized = {
      tournaments: [{ events: [{ sessions: [{ boards: [
        { number: 1, dealer: 'N', vulnerability: 'None', deal: { N: { S: ['A'], H: [], D: [], C: [] }, E: { S: ['K'], H: [], D: [], C: [] }, S: { S: ['Q'], H: [], D: [], C: [] }, W: { S: ['J'], H: [], D: [], C: [] } } },
        { number: 7, dealer: 'E', vulnerability: 'NS', deal: { N: { S: ['2'], H: [], D: [], C: [] }, E: { S: ['3'], H: [], D: [], C: [] }, S: { S: ['4'], H: [], D: [], C: [] }, W: { S: ['5'], H: [], D: [], C: [] } } },
      ] }] }] }],
    }
    fetchGameMock.mockResolvedValue({ payload: JSON.stringify(normalized) })
    const b = await refBoards({ kind: 'clubboard', origin: 'db', gameId: 'g1', boardNumber: 7 })
    expect(b).toHaveLength(1)
    expect(b[0].pbn).toContain('[Board "7"]')
    expect(b[0].pbn).toContain('[Dealer "E"]')
  })
})

describe('nextBoard', () => {
  it('sequential walks the pool concatenation in order and wraps', async () => {
    const sel = { items: [pbnRef(1, 'A'), pbnRef(2, 'B'), pbnRef(3, 'C')], options: { drawOrder: 'sequential' } }
    const out = []
    for (let i = 0; i < 4; i++) out.push((await nextBoard(sel)).label)
    expect(out).toEqual(['A', 'B', 'C', 'A'])
  })

  it('random stays within the pool', async () => {
    const items = [pbnRef(1, 'A'), pbnRef(2, 'B')]
    const seen = new Set()
    for (let i = 0; i < 20; i++) seen.add((await nextBoard({ items, options: { drawOrder: 'random' } })).label)
    expect([...seen].every((l) => ['A', 'B'].includes(l))).toBe(true)
  })

  it('random draws WITHOUT replacement: every board once per cycle, no repeats within a cycle', async () => {
    // 30 distinct boards, mirroring the curated PBS pool size (bug-artifacts#36).
    const items = [{ kind: 'pbn', label: 'P', text: Array.from({ length: 30 }, (_, i) => board(i + 1)).join('\n') }]
    const sel = { items, options: { drawOrder: 'random' } }
    const first = []
    for (let i = 0; i < 30; i++) first.push((await nextBoard(sel)).pbn)
    // A full cycle visits all 30 distinct boards exactly once.
    expect(new Set(first).size).toBe(30)
  })

  it('random never repeats the previous board across many draws (incl. the reshuffle seam)', async () => {
    const items = [{ kind: 'pbn', label: 'P', text: Array.from({ length: 30 }, (_, i) => board(i + 1)).join('\n') }]
    const sel = { items, options: { drawOrder: 'random' } }
    let prev = null
    for (let i = 0; i < 200; i++) {
      const cur = (await nextBoard(sel)).pbn
      expect(cur).not.toBe(prev) // no immediate repeat, ever
      prev = cur
    }
  })

  it('throws on an empty selection', async () => {
    await expect(nextBoard({ items: [] })).rejects.toThrow(/no deal source/i)
  })
})

describe('generators', () => {
  it('isGenerator distinguishes generators from set-refs', () => {
    expect(isGenerator({ kind: 'random' })).toBe(true)
    expect(isGenerator({ kind: 'script' })).toBe(true)
    expect(isGenerator({ kind: 'pbn' })).toBe(false)
  })

  it('random yields a fresh board each draw', async () => {
    const a = (await nextBoard({ items: [{ kind: 'random' }], options: {} })).pbn
    const b = (await nextBoard({ items: [{ kind: 'random' }], options: {} })).pbn
    expect(a).toContain('[Deal ')
    expect(a).not.toBe(b)
  })

  it('script fetches the .dlr once (cached) and generates via dealerClient', async () => {
    fetchScenarioScript.mockResolvedValue('condition hcp(north)>=20\naction printoneline')
    generateBoardPbn.mockResolvedValue({ pbn: board(1), seed: 42 })
    const item = { kind: 'script', repo: 'pbs', file: 'Stayman' }
    await nextBoard({ items: [item], options: {} })
    await nextBoard({ items: [item], options: {} })
    expect(fetchScenarioScript).toHaveBeenCalledTimes(1)
    expect(generateBoardPbn).toHaveBeenCalledTimes(2)
  })
})

describe('materialize', () => {
  it('concatenates the pool in order and renumbers boards 1..N', async () => {
    const three = { kind: 'pbn', label: 'T', text: [1, 2, 3].map(board).join('\n') }
    const mat = await materialize({ items: [three, pbnRef(9, 'X')], options: {} })
    expect(mat.count).toBe(4)
    expect(mat.boardsPbn).toMatch(/\[Board "1"\][\s\S]*\[Board "2"\][\s\S]*\[Board "3"\][\s\S]*\[Board "4"\]/)
  })

  it('generators contribute options.count boards each', async () => {
    const mat = await materialize({ items: [{ kind: 'random' }], options: { count: 3 } })
    expect(mat.count).toBe(3)
  })

  it('a SINGLE fixed source keeps the boards own PBN numbers (no renumber)', async () => {
    // One multi-board PBN file numbered 5,6,7 → replaying it should show 5,6,7,
    // not 1,2,3 (the club-session case).
    const one = { kind: 'pbn', label: 'Club', text: [5, 6, 7].map(board).join('\n') }
    const mat = await materialize({ items: [one], options: {} })
    expect(mat.count).toBe(3)
    expect(mat.boardsPbn).toMatch(/\[Board "5"\][\s\S]*\[Board "6"\][\s\S]*\[Board "7"\]/)
  })
})

describe('usePbnBoardNumbers (single fixed source keeps PBN numbers)', () => {
  it('single fixed board-list source → true', () => {
    expect(usePbnBoardNumbers({ items: [pbnRef(1, 'A')] })).toBe(true)
    expect(usePbnBoardNumbers({ items: [{ kind: 'clubgame', label: 'Tue' }] })).toBe(true)
    expect(usePbnBoardNumbers({ items: [{ kind: 'scenario', file: 'x', label: 'x' }] })).toBe(true)
  })
  it('a generator → false (use the incrementor)', () => {
    expect(usePbnBoardNumbers({ items: [{ kind: 'random' }] })).toBe(false)
    expect(usePbnBoardNumbers({ items: [{ kind: 'script', repo: 'pbs', file: 'x' }] })).toBe(false)
  })
  it('a mix of sources → false (numbers would bounce)', () => {
    expect(usePbnBoardNumbers({ items: [pbnRef(1, 'A'), pbnRef(2, 'B')] })).toBe(false)
    expect(usePbnBoardNumbers({ items: [{ kind: 'scenario', file: 'x' }, { kind: 'random' }] })).toBe(false)
  })
  it('empty / missing selection → false', () => {
    expect(usePbnBoardNumbers({ items: [] })).toBe(false)
    expect(usePbnBoardNumbers(null)).toBe(false)
  })
})

describe('board→PBN converter parity (guards the known duplication)', () => {
  it('dealToMinimalPbn and boardToMinimalPbn agree on the shared format', () => {
    const b = {
      number: 1,
      dealer: 'N',
      vulnerability: 'None',
      deal: {
        N: { S: ['A', 'K'], H: ['10'], D: ['Q', 'J'], C: ['9'] },
        E: { S: ['Q'], H: ['A', 'K'], D: ['10'], C: ['8', '7'] },
        S: { S: ['J', '10'], H: ['Q'], D: ['9'], C: ['A', 'K'] },
        W: { S: ['9'], H: ['J'], D: ['A', 'K'], C: ['Q', 'J'] },
      },
    }
    const viaBoard = boardToMinimalPbn(b)
    const deal = parsePbn(viaBoard).find((d) => d.dealString)
    expect(dealToMinimalPbn(deal)).toBe(viaBoard)
  })
})

describe('describeSelection (auto-generated set label)', () => {
  it('one source → "<Category> - <name>"', () => {
    expect(describeSelection({ items: [{ kind: 'scenario', repo: 'pbs', file: 'x', label: 'Transfers' }] }))
      .toBe('Scenarios - Transfers')
    expect(describeSelection({ items: [{ kind: 'scenario', curated: true, file: 'x', label: 'Keycard' }] }))
      .toBe('Curated - Keycard')
    expect(describeSelection({ items: [{ kind: 'clubgame', label: 'Livermore Tue' }] }))
      .toBe('Club - Livermore Tue')
    expect(describeSelection({ items: [{ kind: 'library', label: 'Lesson 4' }] }))
      .toBe('Library - Lesson 4')
  })
  it('Random / Paste stand alone (no "Random - Random")', () => {
    expect(describeSelection({ items: [{ kind: 'random' }] })).toBe('Random')
    expect(describeSelection({ items: [{ kind: 'pbn', text: '…' }] })).toBe('Paste')
  })
  it('several sources → "Mix: a, b[, +N more]"', () => {
    const items = ['Stayman', 'Keycard'].map((l) => ({ kind: 'scenario', file: l, label: l }))
    expect(describeSelection({ items })).toBe('Mix: Stayman, Keycard')
    const many = ['a', 'b', 'c', 'd', 'e'].map((l) => ({ kind: 'scenario', file: l, label: l }))
    expect(describeSelection({ items: many })).toBe('Mix: a, b, c, +2 more')
  })
  it('empty selection → empty string', () => {
    expect(describeSelection({ items: [] })).toBe('')
  })
})

describe('materialize returns the label', () => {
  it('carries the auto-generated description', async () => {
    const mat = await materialize({ items: [pbnRef(1, 'Hand A')], options: {} })
    expect(mat.label).toBe('Paste')
    expect(mat.count).toBe(1)
  })
})

describe('makeRandomDealPbn', () => {
  it('is a valid 4×13 partition of 52 distinct cards', () => {
    const m = makeRandomDealPbn().match(/\[Deal "N:([^"]+)"\]/)
    const hands = m[1].split(' ')
    expect(hands).toHaveLength(4)
    expect(hands.map((h) => h.split('.').reduce((s, suit) => s + suit.length, 0))).toEqual([13, 13, 13, 13])
    expect(hands.join('').replace(/\./g, '')).toHaveLength(52)
  })
})
