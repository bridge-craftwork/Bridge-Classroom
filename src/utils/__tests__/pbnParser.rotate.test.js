import { describe, it, expect } from 'vitest'
import { parsePbn, isRotateStep, turnSeat, turnSeatKeys } from '../pbnParser.js'

// Baker Bridge two-phase lesson, trimmed from 100Deals board 51. The student holds the
// 19-count and raises partner's weak two to game; the table then turns and they play
// partner's hand as declarer. The generator emits [Deal]/[Auction]/[Declarer] already
// turned, while [Student] and [PLAY] stay in the bidding frame — see #400.
const ROTATE_BOARD = `
[Board "51"]
[Dealer "S"]
[Vulnerable "None"]
[Deal "W:QJT6.8.KJ94.JT85 AK43.A52.A762.K4 875.974.QT5.AQ73 92.KQJT63.83.962"]
[Declarer "S"]
[Contract "4H"]
[Auction "S"]
2H pass 4H pass pass pass
[Student "S"]
{[show S]

You are South and it is your bid. [BID 4\\H]

[show NS]

Even though you have 19 points partner has only 6-11.

North would play 4\\H.

Click [ROTATE]

[PLAY N:S9,N:S2,N:HK,S:SA,S:SK,S:S4]

South plays 4\\H. West leads the \\SQ. [NEXT]

[show NESW]

You can see that playing a \\C from dummy will guarantee the contract.}
`

// Same lesson shape, but with the opponents bidding — this is what proves the two
// frames differ by a 180° turn and not a partner swap. Trimmed from 100NT board 70.
const ROTATE_BOARD_COMPETITIVE = `
[Board "70"]
[Dealer "E"]
[Vulnerable "None"]
[Deal "W:T874.J9.8543.KQT K63.742.QT9.8542 Q95.KQ863.K62.A3 AJ2.AT5.AJ7.J976"]
[Declarer "S"]
[Contract "1NT"]
[Auction "E"]
1H 1NT pass pass pass
[Student "S"]
{[show S]

The bidding has gone as shown. [BID pass]

[show NS]

With no reason to think you could improve the contract you just pass. [NEXT]

The contract would be 1NT played by North.

To make South the declarer click ROTATE. [ROTATE]

[PLAY N:SA,N:SJ,S:SK,S:S6]

South plays 1NT. [NEXT]

[show NESW]

Done.}
`

// A board with no [ROTATE] must come through completely untouched.
const PLAIN_BOARD = `
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Declarer "N"]
[Contract "2S"]
[Auction "N"]
1S Pass 2S Pass Pass Pass
[Student "S"]
{[show S]

Your bid. [BID 2S]

Nice raise. [NEXT]

Done.}
`

const spades = (hand) => (hand?.spades || []).join('')
const hearts = (hand) => (hand?.hearts || []).join('')

