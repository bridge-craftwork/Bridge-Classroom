import { describe, it, expect } from 'vitest'
import {
  LOCAL_CAPABILITIES,
  SERVER_CAPABILITIES,
  capabilityGaps,
  derivePhase,
  deriveWantsCall,
} from '../engines/tableEngine.js'

describe('tableEngine capabilities', () => {
  it('server is missing exactly the local-only analysis features (the backlog)', () => {
    // What the server would need to match the local experience. doubleDummy
    // is now delivered on the server table too (client-computed at review),
    // so it's no longer a gap — the backlog is the remaining three overlays.
    expect(capabilityGaps(LOCAL_CAPABILITIES, SERVER_CAPABILITIES).sort()).toEqual(
      ['bbaExpectedAuction', 'divergence', 'narrative'].sort(),
    )
  })

  it('local is missing exactly the multiplayer features', () => {
    expect(capabilityGaps(SERVER_CAPABILITIES, LOCAL_CAPABILITIES).sort()).toEqual(
      ['invite', 'multiHuman', 'redaction', 'seats'].sort(),
    )
  })

  it('non-boolean capability keys (mechanism choices) are not treated as gaps', () => {
    const gaps = capabilityGaps(LOCAL_CAPABILITIES, SERVER_CAPABILITIES)
    expect(gaps).not.toContain('changeBid')
    expect(gaps).not.toContain('dealSource')
  })
})

describe('derivePhase (canonical 3-state)', () => {
  it('bidding until the auction is over', () => {
    expect(derivePhase({ auctionComplete: false, cardplayActive: false, cardplayComplete: false })).toBe('bidding')
    // Once bidding is done, we are never "bidding" again regardless of cardplay.
    expect(derivePhase({ auctionComplete: true, cardplayActive: false, cardplayComplete: false })).toBe('review')
  })

  it('play only while tricks are actively being played', () => {
    expect(derivePhase({ auctionComplete: true, cardplayActive: true, cardplayComplete: false })).toBe('play')
    // Complete outranks active — the last trick lands both true for a tick.
    expect(derivePhase({ auctionComplete: true, cardplayActive: true, cardplayComplete: true })).toBe('review')
  })

  it('review collapses the three terminal states (note 2 decision)', () => {
    // The pre-Slice-5 shell told these apart (off / unsupported / complete);
    // as a phase they are one thing — the deal is resolved. LocalEngine reveals
    // all four hands in every one of them, so the collapse is behavior-preserving.
    const off = { auctionComplete: true, cardplayActive: false, cardplayComplete: false } // toggle off / unsupported
    const complete = { auctionComplete: true, cardplayActive: false, cardplayComplete: true } // 13 tricks done
    expect(derivePhase(off)).toBe('review')
    expect(derivePhase(complete)).toBe('review')
  })
})

describe('deriveWantsCall (distinct intent field, inert this slice)', () => {
  it('is your-turn-and-still-bidding for a live auction', () => {
    expect(deriveWantsCall({ auctionComplete: false, currentSeat: 'S', yourSeat: 'S' })).toBe(true)
    expect(deriveWantsCall({ auctionComplete: false, currentSeat: 'W', yourSeat: 'S' })).toBe(false)
  })

  it('is never true once the auction is complete (it is not the play-phase turn flag)', () => {
    expect(deriveWantsCall({ auctionComplete: true, currentSeat: 'S', yourSeat: 'S' })).toBe(false)
  })
})

describe('cardplayPhase re-expression reproduces the pre-Slice-5 formula exactly', () => {
  // The original 5-state view formula (verbatim, pre-Slice-5).
  function original({ auctionComplete, playCardplay, cardplayPossible, playComplete, isActive }) {
    if (!auctionComplete) return 'bidding'
    if (!playCardplay) return 'off'
    if (!cardplayPossible) return 'unsupported'
    if (playComplete) return 'complete'
    if (isActive) return 'playing'
    return 'playing'
  }
  // The re-expression the view now uses — coarse gate delegated to derivePhase.
  function reexpressed(inp) {
    const phase = derivePhase({
      auctionComplete: inp.auctionComplete,
      cardplayActive: inp.isActive,
      cardplayComplete: inp.playComplete,
    })
    if (phase === 'bidding') return 'bidding'
    if (!inp.playCardplay) return 'off'
    if (!inp.cardplayPossible) return 'unsupported'
    if (inp.playComplete) return 'complete'
    return 'playing'
  }

  it('agrees across the full boolean cross product of inputs', () => {
    const bools = [false, true]
    let checked = 0
    for (const auctionComplete of bools)
      for (const playCardplay of bools)
        for (const cardplayPossible of bools)
          for (const playComplete of bools)
            for (const isActive of bools) {
              const inp = { auctionComplete, playCardplay, cardplayPossible, playComplete, isActive }
              expect(reexpressed(inp), JSON.stringify(inp)).toBe(original(inp))
              checked++
            }
    expect(checked).toBe(32)
  })
})
