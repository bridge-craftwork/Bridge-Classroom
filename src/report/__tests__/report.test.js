import { describe, it, expect } from 'vitest'
import { detectApp, collectEnv } from '../env.js'
import { collectReport, SCHEMA_VERSION } from '../ReportCollector.js'
import { buildCcPrompt } from '../ccPrompt.js'

describe('detectApp', () => {
  it('maps known route prefixes to app ids', () => {
    expect(detectApp('/tables/host')).toBe('table-host')
    expect(detectApp('/tables/console')).toBe('console')
    expect(detectApp('/tables/solo')).toBe('practice-table')
    expect(detectApp('/harness/scene/foo')).toBe('harness')
  })
  it('defaults everything else to a1 (Scenario Mastery / MainLayout catch-all)', () => {
    expect(detectApp('/')).toBe('a1')
    expect(detectApp('/lobby')).toBe('a1')
    expect(detectApp('')).toBe('a1')
  })
})

describe('collectEnv', () => {
  const deps = {
    win: { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2 },
    nav: { platform: 'MacIntel', userAgent: 'TestUA/1.0' },
    loc: { hash: '#/tables/host', href: 'http://localhost/#/tables/host' },
    now: new Date('2026-07-10T12:00:00Z')
  }

  it('derives app, viewport, platform and a UTC timestamp from injected globals', () => {
    const env = collectEnv(deps)
    expect(env.app).toBe('table-host')
    expect(env.route).toBe('/tables/host')
    expect(env.viewport).toEqual({ w: 1440, h: 900, dpr: 2 })
    expect(env.platform).toBe('MacIntel')
    expect(env.timestamp).toBe('2026-07-10T12:00:00.000Z')
  })

  it('leaves shell/engine coordinates null for later enrichment', () => {
    const env = collectEnv(deps)
    expect(env.arrangement).toBeNull()
    expect(env.phase).toBeNull()
    expect(env.tableScale).toBeNull()
  })

  it('treats an empty hash as the root route', () => {
    expect(collectEnv({ ...deps, loc: { hash: '', href: 'x' } }).route).toBe('/')
  })
})

describe('collectReport', () => {
  it('stamps a schema version, carries the note, and stubs the fixture', () => {
    const bundle = collectReport({ note: 'card overlaps' })
    expect(bundle.context.schemaVersion).toBe(SCHEMA_VERSION)
    expect(bundle.context.note).toBe('card overlaps')
    expect(bundle.context.tape).toEqual([])
    expect(bundle.fixture.stub).toBe(true)
    expect(bundle.screenshot).toBeNull()
  })

  it('merges enrichment over env and replaces the fixture stub', () => {
    const bundle = collectReport({
      enrich: {
        env: { arrangement: 'grid', phase: 'play' },
        fixture: { schemaVersion: 0, deal: 'PBN...' },
        tape: [{ t: 0, kind: 'bid', payload: { call: '1S' } }]
      }
    })
    expect(bundle.context.env.arrangement).toBe('grid')
    expect(bundle.context.env.phase).toBe('play')
    expect(bundle.fixture.deal).toBe('PBN...')
    expect(bundle.fixture.stub).toBeUndefined()
    expect(bundle.context.tape).toHaveLength(1)
  })
})

describe('buildCcPrompt', () => {
  const context = {
    note: 'south hand shows partner cards',
    env: { app: 'table-host', viewport: { w: 800, h: 600, dpr: 1 }, phase: 'play', commit: 'abc123' }
  }

  it('includes the note, env coordinates, the directory layout, and the diagnose line', () => {
    const p = buildCcPrompt({ bundlePath: 'dev-reports/2026/07/x/', context })
    expect(p).toContain('south hand shows partner cards')
    expect(p).toContain('app: table-host')
    expect(p).toContain('viewport: 800×600@1')
    expect(p).toContain('phase: play')
    expect(p).toContain('context.json')
    expect(p).toContain('CLAUDE.md')
    expect(p).toMatch(/Diagnose before changing anything\.$/)
  })

  it('uses single-file wording for the fallback layout', () => {
    const p = buildCcPrompt({ bundlePath: 'x.bundle.json', context, singleFile: true })
    expect(p).toContain('single JSON file')
    expect(p).toContain('data URL')
  })

  it('handles a missing note gracefully', () => {
    const p = buildCcPrompt({ bundlePath: 'd/', context: { env: {} } })
    expect(p).toContain('Reporter note: (none)')
  })
})
