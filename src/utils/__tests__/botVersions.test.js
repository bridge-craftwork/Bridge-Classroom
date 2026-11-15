import { describe, it, expect } from 'vitest'
import { botVersions, rulesNote } from '../botVersions.js'

describe('botVersions', () => {
  it('lists Rusty from the installed package, then BBA and BEN', () => {
    const rows = botVersions({ source: 'release', tag: 'v0.14.0', version: '0.14.0', date: '2026-11-04' })
    expect(rows.map(r => r.name)).toEqual(['Rusty', 'BBA', 'BEN'])
    expect(rows[0]).toMatchObject({ version: 'v0.14.0', date: '2026-11-04' })
    for (const r of rows) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('says when Rusty is a local build or missing', () => {
    expect(botVersions({ source: 'local', tag: null, version: '0.14.0' })[0]).toMatchObject({ version: 'v0.14.0', date: 'local build' })
    expect(botVersions(null)[0].version).toBe('not installed')
  })
  it('names the rules Rusty is bidding with, once known', () => {
    expect(rulesNote(null)).toBe('')
    expect(rulesNote({ number: 21, source: 'published' })).toBe('rules 21')
    expect(rulesNote({ number: 20, source: 'built-in' })).toBe('rules 20 (built in)')
  })
})
