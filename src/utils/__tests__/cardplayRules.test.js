import { describe, it, expect } from 'vitest'
import {
  handToCards,
  trumpFromContract,
  getLegalCards,
  isLegalPlay,
  trickWinner,
  beats,
  computeRemaining,
  nextSeatToPlay,
} from '../cardplayRules.js'

const HAND_A = {
  spades: ['A', 'K', 'Q'],
  hearts: ['J', 'T'],
  diamonds: ['9', '8', '7', '6'],
  clubs: ['5', '4', '3', '2'],
}

describe('cardplayRules', () => {
  describe('handToCards', () => {
    it('flattens a hand into S→H→D→C order', () => {
      const cards = handToCards(HAND_A)
      expect(cards).toHaveLength(13)
      expect(cards[0]).toEqual({ suit: 'S', rank: 'A' })
      expect(cards[2]).toEqual({ suit: 'S', rank: 'Q' })
      expect(cards[3]).toEqual({ suit: 'H', rank: 'J' })
      expect(cards[12]).toEqual({ suit: 'C', rank: '2' })
    })

    it('returns [] for null/empty hands', () => {
      expect(handToCards(null)).toEqual([])
      expect(handToCards({})).toEqual([])
    })
  })

  describe('trumpFromContract', () => {
    it('extracts the trump suit', () => {
      expect(trumpFromContract('4S')).toBe('S')
      expect(trumpFromContract('1H')).toBe('H')
      expect(trumpFromContract('2D')).toBe('D')
      expect(trumpFromContract('3C')).toBe('C')
    })

    it('returns null for NT contracts', () => {
      expect(trumpFromContract('1NT')).toBeNull()
      expect(trumpFromContract('3N')).toBeNull()
      expect(trumpFromContract('7NT')).toBeNull()
    })

    it('handles doubled / redoubled', () => {
      expect(trumpFromContract('4SX')).toBe('S')
      expect(trumpFromContract('4SXX')).toBe('S')
      expect(trumpFromContract('3NTX')).toBeNull()
    })

    it('returns null for pass / empty', () => {
      expect(trumpFromContract('Pass')).toBeNull()
      expect(trumpFromContract('')).toBeNull()
      expect(trumpFromContract(null)).toBeNull()
    })

    it('throws on garbage', () => {
      expect(() => trumpFromContract('garbage')).toThrow()
    })
  })

  describe('getLegalCards', () => {
    const remaining = handToCards(HAND_A)

    it('returns all cards when leading', () => {
      expect(getLegalCards(remaining, [])).toEqual(remaining)
    })

    it('forces follow-suit when seat has the lead suit', () => {
      const trick = [{ seat: 'N', suit: 'H', rank: '2' }]
      const legal = getLegalCards(remaining, trick)
      expect(legal).toHaveLength(2)
      expect(legal.every(c => c.suit === 'H')).toBe(true)
    })

    it('allows any card when seat is void in lead suit', () => {
      const handVoidInSpades = {
        spades: [],
        hearts: ['A', 'K'],
        diamonds: ['Q', 'J'],
        clubs: ['T', '9'],
      }
      const trick = [{ seat: 'N', suit: 'S', rank: '5' }]
      const legal = getLegalCards(handToCards(handVoidInSpades), trick)
      expect(legal).toHaveLength(6)
    })

    it('returns a fresh array (caller can mutate without affecting input)', () => {
      const legal = getLegalCards(remaining, [])
      legal.pop()
      expect(remaining).toHaveLength(13)
    })
  })

  describe('isLegalPlay', () => {
    const remaining = handToCards(HAND_A)

    it('accepts legal plays', () => {
      expect(isLegalPlay({ suit: 'S', rank: 'A' }, remaining, [])).toBe(true)
      const trick = [{ seat: 'N', suit: 'H', rank: '2' }]
      expect(isLegalPlay({ suit: 'H', rank: 'J' }, remaining, trick)).toBe(true)
    })

    it('rejects a card the seat does not hold', () => {
      expect(isLegalPlay({ suit: 'S', rank: 'J' }, remaining, [])).toBe(false)
    })

    it('rejects a card that revokes when seat could follow', () => {
      const trick = [{ seat: 'N', suit: 'H', rank: '2' }]
      // Seat has hearts (J,T) so playing a club is illegal.
      expect(isLegalPlay({ suit: 'C', rank: '5' }, remaining, trick)).toBe(false)
    })
  })

  describe('beats', () => {
    it('higher rank wins in same suit', () => {
      const a = { suit: 'S', rank: 'A' }
      const b = { suit: 'S', rank: 'K' }
      expect(beats(a, b, 'S', null)).toBe(true)
      expect(beats(b, a, 'S', null)).toBe(false)
    })

    it('trump beats non-trump regardless of rank', () => {
      const trumpDeuce = { suit: 'S', rank: '2' }
      const offAce = { suit: 'H', rank: 'A' }
      expect(beats(trumpDeuce, offAce, 'H', 'S')).toBe(true)
      expect(beats(offAce, trumpDeuce, 'H', 'S')).toBe(false)
    })

    it('off-suit non-trump cannot beat lead suit', () => {
      const lead = { suit: 'H', rank: '2' }
      const off = { suit: 'C', rank: 'A' }
      expect(beats(off, lead, 'H', 'S')).toBe(false)
    })

    it('both off-suit non-trump: keep existing winner', () => {
      const a = { suit: 'D', rank: 'A' }
      const b = { suit: 'C', rank: 'K' }
      expect(beats(a, b, 'H', 'S')).toBe(false)
    })
  })

  describe('trickWinner', () => {
    it('high card wins in NT', () => {
      const plays = [
        { seat: 'N', suit: 'H', rank: '2' },
        { seat: 'E', suit: 'H', rank: 'A' },
        { seat: 'S', suit: 'H', rank: 'K' },
        { seat: 'W', suit: 'C', rank: 'A' },
      ]
      expect(trickWinner(plays, null)).toBe('E')
    })

    it('trump wins over high non-trump', () => {
      const plays = [
        { seat: 'N', suit: 'H', rank: 'A' },
        { seat: 'E', suit: 'H', rank: 'K' },
        { seat: 'S', suit: 'S', rank: '2' },  // ruff
        { seat: 'W', suit: 'H', rank: 'Q' },
      ]
      expect(trickWinner(plays, 'S')).toBe('S')
    })

    it('over-ruff: higher trump wins', () => {
      const plays = [
        { seat: 'N', suit: 'H', rank: 'A' },
        { seat: 'E', suit: 'S', rank: '5' },  // ruff
        { seat: 'S', suit: 'S', rank: 'K' },  // over-ruff
        { seat: 'W', suit: 'H', rank: 'Q' },
      ]
      expect(trickWinner(plays, 'S')).toBe('S')
    })

    it('leader wins if everyone follows low', () => {
      const plays = [
        { seat: 'N', suit: 'D', rank: 'A' },
        { seat: 'E', suit: 'D', rank: '5' },
        { seat: 'S', suit: 'D', rank: '7' },
        { seat: 'W', suit: 'D', rank: '2' },
      ]
      expect(trickWinner(plays, null)).toBe('N')
    })

    it('throws on incomplete tricks', () => {
      expect(() => trickWinner([], null)).toThrow()
      expect(() => trickWinner([{ seat: 'N', suit: 'H', rank: 'A' }], null)).toThrow()
    })
  })

  describe('computeRemaining', () => {
    const originalHands = {
      N: { spades: ['A', 'K'], hearts: ['Q'], diamonds: ['J'], clubs: ['T'] },
      E: { spades: ['9'],      hearts: ['8'], diamonds: ['7'], clubs: ['6'] },
      S: { spades: ['5'],      hearts: ['4'], diamonds: ['3'], clubs: ['2'] },
      W: { spades: [],         hearts: [],    diamonds: [],    clubs: [] },
    }

    it('returns the full hands when nothing has been played', () => {
      const r = computeRemaining(originalHands, [])
      expect(r.N).toHaveLength(5)
      expect(r.S).toHaveLength(4)
      expect(r.W).toHaveLength(0)
    })

    it('removes played cards from the correct seat', () => {
      const played = [
        { seat: 'N', suit: 'S', rank: 'A' },
        { seat: 'E', suit: 'S', rank: '9' },
        { seat: 'S', suit: 'S', rank: '5' },
      ]
      const r = computeRemaining(originalHands, played)
      expect(r.N.find(c => c.suit === 'S' && c.rank === 'A')).toBeUndefined()
      expect(r.E.find(c => c.suit === 'S')).toBeUndefined()
      expect(r.S.find(c => c.suit === 'S')).toBeUndefined()
      expect(r.N).toHaveLength(4)
    })

    it('throws if a seat plays a card it does not hold', () => {
      const played = [{ seat: 'N', suit: 'C', rank: 'A' }]
      expect(() => computeRemaining(originalHands, played)).toThrow()
    })
  })

  describe('nextSeatToPlay', () => {
    it('returns the opening leader when nothing is played yet', () => {
      const state = { currentTrick: { leader: 'W', plays: [] }, completedTricks: [] }
      expect(nextSeatToPlay(state, 'S', 'W')).toBe('W')
    })

    it('rotates clockwise mid-trick', () => {
      const state = {
        currentTrick: { leader: 'W', plays: [{ seat: 'W', suit: 'D', rank: 'A' }] },
        completedTricks: [],
      }
      expect(nextSeatToPlay(state, 'S', 'W')).toBe('N')
    })

    it('returns the trick winner after the 4th play', () => {
      const state = {
        currentTrick: {
          leader: 'W',
          plays: [
            { seat: 'W', suit: 'D', rank: '2' },
            { seat: 'N', suit: 'D', rank: '3' },
            { seat: 'E', suit: 'S', rank: '2' },  // ruff in spades
            { seat: 'S', suit: 'D', rank: 'K' },
          ],
        },
        completedTricks: [],
      }
      expect(nextSeatToPlay(state, 'S', 'W')).toBe('E')
    })

    it('returns the last winner when starting a fresh trick after some are complete', () => {
      const state = {
        currentTrick: { leader: null, plays: [] },
        completedTricks: [{ leader: 'W', plays: [], winner: 'N' }],
      }
      expect(nextSeatToPlay(state, 'S', 'W')).toBe('N')
    })
  })
})
