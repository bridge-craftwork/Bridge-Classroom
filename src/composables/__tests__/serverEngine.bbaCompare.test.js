import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useRemoteTable } from '../useRemoteTable.js'
import { useServerEngine } from '../engines/serverEngine.js'
import { fetchAuction } from '../../utils/bbaClient.js'

vi.mock('../../utils/bbaClient.js', () => ({ fetchAuction: vi.fn() }))

// The BBA reference on a served table is only meaningful up to the auction's first
// divergence, at ANY seat. A partner's or a bot's off-line call has to re-anchor it,
// or the viewer's later calls get compared with a line the table has left.

const FULL = (suit) => ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].map((r) => suit + r)

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(nextTick)
}

describe('serverEngine BBA comparison', () => {
  let table, srv, scope, seq
  // South deals: index 0=S, 1=W, 2=N, 3=E, 4=S, ...
  const dealer = 'S'
  const seatAt = (i) => 'SWNE'[i % 4]

  // `reference(prefix)` plays BBA: the auction it bids from that prefix.
  function bba(reference) {
    fetchAuction.mockImplementation(async ({ auctionPrefix }) => ({
      auction: reference(auctionPrefix || []),
      meanings: [],
    }))
  }

  function snapshot(yourSeat, auction) {
    table._handleMessage({
      t: 'snapshot',
      table_id: 'demo',
      state: {
        seq,
        board: { number: 1, dealer, vulnerable: 'None' },
        phase: 'bidding',
        auction,
        contract: null,
        next_to_act: seatAt(auction.length),
        current_trick: null,
        tricks: { ns: 0, ew: 0 },
        hands: {
          N: { visible: true, cards: FULL('S') },
          E: { visible: true, cards: FULL('H') },
          S: { visible: true, cards: FULL('D') },
          W: { visible: true, cards: FULL('C') },
        },
        your_seat: yourSeat,
      },
    })
  }

  async function sit(yourSeat) {
    table._handleMessage({ t: 'welcome', seat: yourSeat, name: 'A', role: 'guest', table_id: 'demo' })
    snapshot(yourSeat, [])
    await flush()
  }

  async function call(...calls) {
    for (const c of calls) {
      const i = table.auction.value.length
      table._handleMessage({
        t: 'event', kind: 'bid_made', seq: ++seq, call: c,
        seat: seatAt(i), next_to_act: seatAt(i + 1),
      })
    }
    await flush()
  }

  const prefixes = () => fetchAuction.mock.calls.map(([o]) => o.auctionPrefix || null)

  beforeEach(() => {
    localStorage.clear()
    seq = 0
    fetchAuction.mockReset()
    table = useRemoteTable()
    table._resetTableState()
    scope = effectScope()
    srv = scope.run(() => useServerEngine())
  })
  afterEach(() => {
    scope.stop()
    table._resetTableState()
  })

  // BBA's line from scratch is 1NT Pass 2H Pass 2S; North calls 2C instead of 2H.
  const stayman = (p) => {
    if (p.includes('2H')) return [...p, 'Pass', 'Pass', 'Pass']
    if (p.includes('2C')) return [...p.slice(0, 3), 'Pass', '2D', 'Pass', 'Pass', 'Pass']
    return ['1NT', 'Pass', '2H', 'Pass', '2S', 'Pass', 'Pass', 'Pass']
  }

  it('re-anchors on a partner\'s divergence without marking it', async () => {
    bba(stayman)
    await sit('S')
    await call('1N', 'Pass', '2C', 'Pass')
    expect(prefixes()).toEqual([null, ['1N', 'Pass', '2C']])
    expect(srv.divergedBids.value).toEqual({})

    // Judged against BBA's bid over the actual 2C (2D), not its old line's 2S.
    await call('2H')
    expect(srv.divergedBids.value).toEqual({ 4: { user: '2H', bba: '2D' } })
  })

  it('tracks the same auction for the player who left the line', async () => {
    bba(stayman)
    await sit('N')
    await call('1N', 'Pass', '2C', 'Pass')
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2C', bba: '2H' } })

    // Partner's 2H re-anchors the reference, and your next call follows that.
    await call('2H', 'Pass', 'Pass')
    expect(prefixes().at(-1)).toEqual(['1N', 'Pass', '2C', 'Pass', '2H'])
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2C', bba: '2H' } })
  })

  it('does not compare your call with a line left by several seats', async () => {
    // North's 3C and East's 4NT are both off BBA's line, which has 4D at index 4.
    bba((p) => (p.length ? [...p, 'Pass', 'Pass', 'Pass'] : ['1S', '2NT', '3D', 'Pass', '4D']))
    await sit('S')
    await call('1S', '2N', '3C', '4N', '5S')
    expect(prefixes()).toEqual([null, ['1S', '2N', '3C'], ['1S', '2N', '3C', '4N'], ['1S', '2N', '3C', '4N', '5S']])
    expect(srv.divergedBids.value[4].bba).toBe('Pass')
  })

  it('never shows a reference call that is illegal over the actual auction', async () => {
    // An answer that ignores the prefix: 4D can't follow the 4NT actually bid.
    bba(() => ['1S', '2NT', '3D', 'Pass', '4D'])
    await sit('S')
    await call('1S', '2N', '3C', '4N', '5S')
    expect(srv.divergedBids.value).toEqual({})
  })

  it('stops after one request per divergence when BBA ignores the prefix', async () => {
    bba(() => ['1S', 'Pass', '2S', 'Pass', 'Pass', 'Pass'])
    await sit('N')
    await call('1H')
    expect(prefixes()).toEqual([null, ['1H']])
  })

  it('compares calls made while a request is out against the answer it brings back', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    fetchAuction.mockImplementation(async ({ auctionPrefix: p }) => {
      if (!p) return { auction: ['1NT', 'Pass', '2C', 'Pass', '2H'], meanings: [] }
      await gate
      return { auction: [...p, '3NT', 'Pass', 'Pass', 'Pass'], meanings: [] }
    })
    await sit('N')
    await call('1S') // South leaves BBA's line; the re-anchor is now out
    await call('Pass', '2H') // North calls while it is
    expect(srv.divergedBids.value).toEqual({})
    release()
    await flush()
    // Against the old line this would be 2C; the new one says 3NT.
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2H', bba: '3NT' } })
    expect(prefixes().at(-1)).toEqual(['1S', 'Pass', '2H'])
  })

  it('stops comparing, and keeps its marks, when a re-anchor fails', async () => {
    fetchAuction.mockImplementation(async ({ auctionPrefix: p }) => {
      if (p) throw new Error('offline')
      return { auction: ['1NT', 'Pass', '2H', 'Pass', '2S'], meanings: [] }
    })
    await sit('N')
    await call('1N', 'Pass', '2C')
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2C', bba: '2H' } })
    await call('Pass', '2D', 'Pass', '3S')
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2C', bba: '2H' } })
  })

  it('forgets a mark and re-anchors when the call behind it is undone', async () => {
    bba((p) => (p.length ? [...p, 'Pass', '4S', 'Pass', 'Pass', 'Pass'] : ['1NT', 'Pass', '2H', 'Pass']))
    await sit('N')
    await call('1N', 'Pass', '2C')
    expect(srv.divergedBids.value).toEqual({ 2: { user: '2C', bba: '2H' } })

    seq++
    snapshot('N', ['1N', 'Pass'])
    await flush()
    expect(srv.divergedBids.value).toEqual({})
    expect(prefixes().at(-1)).toEqual(['1N', 'Pass'])
  })

  it('leaves a kibitzer on the first reference', async () => {
    bba(() => ['1NT', 'Pass', '2H', 'Pass'])
    await sit(null)
    await call('1S')
    expect(prefixes()).toEqual([null])
    expect(srv.divergedBids.value).toEqual({})
  })
})
