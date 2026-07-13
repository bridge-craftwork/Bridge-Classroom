import { describe, it, expect, beforeEach } from 'vitest'
import { initArrangement, useArrangement, setArrangement, __resetArrangementForTests } from '../useArrangement.js'
import { ARRANGEMENT_STORAGE_KEY } from '../../utils/arrangement.js'

const loc = (search = '', hash = '#/') => ({ search, hash })

describe('useArrangement (singleton: read once, persist a query override)', () => {
  beforeEach(() => {
    __resetArrangementForTests()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('defaults to legacy with no param and no storage', () => {
    initArrangement(loc())
    const { arrangement, arrangementSource } = useArrangement()
    expect(arrangement.value).toBe('legacy')
    expect(arrangementSource.value).toBe('default')
    expect(localStorage.getItem(ARRANGEMENT_STORAGE_KEY)).toBeNull()
  })

  it('a ?arrangement=grid query selects grid AND persists it', () => {
    initArrangement(loc('?arrangement=grid'))
    const { arrangement, arrangementSource } = useArrangement()
    expect(arrangement.value).toBe('grid')
    expect(arrangementSource.value).toBe('query')
    expect(localStorage.getItem(ARRANGEMENT_STORAGE_KEY)).toBe('grid')
  })

  it('a persisted grid override survives a later visit with no param (source = localStorage)', () => {
    localStorage.setItem(ARRANGEMENT_STORAGE_KEY, 'grid')
    initArrangement(loc())
    const { arrangement, arrangementSource } = useArrangement()
    expect(arrangement.value).toBe('grid')
    expect(arrangementSource.value).toBe('localStorage')
  })

  it('?arrangement=legacy reverts and clears the persisted key', () => {
    localStorage.setItem(ARRANGEMENT_STORAGE_KEY, 'grid')
    initArrangement(loc('?arrangement=legacy'))
    const { arrangement } = useArrangement()
    expect(arrangement.value).toBe('legacy')
    expect(localStorage.getItem(ARRANGEMENT_STORAGE_KEY)).toBeNull()
  })

  it('setArrangement marks provenance by value-vs-default (drives the profile ring)', () => {
    initArrangement(loc())
    const { arrangement, arrangementSource } = useArrangement()
    setArrangement('grid')
    expect(arrangement.value).toBe('grid')
    expect(arrangementSource.value).toBe('query') // override → orange
    expect(localStorage.getItem(ARRANGEMENT_STORAGE_KEY)).toBe('grid')
    setArrangement('legacy')
    expect(arrangement.value).toBe('legacy')
    expect(arrangementSource.value).toBe('default') // back to default → green
    expect(localStorage.getItem(ARRANGEMENT_STORAGE_KEY)).toBeNull()
  })
})
