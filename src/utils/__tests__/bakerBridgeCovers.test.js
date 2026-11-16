import { describe, it, expect, vi } from 'vitest'
import { lessonsByCoveredId } from '../bakerBridgeCovers.js'
import { BAKER_BRIDGE_TAXONOMY } from '../bakerBridgeTaxonomy.js'

const names = list => (list || []).map(e => e.name)

describe('lessonsByCoveredId', () => {
  it('finds every lesson under its own skill path, with no manifest at all', () => {
    const by = lessonsByCoveredId(null)
    for (const e of BAKER_BRIDGE_TAXONOMY) expect(by[e.path], e.path).toContain(e)
  })

  it('finds a lesson under each ID the collection says it covers', () => {
    const by = lessonsByCoveredId({
      lessons: {
        'Partnership-StaymanTransfers': { covers: ['bidding_conventions/stayman', 'bidding_conventions/jacoby_transfers'] },
        Stayman: { covers: ['bidding_conventions/stayman'] },
        Jacoby: { covers: ['bidding_conventions/jacoby_2nt', 'bidding_conventions/splinters'] },
      },
    })
    // Its own lesson first, then the set that also covers it.
    expect(names(by['bidding_conventions/stayman'])).toEqual(['Stayman', 'Stayman & Transfers (Partnership)'])
    expect(names(by['bidding_conventions/jacoby_2nt'])).toContain('Jacoby 2NT & Splinters')
    // The lesson set is still found under its own path.
    expect(names(by['bidding_conventions/jacoby_2nt_splinters'])).toEqual(['Jacoby 2NT & Splinters'])
  })

  it('leaves out a lesson the catalogue does not know, and a lesson with nothing listed', () => {
    const by = lessonsByCoveredId({ lessons: { NotALesson: { covers: ['bidding_conventions/stayman'] }, '100NT': { covers: [] }, Finesse: {} } })
    expect(names(by['bidding_conventions/stayman'])).toEqual(['Stayman'])
  })
})

describe('loadLessonCovers', () => {
  it('falls back to the skill paths when the manifest cannot be fetched', async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { loadLessonCovers } = await import('../bakerBridgeCovers.js')
    const by = await loadLessonCovers(async () => ({ ok: false, status: 503 }))
    expect(names(by['bidding_conventions/stayman'])).toEqual(['Stayman'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('adds what the manifest says once it has loaded', async () => {
    vi.resetModules()
    const { loadLessonCovers, lessonCoversNow } = await import('../bakerBridgeCovers.js')
    const manifest = { lessons: { Michaels: { covers: ['competitive_bidding/michaels', 'competitive_bidding/unusual_notrump'] } } }
    const by = await loadLessonCovers(async () => ({ ok: true, json: async () => manifest }))
    expect(names(by['competitive_bidding/michaels'])).toEqual(['Michaels & Unusual 2NT'])
    expect(lessonCoversNow()).toBe(by)
  })
})
