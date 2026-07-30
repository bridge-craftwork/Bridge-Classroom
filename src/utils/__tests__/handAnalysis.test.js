import { describe, it, expect } from 'vitest'
import { bidderDivergence, normalizeCall, firstNewDivergence } from '../handAnalysis.js'

// dealer N → bid index 0=N, 1=E, 2=S, 3=W, 4=N, …
// Report #52, verified 2026-07-30 against the live BBA service. Notrump has two
// live spellings and they meet in this function: PBN + the table-service wire say
// `1N`; BiddingBox and BBA say `1NT`. Comparing raw made every NT bid on a SERVED
// table a false divergence — the grid showed "● YOU 1NT" over "○ BBA 1NT" struck
// through. Solo never hit it (BiddingBox and BBA already agree).
describe('bidderDivergence — notrump spelling is not a disagreement', () => {
  const dealer = 'N'

  it('does not flag 1N (wire) against 1NT (BBA) — the served-table case', () => {
    // dealer N, so index 2 is South.
    const actual = ['Pass', 'Pass', '1N', 'Pass']
    const expected = ['Pass', 'Pass', '1NT', 'Pass']
    expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({})
  })

  it('holds at every level', () => {
    for (const lvl of [1, 2, 3, 4, 5, 6, 7]) {
      const actual = ['Pass', 'Pass', `${lvl}N`, 'Pass']
      const expected = ['Pass', 'Pass', `${lvl}NT`, 'Pass']
      expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({})
    }
  })

  it('still reports a REAL divergence, in the caller\'s own spelling', () => {
    const actual = ['Pass', 'Pass', '1N', 'Pass']
    const expected = ['Pass', 'Pass', '2NT', 'Pass']
    expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({
      2: { actual: '1N', bba: '2NT' },
    })
  })

  // Normalising must not smear anything else together.
  it('does not confuse a suit bid, a double, or a different level', () => {
    expect(normalizeCall('1N')).toBe('1NT')
    expect(normalizeCall('1NT')).toBe('1NT')
    expect(normalizeCall('1S')).toBe('1S')
    expect(normalizeCall('Pass')).toBe('Pass')
    expect(normalizeCall('X')).toBe('X')
    expect(normalizeCall('XX')).toBe('XX')
    // Not a call shape at all — passed through untouched, never coerced.
    expect(normalizeCall('8N')).toBe('8N')
    expect(normalizeCall(null)).toBeNull()
    expect(normalizeCall(undefined)).toBeUndefined()
  })
})

// Roadmap §7.2 (#50): the served table's comparison only appeared once the auction
// ended. Going per-call needs ONE divergence at a time, because a from-scratch BBA
// reference stops being positionally meaningful after your first disagreement —
// every later reference call assumes BBA's line, not the auction that happened.
// The caller records the hit, re-requests with the real auction as prefix, asks again.
describe('firstNewDivergence — one at a time, so the reference can be re-anchored', () => {
  const dealer = 'N' // idx 0=N, 1=E, 2=S, 3=W, 4=N, ...

  it('returns null while the seat is matching', () => {
    const a = ['Pass', 'Pass', '1S']
    expect(firstNewDivergence(a, ['Pass', 'Pass', '1S'], dealer, 'S')).toBeNull()
  })

  it('finds the seat\'s first disagreement', () => {
    const a = ['Pass', 'Pass', '1S', 'Pass', 'Pass', 'Pass', '3H']
    const e = ['Pass', 'Pass', '1S', 'Pass', 'Pass', 'Pass', '2H']
    expect(firstNewDivergence(a, e, dealer, 'S')).toEqual({ idx: 6, user: '3H', bba: '2H' })
  })

  it('ignores other seats entirely', () => {
    const a = ['1C', 'Pass', '1S']
    const e = ['1D', 'Pass', '1S'] // North differs — not my problem
    expect(firstNewDivergence(a, e, dealer, 'S')).toBeNull()
  })

  it('skips what is already recorded, so it advances instead of looping', () => {
    const a = ['Pass', 'Pass', '1S', 'Pass', 'Pass', 'Pass', '3H']
    const e = ['Pass', 'Pass', '2S', 'Pass', 'Pass', 'Pass', '2H']
    const first = firstNewDivergence(a, e, dealer, 'S')
    expect(first).toEqual({ idx: 2, user: '1S', bba: '2S' })
    const next = firstNewDivergence(a, e, dealer, 'S', { 2: first })
    expect(next).toEqual({ idx: 6, user: '3H', bba: '2H' })
    expect(firstNewDivergence(a, e, dealer, 'S', { 2: first, 6: next })).toBeNull()
  })

  it('does not read past the shorter array — a live auction is still growing', () => {
    const a = ['Pass', 'Pass'] // South hasn't called yet
    const e = ['Pass', 'Pass', '1N', 'Pass']
    expect(firstNewDivergence(a, e, dealer, 'S')).toBeNull()
  })

  it('applies the notrump normalisation too', () => {
    const a = ['Pass', 'Pass', '1N']
    const e = ['Pass', 'Pass', '1NT']
    expect(firstNewDivergence(a, e, dealer, 'S')).toBeNull()
  })

  it('survives empty/absent input', () => {
    expect(firstNewDivergence([], [], dealer, 'S')).toBeNull()
    expect(firstNewDivergence(undefined, undefined, dealer, 'S')).toBeNull()
  })
})

describe('bidderDivergence (per-bidder auction divergence)', () => {
  const dealer = 'N'

  it("flags only the given seat's calls that differ from the reference", () => {
    const actual = ['1N', 'Pass', '2N', 'Pass', 'Pass', 'Pass']
    const expected = ['1N', 'Pass', '3N', 'Pass', 'Pass', 'Pass'] // BBA wanted 3N from S
    expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({
      2: { actual: '2N', bba: '3N' },
    })
  })

  it('ignores divergences at other seats (per-bidder scope)', () => {
    const actual = ['1N', '2H', '2N', 'Pass'] // E overcalled 2H
    const expected = ['1N', 'Pass', '2N', 'Pass'] // BBA expected E to Pass
    // Seat S (idx 2) matched → nothing for S, even though E diverged.
    expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({})
    // Seat E (idx 1) is where the difference shows.
    expect(bidderDivergence(actual, expected, dealer, 'E')).toEqual({
      1: { actual: '2H', bba: 'Pass' },
    })
  })

  it('returns empty when the seat matched the reference throughout', () => {
    const a = ['1N', 'Pass', '3N', 'Pass', 'Pass', 'Pass']
    expect(bidderDivergence(a, a.slice(), dealer, 'S')).toEqual({})
  })

  it('only compares indices present in both auctions (length mismatch ≠ divergence)', () => {
    const actual = ['Pass', 'Pass', '2S', 'Pass'] // S bid 2S at idx 2
    const expected = ['Pass', 'Pass'] // reference stops short of idx 2
    expect(bidderDivergence(actual, expected, dealer, 'S')).toEqual({})
  })

  it('respects the dealer offset when locating a seat', () => {
    // dealer E → idx 0=E, 1=S, 2=W, 3=N
    const actual = ['Pass', '1S', 'Pass', 'Pass']
    const expected = ['Pass', '1H', 'Pass', 'Pass']
    expect(bidderDivergence(actual, expected, 'E', 'S')).toEqual({
      1: { actual: '1S', bba: '1H' },
    })
  })

  it('tolerates empty / missing inputs', () => {
    expect(bidderDivergence([], [], dealer, 'S')).toEqual({})
    expect(bidderDivergence(undefined, undefined, dealer, 'S')).toEqual({})
  })
})
