// The arranger's forensics have to reach the bundle, and must never be able to stop a
// report filing. Both halves matter: three July-2026 layout bundles were diagnosed by
// hand-deriving allocations the arranger already knew, because nothing carried them.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { collectReport } from '../ReportCollector.js'
import { setArrangerSnapshot, clearArrangerSnapshot, captureArrangerSnapshot, __resetArrangerSnapshotForTests } from '../arrangerSnapshot.js'

afterEach(() => __resetArrangerSnapshotForTests())

describe('arranger snapshot registry', () => {
  it('reaches context.arranger in the bundle', () => {
    setArrangerSnapshot(() => ({ channel: 'beta', seatScale: 0.75, regions: { center: { scale: 1.68 } } }))
    const { context } = collectReport({ note: 'x' })
    expect(context.arranger.channel).toBe('beta')
    expect(context.arranger.regions.center.scale).toBe(1.68)
  })

  it('is null when no grid is mounted, rather than absent or throwing', () => {
    const { context } = collectReport({ note: 'x' })
    expect(context.arranger).toBeNull()
  })

  it('degrades to null when the provider throws — a report must still file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setArrangerSnapshot(() => { throw new Error('boom') })
    expect(captureArrangerSnapshot()).toBeNull()
    const { context } = collectReport({ note: 'x' })
    expect(context.arranger).toBeNull()
    expect(context.note).toBe('x') // the rest of the bundle is intact
    warn.mockRestore()
  })

  it('clear only removes the provider it was given', () => {
    const a = () => ({ channel: 'a' })
    const b = () => ({ channel: 'b' })
    setArrangerSnapshot(a)
    setArrangerSnapshot(b)      // a remount replaced it
    clearArrangerSnapshot(a)    // the old component unmounting must not clobber b
    expect(captureArrangerSnapshot().channel).toBe('b')
  })

  it('records the preview channel in env for every surface', () => {
    const { context } = collectReport({ note: 'x' })
    // Defaults to 'grid' with no override — the point is that it is never null now.
    expect(context.env.arrangement).toBeTruthy()
  })
})
