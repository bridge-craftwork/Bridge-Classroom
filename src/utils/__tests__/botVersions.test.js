import { describe, it, expect } from 'vitest'
import { botVersions } from '../botVersions.js'

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
})
