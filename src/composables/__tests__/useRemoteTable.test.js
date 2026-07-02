import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRemoteTable, toServerCall } from '../useRemoteTable.js'

// Feed server frames straight into the message handler — no live socket.
// (The socket layer's resync() no-ops when never connected.)

function snapshotMsg(overrides = {}) {
  return {
    t: 'snapshot',
    table_id: 'demo',
    state: {
      seq: 0,
      board: { number: 1, dealer: 'S', vulnerable: 'None' },
      phase: 'bidding',
      auction: [],
      contract: null,
      next_to_act: 'S',
      current_trick: null,
      tricks: { ns: 0, ew: 0 },
      hands: {
        N: { visible: false, count: 13 },
        E: { visible: false, count: 13 },
        S: {
          visible: true,
          cards: [
            'SA', 'SK', 'SQ', 'S8', 'S5', 'S4',
            'HA', 'HK', 'DK', 'DQ', 'DJ', 'C8', 'C6',
          ],
        },
        W: { visible: false, count: 13 },
      },
      your_seat: 'S',
      legal: { seat: 'S', kind: 'call' },
      ...overrides,
    },
  }
}

describe('useRemoteTable', () => {
  let table

  beforeEach(() => {
    table = useRemoteTable()
    table._resetTableState()
  })

  it('applies a welcome + snapshot into the presentation shape', () => {
    table._handleMessage({ t: 'welcome', table_id: 'demo', name: 'Alice', role: 'guest', seat: 'S' })
    table._handleMessage(snapshotMsg())

    expect(table.yourSeat.value).toBe('S')
    expect(table.dealer.value).toBe('S')
    expect(table.phase.value).toBe('bidding')
    expect(table.hands.value.S.spades).toEqual(['A', 'K', 'Q', '8', '5', '4'])
    expect(table.hands.value.N).toBeNull()
    expect(table.hiddenSeats.value).toEqual(['N', 'E', 'W'])
    expect(table.handCounts.value.N).toBe(13)
    expect(table.isYourBid.value).toBe(true)
    // Own seat chip seeded from welcome (the server broadcasts the join's
    // seat_update before this connection subscribes, so we'd never see it).
    expect(table.seats.value.S).toEqual({ kind: 'human', name: 'Alice', connected: true })
  })

  it('folds bid_made events and derives the contract at auction end', () => {
    table._handleMessage({ t: 'welcome', seat: 'S', name: 'A', role: 'guest', table_id: 'demo' })
    table._handleMessage(snapshotMsg())

    const bids = ['1S', 'Pass', '4S', 'Pass', 'Pass', 'Pass']
    const nexts = ['W', 'N', 'E', 'S', 'W', null]
    bids.forEach((call, i) => {
      table._handleMessage({
        t: 'event', kind: 'bid_made', seq: i + 1, call,
        seat: 'SWNE'[i % 4], next_to_act: nexts[i],
      })
    })

    expect(table.auction.value).toEqual(bids)
    expect(table.phase.value).toBe('play')
    expect(table.contract.value).toEqual({ text: '4S', declarer: 'S' })
    expect(table.dummySeat.value).toBe('N')
    expect(table.seq.value).toBe(6)
  })

  it('derives declarer from first-to-name-strain, with doubles', () => {
    table._handleMessage(snapshotMsg({ board: { number: 1, dealer: 'N', vulnerable: 'NS' } }))
    // N opens 1H, S raises — N declares even though S bid hearts last. E doubles.
    const calls = ['1H', 'Pass', '2H', 'X', 'Pass', 'Pass', 'Pass']
    calls.forEach((call, i) => {
      table._handleMessage({ t: 'event', kind: 'bid_made', seq: i + 1, call, next_to_act: null })
    })
    expect(table.contract.value).toEqual({ text: '2HX', declarer: 'N' })
  })

  it('treats a passed-out auction as complete with no contract', () => {
    table._handleMessage(snapshotMsg())
    for (let i = 1; i <= 4; i++) {
      table._handleMessage({ t: 'event', kind: 'bid_made', seq: i, call: 'Pass', next_to_act: null })
    }
    expect(table.phase.value).toBe('complete')
    expect(table.contract.value).toBeNull()
  })

  it('tracks card_played: trick assembly, hand removal, winner and counts', () => {
    vi.useFakeTimers()
    table._handleMessage({ t: 'welcome', seat: 'S', name: 'A', role: 'guest', table_id: 'demo' })
    table._handleMessage(snapshotMsg({
      seq: 6,
      phase: 'play',
      auction: ['1S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
      contract: { text: '4S', declarer: 'S' },
      next_to_act: 'W',
    }))

    table._handleMessage({
      t: 'event', kind: 'card_played', seq: 7, seat: 'W', card: 'H4',
      next_to_act: 'N', trick_winner: null, tricks: { ns: 0, ew: 0 },
    })
    expect(table.currentTrick.leader).toBe('W')
    expect(table.currentTrick.plays).toEqual([{ seat: 'W', suit: 'H', rank: '4' }])
    expect(table.handCounts.value.W).toBe(12)

    for (const [seq, seat, card, winner] of [
      [8, 'N', 'HQ', null],
      [9, 'E', 'H3', null],
      [10, 'S', 'HA', 'S'],
    ]) {
      table._handleMessage({
        t: 'event', kind: 'card_played', seq, seat, card,
        next_to_act: winner ? 'S' : null,
        trick_winner: winner,
        tricks: winner ? { ns: 1, ew: 0 } : { ns: 0, ew: 0 },
      })
    }

    // Our own (visible) hand loses the played card.
    expect(table.hands.value.S.hearts).toEqual(['K'])
    // Completed trick lingers for the UI, then clears.
    expect(table.lastFinishedTrick.value.winner).toBe('S')
    expect(table.currentTrick.plays).toEqual([])
    expect(table.currentTrick.leader).toBe('S')
    expect(table.tricksTaken.value).toEqual({ NS: 1, EW: 0 })
    vi.advanceTimersByTime(1500)
    expect(table.lastFinishedTrick.value).toBeNull()
    vi.useRealTimers()
  })

  it('exposes clickableSeat for own turn and for dummy when declaring', () => {
    table._handleMessage({ t: 'welcome', seat: 'S', name: 'A', role: 'guest', table_id: 'demo' })
    table._handleMessage(snapshotMsg({
      seq: 7,
      phase: 'play',
      auction: ['1S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
      contract: { text: '4S', declarer: 'S' },
      next_to_act: 'N',
      current_trick: { leader: 'W', plays: [{ seat: 'W', card: 'H4' }] },
      hands: {
        N: { visible: true, cards: ['HQ', 'H5', 'SJ', 'DA'] },
        E: { visible: false, count: 13 },
        S: { visible: true, cards: ['HA', 'HK', 'SA'] },
        W: { visible: false, count: 12 },
      },
    }))

    // S declares, N (dummy) is on turn → S may click dummy's cards.
    expect(table.clickableSeat.value).toBe('N')
    // Legal hint: dummy must follow hearts.
    expect(table.legalCards.value).toEqual([
      { suit: 'H', rank: 'Q' },
      { suit: 'H', rank: '5' },
    ])
    const res = table.sendCard('N', 'S', 'J')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('illegal play')
  })

  it('ignores stale events after a snapshot already covers them', () => {
    table._handleMessage(snapshotMsg({ seq: 5, auction: ['1S'], next_to_act: 'W' }))
    table._handleMessage({ t: 'event', kind: 'bid_made', seq: 3, call: '7NT', next_to_act: 'N' })
    expect(table.auction.value).toEqual(['1S'])
    expect(table.seq.value).toBe(5)
  })

  it('captures bot_mode from the welcome and clears it on reset', () => {
    table._handleMessage({
      t: 'welcome', table_id: 'demo', name: 'A', role: 'guest', seat: 'S', bot_mode: 'random',
    })
    expect(table.botMode.value).toBe('random')
    table._resetTableState()
    expect(table.botMode.value).toBe('')
    // A welcome without bot_mode leaves it cleared.
    table._handleMessage({ t: 'welcome', table_id: 'demo', name: 'A', role: 'guest', seat: 'S' })
    expect(table.botMode.value).toBe('')
  })

  it('normalizes BiddingBox NT calls to the wire format', () => {
    // BiddingBox emits '1NT'; the protocol (like PBN) uses '1N'.
    expect(toServerCall('3NT')).toBe('3N')
    expect(toServerCall('1NT')).toBe('1N')
    expect(toServerCall('1H')).toBe('1H')
    expect(toServerCall('Pass')).toBe('Pass')
    expect(toServerCall('X')).toBe('X')
    expect(toServerCall('XX')).toBe('XX')
  })

  it('surfaces error frames and undo attribution as transient messages', () => {
    vi.useFakeTimers()
    table._handleMessage({ t: 'error', code: 'rejected', msg: 'not your turn' })
    expect(table.errorMessage.value).toBe('not your turn')
    table._handleMessage({ t: 'event', kind: 'undo', seq: 4, by: 'Alice' })
    expect(table.undoBy.value).toBe('Alice')
    vi.advanceTimersByTime(6000)
    expect(table.errorMessage.value).toBe('')
    expect(table.undoBy.value).toBe('')
    vi.useRealTimers()
  })
})
