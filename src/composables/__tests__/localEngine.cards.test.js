import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useLocalEngine } from '../engines/localEngine.js'
import { makeFakeRusty, makeFakeBba, DEAL } from './fakeRusty.js'

// The table's convention-card choice ("play my card"): per partnership, the
// scenario's card, a BBA card, or one of the user's. Both bots and BBA's
// reference play it, fixed per board like the bidder.

const MY_CARD = { name: 'Rick 2/1', card_data: { notrump: { stayman: { play: true } } } }

function engineWith({ bidder = 'rusty', cards, scenarioCards = { ns: '21GF-DEFAULT', ew: '21GF-GIB' } }) {
  const rbbClient = makeFakeRusty(['1NT', 'Pass', null, 'Pass', 'NORULE', 'Pass'])
  const fetchAuction = makeFakeBba(['1NT', 'Pass', '2C', 'Pass', '2D', 'Pass', 'Pass', 'Pass'])
  const loadCard = vi.fn(async () => MY_CARD)
  const choice = ref(cards)
  const engine = useLocalEngine({
    yourSeat: 'S', bidder: () => bidder, cards: () => choice.value, rbbClient, fetchAuction, loadCard,
    fetchScenarioCards: vi.fn(async () => scenarioCards), logFallback: vi.fn(), paceMs: 0,
  })
  return { engine, rbbClient, fetchAuction, loadCard, choice }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })
afterEach(() => { vi.unstubAllGlobals() })

describe('LocalEngine convention cards', () => {
  it('scenario default both ways: BBA resolves the scenario, as before', async () => {
    const { engine, fetchAuction, loadCard } = engineWith({ cards: { ns: '', ew: '' } })
    await engine.loadDeal(DEAL, { scenario: 'Jacoby_2N' })
    expect(fetchAuction.requests[0]).toMatchObject({ scenario: 'Jacoby_2N', conventions: null, content: null })
    expect(loadCard).not.toHaveBeenCalled()
  })

  it('my card for N/S: Rusty gets its JSON, BBA its .bbsa text, E/W keeps the scenario card', async () => {
    const { engine, fetchAuction, rbbClient } = engineWith({ cards: { ns: 'mine:card-1', ew: '' } })
    await engine.loadDeal(DEAL, { scenario: 'Jacoby_2N' })
    const req = fetchAuction.requests[0]
    expect(req.conventions).toEqual({ ns: 'Rick 2/1', ew: '21GF-GIB' })
    expect(req.scenario).toBeNull()
    expect(Object.keys(req.content)).toEqual(['ns'])
    expect(req.content.ns).toMatch(/\r\n/) // a .bbsa file
    const created = rbbClient.requests.find((r) => r.fn === 'createEngine')
    expect(created.cards.ns).toEqual({ json: MY_CARD.card_data })
    expect(engine.rustyInfo.value.cards).toEqual({ ns: 'Rick 2/1', ew: '21GF-GIB' })
  })

  it('a BBA card by name, with the BBA bidder', async () => {
    const { engine, fetchAuction } = engineWith({ bidder: 'bba', cards: { ns: '', ew: 'bba:Precision' } })
    await engine.loadDeal(DEAL, { scenario: 'Jacoby_2N' })
    expect(fetchAuction.requests[0]).toMatchObject({ conventions: { ns: '21GF-DEFAULT', ew: 'Precision' }, content: null })
  })

  it('a changed choice re-bids the board before the human calls, then waits for the next board', async () => {
    const { engine, fetchAuction, choice } = engineWith({ bidder: 'bba', cards: { ns: '', ew: '' } })
    await engine.loadDeal(DEAL)
    choice.value = { ns: 'bba:Precision', ew: '' }
    expect(engine.cardsPending.value).toBe(true)
    expect(await engine.applyBidderNow()).toBe(true)
    expect(fetchAuction.requests.at(-1).conventions).toEqual({ ns: 'Precision', ew: '21GF-DEFAULT' })
    expect(engine.cardsPending.value).toBe(false)

    await engine.onUserBid('2C')
    choice.value = { ns: '', ew: '' }
    expect(await engine.applyBidderNow()).toBe(false)
    expect(engine.cardsPending.value).toBe(true)
  })

  it('a card that cannot be loaded is a deal error, not a silent default', async () => {
    const { engine, loadCard } = engineWith({ bidder: 'bba', cards: { ns: 'mine:gone', ew: '' } })
    loadCard.mockRejectedValueOnce(new Error('Failed to load card gone: 404'))
    await engine.loadDeal(DEAL)
    expect(engine.dealError.value).toMatch(/404/)
  })

  it('records the calls BBA made in Rusty\'s place, for flagging', async () => {
    const { engine } = engineWith({ cards: { ns: '', ew: '' } })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('2C')
    expect(engine.fallbackCalls.value).toEqual([4])
    await engine.loadDeal(DEAL)
    expect(engine.fallbackCalls.value).toEqual([])
  })
})
