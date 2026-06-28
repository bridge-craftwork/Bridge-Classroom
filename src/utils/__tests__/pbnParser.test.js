import { describe, it, expect } from 'vitest'
import {
  parsePbn,
  parsePrompts,
  getDealTitle,
  getSeatOrder,
  getSeatForBid
} from '../pbnParser.js'

describe('pbnParser', () => {
  describe('parsePbn', () => {
    it('should parse a simple deal', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
1S Pass 2S Pass Pass Pass
`
      const deals = parsePbn(pbn)

      expect(deals).toHaveLength(1)
      expect(deals[0].boardNumber).toBe(1)
      expect(deals[0].dealer).toBe('N')
      expect(deals[0].vulnerable).toBe('None')
    })

    it('should parse multiple deals', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
1S Pass Pass Pass

[Board "2"]
[Dealer "E"]
[Vulnerable "NS"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "E"]
1H Pass 2H Pass Pass Pass
`
      const deals = parsePbn(pbn)

      expect(deals).toHaveLength(2)
      expect(deals[0].boardNumber).toBe(1)
      expect(deals[1].boardNumber).toBe(2)
      expect(deals[1].dealer).toBe('E')
      expect(deals[1].vulnerable).toBe('NS')
    })

    it('should parse hand distributions correctly', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQJT.98.765.432 98765.A.KQJ.AKQ 432.KQJT.AT9.JT9 .76543.832.8765"]
[Auction "N"]
Pass
`
      const deals = parsePbn(pbn)
      const hands = deals[0].hands

      expect(hands.N.spades).toEqual(['A', 'K', 'Q', 'J', 'T'])
      expect(hands.N.hearts).toEqual(['9', '8'])
      expect(hands.N.diamonds).toEqual(['7', '6', '5'])
      expect(hands.N.clubs).toEqual(['4', '3', '2'])

      // West has void in spades
      expect(hands.W.spades).toEqual([])
      expect(hands.W.hearts).toEqual(['7', '6', '5', '4', '3'])
    })

    it('should parse auction correctly', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
1S Pass 2S X XX Pass 4S Pass Pass Pass
`
      const deals = parsePbn(pbn)

      expect(deals[0].auction).toEqual([
        '1S', 'Pass', '2S', 'X', 'XX', 'Pass', '4S', 'Pass', 'Pass', 'Pass'
      ])
    })

    it('should normalize various bid formats', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
1S p 2H dbl 3H rdbl pass PASS
`
      const deals = parsePbn(pbn)

      expect(deals[0].auction).toContain('Pass')
      expect(deals[0].auction).toContain('X')  // dbl normalized to X
      expect(deals[0].auction).toContain('XX') // rdbl normalized to XX
    })

    it('should parse deal starting from different seats', () => {
      const pbn = `
[Board "1"]
[Dealer "W"]
[Vulnerable "None"]
[Deal "W:AKQJT.98.765.432 98765.A.KQJ.AKQ 432.KQJT.AT9.JT9 .76543.832.8765"]
[Auction "W"]
1S
`
      const deals = parsePbn(pbn)
      const hands = deals[0].hands

      // First hand in string is West
      expect(hands.W.spades).toEqual(['A', 'K', 'Q', 'J', 'T'])
      expect(hands.N.spades).toEqual(['9', '8', '7', '6', '5'])
    })

    it('should skip header lines starting with %', () => {
      const pbn = `
% PBN 2.1
% EXPORT
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
Pass
`
      const deals = parsePbn(pbn)
      expect(deals).toHaveLength(1)
    })

    it('should parse commentary blocks', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
{This is a commentary block}
[Auction "N"]
Pass
`
      const deals = parsePbn(pbn)
      expect(deals[0].commentary).toContain('commentary block')
    })

    it('should replace suit escape sequences in commentary', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
{Bid 1\\S with 5 spades}
[Auction "N"]
Pass
`
      const deals = parsePbn(pbn)
      expect(deals[0].commentary).toContain('♠')
    })

    it('should parse Student tag', () => {
      const pbn = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Student "S"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Auction "N"]
Pass
`
      const deals = parsePbn(pbn)
      expect(deals[0].studentSeat).toBe('S')
    })
  })

  describe('getSeatOrder', () => {
    it('should return correct order starting from North', () => {
      expect(getSeatOrder('N')).toEqual(['N', 'E', 'S', 'W'])
    })

    it('should return correct order starting from East', () => {
      expect(getSeatOrder('E')).toEqual(['E', 'S', 'W', 'N'])
    })

    it('should return correct order starting from South', () => {
      expect(getSeatOrder('S')).toEqual(['S', 'W', 'N', 'E'])
    })

    it('should return correct order starting from West', () => {
      expect(getSeatOrder('W')).toEqual(['W', 'N', 'E', 'S'])
    })
  })

  describe('getSeatForBid', () => {
    it('should return correct seat for each bid index', () => {
      // Starting from North
      expect(getSeatForBid(0, 'N')).toBe('N')
      expect(getSeatForBid(1, 'N')).toBe('E')
      expect(getSeatForBid(2, 'N')).toBe('S')
      expect(getSeatForBid(3, 'N')).toBe('W')
      expect(getSeatForBid(4, 'N')).toBe('N') // wraps around
    })

    it('should handle different dealers', () => {
      expect(getSeatForBid(0, 'E')).toBe('E')
      expect(getSeatForBid(1, 'E')).toBe('S')
      expect(getSeatForBid(2, 'E')).toBe('W')
      expect(getSeatForBid(3, 'E')).toBe('N')
    })
  })

  describe('getDealTitle', () => {
    it('should extract title from commentary', () => {
      const deal = {
        boardNumber: 1,
        commentary: 'Stayman 1\n\nSome other text'
      }
      expect(getDealTitle(deal)).toBe('Stayman 1')
    })

    it('should handle multi-word titles', () => {
      const deal = {
        boardNumber: 1,
        commentary: 'Cue-bid 5\n\nSome other text'
      }
      expect(getDealTitle(deal)).toBe('Cue-bid 5')
    })

    it('should return Board number when no title pattern', () => {
      const deal = {
        boardNumber: 5,
        commentary: 'Some commentary without a title line'
      }
      expect(getDealTitle(deal)).toBe('Board 5')
    })

    it('should return Board number for empty commentary', () => {
      const deal = {
        boardNumber: 3,
        commentary: ''
      }
      expect(getDealTitle(deal)).toBe('Board 3')
    })
  })

  describe('parsePrompts', () => {
    it('should return empty array for empty input', () => {
      expect(parsePrompts([])).toEqual([])
    })

    it('should parse BID markers', () => {
      const commentary = [
        'Title Line\n\nSome prompt text [BID 1\\S] This is the explanation.'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts).toHaveLength(1)
      expect(prompts[0].bid).toBe('1♠')
      expect(prompts[0].explanationText).toContain('explanation')
    })

    it('should parse multiple BID markers', () => {
      const commentary = [
        'Title\n\nFirst prompt [BID 1\\H] First explanation [BID 2\\H] Second explanation'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts).toHaveLength(2)
      expect(prompts[0].bid).toBe('1♥')
      expect(prompts[1].bid).toBe('2♥')
    })

    it('should replace suit symbols in prompts', () => {
      const commentary = [
        'Title\n\nBid 1\\S with 5 spades [BID 1\\S] Shows \\S suit'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts[0].text).toContain('♠')
      expect(prompts[0].explanationText).toContain('♠')
    })

    it('extracts [ACCEPT] calls from the explanation and strips the marker', () => {
      const commentary = [
        'Title\n\nClose choice [BID 3N] Either game is sound. [ACCEPT 4S]'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts[0].acceptedBids).toEqual(['4S'])
      // Marker must not leak into displayed text
      expect(prompts[0].explanationText).not.toContain('ACCEPT')
      expect(prompts[0].explanationText).not.toContain('[')
    })

    it('accepts multiple calls in one [ACCEPT] tag', () => {
      const commentary = [
        'Title\n\nMiddling hand [BID 2N] A raise or a sign-off both work. [ACCEPT 3N Pass]'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts[0].acceptedBids).toEqual(['3N', 'Pass'])
    })

    it('extracts [ACCEPT] from the prompt side of the bid too', () => {
      const commentary = [
        'Title\n\nClose call [ACCEPT 4S] [BID 3N] Either game is sound.'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts[0].acceptedBids).toEqual(['4S'])
      expect(prompts[0].text).not.toContain('ACCEPT')
    })

    it('leaves acceptedBids empty for bids without [ACCEPT] (non-disruption)', () => {
      const commentary = [
        'Title\n\nOnly one call [BID 1\\H] Standard opening.'
      ]
      const prompts = parsePrompts(commentary)

      expect(prompts[0].acceptedBids).toEqual([])
    })

    // Real regenerated content (coaching-non-rotated/Basic_Major.pbn board 3):
    // [ACCEPT Pass] sits inside the ⟦⟧ fade brackets on the student's own 5D call.
    it('parses [ACCEPT] from a real folded coaching board', () => {
      const pbn = `
[Event "Basic_Major"]
[Board "3"]
[Dealer "S"]
[Vulnerable "NS"]
[Deal "N:KQ4.84.JT865.K54 AJT2.9.72.AJT932 97.AKJ76.AKQ3.87 8653.QT532.94.Q6"]
[Student "S"]
[Auction "S"]
1H    Pass  1N    2C
2D    Pass  3D    Pass
5D    Pass  Pass  Pass
{[show S]A judgment hand.
[BID 1H] ⟦You open 1\\H.⟧ Partner responds 1NT.
[BID 2D] ⟦You bid 2\\D.⟧ Partner raises to 3\\D.
[BID 5D] ⟦You stretch to 5\\D, a pushy call; passing 3\\D was steadier. [ACCEPT Pass]⟧
[show NS]5\\D is a level too high.}
`
      const deal = parsePbn(pbn)[0]
      const bidSteps = deal.steps.filter(s => s.type === 'bid')
      const byBid = Object.fromEntries(bidSteps.map(s => [s.bid, s]))

      // Only the 5D judgment call carries the accept; the textbook calls don't.
      expect(byBid['5D'].acceptedBids).toEqual(['Pass'])
      expect(byBid['1H'].acceptedBids).toEqual([])
      expect(byBid['2D'].acceptedBids).toEqual([])
      // Marker is stripped from what the student reads.
      expect(byBid['5D'].text + byBid['5D'].explanationText).not.toContain('ACCEPT')
    })
  })
})
