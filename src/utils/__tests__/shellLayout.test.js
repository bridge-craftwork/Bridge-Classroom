// The rule this file encodes is the one that actually broke: TableShell hardcoded
// `@media (max-width: 800px)` while the config said stack at <=999px, so every
// viewport in the 801–999 band kept a two-column layout the config had ruled out —
// and iPad portrait (820×1180) sits in that band. These tests pin the resolution so
// the render and the bug report can't disagree again.
import { describe, it, expect } from 'vitest'
import { matchShell, isStacked, DEFAULT_SHELL } from '../shellLayout.js'

// The live practice-table policy, in config order.
const SHELL = {
  perViewport: [
    { portrait: true, mode: 'stacked', companionPosition: 'below' },
    { minWidth: 1000, mode: 'two-column', companionPosition: 'right' },
    { maxWidth: 999, mode: 'stacked', companionPosition: 'below' },
  ],
}

describe('matchShell', () => {
  it('stacks iPad PORTRAIT — the case the hardcoded 800px breakpoint missed', () => {
    const r = matchShell(SHELL, { w: 820, h: 1180 })
    expect(r).toEqual({ mode: 'stacked', companion: 'below' })
    expect(isStacked(r)).toBe(true)
  })

  it('keeps two columns on iPad LANDSCAPE at the same physical device', () => {
    const r = matchShell(SHELL, { w: 1180, h: 820 })
    expect(r).toEqual({ mode: 'two-column', companion: 'right' })
    expect(isStacked(r)).toBe(false)
  })

  it('stacks a narrow landscape window (below the width rule)', () => {
    expect(matchShell(SHELL, { w: 900, h: 700 })).toEqual({ mode: 'stacked', companion: 'below' })
  })

  it('portrait wins over width — a tall wide screen still stacks', () => {
    // Rule order matters: portrait is listed first deliberately, so a 1200×1600
    // display stacks rather than matching the >=1000 two-column rule.
    expect(matchShell(SHELL, { w: 1200, h: 1600 })).toEqual({ mode: 'stacked', companion: 'below' })
  })

  it('returns null when it cannot resolve, so callers can fall back', () => {
    expect(matchShell(null, { w: 1200, h: 800 })).toBeNull()
    expect(matchShell(SHELL, null)).toBeNull()
    expect(matchShell(SHELL, { h: 800 })).toBeNull()
    expect(DEFAULT_SHELL).toEqual({ mode: 'two-column', companion: 'right' })
  })

  it('treats a missing height as orientation-unknown rather than guessing', () => {
    // h absent → portrait is null → the portrait rule cannot match, and resolution
    // falls through to the width rules. Guessing an orientation here would silently
    // change layout for any caller that only knows its width.
    expect(matchShell(SHELL, { w: 820 })).toEqual({ mode: 'stacked', companion: 'below' })
    expect(matchShell(SHELL, { w: 1180 })).toEqual({ mode: 'two-column', companion: 'right' })
  })
})

describe('isStacked', () => {
  it('counts above/below as stacked and left/right as columns', () => {
    expect(isStacked({ mode: 'x', companion: 'below' })).toBe(true)
    expect(isStacked({ mode: 'x', companion: 'above' })).toBe(true)
    expect(isStacked({ mode: 'two-column', companion: 'left' })).toBe(false)
    expect(isStacked({ mode: 'stacked', companion: null })).toBe(true)
    expect(isStacked(null)).toBe(false)
  })
})
