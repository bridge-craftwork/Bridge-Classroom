import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BiddingBox from '../BiddingBox.vue'

const box = (lastBid) => mount(BiddingBox, { props: { lastBid } })
const levels = (w) => w.findAll('.level-btn').map((b) => ({
  disabled: b.attributes('disabled') !== undefined,
  active: b.classes().includes('active'),
}))
const strains = (w) => w.findAll('.strain-btn').map((b) => b.attributes('disabled') !== undefined)

// Legality greying of the bidding box (2026-07-13 report). Levels below the minimum
// legal level are greyed, the box opens on the lowest legal level, and strains that
// can't outbid the last call at that level are greyed.
describe('BiddingBox — illegal bids greyed', () => {
  it('opening (no prior bid): every level + strain legal, level 1 selected', () => {
    const w = box(null)
    const L = levels(w)
    expect(L.every((l) => !l.disabled)).toBe(true)
    expect(L[0].active).toBe(true) // level 1 is the lowest legal
    expect(strains(w).every((s) => !s)).toBe(true)
  })

  it('after 2H: level 1 greyed, level 2 auto-selected, only 2S/2NT legal', () => {
    const w = box('2H')
    const L = levels(w)
    expect(L[0].disabled).toBe(true) // 1 — illegal below 2H
    expect(L[1].disabled).toBe(false) // 2 — legal
    expect(L[1].active).toBe(true) // auto-selected to the lowest legal level
    expect(L.slice(2).every((l) => !l.disabled)).toBe(true) // 3–7 legal
    // Strains at the selected level 2: C, D, H greyed; S, NT bidable.
    expect(strains(w)).toEqual([true, true, true, false, false])
  })

  it('after 3D: levels 1–2 greyed; at level 3 only 3H/3S/3NT bidable', () => {
    const w = box('3D')
    const L = levels(w)
    expect(L[0].disabled).toBe(true)
    expect(L[1].disabled).toBe(true)
    expect(L[2].disabled).toBe(false)
    expect(L[2].active).toBe(true)
    expect(strains(w)).toEqual([true, true, false, false, false]) // 3C,3D grey; 3H,3S,3NT ok
  })

  it('pathological 7NT (only Pass legal): every level AND strain greyed, none active', () => {
    const w = box('7NT')
    expect(levels(w).every((l) => l.disabled && !l.active)).toBe(true)
    expect(strains(w).every((s) => s)).toBe(true)
  })

  it('a doubled 7NTXX parses its strain — no phantom legal bids', () => {
    const w = box('7NTXX')
    expect(levels(w).every((l) => l.disabled)).toBe(true)
    expect(strains(w).every((s) => s)).toBe(true)
  })
})
