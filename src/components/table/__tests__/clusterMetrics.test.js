// The corner-cluster reserves exist to express ONE thing the role-derived defaults
// can't: a corner's width depends on which cluster members the viewer actually gets.
// The property that matters is therefore "a viewer with no controls reserves nothing
// for them" — if that regresses, B3's NW silently holds a column of empty space for
// a transport an invited player never sees, which is the exact bug this replaced.
import { describe, it, expect } from 'vitest'
import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../../boardIndicatorMetrics.js'
import {
  CLUSTER_UNIT,
  dealControlsReservePx,
  actionClusterReservePx,
  doubleDummyReservePx,
} from '../clusterMetrics.js'

describe('dealControlsReservePx (NW transport)', () => {
  it('reserves nothing when the viewer gets no transport (the B3 guest case)', () => {
    expect(dealControlsReservePx({ showRestart: false, showNext: false, showRestartCardplay: false })).toBe(0)
  })

  it('grows with the button count, then WRAPS rather than growing further', () => {
    const one = dealControlsReservePx({ showRestart: true, showNext: false })
    const two = dealControlsReservePx({ showRestart: true, showNext: true })
    const three = dealControlsReservePx({ showRestart: true, showNext: true, showRestartCardplay: true })
    expect(one).toBe(CLUSTER_UNIT.iconBtnPx)
    expect(two).toBe(2 * CLUSTER_UNIT.iconBtnPx + CLUSTER_UNIT.gapPx)
    // The third icon wraps onto a second line instead of widening the corner.
    expect(three).toBe(two)
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

  it('grows horizontally — Undo (icon) and Claim (text) sit side by side', () => {
    const undo = actionClusterReservePx({ showUndo: true })
    const both = actionClusterReservePx({ showUndo: true, showClaim: true })
    expect(undo).toBe(CLUSTER_UNIT.iconBtnPx)
    expect(both).toBe(CLUSTER_UNIT.iconBtnPx + CLUSTER_UNIT.textBtnPx + CLUSTER_UNIT.gapPx)
    expect(both).toBeGreaterThan(undo)
  })
})

describe('doubleDummyReservePx (SE at review)', () => {
  it('is wider than the action cluster — the reason SE needs a per-phase reserve', () => {
    expect(doubleDummyReservePx()).toBeGreaterThan(actionClusterReservePx({ showUndo: true, showClaim: true }))
  })
})
