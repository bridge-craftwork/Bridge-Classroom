import { describe, it, expect, beforeEach } from 'vitest'
import {
  readOverlaysParam, initDebugOverlays, useDebugOverlays,
  setDebugOverlays, DEBUG_OVERLAYS_KEY, __resetDebugOverlaysForTests,
} from '../useDebugOverlays.js'

const loc = (search = '', hash = '#/') => ({ search, hash })
const attrOn = () => document.documentElement.hasAttribute('data-bounding-boxes')

describe('readOverlaysParam', () => {
  it('reads truthy/falsey values from search or hash query', () => {
    expect(readOverlaysParam(loc('?bounding-boxes=1'))).toBe(true)
    expect(readOverlaysParam(loc('', '#/x?bounding-boxes=on'))).toBe(true)
    expect(readOverlaysParam(loc('?bounding-boxes=0'))).toBe(false)
    expect(readOverlaysParam(loc('?bounding-boxes=off'))).toBe(false)
    expect(readOverlaysParam(loc('?other=1'))).toBeNull()
    expect(readOverlaysParam(null)).toBeNull()
  })
})

describe('useDebugOverlays (singleton flag → data-bounding-boxes on <html>)', () => {
  beforeEach(() => {
    __resetDebugOverlaysForTests()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('defaults off — no attribute, no stored key', () => {
    initDebugOverlays(loc())
    expect(useDebugOverlays().enabled.value).toBe(false)
    expect(attrOn()).toBe(false)
  })

  it('?bounding-boxes=1 enables, sets the attribute, and persists', () => {
    initDebugOverlays(loc('?bounding-boxes=1'))
    expect(useDebugOverlays().enabled.value).toBe(true)
    expect(attrOn()).toBe(true)
    expect(localStorage.getItem(DEBUG_OVERLAYS_KEY)).toBe('1')
  })

  it('a persisted flag survives a later plain visit', () => {
    localStorage.setItem(DEBUG_OVERLAYS_KEY, '1')
    initDebugOverlays(loc())
    expect(useDebugOverlays().enabled.value).toBe(true)
    expect(attrOn()).toBe(true)
  })

  it('?bounding-boxes=0 turns it off and clears the key', () => {
    localStorage.setItem(DEBUG_OVERLAYS_KEY, '1')
    initDebugOverlays(loc('?bounding-boxes=0'))
    expect(useDebugOverlays().enabled.value).toBe(false)
    expect(attrOn()).toBe(false)
    expect(localStorage.getItem(DEBUG_OVERLAYS_KEY)).toBeNull()
  })

  it('toggle flips the attribute + persistence both ways', () => {
    initDebugOverlays(loc())
    const { toggle, enabled } = useDebugOverlays()
    toggle()
    expect(enabled.value).toBe(true)
    expect(attrOn()).toBe(true)
    expect(localStorage.getItem(DEBUG_OVERLAYS_KEY)).toBe('1')
    toggle()
    expect(enabled.value).toBe(false)
    expect(attrOn()).toBe(false)
    expect(localStorage.getItem(DEBUG_OVERLAYS_KEY)).toBeNull()
  })
})
