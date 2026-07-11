import { describe, it, expect, afterEach } from 'vitest'
import { collectLayout } from '../layout.js'
import { resolveTableConfig, matchShell } from '../tableConfigSnapshot.js'

// happy-dom: getComputedStyle reflects inline styles (incl. custom properties);
// getBoundingClientRect returns 0s (no layout engine), so we assert structure +
// the style/var fields, not pixel widths.
function mount(html) {
  document.body.innerHTML = html
  return { doc: document, win: window }
}
afterEach(() => { document.body.innerHTML = '' })

describe('collectLayout', () => {
  it('returns null when there are no table components on the page', () => {
    expect(collectLayout(mount('<div class="unrelated">x</div>'))).toBeNull()
  })

  it('returns null without a DOM (tests / SSR)', () => {
    expect(collectLayout({ doc: null, win: {} })).toBeNull()
  })

  it('captures known anchors with their min-width and scale vars', () => {
    const out = collectLayout(mount(`
      <div class="seat-panel compact" style="min-width:240px;--table-scale:1.25">
        <div class="holding">
          <div class="suit-row" style="--suit-scale:0.65"></div>
          <div class="suit-row"></div>
        </div>
      </div>`))
    expect(out).not.toBeNull()
    const seat = out.anchors.find((a) => a.sel.includes('seat-panel'))
    expect(seat.sel).toBe('div.seat-panel.compact')
    expect(seat.minW).toBe('240px')
    expect(seat.vars.ts).toBe('1.25')
    // the compressed suit row exposes --suit-scale; a plain one has no vars key
    const rows = out.anchors.filter((a) => a.sel.includes('suit-row'))
    expect(rows.find((r) => r.vars?.ss === '0.65')).toBeTruthy()
    expect(rows.find((r) => r.vars === undefined)).toBeTruthy()
  })

  it('records a non-default display (reveals shrink-wrap / flex context)', () => {
    const out = collectLayout(mount('<div class="grid-table" style="display:flex"></div>'))
    expect(out.anchors[0].disp).toBe('flex')
  })

  it('does not double-count an element matched by two anchors', () => {
    // (only one .holding — sanity that de-dup Set works across the anchor loop)
    const out = collectLayout(mount('<div class="holding"><div class="suit-row"></div></div>'))
    const holdings = out.anchors.filter((a) => a.sel === 'div.holding')
    expect(holdings).toHaveLength(1)
  })

  it('includes the primary hand box ancestry, flagging Vue scope attrs', () => {
    const out = collectLayout(mount(`
      <main data-v-abc123>
        <div class="practice-left">
          <div class="seat-panel"><div class="holding"></div></div>
        </div>
      </main>`))
    expect(out.ancestry[0].sel).toContain('holding')
    expect(out.ancestry.some((a) => a.sel.includes('practice-left'))).toBe(true)
    // <main> carries a data-v-* scoped-style attr → scoped:true; the plain
    // .practice-left (unscoped block, the #172 tell) → scoped:false.
    expect(out.ancestry.some((a) => a.scoped === true)).toBe(true)
    expect(out.ancestry.some((a) => a.sel.includes('practice-left') && a.scoped === false)).toBe(true)
  })
})

describe('resolveTableConfig', () => {
  const cfg = {
    arrangement: 'grid',
    orientation: 'south',
    tracks: { columns: [1.1, 1.3, 1.1], rows: [0.85, 1.15, 1.3] },
    scale: { caps: { center: 1.8, seats: 1.4, se: 'seats' }, legibilityFloor: 0.65 },
    densities: { bidding: { ne: 'none' }, play: { ne: 'full' } },
    shell: { perViewport: [
      { minWidth: 1000, mode: 'two-column', companionPosition: 'right' },
      { maxWidth: 999, mode: 'stacked', companionPosition: 'below' },
    ] },
  }

  it('returns null for a null/legacy config (spreads safely)', () => {
    expect(resolveTableConfig(null)).toBeNull()
    expect(resolveTableConfig(undefined, 'play', { w: 1440, h: 900 })).toBeNull()
  })

  it('flattens caps/tracks/orientation and the CURRENT-phase density only', () => {
    const snap = resolveTableConfig(cfg, 'play', { w: 1440, h: 900 })
    expect(snap.arrangement).toBe('grid')
    expect(snap.orientation).toBe('south')
    expect(snap.tracks.columns).toEqual([1.1, 1.3, 1.1])
    expect(snap.caps.se).toBe('seats')
    expect(snap.legibilityFloor).toBe(0.65)
    expect(snap.density).toEqual({ ne: 'full' }) // play phase only, not bidding
    expect(snap.phase).toBe('play')
  })

  it('resolves the shell rule the viewport actually matched', () => {
    expect(resolveTableConfig(cfg, 'bidding', { w: 1440, h: 900 }).shell)
      .toEqual({ mode: 'two-column', companion: 'right' })
    // portrait tablet (820 wide) → maxWidth 999 → stacked
    expect(resolveTableConfig(cfg, 'bidding', { w: 820, h: 1180 }).shell)
      .toEqual({ mode: 'stacked', companion: 'below' })
  })
})

describe('matchShell', () => {
  const shell = { perViewport: [
    { minWidth: 1000, mode: 'two-column' },
    { portrait: true, mode: 'stacked', companionPosition: 'below' },
    { maxWidth: 999, mode: 'drawer' },
  ] }
  it('first hit wins; portrait is honored before the maxWidth fallback', () => {
    expect(matchShell(shell, { w: 1440, h: 900 })).toEqual({ mode: 'two-column', companion: null })
    expect(matchShell(shell, { w: 820, h: 1180 })).toEqual({ mode: 'stacked', companion: 'below' })
    expect(matchShell(shell, { w: 720, h: 500 })).toEqual({ mode: 'drawer', companion: null })
  })
  it('returns null when there is no perViewport or viewport', () => {
    expect(matchShell(null, { w: 1000, h: 800 })).toBeNull()
    expect(matchShell(shell, null)).toBeNull()
  })
})
