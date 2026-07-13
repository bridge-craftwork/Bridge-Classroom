import { describe, it, expect } from 'vitest'
import {
  normalizeArrangement, readArrangementParam, resolveArrangement,
  DEFAULT_ARRANGEMENT,
} from '../arrangement.js'

describe('normalizeArrangement', () => {
  it('accepts the two valid arrangements, rejects everything else', () => {
    expect(normalizeArrangement('grid')).toBe('grid')
    expect(normalizeArrangement('legacy')).toBe('legacy')
    expect(normalizeArrangement('compass')).toBeNull()
    expect(normalizeArrangement('')).toBeNull()
    expect(normalizeArrangement(null)).toBeNull()
    expect(normalizeArrangement(undefined)).toBeNull()
  })
})

describe('readArrangementParam', () => {
  it('reads from the search string (before the hash)', () => {
    expect(readArrangementParam({ search: '?arrangement=grid', hash: '#/lesson' })).toBe('grid')
  })
  it('reads from the hash query (after the hash — hash routing)', () => {
    expect(readArrangementParam({ search: '', hash: '#/lesson?arrangement=grid' })).toBe('grid')
  })
  it('search wins over hash when both present', () => {
    expect(readArrangementParam({ search: '?arrangement=legacy', hash: '#/x?arrangement=grid' })).toBe('legacy')
  })
  it('ignores an invalid value', () => {
    expect(readArrangementParam({ search: '?arrangement=fancy', hash: '' })).toBeNull()
  })
  it('returns null with no param or no location', () => {
    expect(readArrangementParam({ search: '?foo=bar', hash: '#/x' })).toBeNull()
    expect(readArrangementParam(null)).toBeNull()
  })
})

describe('resolveArrangement (priority: query → localStorage → default)', () => {
  it('query wins and is flagged as the source', () => {
    expect(resolveArrangement({ param: 'grid', stored: 'legacy' })).toEqual({ arrangement: 'grid', source: 'query' })
  })
  it('falls back to the stored value when no query', () => {
    expect(resolveArrangement({ param: null, stored: 'grid' })).toEqual({ arrangement: 'grid', source: 'localStorage' })
  })
  it('defaults to legacy when neither is set', () => {
    expect(resolveArrangement({})).toEqual({ arrangement: DEFAULT_ARRANGEMENT, source: 'default' })
    expect(resolveArrangement({ param: 'bogus', stored: 'bogus' })).toEqual({ arrangement: 'legacy', source: 'default' })
  })
  it('a query=legacy override reverts even when grid is stored', () => {
    expect(resolveArrangement({ param: 'legacy', stored: 'grid' })).toEqual({ arrangement: 'legacy', source: 'query' })
  })
})
