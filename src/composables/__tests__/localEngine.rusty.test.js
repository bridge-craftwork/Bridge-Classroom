import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLocalEngine } from '../engines/localEngine.js'
import { makeFakeRusty, makeFakeBba, DEAL } from './fakeRusty.js'

// The solo table with the Rusty bidder (C1/C2): Rusty bids every bot seat,
// BBA's call is taken where Rusty has no rule, and the student is still marked
// against BBA's auction. Rusty and BBA are both stubbed; S is the human.

function engineWith({ script, bbaLine, bidder = 'rusty', bbaFail = false, scenarioCards = null }) {
  const rbbClient = makeFakeRusty(script)
  const fetchAuction = makeFakeBba(bbaLine, { fail: bbaFail })
  const logFallback = vi.fn()
  const fetchScenarioCards = vi.fn(async () => scenarioCards)
  const engine = useLocalEngine({
    yourSeat: 'S', bidder: () => bidder, rbbClient, fetchAuction, logFallback, fetchScenarioCards, paceMs: 0,
  })
  return { engine, rbbClient, fetchAuction, logFallback, fetchScenarioCards }
}

// Only the Rusty/BBA stubs may answer; the double-dummy fetch fails quietly.
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })
afterEach(() => { vi.unstubAllGlobals() })

