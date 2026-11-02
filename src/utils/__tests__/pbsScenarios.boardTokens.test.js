import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// #94: board_version_token comes from the manifest's lessons roster, joined on
// (PBN basename, board number). The module holds the roster once per page, so
// each test imports it fresh.
const manifest = {
  schemaVersion: 2,
  layout: [],
  scenarios: {},
  lessons: {
    Smolen: { boards: [
      { number: 1, boardVersionToken: 'tok-1' },
      { number: 2, boardVersionToken: null },
    ] },
  },
}
const deal = (over = {}) => ({ collectionId: 'pbs-coaching', subfolder: 'Smolen', boardNumber: 1, ...over })
const json = (body) => ({ ok: true, json: async () => body })
const settle = () => new Promise((resolve) => setTimeout(resolve))

async function freshModules() {
  vi.resetModules()
  return {
    pbs: await import('../pbsScenarios.js'),
    schema: await import('../observationSchema.js'),
  }
}

const observe = (schema, d) => schema.createObservation({
  userId: 'u', sessionId: 's', deal: { hands: {}, ...d }, promptIndex: 0, auctionSoFar: [],
  expectedBid: '1C', studentBid: '1C', correct: true, attemptNumber: 1, timeTakenMs: 1,
  skillPath: 'x', assignment: null,
})

describe('board version tokens from the manifest roster', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn(async () => json(manifest))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetchScenarioManifest returns the roster, or {} from a v1 manifest', async () => {
    const { pbs } = await freshModules()
    expect((await pbs.fetchScenarioManifest()).lessons).toEqual(manifest.lessons)
    fetchMock.mockImplementationOnce(async () => json({ layout: [], scenarios: {} }))
    expect((await pbs.fetchScenarioManifest()).lessons).toEqual({})
  })

  it('builds the lookup, skipping boards with no token', async () => {
    const { pbs } = await freshModules()
    const tokens = pbs.buildBoardTokenLookup(manifest.lessons)
    expect([...tokens]).toEqual([['Smolen#1', 'tok-1']])
    expect(pbs.buildBoardTokenLookup(undefined).size).toBe(0)
  })

  it('puts the roster token on the observation and its metadata', async () => {
    const { pbs, schema } = await freshModules()
    pbs.preloadBoardTokens(deal())
    await settle()
    const obs = observe(schema, deal({ boardVersionToken: 'tag-loses' }))
    expect(obs.board_version_token).toBe('tok-1')
    expect(schema.extractMetadata(obs, null).board_version_token).toBe('tok-1')
  })

  it('fetches the manifest once however many deals load', async () => {
    const { pbs } = await freshModules()
    pbs.preloadBoardTokens(deal())
    pbs.preloadBoardTokens(deal({ boardNumber: 2 }))
    await settle()
    pbs.preloadBoardTokens(deal({ boardNumber: 3 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch for other collections, or apply the roster to them', async () => {
    const { pbs, schema } = await freshModules()
    pbs.preloadBoardTokens(deal({ collectionId: 'baker-bridge' }))
    pbs.preloadBoardTokens(deal({ collectionId: null }))
    expect(fetchMock).not.toHaveBeenCalled()

    pbs.preloadBoardTokens(deal())
    await settle()
    // Same lesson name and board number, different collection.
    expect(observe(schema, deal({ collectionId: 'baker-bridge' })).board_version_token).toBeNull()
    expect(observe(schema, deal({ collectionId: 'baker-bridge', boardVersionToken: 'tag' })).board_version_token).toBe('tag')
  })

  it('falls back to null when the roster has no entry or has not loaded', async () => {
    const { pbs, schema } = await freshModules()
    expect(observe(schema, deal()).board_version_token).toBeNull() // not loaded
    pbs.preloadBoardTokens(deal())
    expect(observe(schema, deal()).board_version_token).toBeNull() // in flight
    await settle()
    expect(observe(schema, deal({ boardNumber: 2 })).board_version_token).toBeNull()
    expect(observe(schema, deal({ boardNumber: 99 })).board_version_token).toBeNull()
    expect(observe(schema, deal({ subfolder: 'Other' })).board_version_token).toBeNull()
  })

  it('still records an observation when the manifest fails, and retries on the next deal', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500 }))
    const { pbs, schema } = await freshModules()
    pbs.preloadBoardTokens(deal())
    await settle()
    expect(observe(schema, deal()).board_version_token).toBeNull()

    pbs.preloadBoardTokens(deal())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(observe(schema, deal()).board_version_token).toBe('tok-1')
  })
})
