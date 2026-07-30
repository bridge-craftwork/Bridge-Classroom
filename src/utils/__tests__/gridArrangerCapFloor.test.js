// The 1521×784 collapse, pinned as a unit test.
//
// capsWithHeight() lowers `caps.seats` when the stack is too tall. Because a column's
// growth ceiling is max(cap × reserve) over its members, that HEIGHT clamp also capped
// the column's WIDTH — and column 0 is the only column with nothing but a seat to
// defend it (NW's glyph reserves 89, against NE's auction 220 and the centre's 1.8
// cap). West therefore starved while East, holding an identical 6-card hand, did not.
import { describe, it, expect } from 'vitest'
import { computeLayoutLedger } from '../gridArranger.js'

// The reporter's deal + geometry: B1 review, all four hands revealed.
const BASE = {
  budget: 1022,
  occupied: ['nw', 'ne', 'center', 'n', 'e', 's', 'w'],
  reserves: { nw: 89, ne: 220, center: 220, n: 180, e: 180, s: 180, w: 180 },
  tiers: [['center', 'n', 'e', 's', 'w'], ['se', 'nw', 'ne', 'sw']],
  seatReserve: 180,
  handBearingAreas: ['n', 'e', 's', 'w'],
  cellGap: 6,
  actionHandGap: 14,
  floor: 0.65,
  columnWeights: [1.1, 1.3, 1.1],
}
// seats: 0.65 is what the height fit produces at 784px tall. 1.4 is the unclamped cap.
const caps = (seats) => ({ center: 1.8, seats, nw: 1, ne: 1, se: 'seats', sw: 1 })
const alloc = (L, area) => Math.round(L.regions[area].allocated)

describe('height-driven seat cap vs column width', () => {
  it('reproduces the collapse on the default channel', () => {
    const L = computeLayoutLedger({ ...BASE, caps: caps(0.65) })
    // West's column is pinned at 0.65 × 180 — BELOW its own 180 natural need …
    expect(alloc(L, 'nw')).toBe(117)
    // … while East's is held up by the NE reference auction's 220 reserve.
    expect(alloc(L, 'ne')).toBe(220)
  })

  it('is symmetric when the height fit is NOT clamping', () => {
    const L = computeLayoutLedger({ ...BASE, caps: caps(1.4) })
    expect(alloc(L, 'nw')).toBe(alloc(L, 'ne'))
  })

  it('beta lifts the starved column to its natural need', () => {
    const L = computeLayoutLedger({ ...BASE, caps: caps(0.65), capFloorAtNeed: true })
    expect(alloc(L, 'nw')).toBe(180) // == max(reserves.nw, reserves.w)
    expect(alloc(L, 'nw')).toBeGreaterThan(117)
  })

  it('beta never SHRINKS a column — it only raises a ceiling', () => {
    for (const seats of [0.65, 1.0, 1.4]) {
      const off = computeLayoutLedger({ ...BASE, caps: caps(seats) })
      const on = computeLayoutLedger({ ...BASE, caps: caps(seats), capFloorAtNeed: true })
      for (const a of ['nw', 'ne', 'center']) {
        expect(alloc(on, a), `seats ${seats}, ${a}`).toBeGreaterThanOrEqual(alloc(off, a))
      }
    }
  })

  it('is a no-op when no cap is below its column need — the default channel is untouched', () => {
    // The guard that matters for A1: with caps that never bite, both channels agree.
    const off = computeLayoutLedger({ ...BASE, caps: caps(1.4) })
    const on = computeLayoutLedger({ ...BASE, caps: caps(1.4), capFloorAtNeed: true })
    expect(JSON.stringify(on.regions)).toBe(JSON.stringify(off.regions))
  })
})
