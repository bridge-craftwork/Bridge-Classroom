import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchDoubleDummy } from '../ddsClient.js'
import { handsToPbnString, buildDdRows } from '../handAnalysis.js'

// Plan example deal. hands keyed by seat; handsToPbnString emits N,E,S,W order.
const DEAL = {
  hands: {
    N: { spades: ['A', 'K', 'Q', 'T', '3'], hearts: ['J', '6'], diamonds: ['K', 'J', '4', '2'], clubs: ['9', '5'] },
    E: { spades: ['6', '5', '2'], hearts: ['A', 'K', '4', '2'], diamonds: ['A', 'Q', '8', '7'], clubs: ['T', '4'] },
    S: { spades: ['J', '7', '4'], hearts: ['Q', 'T', '9', '5'], diamonds: ['T'], clubs: ['A', 'K', '8', '6', '3'] },
    W: { spades: ['9', '8'], hearts: ['8', '7', '3'], diamonds: ['9', '6', '5', '3'], clubs: ['Q', 'J', '7', '2'] },
  },
}

// The exact ddtricks our live service returns for DEAL — NT-first
// [NT,S,H,D,C] per seat [N,S,E,W]. Verified byte-for-byte vs bridgewebs.
const DDTRICKS = '9a8789a8784346543465'

function mockFetch(impl) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchDoubleDummy', () => {
  it('POSTs the PBN deal string to /dd and returns ddtricks', async () => {
    const fetchFn = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ddtricks: DDTRICKS, cached: false }),
    }))

    const result = await fetchDoubleDummy(DEAL)
    expect(result).toBe(DDTRICKS)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toMatch(/\/dd$/)
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    // Standard PBN (spaces, no bridgewebs 'x' hack), built from the deal hands.
    expect(JSON.parse(opts.body)).toEqual({ dealstr: 'N:' + handsToPbnString(DEAL.hands) })
  })

  it('returns null on a non-OK response', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }))
    expect(await fetchDoubleDummy(DEAL)).toBeNull()
  })

  it('returns null when ddtricks is missing or too short', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ ddtricks: 'abc' }) }))
    expect(await fetchDoubleDummy(DEAL)).toBeNull()
  })
})

describe('ddtricks renders through buildDdRows (NT-first contract)', () => {
  // Final contract 3NT by South. buildDdRows columns are [C,D,H,S,NT].
  const rows = buildDdRows(DDTRICKS, { declarer: 'S', contract: '3NT' })

  it('lays out seats N,S,E,W', () => {
    expect(rows.map(r => r.seat)).toEqual(['N', 'S', 'E', 'W'])
  })

  it('reads South declarer tricks per strain correctly', () => {
    // South: C=8, D=7, H=8, S=10, NT=9 (columns [C,D,H,S,NT]).
    expect(rows[1].cells.map(c => c.tricks)).toEqual([8, 7, 8, 10, 9])
  })

  it('highlights exactly the contract cell (South, NT)', () => {
    const flagged = rows.flatMap((r, si) =>
      r.cells.map((c, ci) => (c.isContract ? `${si},${ci}` : null)).filter(Boolean),
    )
    // South row index 1, NT column index 4.
    expect(flagged).toEqual(['1,4'])
  })
})
