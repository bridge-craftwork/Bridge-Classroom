// The beta height solve, pinned against the two MEASURED cases it was built from.
//
// Both are 1516×836, the viewport the reports and the harness runs agree on:
//  · b1-review  — four hands + the review stage; the case that kept ending ~8px
//    below the fold because the fit over-predicted what shrinking the hands buys.
//  · the 2026-07-30 bidding report — a grown auction (1.68×) with South and the
//    bidding box clipped off the bottom.
//
// Heights below are the real measured region boxes, not invented numbers.
import { describe, it, expect } from 'vitest'
import { solveHeightFit } from '../gridArranger.js'

// b1-review @1516×836: NW is the top row's binding region (the glyph + status +
// transport cluster, 235px) — TALLER than the North hand it shares the row with.
const REVIEW = {
  rows: [
    [{ area: 'nw', h: 235, kind: 'fixed' }, { area: 'n', h: 188, kind: 'seat', hand: true }, { area: 'ne', h: 117, kind: 'fixed' }],
    [{ area: 'w', h: 188, kind: 'seat', hand: true }, { area: 'center', h: 220, kind: 'center' }, { area: 'e', h: 188, kind: 'seat', hand: true }],
    [{ area: 's', h: 188, kind: 'seat', hand: true }, { area: 'se', h: 126, kind: 'action' }],
  ],
  gridH: 708,
  heightBudget: 674,
  seatScale: 0.79,
  centerScale: 1,
}

// The bidding report: only South holds a hand, so E/W are 91px chips; the centre is a
// 3-round auction grown to 1.68×; the bidding box (SE, cap 'seats') is 206px at 1.0×.
const BIDDING = {
  rows: [
    [{ area: 'nw', h: 129, kind: 'fixed' }, { area: 'n', h: 91, kind: 'seat', hand: false }],
    [{ area: 'w', h: 91, kind: 'seat', hand: false }, { area: 'center', h: 256, kind: 'center' }, { area: 'e', h: 91, kind: 'seat', hand: false }],
    [{ area: 's', h: 328, kind: 'seat', hand: true }, { area: 'se', h: 206, kind: 'action' }],
  ],
  gridH: 776,
  heightBudget: 638,
  seatScale: 1.4,
  centerScale: 1.68,
}

// The SECOND bidding bundle, 35 minutes later on the same build ("south and SE are
// still sliding offscreen as the auction increases row count"). Same defect, caught at
// a different auction length — a shorter stage (181 vs 256) but the same null ceilings.
// Kept alongside the first because it pins a different point on the same curve: here
// the centre giving up its growth is enough on its own, and the hands pay nothing.
const BIDDING_SHORTER = {
  rows: [
    [{ area: 'nw', h: 129, kind: 'fixed' }, { area: 'n', h: 91, kind: 'seat', hand: false }],
    [{ area: 'w', h: 91, kind: 'seat', hand: false }, { area: 'center', h: 181, kind: 'center' }, { area: 'e', h: 91, kind: 'seat', hand: false }],
    [{ area: 's', h: 328, kind: 'seat', hand: true }, { area: 'se', h: 206, kind: 'action' }],
  ],
  gridH: 702,
  heightBudget: 638,
  seatScale: 1.4,
  centerScale: 1.68,
}

// Re-derive the stack height the solve is predicting, so a test failure says WHICH
// row moved rather than just "a number changed".
function predictHeight({ rows, gridH, seatScale, centerScale }, { seatTarget, centerMode }) {
  const k = seatTarget / seatScale
  const seatCeil = Math.min(1, seatScale)
  const midSeatH = Math.max(0, ...rows[1].filter((m) => m.kind === 'seat').map((m) => m.h))
  const hAt = (m) => {
    if (m.kind === 'seat') return m.h * k
    if (m.kind === 'action') return m.h * (Math.min(1, seatScale * k) / seatCeil)
    if (m.kind === 'center') {
      if (centerMode === 'equalise') return midSeatH * k
      if (centerMode === 'natural') return m.h / centerScale
      return m.h
    }
    return m.h
  }
  return rows.reduce(
    (t, ms) => t + (ms.reduce((h, m) => Math.max(h, hAt(m)), 0) - ms.reduce((h, m) => Math.max(h, m.h), 0)),
    gridH,
  )
}

