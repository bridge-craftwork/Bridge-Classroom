import { describe, it, expect, beforeEach } from 'vitest'
import { useRemoteTable } from '../useRemoteTable.js'
import serverMidplay from '../../harness/fixtures/server-midplay.js'

// Contract tests for the Phase-0.2 fixture driver (Invariant 7): the driver is
// the referee for the Phase-3 serverEngine refactor, so it must reconstruct the
// client state — and every derived computed — from a frozen snapshot, and a
// capture must round-trip. Pixel-identity proves scope; THESE prove correctness.
// The rotated case is the seat-mapping guard the pixel harness is blind to.

describe('useRemoteTable fixture driver (Phase 0.2)', () => {
  let srv
  beforeEach(() => {
    srv = useRemoteTable()
    srv._resetTableState()
  })

  it('reconstructs client state + derivations from a frozen snapshot', () => {
    srv.loadFixture(serverMidplay.snapshot)

    // raw state
    expect(srv.phase.value).toBe('play')
    expect(srv.contract.value).toEqual({ text: '4H', declarer: 'S' })
    expect(srv.board.value).toEqual({ number: 1, dealer: 'N', vulnerable: 'NS' })
    expect(srv.auction.value).toHaveLength(8)
    expect(srv.hands.value.S.hearts).toEqual(['A', 'K', 'Q', 'J', '9'])
    expect(srv.tricksTaken.value).toEqual({ NS: 1, EW: 1 })
    expect(srv.seats.value.N.name).toBe('Snow White')

    // derivations
    expect(srv.dummySeat.value).toBe('N') // partnerOf(S)
    expect(srv.hiddenSeats.value).toEqual(['E', 'W']) // the null-hand seats
    // you are declarer (S) and dummy (N) is on lead → you click dummy's card
    expect(srv.clickableSeat.value).toBe('N')
    expect(srv.isYourBid.value).toBe(false) // not bidding
  })

  it('round-trips: loadFixture ∘ captureFixture is identity', () => {
    srv.loadFixture(serverMidplay.snapshot)
    const captured = srv.captureFixture()

    // capture reproduces every field the fixture set
    expect(captured).toEqual(serverMidplay.snapshot)

    // and reloading the capture yields identical derivations (no drift)
    srv._resetTableState()
    srv.loadFixture(captured)
    expect(srv.clickableSeat.value).toBe('N')
    expect(srv.dummySeat.value).toBe('N')
  })

  it('maps ROTATED seats correctly — the seat-mapping guard (asymmetric)', () => {
    // Declarer East, dummy West, you are South defending, and it is your turn.
    // Nothing here is symmetric with the S-declarer case, so a serverEngine
    // refactor that assumes "declarer = you" or "dummy = your partner" breaks.
    const rotated = {
      yourSeat: 'S',
      role: 'player',
      seeAll: false,
      board: { number: 2, dealer: 'E', vulnerable: 'EW' },
      phase: 'play',
      auction: ['1N', 'Pass', '3N', 'Pass', 'Pass', 'Pass'],
      contract: { text: '3NT', declarer: 'E' },
      nextToAct: 'S',
      hands: {
        S: { spades: ['J', '9', '4'], hearts: ['K', '6'], diamonds: ['Q', 'T', '8'], clubs: ['9', '5', '3'] },
        W: { spades: ['A', 'Q'], hearts: ['A', 'J', '9'], diamonds: ['K', '4'], clubs: ['A', 'K', 'Q', '2'] },
        N: null,
        E: null,
      },
      handCounts: { N: 11, E: 11, S: 11, W: 11 },
      currentTrick: {
        leader: 'N',
        plays: [
          { seat: 'N', suit: 'S', rank: 'K' },
          { seat: 'E', suit: 'S', rank: '2' },
        ],
      },
      tricksTaken: { NS: 1, EW: 1 },
      seats: {
        N: { kind: 'human', name: 'Doc', connected: true },
        E: { kind: 'empty' },
        S: { kind: 'human', name: 'Rick', connected: true },
        W: { kind: 'empty' },
      },
    }
    srv.loadFixture(rotated)

    expect(srv.dummySeat.value).toBe('W') // partnerOf(E), NOT partnerOf(you)
    expect(srv.hiddenSeats.value).toEqual(['N', 'E'])
    expect(srv.contract.value.declarer).toBe('E')
    // it's your turn as a defender → you click your OWN seat
    expect(srv.clickableSeat.value).toBe('S')
    // current trick mapped through to display shape
    expect(srv.currentTrick.plays).toEqual([
      { seat: 'N', suit: 'S', rank: 'K' },
      { seat: 'E', suit: 'S', rank: '2' },
    ])
  })

  it('resets stale state between loads (defaults fill missing fields)', () => {
    srv.loadFixture(serverMidplay.snapshot)
    expect(srv.contract.value).not.toBeNull()

    // a bidding-phase snapshot with no contract must clear the prior one
    srv.loadFixture({
      yourSeat: 'S',
      phase: 'bidding',
      board: { number: 1, dealer: 'S', vulnerable: 'None' },
      auction: ['1S'],
      nextToAct: 'W',
      hands: { S: { spades: ['A'], hearts: [], diamonds: [], clubs: [] }, N: null, E: null, W: null },
    })
    expect(srv.contract.value).toBeNull()
    expect(srv.tricksTaken.value).toEqual({ NS: 0, EW: 0 })
    expect(srv.currentTrick.plays).toEqual([])
    expect(srv.seats.value).toEqual({})
  })
})
