import { describe, it, expect, beforeEach, vi } from 'vitest'

// A socket that records what the table sends and always "sends".
const sent = []
vi.mock('../useTableSocket.js', () => ({
  useTableSocket: () => ({
    send: (msg) => { sent.push(msg); return true },
    onMessage: () => () => {},
    connect: async () => {},
    disconnect: () => {},
    resync: () => {},
    status: { value: 'connected' },
    lastError: { value: null },
  }),
}))

const { useRemoteTable } = await import('../useRemoteTable.js')

// Board 1, 4S by South after West has led the ♥2 (the table service's snapshot
// shape: every hand visible, plus the original deal and the play record).
const DEAL = 'N:J732.Q5.A864.K42 T9.JT98763.95.A3 AKQ854.AK.KQJ.86 6.42.T732.QJT975'
function playSnapshot(overrides = {}) {
  return {
    t: 'snapshot',
    table_id: 't1',
    state: {
      seq: 5,
      board: { number: 1, dealer: 'S', vulnerable: 'None' },
      phase: 'play',
      auction: ['1S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'].slice(0, 4),
      contract: { text: '4S', declarer: 'S' },
      next_to_act: 'N',
      current_trick: { leader: 'W', plays: [{ seat: 'W', card: 'H4' }] },
      tricks: { ns: 0, ew: 0 },
      deal: DEAL,
      plays: ['H4'],
      claim: null,
      hands: {
        N: { visible: true, cards: ['SJ', 'S7', 'S3', 'S2', 'HQ', 'H5', 'DA', 'D8', 'D6', 'D4', 'CK', 'C4', 'C2'] },
        E: { visible: true, cards: ['ST', 'S9', 'HJ', 'HT', 'H9', 'H8', 'H7', 'H6', 'H3', 'D9', 'D5', 'CA', 'C3'] },
        S: { visible: true, cards: ['SA', 'SK', 'SQ', 'S8', 'S5', 'S4', 'HA', 'HK', 'DK', 'DQ', 'DJ', 'C8', 'C6'] },
        W: { visible: true, cards: ['S6', 'H2', 'DT', 'D7', 'D3', 'D2', 'CQ', 'CJ', 'CT', 'C9', 'C7', 'C5'] },
      },
      your_seats: ['S'],
      ...overrides,
    },
  }
}

describe('useRemoteTable — claims', () => {
  let table
  beforeEach(() => {
    sent.length = 0
    table = useRemoteTable()
    table._resetTableState()
    table._handleMessage({ t: 'welcome', name: 'Ann', role: 'student', seat: 'S', your_seats: ['S'] })
    table._handleMessage(playSnapshot())
  })

  it('builds the claim position from the snapshot, for the declarer', () => {
    const pos = table.claimPosition.value
    expect(pos.claimer).toBe('S')
    expect(pos.stamp).toBe(1)
    expect(pos.play).toMatchObject({ trump: 'S', declarer: 'S', leader: 'W', plays: ['H4'] })
    expect(pos.play.hands.S.spades).toEqual(['A', 'K', 'Q', '8', '5', '4'])
    expect(table.remainingTricks.value).toBe(13)
  })

  it('keeps the play record growing with card_played', () => {
    table._handleMessage({ t: 'event', table_id: 't1', kind: 'card_played', seq: 6, seat: 'N', card: 'H5', next_to_act: 'E', tricks: { ns: 0, ew: 0 } })
    expect(table.plays.value).toEqual(['H4', 'H5'])
    expect(table.claimPosition.value.stamp).toBe(2)
  })

  it('sends a claim with its stamp and resolves when the table applies it', async () => {
    const p = table.sendClaim(10, 1)
    expect(sent.at(-1)).toEqual({ t: 'claim', seat: 'S', tricks: 10, plays_seen: 1 })
    table._handleMessage({
      t: 'event', table_id: 't1', kind: 'claim', seq: 6,
      claim: { seat: 'S', tricks: 10, ruling: false, at_trick: 1, at_card: 1 },
      tricks: { ns: 10, ew: 3 },
    })
    await expect(p).resolves.toBeUndefined()
    expect(table.phase.value).toBe('complete')
    expect(table.claim.value.tricks).toBe(10)
    expect(table.tricksTaken.value).toEqual({ NS: 10, EW: 3 })
    expect(table.claimPosition.value).toBeNull()
  })

  it('rejects with the server’s reason, and keeps it out of the toast', async () => {
    const p = table.sendClaim(13, 1)
    table._handleMessage({ t: 'error', code: 'claim_stale', msg: 'the play moved on while the claim was checked' })
    await expect(p).rejects.toThrow(/moved on/)
    expect(table.errorMessage.value).toBe('')
  })

  it('a kibitzer has no claim position', () => {
    table._handleMessage(playSnapshot({ your_seats: [] }))
    table.yourSeats.value = []
    expect(table.claimPosition.value).toBeNull()
  })

  it('a teacher ruling shows in the board result', () => {
    table._handleMessage({
      t: 'event', table_id: 't1', kind: 'board_complete', seq: 6, board_no: 1,
      passed_out: false, contract: { text: '4S', declarer: 'S', declarer_tricks: 12, made: 2 },
      tricks: { ns: 12, ew: 1 }, claim: { seat: 'S', tricks: 12, ruling: true, at_trick: 1, at_card: 1 },
    })
    expect(table.boardComplete.value.claim.ruling).toBe(true)
  })
})
