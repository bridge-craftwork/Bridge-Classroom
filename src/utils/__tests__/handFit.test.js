import { describe, it, expect } from 'vitest'
import { computeFit, LEGIBILITY_FLOOR } from '../handFit.js'

// Per-card natural widths → cumulative right-edges (what HandDisplay measures).
const cum = (widths) => widths.reduce((acc, w) => { acc.push((acc.at(-1) || 0) + w); return acc }, [])

describe('computeFit', () => {
  it('fits at scale 1 (no chip, all visible) when cards fit', () => {
    expect(computeFit({ cumWidths: cum([12, 12, 12, 12]), available: 100 }))
      .toEqual({ scale: 1, visible: 4, hidden: 0 })
  })

  it('compresses between floor and 1 without truncating', () => {
    // natural 100, available 80 → scale 0.8 ≥ floor → one line, all visible.
    const f = computeFit({ cumWidths: cum(Array(10).fill(10)), available: 80, chipReserve: 8 })
    expect(f.hidden).toBe(0)
    expect(f.visible).toBe(10)
    expect(f.scale).toBeCloseTo(0.8, 5)
  })

  it('truncation TEST excludes the chip: cards fitting at the floor never truncate', () => {
    // natural 100, available 66 → scale 0.66 ≥ floor(0.65): NOT truncated, even
    // though cards + a fat chip would overflow at the floor.
    const f = computeFit({ cumWidths: cum(Array(10).fill(10)), available: 66, chipReserve: 40 })
    expect(f.hidden).toBe(0)
    expect(f.visible).toBe(10)
  })

  it('truncates at the floor with a chip when the cards do not fit', () => {
    const f = computeFit({ cumWidths: cum(Array(11).fill(10)), available: 50, chipReserve: 8 })
    expect(f.scale).toBe(LEGIBILITY_FLOOR)
    expect(f.hidden).toBeGreaterThan(0)
    expect(f.visible + f.hidden).toBe(11)
  })

  it('allowTruncate:false never truncates — compresses the whole suit below the floor', () => {
    // Same cramped input that truncates by default, but no popup to reach hidden
    // cards → show ALL of them, compressed under the floor (bug-artifacts #6).
    const widths = Array(5).fill(12) // natural 60; available 35 → 0.58 < floor
    const d = computeFit({ cumWidths: cum(widths), available: 35, chipReserve: 8 })
    expect(d.hidden).toBeGreaterThan(0) // default truncates
    const f = computeFit({ cumWidths: cum(widths), available: 35, chipReserve: 8, allowTruncate: false })
    expect(f.hidden).toBe(0)           // all visible
    expect(f.visible).toBe(5)
    expect(f.scale).toBeLessThan(LEGIBILITY_FLOOR) // and it went below the floor to fit them
  })

  it('COUNT includes the chip: visible cards + chip never exceed the floor budget', () => {
    const widths = Array(11).fill(10)
    const f = computeFit({ cumWidths: cum(widths), available: 50, chipReserve: 8 })
    const budget = 50 / LEGIBILITY_FLOOR
    expect(cum(widths)[f.visible - 1] + 8).toBeLessThanOrEqual(budget)
  })

  describe('play-state invariants', () => {
    it('monotone un-truncation: +N never increases as cards are played', () => {
      // 11-card suit in a tight zone; play cards (remove them) over time.
      let widths = Array(11).fill(10)
      const available = 45
      const chipReserve = 8
      const playOrder = [3, 0, 5, 2, 1] // arbitrary indices, visible or hidden
      let prevHidden = Infinity
      for (let step = 0; step <= playOrder.length; step++) {
        const f = computeFit({ cumWidths: cum(widths), available, chipReserve })
        expect(f.hidden).toBeLessThanOrEqual(prevHidden)
        prevHidden = f.hidden
        if (step < playOrder.length) widths.splice(playOrder[step] % widths.length, 1)
      }
      // Enough played → the remainder fits → chip gone.
      expect(prevHidden).toBe(0)
    })

    it('a played (removed) card only ever frees width — visible remainder never shrinks', () => {
      const before = computeFit({ cumWidths: cum(Array(9).fill(10)), available: 40, chipReserve: 8 })
      // Remove one card → 8 remain in the same zone.
      const after = computeFit({ cumWidths: cum(Array(8).fill(10)), available: 40, chipReserve: 8 })
      expect(after.visible).toBeGreaterThanOrEqual(before.visible)
      expect(after.hidden).toBeLessThanOrEqual(before.hidden)
    })

    it('+N reaching zero vacates cleanly (no chip) once the suit fits', () => {
      expect(computeFit({ cumWidths: cum(Array(3).fill(10)), available: 200, chipReserve: 8 }).hidden).toBe(0)
    })

    it('per-row independence: fit is a pure function of one row’s inputs', () => {
      const a = computeFit({ cumWidths: cum(Array(8).fill(12)), available: 60, chipReserve: 8 })
      const b = computeFit({ cumWidths: cum(Array(8).fill(12)), available: 60, chipReserve: 8 })
      expect(a).toEqual(b)
    })
  })
})
