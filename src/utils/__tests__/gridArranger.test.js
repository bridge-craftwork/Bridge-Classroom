import { describe, it, expect } from 'vitest'
import {
  seatToArea, anchorFor, partnerOf, seatRole, computeRegionScale, uniformSeatScale,
  rowReservePx, computeLayoutLedger, actionCornerFor,
} from '../gridArranger.js'

describe('actionCornerFor (§ play bottom-pack — hero-relative action corner)', () => {
  it('South/East hero → SE (the bidding-box position / adjacent corner)', () => {
    expect(actionCornerFor('s')).toBe('se')
    expect(actionCornerFor('e')).toBe('se')
  })
  it('a screen-left West defender → SW (Undo/Claim ride under the hero)', () => {
    expect(actionCornerFor('w')).toBe('sw')
  })
  it('North hero → SE default', () => {
    expect(actionCornerFor('n')).toBe('se')
  })
})

describe('seatRole / partnerOf (item 4 — badges by role)', () => {
  it('partnerOf faces across the table', () => {
    expect(partnerOf('S')).toBe('N')
    expect(partnerOf('N')).toBe('S')
    expect(partnerOf('E')).toBe('W')
    expect(partnerOf('W')).toBe('E')
  })
  it('roles are relative to the hero seat (South hero)', () => {
    expect(seatRole('S', 'S')).toBe('hero')
    expect(seatRole('N', 'S')).toBe('partner')
    expect(seatRole('E', 'S')).toBe('opponent')
    expect(seatRole('W', 'S')).toBe('opponent')
  })
  it('roles rotate with the hero (West hero → E is partner)', () => {
    expect(seatRole('W', 'W')).toBe('hero')
    expect(seatRole('E', 'W')).toBe('partner')
    expect(seatRole('N', 'W')).toBe('opponent')
    expect(seatRole('S', 'W')).toBe('opponent')
  })
})

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

  // Ledger assertion 4 — floor-protection / corner rule (2026-07-12). A lone
  // corner (NW status) in its own column, one tier below a heavier sibling
  // column, must ride at its floor-minimum — NOT starve below it — while the
  // budget can cover every column's floor. This is the defensive-cardplay case
  // (hero S, dummy E) that previously starved NW to 80 (< 0.65×150).
  it('lone corner rides at its floor, not below, when the budget has room', () => {
    const l = computeLayoutLedger({
      budget: 650,
      occupied: ['center', 'e', 'ne', 'nw', 's', 'se'],
      reserves: { center: 200, e: SEAT, ne: 220, nw: 150, s: SEAT, se: 222 },
      tiers: A1_TIERS, // nw/ne/se tier 1; center/e/s tier 0
      seatReserve: SEAT,
      handBearingAreas: ['e', 's'],
    })
    // NW is floor-protected: alloc ≈ 0.65×150 ≈ 97.5, scale pinned at the floor,
    // and the binding is the legal 'floor' — never 'overflow'.
    expect(l.regions.nw.scale).toBe(0.65)
    expect(l.regions.nw.binding).toBe('floor')
    expect(l.regions.nw.allocated).toBeGreaterThanOrEqual(Math.round(0.65 * 150))
  })

  // Ledger assertion 5 — genuine overflow: when even the floor-minimums can't all
  // fit (a very narrow budget), the starved region reports 'overflow', distinct
  // from the legal 'floor'.
  it('reports overflow only when the floor-minimums cannot all fit', () => {
    const l = computeLayoutLedger({
      budget: 240, // below the two columns' floor-minimums + margins → starved
      occupied: ['center', 's', 'nw'],
      reserves: { center: 220, s: SEAT, nw: 150 },
      tiers: A1_TIERS,
      seatReserve: SEAT,
      handBearingAreas: ['s'],
    })
    const starved = ['center', 's', 'nw'].map((a) => l.regions[a]).filter((r) => r.binding === 'overflow')
    expect(starved.length).toBeGreaterThan(0)
    for (const r of starved) expect(r.allocated).toBeLessThan(Math.round(0.65 * r.reserve))
  })

  // Ledger assertion 6 — row bands + phantom seats (play bottom-pack, 2026-07-12).
  // A hidden CENTRE-column seat (the declarer's South in a defence scene) is ABSORBED
  // by the stage (s-absorption), so it's NOT a phantom band — that's the cure. Only a
  // hidden SIDE seat (East, middle row) leaves a genuine dead band the stage can't
  // absorb sideways. Occupancy reflects the relocated action cluster (Undo/Claim at
  // SW under the West hero, not SE).
  it('centre-seat absorption clears the phantom; a hidden side seat still phantoms', () => {
    const l = computeLayoutLedger({
      budget: 650,
      occupied: ['center', 'w', 'n', 'nw', 'ne', 'sw'], // hero W + dummy N; E/S hidden; controls at SW
      reserves: { center: 200, w: SEAT, n: SEAT, nw: 89, ne: 220, sw: 222 },
      tiers: A1_TIERS,
      seatReserve: SEAT,
      handBearingAreas: ['w', 'n'],
    })
    expect(l.rows).toHaveLength(3)
    const mid = l.rows[1] // [w, center, e]
    expect(mid.phantom).toContain('e') // hidden East (side seat) → genuine phantom band
    const bot = l.rows[2] // [sw, s, se]
    expect(bot.occupied).toEqual(['sw'])
    expect(bot.phantom).toEqual([]) // hidden South is absorbed by the stage, not a void
    expect(bot.collapsed).toEqual(expect.arrayContaining(['s', 'se']))
    // Top row is fully occupied (status + dummy + auction) — no phantom.
    expect(l.rows[0].phantom).toEqual([])
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