describe('LocalEngine with the Rusty bidder', () => {
  it('bids the bot seats with Rusty up to the human, and keeps BBA as the reference', async () => {
    const { engine, fetchAuction, rbbClient } = engineWith({
      script: ['1NT', 'Pass'],
      bbaLine: ['1NT', 'Pass', '2C', 'Pass', '2D', 'Pass', 'Pass', 'Pass'],
    })
    await engine.loadDeal(DEAL)
    expect(engine.boardBidder.value).toBe('rusty')
    expect(engine.bidderName.value).toBe('Rusty')
    expect(engine.bids.value).toEqual(['1NT', 'Pass'])
    expect(engine.expectedAuction.value[2]).toBe('2C') // BBA's reference
    expect(fetchAuction.requests).toHaveLength(1) // the reference only
    expect(fetchAuction.requests[0].conventions).toEqual({ ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' })
    expect(rbbClient.requests.filter((r) => r.fn === 'auction')).toHaveLength(1)
    // The grid shows Rusty's meanings, not BBA's.
    expect(engine.meanings.value[0]).toMatchObject({ position: 0, meaning: 'Rusty: 1NT', source: 'rusty' })
    expect(engine.dealError.value).toBe('')
  })

  it('a no-rule stop is bid by BBA (from the reference) and Rusty resumes after it', async () => {
    // N 1NT, E Pass, S 2C (human), W Pass, N: no rule → BBA's 2D, E Pass, S human.
    const { engine, fetchAuction, logFallback } = engineWith({
      script: ['1NT', 'Pass', null, 'Pass', 'NORULE', 'Pass'],
      bbaLine: ['1NT', 'Pass', '2C', 'Pass', '2D', 'Pass', 'Pass', 'Pass'],
    })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('2C')
    expect(engine.bids.value).toEqual(['1NT', 'Pass', '2C', 'Pass', '2D', 'Pass'])
    expect(engine.divergedBids.value).toEqual({})
    // On BBA's line: the fallback call came from the reference, no new request.
    expect(fetchAuction.requests).toHaveLength(1)
    expect(logFallback).toHaveBeenCalledTimes(1)
    expect(logFallback.mock.calls[0][0]).toMatchObject({ seat: 'N', index: 4, call: '2D', rules_id: 'test-rules' })
    expect(engine.rustyFallbacks.value).toHaveLength(1)
    // BBA's meaning for its call, flagged only in the data.
    expect(engine.meanings.value[4]).toMatchObject({ meaning: 'BBA: 2D', fallback: true })
  })

  it('off BBA\'s line, the fallback asks BBA from the actual prefix, with the table\'s cards', async () => {
    const { engine, fetchAuction } = engineWith({
      script: ['1NT', 'Pass', null, 'Pass', 'NORULE', 'Pass'],
      bbaLine: ['1NT', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'],
    })
    await engine.loadDeal(DEAL, { scenario: 'Stayman' })
    await engine.onUserBid('2C') // diverges from BBA's 3NT
    expect(engine.divergedBids.value).toEqual({ 2: { user: '2C', bba: '3NT' } })
    expect(fetchAuction.requests).toHaveLength(2)
    expect(fetchAuction.requests[1]).toMatchObject({ prefix: ['1NT', 'Pass', '2C', 'Pass'], scenario: 'Stayman' })
    expect(engine.bids.value.slice(0, 6)).toEqual(['1NT', 'Pass', '2C', 'Pass', 'Pass', 'Pass'])
  })

  it('plays the scenario\'s own cards (CC1/CC2)', async () => {
    const { engine, rbbClient, fetchScenarioCards } = engineWith({
      script: ['1NT', 'Pass'], bbaLine: ['1NT', 'Pass'], scenarioCards: { ns: '21GF-GIB', ew: '21GF-DEFAULT' },
    })
    await engine.loadDeal(DEAL, { scenario: 'Some_Scenario' })
    expect(fetchScenarioCards).toHaveBeenCalledWith('Some_Scenario')
    expect(rbbClient.requests[0]).toEqual({ fn: 'createEngine', cards: { ns: '21GF-GIB', ew: '21GF-DEFAULT' } })
  })

  it('refreshes the reference at the human\'s turn only when Rusty has left BBA\'s line', async () => {
    const { engine, fetchAuction } = engineWith({
      script: ['1C', 'Pass'], // BBA would open 1NT
      bbaLine: ['1NT', 'Pass', '2C', 'Pass'],
    })
    await engine.loadDeal(DEAL)
    expect(engine.bids.value).toEqual(['1C', 'Pass'])
    expect(fetchAuction.requests).toHaveLength(2)
    expect(fetchAuction.requests[1].prefix).toEqual(['1C', 'Pass'])
    expect(engine.expectedAuction.value.slice(0, 2)).toEqual(['1C', 'Pass'])
  })

  it('divergence, toggle and undo send no bidding request to BBA', async () => {
    const { engine, fetchAuction, rbbClient } = engineWith({
      script: ['1NT', 'Pass', null, 'Pass', '2H', 'Pass', null, 'Pass', 'Pass', 'Pass'],
      bbaLine: ['1NT', 'Pass', '2C', 'Pass', '2H', 'Pass', '4H', 'Pass', 'Pass', 'Pass'],
    })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('2D') // divergence: Rusty answers, nothing is re-predicted
    expect(engine.divergedBids.value[2]).toEqual({ user: '2D', bba: '2C' })
    const afterDivergence = fetchAuction.requests.length
    // Rusty's calls after 2D are its own; the only BBA request is the reference
    // refresh for the human's next call, from the actual prefix.
    expect(fetchAuction.requests.slice(1).every((r) => r.prefix?.length === engine.bids.value.length)).toBe(true)

    await engine.undo()
    expect(engine.bids.value).toEqual(['1NT', 'Pass'])
    expect(engine.divergedBids.value).toEqual({})
    // Back on BBA's line: no request at all.
    expect(fetchAuction.requests.length).toBe(afterDivergence)

    await engine.onUserBid('2D')
    const before = rbbClient.requests.length
    await engine.toggleDivergedBid(2) // play BBA's 2C instead; Rusty bids on from there
    expect(engine.bids.value.slice(0, 3)).toEqual(['1NT', 'Pass', '2C'])
    expect(rbbClient.requests.length).toBeGreaterThan(before)
    expect(engine.bids.value).toEqual(['1NT', 'Pass', '2C', 'Pass', '2H', 'Pass'])
  })

  it('restart replays Rusty from the first call', async () => {
    const { engine } = engineWith({ script: ['1NT', 'Pass'], bbaLine: ['1NT', 'Pass', '2C'] })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('3NT')
    await engine.resetAuction()
    expect(engine.bids.value).toEqual(['1NT', 'Pass'])
    expect(engine.divergedBids.value).toEqual({})
  })

  it('finishes the board and marks the student against BBA', async () => {
    const { engine } = engineWith({
      script: ['1NT', 'Pass', null, 'Pass', 'Pass', 'Pass'],
      bbaLine: ['1NT', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'],
    })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('3NT')
    expect(engine.auctionComplete.value).toBe(true)
    expect(engine.summary.value).toBe('You matched the BBA all the way through.')
    expect(engine.referenceName).toBe('BBA')
  })

  it('bids with Rusty even when BBA is down (no reference, fallbacks pass)', async () => {
    const { engine } = engineWith({ script: ['1NT', 'NORULE'], bbaLine: [], bbaFail: true })
    await engine.loadDeal(DEAL)
    expect(engine.bids.value).toEqual(['1NT', 'Pass'])
    expect(engine.dealError.value).toBe('')
    expect(engine.expectedAuction.value).toEqual([])
  })

  it('an engine failure surfaces as dealError with the engine\'s message', async () => {
    const { engine, rbbClient } = engineWith({ script: [], bbaLine: ['1NT'] })
    rbbClient.auction = async () => { throw new Error('Rusty auction: auction: call 2 (1C) is not legal here') }
    await engine.loadDeal(DEAL)
    expect(engine.dealError.value).toBe('Rusty error: Rusty auction: auction: call 2 (1C) is not legal here')
    expect(engine.auctionLoading.value).toBe(false)
  })

  it('the bidder is read per board: a change applies to the next board', async () => {
    let bidder = 'bba'
    const rbbClient = makeFakeRusty(['1C', 'Pass'])
    const fetchAuction = makeFakeBba(['1NT', 'Pass', '2C'])
    const engine = useLocalEngine({ yourSeat: 'S', bidder: () => bidder, rbbClient, fetchAuction, paceMs: 0 })
    await engine.loadDeal(DEAL)
    expect(engine.bids.value).toEqual(['1NT', 'Pass']) // BBA's replay
    expect(engine.meanings.value[0].meaning).toBe('BBA: 1NT')
    expect(rbbClient.requests).toHaveLength(0) // Rusty never touched
    bidder = 'rusty'
    expect(engine.boardBidder.value).toBe('bba')
    await engine.loadDeal(DEAL)
    expect(engine.boardBidder.value).toBe('rusty')
    expect(engine.bids.value).toEqual(['1C', 'Pass'])
  })

  // Bug-report 2026-10-05: the table deals board 1 on opening, before anyone
  // opens Table settings, so a bidder chosen then has to apply to THIS board.
  it('a bidder change before your first call re-bids the same board with the new engine', async () => {
    let bidder = 'bba'
    const rbbClient = makeFakeRusty(['1C', 'Pass'])
    const fetchAuction = makeFakeBba(['1NT', 'Pass', '2C'])
    const engine = useLocalEngine({ yourSeat: 'S', bidder: () => bidder, rbbClient, fetchAuction, paceMs: 0 })
    await engine.loadDeal(DEAL)
    expect(engine.bids.value).toEqual(['1NT', 'Pass']) // the bots (N, E) have called; you (S) haven't
    const hands = engine.currentDeal.value.hands

    bidder = 'rusty'
    expect(await engine.applyBidderNow()).toBe(true)
    expect(engine.boardBidder.value).toBe('rusty')
    expect(engine.bids.value).toEqual(['1C', 'Pass']) // Rusty's calls, not BBA's
    expect(engine.currentDeal.value.hands).toEqual(hands) // same board
    expect(engine.dealsDrawn.value).toBe(1) // not counted as a new board
  })

  it('once you have called, a bidder change waits for the next board', async () => {
    let bidder = 'bba'
    const rbbClient = makeFakeRusty(['1C', 'Pass'])
    const fetchAuction = makeFakeBba(['1NT', 'Pass', '2C', 'Pass', '2H', 'Pass', 'Pass', 'Pass'])
    const engine = useLocalEngine({ yourSeat: 'S', bidder: () => bidder, rbbClient, fetchAuction, paceMs: 0 })
    await engine.loadDeal(DEAL)
    await engine.onUserBid('2C')
    const before = engine.bids.value.slice()
    expect(before.slice(0, 3)).toEqual(['1NT', 'Pass', '2C'])

    bidder = 'rusty'
    expect(await engine.applyBidderNow()).toBe(false)
    expect(engine.boardBidder.value).toBe('bba')
    expect(engine.bids.value).toEqual(before) // your calls are kept
    expect(rbbClient.requests).toHaveLength(0)

    await engine.loadDeal(DEAL)
    expect(engine.boardBidder.value).toBe('rusty')
  })

  it('a Rusty start still in flight when you switch back to BBA does not bid onto the BBA board', async () => {
    let bidder = 'rusty'
    const rbbClient = makeFakeRusty(['1C', 'Pass'])
    let release
    const engineReady = new Promise((r) => { release = r })
    const realEngineFor = rbbClient.engineFor
    let starts = 0
    rbbClient.engineFor = async (cards) => {
      starts++
      if (starts === 1) await engineReady // the first board start's Rusty setup hangs
      return realEngineFor(cards)
    }
    const fetchAuction = makeFakeBba(['1NT', 'Pass', '2C'])
    // Real pacing: BBA bids the bot seats one at a time, so the late Rusty
    // setup lands while BBA is mid-way through them.
    const engine = useLocalEngine({ yourSeat: 'S', bidder: () => bidder, rbbClient, fetchAuction, paceMs: 20 })
    const firstStart = engine.loadDeal(DEAL)
    await new Promise((r) => setTimeout(r, 5))
    expect(engine.boardBidder.value).toBe('rusty')

    bidder = 'bba'
    const switched = engine.applyBidderNow()
    await new Promise((r) => setTimeout(r, 5)) // BBA has answered and is pausing before its first call
    release()
    await Promise.all([firstStart, switched])
    await new Promise((r) => setTimeout(r, 60)) // let any stray loop finish

    expect(engine.boardBidder.value).toBe('bba')
    expect(engine.bids.value).toEqual(['1NT', 'Pass']) // BBA's calls only: the late Rusty setup was dropped
  })
})
