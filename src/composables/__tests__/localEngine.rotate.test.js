import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLocalEngine } from '../engines/localEngine.js'
import { makeFakeBba, DEAL } from './fakeRusty.js'

// "Rotate deals randomly" turns a board 180°. The partnerships keep their own two
// hands, so the side that was vulnerable still is.

function loadRotated(deal) {
  const fetchAuction = makeFakeBba(['Pass', 'Pass', 'Pass', 'Pass'])
  const engine = useLocalEngine({
    yourSeat: 'S', bidder: () => 'bba', rotate: () => true, fetchAuction, paceMs: 0,
  })
  return engine.loadDeal(deal).then(() => engine.currentDeal.value)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  vi.spyOn(Math, 'random').mockReturnValue(0) // always take the 50% turn
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LocalEngine 180° rotation', () => {
  it('swaps the hands within each partnership and moves the dealer', async () => {
    const turned = await loadRotated({ ...DEAL, dealer: 'E' })
    expect(turned.hands).toEqual({ N: DEAL.hands.S, S: DEAL.hands.N, E: DEAL.hands.W, W: DEAL.hands.E })
    expect(turned.dealer).toBe('W')
  })

  it.each(['None', 'NS', 'EW', 'All'])('keeps vulnerability %s', async (vulnerable) => {
    const turned = await loadRotated({ ...DEAL, vulnerable })
    expect(turned.vulnerable).toBe(vulnerable)
  })
})
