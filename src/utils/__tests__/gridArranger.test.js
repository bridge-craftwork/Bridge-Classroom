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

  // Ledger assertion 7 — caps growth (§3.4 caps wiring, 2026-07-12). The stage grows
  // ABOVE 1.0× toward its fr SHARE of the budget (geometry-bound), the seats toward the
  // seat cap, the periphery pinned at 1.0, and se ≤ seats. Growing to the fr share — not
  // straight to the cap — is what keeps the stage geometry-bound (~1.3 desktop) with the
  // cap a ceiling that binds only on a very wide screen, restoring the pre-rewrite
  // behaviour the pure-allocator lost (the earlier 1.27×/1.40× center captions).
  const A1_CAPS = { center: 1.8, seats: 1.4, nw: 1.0, ne: 1.0, se: 'seats', sw: 1.0 }
  const A1_WEIGHTS = [1.1, 1.3, 1.1]
  const bidding = (budget) => computeLayoutLedger({
    budget, occupied: ['center', 's', 'se', 'nw'],
    reserves: { center: 220, s: SEAT, se: 222, nw: 89 },
    tiers: A1_TIERS, seatReserve: SEAT, handBearingAreas: ['s'],
    caps: A1_CAPS, columnWeights: A1_WEIGHTS,
  })

  it('caps: the stage grows above 1.0× to its fr share, geometry-bound, cap NON-binding at a desktop budget', () => {
    const l = bidding(774)
    expect(l.regions.center.scale).toBeGreaterThan(1.2)
    expect(l.regions.center.scale).toBeLessThan(1.5) // ~1.31 — NOT the 1.8 cap
    expect(l.regions.center.binding).toBe('budget')  // geometry binds, not the cap
    expect(l.outerMargin).toBeGreaterThan(0)         // clustering preserved (surplus → margin)
  })

  it('caps: the stage reaches its 1.8 cap only on a very wide screen (then the ceiling binds)', () => {
    const l = bidding(2000)
    expect(l.regions.center.scale).toBe(1.8)
    expect(l.regions.center.binding).toBe('cap')
  })

  it('caps: seats grow toward the 1.4 seat cap and never exceed it', () => {
    expect(bidding(774).seats.scale).toBeGreaterThan(1)       // grown above natural
    expect(bidding(774).seats.scale).toBeLessThanOrEqual(1.4)
    expect(bidding(2000).seats.scale).toBe(1.4)               // cap binds on a wide screen
  })

  it('caps: the periphery (nw status) stays pinned at its 1.0 cap however wide the budget', () => {
    const l = bidding(2000)
    expect(l.regions.nw.scale).toBe(1)
    expect(l.regions.nw.binding).toBe('natural')
  })

  it("caps: se honours the 'seats' relationship — cap = min(1, seatScale), never larger than the seats", () => {
    // wide: seats grow to 1.4 but se is pinned at its ≤ 1.0 ceiling (touch-ergonomic, not typographic)
    const wide = bidding(2000)
    expect(wide.regions.se.cap).toBe(1)
    expect(wide.regions.se.scale).toBeLessThanOrEqual(1)
    expect(wide.regions.se.scale).toBeLessThanOrEqual(wide.seats.scale)
    // tight (hero + a west defender, both below 1.0×): se's ceiling tracks the seat scale
    const tight = computeLayoutLedger({
      budget: 640, occupied: ['center', 's', 'w', 'se'],
      reserves: { center: 220, s: SEAT, w: SEAT, se: 222 },
      tiers: A1_TIERS, seatReserve: SEAT, handBearingAreas: ['s', 'w'],
      caps: A1_CAPS, columnWeights: A1_WEIGHTS,
    })
    expect(tight.seats.scale).toBeLessThan(1)
    expect(tight.regions.se.cap).toBeCloseTo(tight.seats.scale, 2) // se ceiling = min(1, seatScale)
    expect(tight.regions.se.scale).toBeLessThanOrEqual(tight.seats.scale + 1e-9)
  })

  it('caps: default to a no-op — all-1.0 caps equal passing no caps (the min(1, fit) baseline)', () => {
    const args = { budget: 774, occupied: ['center', 's', 'se', 'nw'], reserves: { center: 220, s: SEAT, se: 222, nw: 89 }, tiers: A1_TIERS, seatReserve: SEAT, handBearingAreas: ['s'], columnWeights: A1_WEIGHTS }
    const noCaps = computeLayoutLedger(args)
    const flatCaps = computeLayoutLedger({ ...args, caps: { center: 1, seats: 1, nw: 1, ne: 1, se: 1, sw: 1 } })
    expect(flatCaps.regions.center.scale).toBe(noCaps.regions.center.scale)
    expect(flatCaps.seats.scale).toBe(noCaps.seats.scale)
    expect(noCaps.regions.center.scale).toBe(1) // no caps → clamped at 1.0 (the pre-caps regression baseline)
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