describe('solveHeightFit — review (the 8px residual)', () => {
  const out = solveHeightFit(REVIEW)

  it('equalises the middle row instead of capping the centre at natural', () => {
    // The centre is 220 against 188 hands beside it, so it has a peer to match.
    expect(out.centerMode).toBe('equalise')
    // ~188/220 of its current 1.0× — BELOW natural, which cap-at-natural couldn't reach.
    expect(out.centerTarget).toBe(0.84)
  })

  it('costs the hands ~nothing — the 32px the centre gives up covers the overflow', () => {
    // Was: every pass shrank the hands (to the 0.65 floor in the reported case) and
    // the stack STILL ended below the fold. Now they give up a single hundredth.
    expect(out.seatTarget).toBe(0.78)
    expect(out.seatTarget).toBeGreaterThan(REVIEW.seatScale - 0.02)
  })

  it('fits inside the height budget in ONE solve', () => {
    expect(predictHeight(REVIEW, out)).toBeLessThanOrEqual(REVIEW.heightBudget)
  })

  it('does not credit the NW-bound top row with height the hands cannot pay', () => {
    // The over-prediction that caused the residual: the old model counted North's
    // 188px as scalable, though the row is pinned at NW's 235 whatever the hands do.
    const noNw = {
      ...REVIEW,
      rows: [[{ area: 'n', h: 188, kind: 'seat' }], REVIEW.rows[1], REVIEW.rows[2]],
      gridH: 708 - 47, // the row shrinks to the North hand
      heightBudget: 674 - 47,
    }
    // Same relative pressure, but now the top row genuinely scales — the solve is
    // allowed to charge the hands for it, and does.
    expect(solveHeightFit(noNw).seatTarget).toBeLessThanOrEqual(out.seatTarget)
  })
})

describe('solveHeightFit — bidding (the 2026-07-30 report)', () => {
  const out = solveHeightFit(BIDDING)

  it('spends the centre growth first when the middle row holds no hand', () => {
    // E/W are chips: there is no peer height to equalise to, so #363's rule stands.
    expect(out.centerMode).toBe('natural')
    expect(out.centerTarget).toBe(1)
  })

  it('brings the stack inside the fold — South and the box stop being clipped', () => {
    expect(predictHeight(BIDDING, out)).toBeLessThanOrEqual(BIDDING.heightBudget)
  })

  it('keeps the hands well above the floor (1.68× of stage was the real surplus)', () => {
    expect(out.seatTarget).toBeGreaterThan(1.2)
    expect(out.seatTarget).toBeLessThan(BIDDING.seatScale)
  })

  it('does not promise height the action corner cannot give back', () => {
    // SE rides min(1, seatScale): flat while the seats are above natural. Modelling it
    // as plainly proportional would let the solve leave the hands too large.
    const flat = solveHeightFit({
      ...BIDDING,
      rows: [BIDDING.rows[0], BIDDING.rows[1], [{ area: 's', h: 328, kind: 'seat' }, { area: 'se', h: 206, kind: 'fixed' }]],
    })
    expect(flat.seatTarget).toBeCloseTo(out.seatTarget, 2)
  })
})

describe('solveHeightFit — bidding, second bundle (shorter auction, same defect)', () => {
  const out = solveHeightFit(BIDDING_SHORTER)

  it('costs the hands NOTHING — the stage’s surplus growth covers the whole overflow', () => {
    expect(out.centerTarget).toBe(1)
    expect(out.seatTarget).toBe(BIDDING_SHORTER.seatScale) // 1.4, untouched
  })

  it('fits: 702 → 629 against a 638 budget', () => {
    expect(Math.round(predictHeight(BIDDING_SHORTER, out))).toBe(629)
  })
})

describe('solveHeightFit — guards', () => {
  it('never returns a seat scale below the legibility floor', () => {
    const out = solveHeightFit({ ...REVIEW, heightBudget: 200 })
    expect(out.seatTarget).toBeGreaterThanOrEqual(0.65)
  })

  it('equalises DOWNWARD only — a centre smaller than the hands is not grown to match', () => {
    const out = solveHeightFit({
      ...REVIEW,
      rows: [REVIEW.rows[0], [{ area: 'w', h: 188, kind: 'seat', hand: true }, { area: 'center', h: 120, kind: 'center' }], REVIEW.rows[2]],
    })
    expect(out.centerMode).toBe('equalise')
    expect(out.centerTarget).toBe(REVIEW.centerScale) // unchanged: nothing to reclaim
  })

  it('holds the equalisation at the SOLVED hand size, not the current one', () => {
    // The regression this pins: at pass 1 the centre measured 202 against 203px hands
    // (equal), the solve then took the hands to 173 — and the stage was the tallest
    // thing in its row again, 29px clear. Equalising against today's hands is not
    // equalising.
    const rows = [
      [{ area: 'nw', h: 235, kind: 'fixed' }, { area: 'n', h: 203, kind: 'seat', hand: true }],
      [{ area: 'w', h: 203, kind: 'seat', hand: true }, { area: 'center', h: 202, kind: 'center' }, { area: 'e', h: 203, kind: 'seat', hand: true }],
      [{ area: 's', h: 203, kind: 'seat', hand: true }, { area: 'se', h: 126, kind: 'action' }],
    ]
    const out = solveHeightFit({ rows, gridH: 705, heightBudget: 674, seatScale: 0.85, centerScale: 0.92 })
    expect(out.centerMode).toBe('equalise')
    const handH = 203 * (out.seatTarget / 0.85)
    const centerH = 202 * (out.centerTarget / 0.92)
    expect(centerH).toBeLessThanOrEqual(handH + 2)
  })

  it('returns null on nonsense input rather than a scale', () => {
    expect(solveHeightFit({ rows: [], gridH: 700, heightBudget: 600, seatScale: 1, centerScale: 1 })).toBeNull()
    expect(solveHeightFit({ rows: REVIEW.rows, gridH: 700, heightBudget: 600, seatScale: 0, centerScale: 1 })).toBeNull()
  })
})
