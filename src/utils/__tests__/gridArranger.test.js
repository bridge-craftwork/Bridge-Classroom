import { describe, it, expect } from 'vitest'
import {
  seatToArea, anchorFor, computeRegionScale, uniformSeatScale, rowReservePx,
  computeLayoutLedger,
} from '../gridArranger.js'

describe('seatToArea (§1 rotation)', () => {
  it("south anchor is compass-fixed (identity)", () => {
    expect(seatToArea('S', 'S')).toBe('s')
    expect(seatToArea('N', 'S')).toBe('n')
    expect(seatToArea('E', 'S')).toBe('e')
    expect(seatToArea('W', 'S')).toBe('w')
  })
  it('hero=West rotates: W→s, partner E→n, LHO N→w (screen-left), RHO S→e', () => {
    expect(seatToArea('W', 'W')).toBe('s')
    expect(seatToArea('E', 'W')).toBe('n')
    expect(seatToArea('N', 'W')).toBe('w')
    expect(seatToArea('S', 'W')).toBe('e')
  })
  it('every anchor keeps the four areas a bijection over the four seats', () => {
    for (const anchor of ['N', 'E', 'S', 'W']) {
      const areas = ['N', 'E', 'S', 'W'].map((s) => seatToArea(s, anchor))
      expect(new Set(areas)).toEqual(new Set(['n', 'e', 's', 'w']))
    }
  })
})

describe('anchorFor', () => {
  it("'south' is always S; 'hero' is the hero seat", () => {
    expect(anchorFor('south', 'W')).toBe('S')
    expect(anchorFor('hero', 'W')).toBe('W')
    expect(anchorFor('hero')).toBe('S') // default hero
  })
})

describe('computeRegionScale (§3 clamp)', () => {
  const floor = 0.65
  it('grows to fill up to the cap when there is room', () => {
    // room for 1.5×, cap 1.8 → 1.5 (center grows, cap not binding)
    expect(computeRegionScale({ available: 390, reserve: 260, cap: 1.8, floor })).toBeCloseTo(1.5, 5)
  })
  it('is bound by the cap (periphery pinned at 1.0 in a big region)', () => {
    expect(computeRegionScale({ available: 800, reserve: 200, cap: 1.0, floor })).toBe(1.0)
  })
  it('shrinks to fit below the neutral 1.0 when the region is cramped', () => {
    // 208/260 = 0.8 ≥ floor → 0.8 (the laptop-half seat finding)
    expect(computeRegionScale({ available: 208, reserve: 260, cap: 1.4, floor })).toBeCloseTo(0.8, 5)
  })
  it('never goes below the legibility floor', () => {
    expect(computeRegionScale({ available: 100, reserve: 260, cap: 1.4, floor })).toBe(floor)
  })
  it('no measurable geometry → cap-side', () => {
    expect(computeRegionScale({ available: 0, reserve: 260, cap: 1.0, floor })).toBe(1.0)
  })
})

describe('uniformSeatScale (§3 refined — hand-bearing only)', () => {
  const cap = 1.4, floor = 0.65
  it('is the MIN fit over hand-bearing seats (a wide hero not starved by a narrow side hand)', () => {
    // hero in a wide center col (fit 1.5) + a side hand in a narrow col (fit 1.05)
    const scale = uniformSeatScale(
      [{ available: 390, reserve: 260 }, { available: 273, reserve: 260 }], { cap, floor },
    )
    expect(scale).toBeCloseTo(1.05, 5) // min(1.4, min(1.5, 1.05))
  })
  it('a lone hero is sized to its own track, ignoring empty chip cells entirely', () => {
    // only the hero passed in — the chip seats are simply not in the list
    expect(uniformSeatScale([{ available: 390, reserve: 260 }], { cap, floor })).toBeCloseTo(1.4, 5) // min(1.4, 1.5)=1.4 (cap)
  })
  it('no hand-bearing seats → cap-side', () => {
    expect(uniformSeatScale([], { cap, floor })).toBe(cap)
  })
  it('honors the floor', () => {
    expect(uniformSeatScale([{ available: 100, reserve: 260 }], { cap, floor })).toBe(floor)
  })
})

describe('rowReservePx (shared with handMetrics)', () => {
  it('7-card reserve ≈ the spec estimate (~260px)', () => {
    expect(rowReservePx(7)).toBe(260) // 28 + 8 + 7·32
  })
})

describe('computeLayoutLedger (§3 one-directional allocator)', () => {
  const A1_TIERS = [['center', 'n', 'e', 's', 'w'], ['se', 'nw', 'ne', 'sw']]
  const SEAT = rowReservePx(7) // 260

  // Ledger assertion 1 — no floor-bound regions at laptop-half bidding: the working
  // set (centre + hero hand) holds 1.0×, and the periphery (BB, status) compress
  // TOGETHER but stay above the floor. (Holds even with the wide-form BB reserve;
  // a narrower BB only lifts the periphery further.)
  it('laptop-half bidding: no region hits the floor; hand stays 1.0×', () => {
    const l = computeLayoutLedger({
      budget: 652,
      occupied: ['center', 's', 'se', 'nw'],
      reserves: { center: 220, s: SEAT, se: 308, nw: 150 },
      tiers: A1_TIERS,
      seatReserve: SEAT,
      handBearingAreas: ['s'],
    })
    expect(l.seats.scale).toBe(1) // hero protected
    expect(l.regions.center.scale).toBe(1)
    for (const a of ['center', 's', 'se', 'nw']) expect(l.regions[a].scale).toBeGreaterThan(0.65)
    // periphery compresses together (same tier → same ratio)
    expect(l.regions.se.scale).toBeCloseTo(l.regions.nw.scale, 2)
    expect(l.regions.se.scale).toBeLessThan(1)
  })

  // Ledger assertion 2 — uniform seat scales: hands in different columns still get
  // ONE size (the min fit), never differing on a single deal.
  it('uniform seat scale across hand-bearing seats in different columns', () => {
    const l = computeLayoutLedger({
      budget: 560, // tight enough that a side-column hand can't reach 1.0×
      occupied: ['center', 's', 'w'], // hero south (col1) + west defender (col0)
      reserves: { center: 220, s: SEAT, w: SEAT },
      tiers: [['center', 'n', 'e', 's', 'w'], ['se', 'nw', 'ne', 'sw']],
      seatReserve: SEAT,
      handBearingAreas: ['s', 'w'],
    })
    expect(l.regions.s.scale).toBe(l.regions.w.scale) // identical, both = uniform seat scale
    expect(l.regions.s.scale).toBe(l.seats.scale)
  })

  // Ledger assertion 3 — review clustering: with a generous budget the columns size
  // to need (not stretched), leaving OUTER MARGIN, so the revealed hands cluster
  // beside the centred auction rather than at the stage extremes.
  it('review clustering: surplus becomes outer margin (not stretched into tracks)', () => {
    const l = computeLayoutLedger({
      budget: 1000,
      occupied: ['center', 'n', 's', 'nw'], // auction centre + N/S hands revealed + status
      reserves: { center: 220, n: SEAT, s: SEAT, nw: 150 },
      tiers: [['center', 'n', 'e', 's', 'w'], ['se', 'nw', 'ne', 'sw']],
      seatReserve: SEAT,
      handBearingAreas: ['n', 's'],
    })
    expect(l.outerMargin).toBeGreaterThan(0) // clustered, surplus is margin
    expect(l.colWidths.reduce((a, b) => a + b, 0)).toBeLessThan(l.budget)
    for (const a of ['center', 'n', 's', 'nw']) expect(l.regions[a].scale).toBe(1) // all natural
  })
})
