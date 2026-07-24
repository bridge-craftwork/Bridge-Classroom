import { describe, it, expect } from 'vitest'
import {
  LOCAL_CAPABILITIES,
  SERVER_CAPABILITIES,
  capabilityGaps,
  derivePhase,
  deriveWantsCall,
} from '../engines/tableEngine.js'
import { deriveSlots } from '../engines/tableSlots.js'

describe('tableEngine capabilities', () => {
  it('server is missing exactly the local-only analysis features (the backlog)', () => {
    // What the server would need to match the local experience. doubleDummy,
    // the BBA expected auction, and per-seat divergence are all delivered on the
    // server table now (client-computed at review), so the only remaining gap is
    // `narrative` — authored server-side commentary with no client fallback.
    expect(capabilityGaps(LOCAL_CAPABILITIES, SERVER_CAPABILITIES).sort()).toEqual(
      ['narrative'].sort(),
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

  // The slot decision must show the CARDPLAY STAGE for exactly the states the
  // pre-slice local shell did (cardplayPhase ∈ {playing, complete}) and hide it
  // for the rest (bidding/off/unsupported). The stage is 'trick-area' in play and
  // 'review' post-play; a legacy shell renders TrickArea for either, so the gate
  // is `center ∈ {'trick-area','review'}` — identical truth to the old
  // `center === 'trick-area'` because review used to emit 'trick-area' too.
  const isCardplayCenter = (c) => c === 'trick-area' || c === 'review'
  it("deriveSlots.center reproduces the local shell's cardplay-stage gate", () => {
    const bools = [false, true]
    for (const auctionComplete of bools)
      for (const playCardplay of bools)
        for (const cardplayPossible of bools)
          for (const playComplete of bools)
            for (const isActive of bools) {
              const inp = { auctionComplete, playCardplay, cardplayPossible, playComplete, isActive }
              const cp = original(inp) // the 5-state cardplayPhase
              const phase = derivePhase({ auctionComplete, cardplayActive: isActive, cardplayComplete: playComplete })
              // Local `hasCardplay` = cardplay engaged for this board (NOT playComplete):
              // the stage lives for the whole post-auction life of a playable deck.
              const hasCardplay = playCardplay && cardplayPossible
              const { center } = deriveSlots({ phase, wantsCall: false, hasCardplay })
              const shownBefore = cp === 'playing' || cp === 'complete'
              expect(isCardplayCenter(center), JSON.stringify(inp)).toBe(shownBefore)
            }
  })
})

describe('deriveSlots (Slice 6 — mutually-exclusive slots)', () => {
  it('center reports the phase stage: auction / trick-area / review / null', () => {
    // Bidding: the stage is the live auction (a legacy shell keeps it in the rail
    // and paints no center — see the consumer note; grid renders it centrally).
    expect(deriveSlots({ phase: 'bidding', wantsCall: false, hasCardplay: true }).center).toBe('auction')
    expect(deriveSlots({ phase: 'bidding', wantsCall: false, hasCardplay: false }).center).toBe('auction')
    // Engaged board (hasCardplay): the cardplay stage — 'trick-area' in play,
    // 'review' post-play (both render TrickArea under legacy).
    expect(deriveSlots({ phase: 'play', wantsCall: false, hasCardplay: true }).center).toBe('trick-area')
    expect(deriveSlots({ phase: 'review', wantsCall: false, hasCardplay: true }).center).toBe('review')
    // Non-playing deck (bidding-only / unsupported / toggled-off): no cardplay
    // stage even post-auction. This is the note-2 per-source reveal.
    expect(deriveSlots({ phase: 'play', wantsCall: false, hasCardplay: false }).center).toBe(null)
    expect(deriveSlots({ phase: 'review', wantsCall: false, hasCardplay: false }).center).toBe(null)
  })

  it('action: bidding box iff wantsCall (never a literal turn flag)', () => {
    expect(deriveSlots({ phase: 'bidding', wantsCall: true, hasCardplay: false }).action).toBe('bidding-box')
    expect(deriveSlots({ phase: 'bidding', wantsCall: false, hasCardplay: false }).action).toBe(null)
    // wantsCall is false once bidding is over, so no action slot in play/review.
    expect(deriveSlots({ phase: 'play', wantsCall: false, hasCardplay: false }).action).toBe(null)
  })

  it("center reproduces the server shell's cardplay-stage gate (play || complete)", () => {
    // Server raw phase is 'bidding' | 'play' | 'complete'; the seam maps
    // 'complete' → 'review' and a served board always plays (hasCardplay=true).
    const isCardplayCenter = (c) => c === 'trick-area' || c === 'review'
    for (const raw of ['bidding', 'play', 'complete']) {
      const phase = raw === 'complete' ? 'review' : raw
      const { center } = deriveSlots({ phase, wantsCall: false, hasCardplay: true })
      const shownBefore = raw === 'play' || raw === 'complete'
      expect(isCardplayCenter(center), raw).toBe(shownBefore)
    }
  })
})
