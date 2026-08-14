import { describe, it, expect, beforeEach } from 'vitest'
import { useDealPractice } from '../useDealPractice.js'
import { parsePbn } from '../../utils/pbnParser.js'

// Baker Bridge two-phase board (100Deals 51, trimmed): the student raises partner's
// weak two to game, then the table turns and they play partner's hand as declarer.
// The [PLAY] cards below are partner's — they are authored in the bidding frame, where
// partner sits North. See #400.
const ROTATE_PBN = `
[Event "Test"]
[Board "51"]
[Dealer "S"]
[Vulnerable "None"]
[Deal "W:QJT6.8.KJ94.JT85 AK43.A52.A762.K4 875.974.QT5.AQ73 92.KQJT63.83.962"]
[Declarer "S"]
[Contract "4H"]
[Student "S"]
[Auction "S"]
2H pass 4H pass pass pass
{[show S]

You are South and it is your bid. [BID 4\\H]

[show NS]

Even though you have 19 points partner has only 6-11.

North would play 4\\H.

Click [ROTATE]

[PLAY N:S9,N:S2,N:HK]

South plays 4\\H. West leads the \\SQ. [NEXT]

[show NESW]

Playing a club from dummy guarantees the contract.}
`

const spades = (hand) => (hand?.spades || []).join('')
const hearts = (hand) => (hand?.hearts || []).join('')

describe('useDealPractice — [ROTATE] table turn', () => {
  let dp
  beforeEach(() => {
    dp = useDealPractice()
    dp.loadDeal(parsePbn(ROTATE_PBN)[0])
  })

  it('starts in the bidding frame, with the student holding the hand the prompt describes', () => {
    expect(dp.frameTurned.value).toBe(false)
    expect(spades(dp.hands.value.S)).toBe('AK43')   // the 19-count the prompt narrates
    expect(hearts(dp.hands.value.N)).toBe('KQJT63') // partner's weak two
  })

  it('prompts the student for the call the [BID] tag asks for', () => {
    expect(dp.hasBidPrompt.value).toBe(true)
    expect(dp.currentTurnSeat.value).toBe('S')
    expect(dp.makeBid('4H')).toBe(true)
  })

  it('does not turn the table until the reader advances past the rotate step', () => {
    dp.makeBid('4H')
    expect(dp.frameTurned.value).toBe(false)
    expect(spades(dp.hands.value.S)).toBe('AK43')
  })

  it('turns the table on advancing past the rotate step, bringing declarer to South', () => {
    dp.makeBid('4H')
    dp.advance()

    expect(dp.frameTurned.value).toBe(true)
    // The student now sits in partner's chair — and that chair is South, which is what
    // makes the authored "South plays 4H" read true.
    expect(hearts(dp.hands.value.S)).toBe('KQJT63')
    expect(spades(dp.hands.value.N)).toBe('AK43')
    expect(dp.displayDeclarer.value).toBe('S')
    expect(dp.displayDealer.value).toBe('S')
  })

  it('turns the opponents too, so West still holds the hand that leads', () => {
    dp.makeBid('4H')
    dp.advance()
    // West leads the SQ in the play phase; the QJT6 holding must be at West there.
    expect(spades(dp.hands.value.W)).toBe('QJT6')
  })

  it('moves the [PLAY] cards with the hand they belong to', () => {
    dp.makeBid('4H')
    dp.advance()
    // [PLAY N:S9,N:S2,N:HK] names partner's cards in the bidding frame; after the turn
    // that hand is drawn at South, so the struck cards have to follow it.
    expect(dp.struckCards.value.S).toEqual(['S9', 'S2', 'HK'])
    expect(dp.struckCards.value.N).toBeUndefined()
  })

  it('turns back when the reader steps back over the rotate', () => {
    dp.makeBid('4H')
    dp.advance()
    expect(dp.frameTurned.value).toBe(true)

    dp.goBack()
    expect(dp.frameTurned.value).toBe(false)
    expect(spades(dp.hands.value.S)).toBe('AK43')
  })

  it('keeps the underlying deal in the bidding frame, even once the table has turned', () => {
    dp.makeBid('4H')
    dp.advance()

    // The turn is a presentation change only. Observations key off studentSeat and the
    // deal's own hands (observationSchema: hands[studentSeat]), so those must still be
    // the seat and the hand the student actually bid from.
    expect(dp.studentSeat.value).toBe('S')
    expect(spades(dp.currentDeal.value.hands.S)).toBe('AK43')
    expect(dp.currentDeal.value.declarer).toBe('N')
  })
})
