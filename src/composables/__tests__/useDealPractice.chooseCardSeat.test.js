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

// A hold-up walked trick by trick: dummy ducks twice (either small spade), then wins.
// Each trick is gathered by the next step's [PLAY], which names every card but the
// student's — only the app knows which small spade was chosen.
const HOLDUP = board('S', [
  '[show NS] [showcards W:SK] Trick 1. [choose-card any:S7,S6]',
  '[showcards E:S3 S:S2] Plan. [NEXT]',
  '[PLAY W:SK,E:S3,S:S2] [showcards W:SQ] Trick 2. [choose-card any:S7,S6]',
  '[PLAY W:SQ,E:S4,S:S8] [showcards W:SJ] Trick 3. [choose-card SA]',
  '[PLAY W:SJ,E:S9,S:C3] Done. [NEXT] End.',
].join(' '))

describe('useDealPractice — multi-trick [choose-card] boards', () => {
  let dp
  const choose = (code) => dp.makeCardChoice(code[0], code.slice(1))
  const table = () => ({ ...dp.showcardsPlayedCards.value, ...(dp.currentShowcards.value || {}) })
  beforeEach(() => {
    dp = useDealPractice()
    dp.loadDeal(parsePbn(HOLDUP)[0])
  })

  it('gathers a trick off the table and strikes the chosen card with it', () => {
    choose('S6')
    expect(table()).toEqual({ N: ['S6'], E: ['S3'], S: ['S2'], W: ['SK'] })
    dp.advance()
    expect(table()).toEqual({ W: ['SQ'] })
    expect(dp.struckCards.value.N).toEqual(['S6'])
  })

  it('lets an any: list repeat across tricks, with the used card struck', () => {
    choose('S6'); dp.advance()
    expect(choose('S7')).toBe(true)
    expect(choose('SA')).toBe(true)
    expect(dp.struckCards.value.N).toEqual(['S6', 'S7', 'SA'])
    expect(table()).toEqual({})
  })

  it('gathers a wrong choice as the expected card, so later tricks stay consistent', () => {
    expect(choose('SA')).toBe(false)
    expect(table().N).toEqual(['SA'])
    dp.advance()
    expect(table()).toEqual({ W: ['SQ'] })
    expect(dp.struckCards.value.N).toEqual(['S7'])
  })

  it('shows a wrong card chosen again on a later trick', () => {
    dp.loadDeal(parsePbn(board('S', [
      '[show NS] [showcards W:SK] Trick 1. [choose-card any:S7,S6]',
      '[PLAY W:SK,E:S3,S:S2] [showcards W:SQ] Trick 2. [choose-card any:S7,S6]',
      '[showcards E:S4] Look. [NEXT] End.',
    ].join(' ')))[0])
    expect(choose('SA')).toBe(false)
    expect(choose('SA')).toBe(false)
    expect(table()).toEqual({ W: ['SQ'], N: ['SA'], E: ['S4'] })
  })

  it('gathers two wrong answers on an any: pair as two different cards', () => {
    expect(choose('SA')).toBe(false)
    dp.advance()
    expect(choose('SA')).toBe(false)
    expect(dp.struckCards.value.N).toEqual(['S7', 'S6'])
  })

  it('clears [PLAY] marks at [RESET]', () => {
    dp.loadDeal(parsePbn(board('S', [
      '[show NS] [PLAY W:SK,N:S6,E:S3,S:S2] Played. [NEXT]',
      '[RESET] [show NESW] Full deal. [NEXT] End.',
    ].join(' ')))[0])
    expect(dp.struckCards.value.N).toEqual(['S6'])
    dp.advance()
    expect(dp.struckCards.value).toEqual({})
  })

  it('keeps a shown hand whole when a later step puts one of its cards on the table', () => {
    dp.loadDeal(parsePbn(board('S', [
      '[show NS] Plan. [NEXT]',
      '[showcards W:SK N:S6 E:S3] Trick. [NEXT] End.',
    ].join(' ')))[0])
    dp.advance()
    expect(dp.hands.value.N.spades).toEqual(['A', '7', '6'])
    expect(dp.hands.value.N.hearts.length).toBe(5)
    expect(dp.showcardsPlayedCards.value.N).toEqual(['S6'])
    expect(dp.currentShowcards.value).toEqual({ W: ['SK'], E: ['S3'] })
  })

  it('un-plays a choice on Back', () => {
    choose('S6'); dp.advance()
    dp.goBack()
    dp.goBack()
    expect(dp.cardChoiceSeat.value).toBe('N')
    expect(table()).toEqual({ W: ['SK'] })
    expect(dp.struckCards.value.N).toBeUndefined()
  })
})
