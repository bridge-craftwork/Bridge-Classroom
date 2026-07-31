// The corner-cluster reserves exist to express ONE thing the role-derived defaults
// can't: a corner's width depends on which cluster members the viewer actually gets.
// The property that matters is therefore "a viewer with no controls reserves nothing
// for them" — if that regresses, B3's NW silently holds a column of empty space for
// a transport an invited player never sees, which is the exact bug this replaced.
import { describe, it, expect } from 'vitest'
import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../../boardIndicatorMetrics.js'
import {
  CLUSTER_UNIT,
  dealControlsButtonWidthPx,
  dealControlsReservePx,
  actionClusterReservePx,
  doubleDummyReservePx,
  DD_COMPACT_MEASURED_PX,
} from '../clusterMetrics.js'

describe('dealControlsReservePx (NW transport)', () => {
  it('reserves nothing when the viewer gets no transport (the B3 guest case)', () => {
    expect(dealControlsReservePx({ showRestart: false, showNext: false, showRestartCardplay: false })).toBe(0)
  })

  // 2026-07-30, Rick: the third button was wrapping to a second line — keep it to one
  // row, centred under the board glyph, and scale the buttons to use that width. All
  // three fall out of one rule: the ROW spans the glyph, whatever the count.
  it('spans the board glyph at every button count, so the row is aligned under it', () => {
    const glyph = Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE))
    for (const opts of [
      { showRestart: true, showNext: false },
      { showRestart: true, showNext: true },
      { showRestart: true, showNext: true, showRestartCardplay: true },
    ]) {
      expect(dealControlsReservePx(opts)).toBe(glyph)
    }
  })

  it('divides that width between the buttons — fewer buttons, wider ones', () => {
    expect(dealControlsButtonWidthPx(1)).toBeGreaterThan(dealControlsButtonWidthPx(2))
    expect(dealControlsButtonWidthPx(2)).toBeGreaterThan(dealControlsButtonWidthPx(3))
    expect(dealControlsButtonWidthPx(3)).toBe(
      Math.floor((boardIndicatorExtentPx(A1_BOARD_SIZE) - 2 * CLUSTER_UNIT.gapPx) / 3),
    )
  })

  it('stops dividing at a usable target size, even if the row then overflows', () => {
    expect(dealControlsButtonWidthPx(6)).toBe(CLUSTER_UNIT.minIconBtnPx)
  })

  // THE regression guard. The labelled first cut min-width'd each button to the
  // widest label (148px), which pushed NW's reserve from the glyph's ~89px to 148px,
  // starved the grid and collided with North at ~820px wide. NW holds the glyph
  // ABOVE the transport, so as long as the transport is no wider than the glyph the
  // corner reserves exactly what it did before the controls existed — the collision
  // cannot come back. If a future change re-widens these buttons, this fails first.
  it('never makes NW wider than the board glyph it sits under', () => {
    const glyph = boardIndicatorExtentPx(A1_BOARD_SIZE)
    const fullest = dealControlsReservePx({ showRestart: true, showNext: true, showRestartCardplay: true })
    expect(fullest).toBeLessThanOrEqual(Math.round(glyph))
  })
})

describe('actionClusterReservePx (SE actions)', () => {
  it('reserves nothing when neither button renders', () => {
    expect(actionClusterReservePx({ showUndo: false, showClaim: false })).toBe(0)
  })

  it('grows horizontally — Undo and Claim sit side by side, both labelled', () => {
    const undo = actionClusterReservePx({ showUndo: true })
    const both = actionClusterReservePx({ showUndo: true, showClaim: true })
    expect(undo).toBe(CLUSTER_UNIT.textBtnPx)
    expect(both).toBe(2 * CLUSTER_UNIT.textBtnPx + CLUSTER_UNIT.gapPx)
    expect(both).toBeGreaterThan(undo)
  })
})

describe('doubleDummyReservePx (SE at review)', () => {
  // Was: "is wider than the action cluster". That stopped being true once the compact
  // density squeezed the table from 205 → 120 — it is now NARROWER than Undo+Claim.
  // Which is the point: the corner's width is set by whichever occupant is widest in
  // that phase, so the reserve has to be per-phase either way, just not always by DD.
  // Re-baselined 2026-07-30. This assertion has now flipped TWICE, which is the point
  // worth recording: the corner form's size is a live design trade, not a constant.
  //   • originally "wider than the action cluster" (the 205px full-padding table)
  //   • then "narrower" (the July squeeze to 120, to fit a corner that couldn't grow)
  //   • now comparable to a HAND, because the corner tracks the seats and a DD at 65%
  //     of a hand's reserve read as an afterthought (Rick: "the native DD is 50% of
  //     the native hand").
  // So pin the RELATIONSHIP that actually matters rather than a bare number.
  const HAND_RESERVE_PX = 196   // rowReservePx(7) in the b2-review ledger

  it('is comparable to a hand — neither an afterthought nor the full-padding table', () => {
    const dd = doubleDummyReservePx()
    // Within a quarter of a hand's reserve: the corner reads as a peer of the hands.
    expect(dd).toBeGreaterThan(HAND_RESERVE_PX * 0.75)
    expect(dd).toBeLessThanOrEqual(HAND_RESERVE_PX * 1.05)
  })

  it('still fits the SE allocation without forcing the scale down', () => {
    // Measured allocation at the reported viewport. If the reserve creeps past this,
    // the arranger clamps the scale BELOW the seat scale and the corner stops
    // tracking — bigger native, smaller render.
    const SE_ALLOCATED_PX = 216
    expect(doubleDummyReservePx()).toBeLessThanOrEqual(SE_ALLOCATED_PX)
  })
})

// Shape-awareness (2026-07-30). The DD table renders in more than one shape now, and
// a reserve reporting a single number would mis-provision the rest — the same trap
// §6.2 hit with the auction, where auctionReservePx() provisioned a NORMAL auction and
// compare mode systematically under-reserved.
describe('doubleDummyReservePx — shape-aware', () => {
  it('defaults to the upright corner form, unchanged for existing callers', () => {
    expect(doubleDummyReservePx()).toBe(DD_COMPACT_MEASURED_PX + 6)
    expect(doubleDummyReservePx({})).toBe(doubleDummyReservePx())
  })

  it('rotated is much narrower — that is the point of offering it', () => {
    expect(doubleDummyReservePx({ rotated: true })).toBeLessThan(doubleDummyReservePx())
    // roughly half the upright width
    expect(doubleDummyReservePx({ rotated: true })).toBeLessThan(doubleDummyReservePx() * 0.7)
  })

  it('rotated widens with four declarer columns rather than two', () => {
    const two = doubleDummyReservePx({ rotated: true, rows: 2 })
    const four = doubleDummyReservePx({ rotated: true, rows: 4 })
    expect(four).toBeGreaterThan(two)
    // 3 rows (one pair split) is 3 declarer COLUMNS when rotated — wider than 2, so
    // it must provision like 4. Asserting it equalled `two` was a tautology that hid
    // exactly the under-reserve this function exists to prevent.
    expect(doubleDummyReservePx({ rotated: true, rows: 3 })).toBe(four)
    expect(doubleDummyReservePx({ rotated: true, rows: 3 })).toBeGreaterThan(two)
  })

  it('row count does not affect the upright width (rows are rows there)', () => {
    expect(doubleDummyReservePx({ rows: 4 })).toBe(doubleDummyReservePx({ rows: 2 }))
  })
})
