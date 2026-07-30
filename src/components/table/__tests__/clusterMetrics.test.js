// The corner-cluster reserves exist to express ONE thing the role-derived defaults
// can't: a corner's width depends on which cluster members the viewer actually gets.
// The property that matters is therefore "a viewer with no controls reserves nothing
// for them" — if that regresses, B3's NW silently holds a column of empty space for
// a transport an invited player never sees, which is the exact bug this replaced.
import { describe, it, expect } from 'vitest'
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

  it('is one button wide however many stack — the cluster is a column, not a row', () => {
    const one = dealControlsReservePx({ showRestart: true, showNext: false })
    const three = dealControlsReservePx({ showRestart: true, showNext: true, showRestartCardplay: true })
    expect(one).toBe(CLUSTER_UNIT.stackedBtnPx)
    expect(three).toBe(one)
  })
})

describe('actionClusterReservePx (SE actions)', () => {
  it('reserves nothing when neither button renders', () => {
    expect(actionClusterReservePx({ showUndo: false, showClaim: false })).toBe(0)
  })

  it('grows horizontally — Undo and Claim sit side by side', () => {
    const undo = actionClusterReservePx({ showUndo: true })
    const both = actionClusterReservePx({ showUndo: true, showClaim: true })
    expect(undo).toBe(CLUSTER_UNIT.inlineBtnPx)
    expect(both).toBe(2 * CLUSTER_UNIT.inlineBtnPx + CLUSTER_UNIT.gapPx)
    expect(both).toBeGreaterThan(undo)
  })
})

describe('doubleDummyReservePx (SE at review)', () => {
  it('is wider than the action cluster — the reason SE needs a per-phase reserve', () => {
    expect(doubleDummyReservePx()).toBeGreaterThan(actionClusterReservePx({ showUndo: true, showClaim: true }))
  })
})
