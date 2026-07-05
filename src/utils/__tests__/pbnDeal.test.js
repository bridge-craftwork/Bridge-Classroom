import { describe, it, expect } from 'vitest'
import { parseDealHands, makeDeal, parsePbnDeals } from '../pbnDeal.js'

describe('pbnDeal', () => {
  const DEAL = 'N:AKQJ.AKQ.AKQ.AKQJ .JT98.JT9876.T9876 T98765432... ..5432.5432xx'

  it('parseDealHands maps N-first PBN to per-seat suit arrays', () => {
    const hands = parseDealHands('S:48JA.37K.QK.28TA 9TK.59Q.34TA.34J 753.J8642.J9762. 26Q.TA.58.5679QK')
    // The string starts at South, so the first hand is South.
    expect(hands.S).toEqual({ spades: ['4', '8', 'J', 'A'], hearts: ['3', '7', 'K'], diamonds: ['Q', 'K'], clubs: ['2', '8', 'T', 'A'] })
    // Next clockwise seat (W) gets the second hand.
    expect(hands.W.spades).toEqual(['9', 'T', 'K'])
    expect(Object.keys(hands).sort()).toEqual(['E', 'N', 'S', 'W'])
  })

  it('parseDealHands rejects malformed strings', () => {
    expect(parseDealHands('nope')).toBeNull()
    expect(parseDealHands('N:AKQ.AKQ.AKQ')).toBeNull() // only 3 hands
    expect(parseDealHands(null)).toBeNull()
  })

  it('makeDeal carries dealer/vulnerable and the raw pbn', () => {
    const d = makeDeal('S:48JA.37K.QK.28TA 9TK.59Q.34TA.34J 753.J8642.J9762. 26Q.TA.58.5679QK', { dealer: 'W', vulnerable: 'EW' })
    expect(d.dealer).toBe('W')
    expect(d.vulnerable).toBe('EW')
    expect(d.hands.S.spades).toEqual(['4', '8', 'J', 'A'])
    expect(d.pbn).toContain('S:48JA')
  })

  it('parsePbnDeals reads tags from a board block', () => {
    const pbn = [
      '[Board "3"]', '[Dealer "E"]', '[Vulnerable "Both"]',
      '[Deal "S:48JA.37K.QK.28TA 9TK.59Q.34TA.34J 753.J8642.J9762. 26Q.TA.58.5679QK"]',
    ].join('\n')
    const deals = parsePbnDeals(pbn)
    expect(deals).toHaveLength(1)
    expect(deals[0]).toMatchObject({ board: '3', dealer: 'E', vulnerable: 'Both' })
    expect(deals[0].hands.S.clubs).toEqual(['2', '8', 'T', 'A'])
  })

  void DEAL
})
