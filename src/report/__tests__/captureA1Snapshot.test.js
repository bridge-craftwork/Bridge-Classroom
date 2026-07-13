import { describe, it, expect } from 'vitest'
import { captureA1Snapshot, a1SnapshotToEnrich, A1_SNAPSHOT_SCHEMA_VERSION } from '../captureA1Snapshot.js'

describe('captureA1Snapshot', () => {
  it('stamps its own schema version', () => {
    expect(captureA1Snapshot({}).schemaVersion).toBe(A1_SNAPSHOT_SCHEMA_VERSION)
  })

  it('never throws on empty/garbage input — degrades to nulls (report must still file)', () => {
    for (const bad of [undefined, null, 42, 'x', []]) {
      const snap = captureA1Snapshot(bad)
      expect(snap.schemaVersion).toBe(A1_SNAPSHOT_SCHEMA_VERSION)
      expect(snap.arrangement).toEqual({ value: null, source: null })
      expect(snap.ledger).toBeNull()
      expect(snap.fixture).toBeNull()
      expect(snap.tape).toEqual([])
    }
  })

  it('carries arrangement + provenance, phase, phase signals verbatim, and the ledger', () => {
    const snap = captureA1Snapshot({
      arrangement: { value: 'grid', source: 'query' },
      phase: 'bidding',
      phaseSignals: { auctionComplete: false, isDeclarerPlay: false, showOpeningLead: false, hasSteps: true },
      ledger: { budget: 774, regions: { center: { scale: 1.31 } } },
    })
    expect(snap.arrangement).toEqual({ value: 'grid', source: 'query' })
    expect(snap.phase).toBe('bidding')
    expect(snap.phaseSignals).toEqual({ auctionComplete: false, isDeclarerPlay: false, showOpeningLead: false, hasSteps: true })
    expect(snap.ledger.regions.center.scale).toBe(1.31)
  })

  it('shapes content identity and env, filtering non-finite numbers', () => {
    const snap = captureA1Snapshot({
      content: { collection: 'pbs-coaching', lesson: 'Cue-bid', board: 3, stepIndex: 2, stepCount: 8, dealHash: 'abc123' },
      env: { viewport: { w: 720, h: 900 }, tableScale: 1.31, dpr: 2, userAgent: 'iPad' },
      capturedAt: 1234,
    })
    expect(snap.content.collection).toBe('pbs-coaching')
    expect(snap.content.board).toBe(3)
    expect(snap.content.dealHash).toBe('abc123')
    expect(snap.env.viewport).toEqual({ w: 720, h: 900 })
    expect(snap.env.tableScale).toBe(1.31)
    expect(snap.capturedAt).toBe(1234)
  })

  it('passes the fixture-grade state through for gallery import', () => {
    const fixture = { surface: 'a1', seat: 'W', phase: 'play', hands: { W: {}, N: {} }, hiddenSeats: ['E', 'S'] }
    expect(captureA1Snapshot({ fixture }).fixture).toEqual(fixture)
  })
})

describe('a1SnapshotToEnrich', () => {
  const snap = captureA1Snapshot({
    arrangement: { value: 'grid', source: 'localStorage' },
    phase: 'play',
    env: { tableScale: 1.18 },
    ledger: { budget: 650 },
    fixture: { surface: 'a1', seat: 'S' },
  })

  it('surfaces arrangement/phase/scale into env for existing triage', () => {
    const e = a1SnapshotToEnrich(snap)
    expect(e.env).toEqual({ arrangement: 'grid', arrangementSource: 'localStorage', phase: 'play', tableScale: 1.18 })
  })

  it('lifts the fixture to the top (gallery-loadable) and puts the diagnostic under context.a1', () => {
    const e = a1SnapshotToEnrich(snap)
    expect(e.fixture).toEqual({ surface: 'a1', seat: 'S' })
    // The full snapshot rides context.a1 WITHOUT re-duplicating the fixture.
    expect(e.context.a1.ledger).toEqual({ budget: 650 })
    expect(e.context.a1.fixture).toBeUndefined()
    expect(e.context.a1.schemaVersion).toBe(A1_SNAPSHOT_SCHEMA_VERSION)
  })

  it('tolerates a null snapshot', () => {
    const e = a1SnapshotToEnrich(null)
    expect(e.fixture).toBeNull()
    expect(e.env.arrangement).toBeNull()
  })
})
