import { describe, it, expect } from 'vitest'
import { buildBoardSnapshot, dealToPbn } from '../boardSnapshot.js'

const hand = (s, h, d, c) => ({ spades: s.split(''), hearts: h.split(''), diamonds: d.split(''), clubs: c.split('') })
const HANDS = {
  N: hand('J98', 'J74', 'QT3', 'KQ54'),
  E: hand('K432', '83', 'J4', 'T9872'),
  S: hand('AQT5', 'AKQT62', '6', 'J3'),
  W: hand('76', '95', 'AK98752', 'A6'),
}

describe('dealToPbn', () => {
  it('writes all four hands, N first', () => {
    expect(dealToPbn(HANDS)).toBe('N:J98.J74.QT3.KQ54 K432.83.J4.T9872 AQT5.AKQT62.6.J3 76.95.AK98752.A6')
  })

  it("marks a missing hand '-' and writes 10 as T", () => {
    const h = { S: { spades: ['A', '10'], hearts: [], diamonds: ['2'], clubs: [] } }
    expect(dealToPbn(h)).toBe('N:- - AT..2. -')
  })

  it('is null with no hands', () => {
    expect(dealToPbn(null)).toBe(null)
    expect(dealToPbn({})).toBe(null)
  })
})

describe('buildBoardSnapshot', () => {
  const meanings = [
    { position: 0, bid: '1H', meaning: '5+ hearts, 12-21', ruleRef: 'open.one_major', source: 'rusty' },
    { position: 2, bid: '2H', meaning: 'Single raise', ruleRef: null, source: 'bba', fallback: true },
    { position: 4, bid: '4H', meaning: 'Game', ruleRef: { module: 'base', file: 'conventions/base/base.bid', line: 64 }, announce: null, isAlert: true, alertText: 'to play' },
  ]
  const snap = buildBoardSnapshot({
    hands: HANDS, dealer: 'S', vulnerable: 'NS', scoring: 'MP', board: 2, source: 'Finesse_Simple',
    bids: ['1H', '2D', '2H', 'Pass', '4H', 'Pass', 'Pass', 'Pass'],
    meanings, humanSeats: ['S'], bidder: 'rusty', fallbackIndices: [2],
  })

  it('records the deal, the board and a one-line auction', () => {
    expect(snap.deal).toMatch(/^N:J98/)
    expect(snap).toMatchObject({ dealer: 'S', vulnerable: 'NS', scoring: 'MP', board: 2, source: 'Finesse_Simple' })
    expect(snap.auction).toBe('1H 2D 2H P 4H P P P')
  })

  it('seats each call from the dealer and says who made it', () => {
    expect(snap.calls.map((c) => c.seat).join('')).toBe('SWNESWNE')
    expect(snap.calls[0].by).toBe('student')
    expect(snap.calls[1].by).toBe('rusty')
    expect(snap.calls[2].by).toBe('bba-fallback')
  })

  it('carries the meaning, rule and alert the table showed', () => {
    expect(snap.calls[0]).toMatchObject({ meaning: '5+ hearts, 12-21', rule: 'open.one_major' })
    expect(snap.calls[4]).toMatchObject({ rule: 'conventions/base/base.bid:64', alert: 'to play' })
    expect(snap.calls[4].ruleRef).toEqual({ module: 'base', file: 'conventions/base/base.bid', line: 64 })
    expect(snap.calls[1].meaning).toBe(null)
  })

  it("names BBA's calls on a BBA table", () => {
    const bba = buildBoardSnapshot({ hands: HANDS, dealer: 'N', bids: ['1C', 'Pass'], humanSeats: ['S'], bidder: 'bba' })
    expect(bba.calls.map((c) => c.by)).toEqual(['bba', 'bba'])
  })
})
