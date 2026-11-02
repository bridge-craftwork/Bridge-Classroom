import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchOpeningLead, fetchBotCard, clearBenCache } from '../benClient.js'

const hand = { spades: ['A', 'K'], hearts: ['Q', 'J'], diamonds: ['T', '9'], clubs: ['8', '7'] }
const other = { spades: ['Q', 'J'], hearts: ['A', 'K'], diamonds: ['8', '7'], clubs: ['T', '9'] }
const lead = (over = {}) => ({ hand, seat: 'W', dealer: 'N', vul: 'None', ctx: ['1NT', 'Pass', 'Pass', 'Pass'], ...over })
const play = (over = {}) => ({ ...lead(), dummy: other, played: [{ suit: 'S', rank: 'A' }], ...over })

const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

describe('benClient answer cache (#257)', () => {
  let fetchMock

  beforeEach(() => {
    clearBenCache()
    let n = 0
    fetchMock = vi.fn(async () => okJson({ card: `S${++n}`, player: 0 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('answers a repeated lead and a repeated card without calling BEN again', async () => {
    const firstLead = await fetchOpeningLead(lead())
    const firstCard = await fetchBotCard(play())
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect((await fetchOpeningLead(lead())).card).toBe(firstLead.card)
    const again = await fetchBotCard(play())
    expect(again.card).toBe(firstCard.card)
    expect(again.player).toBe(firstCard.player)
    expect(again.elapsedMs).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['hand', { hand: other }],
    ['seat', { seat: 'E' }],
    ['dealer', { dealer: 'S' }],
    ['vulnerability', { vul: 'All' }],
    ['auction', { ctx: ['1S', 'Pass', 'Pass', 'Pass'] }],
  ])('does not reuse a lead when the %s differs', async (_, over) => {
    const base = await fetchOpeningLead(lead())
    const changed = await fetchOpeningLead(lead(over))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(changed.card).not.toBe(base.card)
  })

  it.each([
    ['dummy', { dummy: hand }],
    ['played cards', { played: [{ suit: 'S', rank: 'K' }] }],
    ['play order', { played: [{ suit: 'S', rank: 'A' }, { suit: 'S', rank: 'K' }] }],
  ])('does not reuse a card when the %s differs', async (_, over) => {
    const base = await fetchBotCard(play())
    const changed = await fetchBotCard(play(over))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(changed.card).not.toBe(base.card)
  })

  it('keeps /lead and /play apart', async () => {
    await fetchOpeningLead(lead())
    await fetchBotCard(play())
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/lead', '/play'])
  })

  it('does not cache a failure', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }))
    await expect(fetchOpeningLead(lead())).rejects.toThrow('boom')
    expect((await fetchOpeningLead(lead())).card).toBe('S1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a 200 with no card', async () => {
    fetchMock.mockImplementationOnce(async () => okJson({ error: 'no card' }))
    expect((await fetchOpeningLead(lead())).card).toBeUndefined()
    expect((await fetchOpeningLead(lead())).card).toBe('S1')
  })

  it('does not let a caller change a cached answer', async () => {
    const first = await fetchOpeningLead(lead())
    first.raw.card = 'changed'
    const second = await fetchOpeningLead(lead())
    second.raw.card = 'changed too'
    expect((await fetchOpeningLead(lead())).card).toBe('S1')
  })

  it('stays bounded, dropping the least recently used entry', async () => {
    const at = (i) => play({ played: [{ suit: 'S', rank: String(i) }] })
    await fetchBotCard(at(0))
    for (let i = 1; i < 256; i++) await fetchBotCard(at(i))
    expect(fetchMock).toHaveBeenCalledTimes(256)

    await fetchBotCard(at(0)) // still cached; now the most recently used
    expect(fetchMock).toHaveBeenCalledTimes(256)

    await fetchBotCard(at(256)) // over the limit: evicts at(1), the oldest
    expect(fetchMock).toHaveBeenCalledTimes(257)
    await fetchBotCard(at(0))
    expect(fetchMock).toHaveBeenCalledTimes(257)
    await fetchBotCard(at(1))
    expect(fetchMock).toHaveBeenCalledTimes(258)
  })
})
