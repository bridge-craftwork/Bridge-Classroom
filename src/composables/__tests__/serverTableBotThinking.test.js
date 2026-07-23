import { describe, it, expect, beforeEach } from 'vitest'
import { useRemoteTable } from '../useRemoteTable.js'
import { useServerEngine } from '../engines/serverEngine.js'

// Regression (2026-07-14 host-table report): you are declarer in 3NT and dummy
// (North) is a BOT-occupied seat on lead. The human declarer plays dummy's card —
// it is NOT a bot's move — so the centre trick area must not show "Bot thinking…"
// (which read as a stuck hand: a bot that never plays). botThinking must yield to
// clickableSeat, which already routes dummy to the human declarer.

const declarerHumanBotDummy = {
  yourSeat: 'S',
  role: 'player',
  seeAll: false,
  board: { number: 7, dealer: 'S', vulnerable: 'None' },
  phase: 'play',
  auction: ['1N', 'Pass', '3N', 'Pass', 'Pass', 'Pass'],
  contract: { text: '3NT', declarer: 'S' },
  nextToAct: 'N', // dummy on lead → the human declarer (S) plays dummy's card
  hands: {
    S: { spades: ['K', '4'], hearts: ['Q', '4'], diamonds: ['A', 'K', '7', '3'], clubs: ['Q', 'T', '7', '5', '4'] },
    N: { spades: ['A', 'Q', '6', '2'], hearts: ['T', '7', '6'], diamonds: ['9', '2'], clubs: ['A', '8', '6', '3'] },
    E: null,
    W: null,
  },
  handCounts: { N: 12, E: 13, S: 13, W: 12 },
  currentTrick: { leader: 'W', plays: [{ seat: 'W', suit: 'H', rank: '8' }] },
  tricksTaken: { NS: 0, EW: 0 },
  seats: {
    N: { kind: 'bot' }, // dummy is a bot occupant …
    E: { kind: 'bot' },
    S: { kind: 'human', name: 'Rick Wilson', connected: true }, // … but YOU declare
    W: { kind: 'bot' },
  },
}

describe('serverEngine botThinking (human plays dummy)', () => {
  let srv, table
  beforeEach(() => {
    table = useRemoteTable()
    srv = useServerEngine()
    table._resetTableState()
  })

  it('is FALSE when a human declarer must play a bot-occupied dummy', () => {
    table.loadFixture(declarerHumanBotDummy)
    expect(srv.dummySeat.value).toBe('N')
    expect(srv.clickableSeat.value).toBe('N') // you play dummy
    expect(srv.botThinking.value).toBe(false) // ← the fix: not a bot's move
  })

  it('is TRUE when a bot opponent is genuinely on turn', () => {
    table.loadFixture({ ...declarerHumanBotDummy, nextToAct: 'E' })
    expect(srv.clickableSeat.value).toBeNull() // not your turn
    expect(srv.botThinking.value).toBe(true)
  })
})
