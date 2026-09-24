import { describe, it, expect, beforeEach } from 'vitest'
import { useDealPractice } from '../useDealPractice.js'
import { parsePbn } from '../../utils/pbnParser.js'

// A [choose-card] is answered from whichever hand holds the expected card. For a
// declarer (student South) that can be dummy: the answer card names the hand.
// Holdup board 2: North A76.A8653.K5.AK5, South 82.K4.QJT73.9843, East 943.Q972.A84.QT2.
const board = (student, body) => `
[Event "Test"]
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "W:KQJT5.JT.962.J76 A76.A8653.K5.AK5 943.Q972.A84.QT2 82.K4.QJT73.9843"]
[Declarer "S"]
[Contract "3NT"]
[Student "${student}"]
[Auction "N"]
1H Pass 1NT Pass 3NT Pass Pass Pass
{${body}}
`

const DUMMY_CHOICE = board('S', '[show NS] [showcards W:SK] Dummy to play. [choose-card any:S7,S6] Duck. [NEXT] Done.')
const HAND_CHOICE = board('S', '[show NS] [showcards W:D2 N:D5 E:D4] Your play. [choose-card DQ] Win it. [NEXT] Done.')
const DEFENSE_CHOICE = board('E', '[show NE] [showcards W:SK N:S6] Your play. [choose-card S3] Low. [NEXT] Done.')

describe('useDealPractice — [choose-card] plays from the hand holding the card', () => {
  let dp
  beforeEach(() => {
    dp = useDealPractice()
  })

  it('makes dummy clickable when the expected card is in dummy', () => {
    dp.loadDeal(parsePbn(DUMMY_CHOICE)[0])
    expect(dp.cardChoiceSeat.value).toBe('N')
  })

  it('puts a chosen dummy card on the table as dummy\'s', () => {
    dp.loadDeal(parsePbn(DUMMY_CHOICE)[0])
    expect(dp.makeCardChoice('S', '6')).toBe(true)
    expect(dp.showcardsPlayedCards.value.N).toEqual(['S6'])
    expect(dp.showcardsPlayedCards.value.S).toBeUndefined()
    expect(dp.cardChoiceSeat.value).toBeNull()
  })

  it('makes declarer\'s own hand clickable when the expected card is there', () => {
    dp.loadDeal(parsePbn(HAND_CHOICE)[0])
    expect(dp.cardChoiceSeat.value).toBe('S')
    expect(dp.makeCardChoice('D', 'Q')).toBe(true)
    expect(dp.showcardsPlayedCards.value.S).toEqual(['DQ'])
  })

  it('leaves defense choices on the student\'s own hand (non-disruption)', () => {
    dp.loadDeal(parsePbn(DEFENSE_CHOICE)[0])
    expect(dp.cardChoiceSeat.value).toBe('E')
    expect(dp.makeCardChoice('S', '3')).toBe(true)
    expect(dp.showcardsPlayedCards.value.E).toEqual(['S3'])
  })
})