describe('[ROTATE] two-phase boards', () => {
  describe('seat helpers', () => {
    it('turns a seat to the one opposite', () => {
      expect(turnSeat('N')).toBe('S')
      expect(turnSeat('S')).toBe('N')
      expect(turnSeat('E')).toBe('W')
      expect(turnSeat('W')).toBe('E')
    })

    it('passes unknown or blank seats through', () => {
      expect(turnSeat('')).toBe('')
      expect(turnSeat(undefined)).toBe(undefined)
    })

    it('re-keys a seat map and is its own inverse', () => {
      const map = { N: 1, E: 2, S: 3, W: 4 }
      expect(turnSeatKeys(map)).toEqual({ S: 1, W: 2, N: 3, E: 4 })
      expect(turnSeatKeys(turnSeatKeys(map))).toEqual(map)
    })
  })

  describe('recognising the turn point', () => {
    it('records a [ROTATE] that follows a [BID] explanation, which leaves it no text', () => {
      const [deal] = parsePbn(ROTATE_BOARD)
      // The explanation before [ROTATE] is consumed into the bid step, so the tag has
      // no text of its own and used to be dropped outright.
      expect(deal.steps.filter(isRotateStep)).toHaveLength(1)
      expect(deal.steps[0].type).toBe('bid')
      expect(deal.steps[0].rotateAfter).toBe(true)
    })

    it('records a [ROTATE] that has text of its own as a step of its own', () => {
      const [deal] = parsePbn(ROTATE_BOARD_COMPETITIVE)
      const turns = deal.steps.filter(isRotateStep)
      expect(turns).toHaveLength(1)
      expect(turns[0].type).toBe('rotate')
      expect(turns[0].text).toContain('1NT played by North')
    })

    it('finds no turn point on an ordinary board', () => {
      const [deal] = parsePbn(PLAIN_BOARD)
      expect(deal.steps.some(isRotateStep)).toBe(false)
    })
  })

  describe('normalising into the [Student] frame', () => {
    it('puts the hand the bidding phase narrates at the student seat', () => {
      const [deal] = parsePbn(ROTATE_BOARD)
      expect(deal.frameNormalized).toBe(true)
      // [Deal] dealt the 19-count to North; [Student] says South, and the prompt says
      // "you have 19 points". After normalising, South holds it.
      expect(spades(deal.hands.S)).toBe('AK43')
      expect(hearts(deal.hands.N)).toBe('KQJT63')
    })

    it('turns every seat, so the auction still runs in its recorded order', () => {
      const [deal] = parsePbn(ROTATE_BOARD_COMPETITIVE)
      expect(deal.dealer).toBe('W')
      expect(deal.auctionDealer).toBe('W')
      // W opens 1H, partner N overcalls 1NT, E passes, the student passes. Under a
      // partner-only swap the order would be W→S→E→N and partner could not overcall
      // second in hand.
      expect(deal.auction).toEqual(['1H', '1NT', 'Pass', 'Pass', 'Pass'])
      expect(hearts(deal.hands.W)).toBe('KQ863')   // the 1H opener keeps five hearts
      expect(spades(deal.hands.N)).toBe('AJ2')     // partner holds the 1NT overcall
    })

    it('leaves the [BID] target binding at the student seat', () => {
      const [deal] = parsePbn(ROTATE_BOARD)
      // dealer N: N=2H, E=Pass, S=4H — the call the [BID 4H] prompt asks for.
      expect(deal.dealer).toBe('N')
      expect(deal.auction[2]).toBe('4H')
      expect(deal.studentSeat).toBe('S')
    })

    it('turns the declarer with the rest of the table', () => {
      const [deal] = parsePbn(ROTATE_BOARD)
      // Partner declares during the bidding phase — "North would play 4H".
      expect(deal.declarer).toBe('N')
    })

    it('keeps the raw [Deal] tag as-is for reporting', () => {
      const [deal] = parsePbn(ROTATE_BOARD)
      expect(deal.dealString).toContain('W:QJT6.8.KJ94.JT85')
    })

    it('leaves a board without a [ROTATE] untouched', () => {
      const [deal] = parsePbn(PLAIN_BOARD)
      expect(deal.frameNormalized).toBe(false)
      expect(deal.dealer).toBe('N')
      expect(deal.declarer).toBe('N')
      expect(spades(deal.hands.N)).toBe('AKQ')
    })

    it('does not turn a board that is already in its [Student] frame', () => {
      // Same board with the deal and auction as they would be once the generator
      // stops turning them: the [BID] target already binds at South.
      const alreadyStraight = ROTATE_BOARD
        .replace('[Dealer "S"]', '[Dealer "N"]')
        .replace('[Auction "S"]', '[Auction "N"]')
        .replace(
          '[Deal "W:QJT6.8.KJ94.JT85 AK43.A52.A762.K4 875.974.QT5.AQ73 92.KQJT63.83.962"]',
          '[Deal "W:875.974.QT5.AQ73 92.KQJT63.83.962 QJT6.8.KJ94.JT85 AK43.A52.A762.K4"]'
        )
      const [deal] = parsePbn(alreadyStraight)
      expect(deal.frameNormalized).toBe(false)
      expect(spades(deal.hands.S)).toBe('AK43')
    })
  })
})
