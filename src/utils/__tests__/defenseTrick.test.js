import { describe, it, expect } from 'vitest'
import { parseCardCode, buildTrickFromShowcards, playedCardOnlySeats } from '../defenseTrick.js'

describe('parseCardCode', () => {
  it('parses suit + rank', () => {
    expect(parseCardCode('S7')).toEqual({ suit: 'spades', rank: '7' })
    expect(parseCardCode('HK')).toEqual({ suit: 'hearts', rank: 'K' })
    expect(parseCardCode('DT')).toEqual({ suit: 'diamonds', rank: 'T' })
    expect(parseCardCode('cA')).toEqual({ suit: 'clubs', rank: 'A' }) // case-insensitive suit
  })
  it('rejects bad codes', () => {
    expect(parseCardCode('X7')).toBeNull()
    expect(parseCardCode('S')).toBeNull()
    expect(parseCardCode('')).toBeNull()
    expect(parseCardCode(null)).toBeNull()
  })
})

describe('buildTrickFromShowcards', () => {
  it('builds one play per seat, in N/E/S/W order, using the last card', () => {
    // The signals scene: W led ♠K, N (dummy) ♠3, E (partner) ♠7, S (declarer) ♠5.
    const trick = buildTrickFromShowcards({ W: ['SK'], N: ['S3'], E: ['S7'], S: ['S5'] })
    expect(trick.plays).toEqual([
      { seat: 'N', suit: 'spades', rank: '3' },
      { seat: 'E', suit: 'spades', rank: '7' },
      { seat: 'S', suit: 'spades', rank: '5' },
      { seat: 'W', suit: 'spades', rank: 'K' },
    ])
  })
  it('omits seats with no card and tolerates garbage', () => {
    expect(buildTrickFromShowcards({ E: ['S7'], S: [], W: ['bad'] }).plays).toEqual([
      { seat: 'E', suit: 'spades', rank: '7' },
    ])
    expect(buildTrickFromShowcards(null).plays).toEqual([])
  })
})

describe('playedCardOnlySeats', () => {
  it('is the showcards seats minus the fully-shown ones', () => {
    // currentShowcards has all four; W & N are fully shown (their card struck in-hand);
    // E & S are played-card-only → hidden + moved to the trick.
    expect(playedCardOnlySeats(
      { W: ['SK'], N: ['S3'], E: ['S7'], S: ['S5'] },
      { W: ['SK'], N: ['S3'] },
    ).sort()).toEqual(['E', 'S'])
  })
  it('empty when there are no showcards', () => {
    expect(playedCardOnlySeats(null, {})).toEqual([])
    expect(playedCardOnlySeats({}, {})).toEqual([])
  })
})
