import { describe, it, expect } from 'vitest'
import { deriveStatus, parseContract, sideOf } from '../engines/useTableStatus.js'
import { deriveSlots } from '../engines/tableSlots.js'

// Contract tests for the Phase-0.3/0.4 derivations (Invariant 7). These feed the
// StatusStrip and the status/context slots, so their correctness is what the
// gallery pixel-diff can't prove on its own.

describe('parseContract', () => {
  it('parses level/strain, NT, and doubling', () => {
    expect(parseContract('4H')).toEqual({ level: 4, strain: 'H', dbl: '' })
    expect(parseContract('3NT')).toEqual({ level: 3, strain: 'NT', dbl: '' })
    expect(parseContract('7NTXX')).toEqual({ level: 7, strain: 'NT', dbl: 'XX' })
    expect(parseContract('1SX')).toEqual({ level: 1, strain: 'S', dbl: 'X' })
    expect(parseContract('Pass')).toBeNull()
    expect(parseContract('')).toBeNull()
    expect(parseContract(null)).toBeNull()
  })
})

describe('sideOf', () => {
  it('maps seat to partnership', () => {
    expect(sideOf('N')).toBe('NS')
    expect(sideOf('S')).toBe('NS')
    expect(sideOf('E')).toBe('EW')
    expect(sideOf('W')).toBe('EW')
    expect(sideOf(null)).toBeNull()
  })
})

describe('deriveStatus', () => {
  it('bidding: dealer + vul, no contract/target/result', () => {
    const s = deriveStatus({ phase: 'bidding', dealer: 'N', vulnerable: 'NS' })
    expect(s.dealer).toBe('N')
    expect(s.vul).toBe('NS')
    expect(s.contract).toBeNull()
    expect(s.tricks.target).toBeNull()
    expect(s.result).toBeNull()
  })

  it('play: contract-relative target (6 + level) and declaring side', () => {
    const s = deriveStatus({
      phase: 'play',
      dealer: 'N',
      vulnerable: 'NS',
      contract: { text: '4H', declarer: 'S' },
      tricks: { NS: 7, EW: 3 },
    })
    expect(s.declaringSide).toBe('NS')
    expect(s.tricks.target).toBe(10)
    expect(s.tricks.ns).toBe(7)
    // not yet made — the standing is target-relative
    expect(s.result).toEqual({ need: 10, made: false, delta: -3 })
  })

  it('review made: delta over the target', () => {
    const s = deriveStatus({
      phase: 'review',
      contract: { text: '4H', declarer: 'S' },
      tricks: { NS: 11, EW: 2 },
    })
    expect(s.result).toEqual({ need: 10, made: true, delta: 1 })
  })

  it('review down: negative delta', () => {
    const s = deriveStatus({
      phase: 'review',
      contract: { text: '3NT', declarer: 'E' },
      tricks: { NS: 6, EW: 7 }, // EW declares, needs 9, has 7
    })
    expect(s.declaringSide).toBe('EW')
    expect(s.result).toEqual({ need: 9, made: false, delta: -2 })
  })

  it('doubling does not change the target', () => {
    const s = deriveStatus({
      phase: 'play',
      contract: { text: '7NTXX', declarer: 'W' },
      tricks: { NS: 2, EW: 9 },
    })
    expect(s.declaringSide).toBe('EW')
    expect(s.tricks.target).toBe(13)
    expect(s.contract).toBe('7NTXX')
  })

  it('accepts lowercase ns/ew trick keys too', () => {
    const s = deriveStatus({
      phase: 'play',
      contract: { text: '2S', declarer: 'N' },
      tricks: { ns: 5, ew: 1 },
    })
    expect(s.tricks.ns).toBe(5)
    expect(s.tricks.target).toBe(8)
  })
})

describe('deriveSlots — status + context extensions', () => {
  it('status present whenever a board is loaded; null otherwise', () => {
    expect(deriveSlots({ phase: 'bidding' }).status).toBe('status-strip')
    expect(deriveSlots({ phase: 'play' }).status).toBe('status-strip')
    expect(deriveSlots({ phase: null }).status).toBeNull()
  })

  it('context gated on hasContext, defaulting off', () => {
    expect(deriveSlots({ phase: 'play', hasContext: true }).context).toBe('context-panel')
    expect(deriveSlots({ phase: 'play', hasContext: false }).context).toBeNull()
    expect(deriveSlots({ phase: 'play' }).context).toBeNull()
  })

  it('center/action unchanged by the extension', () => {
    const s = deriveSlots({ phase: 'play', wantsCall: false, hasCardplay: true, hasContext: true })
    expect(s.center).toBe('trick-area')
    expect(s.action).toBeNull()
  })
})
