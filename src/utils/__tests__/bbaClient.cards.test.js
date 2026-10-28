import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchAuction } from '../bbaClient.js'

const DEAL = {
  dealer: 'N', vulnerable: 'None',
  hands: Object.fromEntries(['N', 'E', 'S', 'W'].map((s) => [s, { spades: [], hearts: [], diamonds: [], clubs: [] }])),
}

function stubBba(reply) {
  const fetchFn = vi.fn(async (_url, init) => ({ ok: true, json: async () => reply, body: JSON.parse(init.body) }))
  vi.stubGlobal('fetch', fetchFn)
  return fetchFn
}
afterEach(() => vi.unstubAllGlobals())

describe('fetchAuction with a card given as content', () => {
  it('sends conventionContent and accepts a server that used it', async () => {
    const f = stubBba({ success: true, auction: ['Pass'], customCards: ['ns'], conventionsUsed: { ns: 'Mine', ew: '21GF-GIB' } })
    const r = await fetchAuction({ deal: DEAL, conventions: { ns: 'Mine', ew: '21GF-GIB' }, conventionContent: { ns: 'System type = 0\r\n' } })
    expect(JSON.parse(f.mock.calls[0][1].body).conventionContent).toEqual({ ns: 'System type = 0\r\n' })
    expect(r.conventionsUsed).toEqual({ ns: 'Mine', ew: '21GF-GIB' })
  })

  it('refuses an older server\'s answer, which bid with the named card instead', async () => {
    stubBba({ success: true, auction: ['Pass'], conventionsUsed: { ns: 'Mine', ew: '21GF-GIB' } })
    await expect(fetchAuction({ deal: DEAL, conventions: { ns: 'Mine', ew: '21GF-GIB' }, conventionContent: { ns: 'x' } }))
      .rejects.toThrow(/own convention card/)
  })

  it('sends no conventionContent for named cards', async () => {
    const f = stubBba({ success: true, auction: ['Pass'] })
    await fetchAuction({ deal: DEAL, conventions: { ns: '21GF-DEFAULT', ew: '21GF-GIB' } })
    expect(JSON.parse(f.mock.calls[0][1].body).conventionContent).toBeUndefined()
  })
})
