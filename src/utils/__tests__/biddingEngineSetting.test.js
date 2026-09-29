import { describe, it, expect } from 'vitest'
import {
  BIDDING_ENGINE_KEY, loadBiddingEngine, saveBiddingEngine, readBidderParam, rustyAvailable,
} from '../biddingEngineSetting.js'

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}

describe('bidding engine setting (bp.biddingEngine)', () => {
  it('defaults to BBA for a new user', () => {
    expect(loadBiddingEngine({ storage: memoryStorage(), param: null })).toBe('bba')
  })

  it('remembers a changed choice (a new page load reads it back)', () => {
    const storage = memoryStorage()
    saveBiddingEngine('rusty', storage)
    expect(storage.map.get(BIDDING_ENGINE_KEY)).toBe('rusty')
    expect(loadBiddingEngine({ storage, param: null })).toBe('rusty')
    saveBiddingEngine('bba', storage)
    expect(loadBiddingEngine({ storage, param: null })).toBe('bba')
  })

  it('also persists through the real localStorage', () => {
    localStorage.removeItem(BIDDING_ENGINE_KEY)
    saveBiddingEngine('rusty')
    expect(loadBiddingEngine({ param: null })).toBe('rusty')
    localStorage.removeItem(BIDDING_ENGINE_KEY)
  })

  it('ignores junk, saved or passed', () => {
    const storage = memoryStorage({ [BIDDING_ENGINE_KEY]: 'gib' })
    expect(loadBiddingEngine({ storage, param: null })).toBe('bba')
    saveBiddingEngine('gib', storage)
    expect(storage.map.get(BIDDING_ENGINE_KEY)).toBe('gib') // unchanged
  })

  it('?bidder= overrides for the page load without being saved', () => {
    const storage = memoryStorage({ [BIDDING_ENGINE_KEY]: 'bba' })
    expect(loadBiddingEngine({ storage, param: 'rusty' })).toBe('rusty')
    expect(storage.map.get(BIDDING_ENGINE_KEY)).toBe('bba')
  })

  it('embedded tables keep BBA unless the host passes bidder', () => {
    const storage = memoryStorage({ [BIDDING_ENGINE_KEY]: 'rusty' })
    expect(loadBiddingEngine({ storage, embedded: true, param: null })).toBe('bba')
    expect(loadBiddingEngine({ storage, embedded: true, param: 'rusty' })).toBe('rusty')
  })

  it('reads bidder from the query or the hash query', () => {
    expect(readBidderParam({ search: '?bidder=Rusty', hash: '' })).toBe('rusty')
    expect(readBidderParam({ search: '', hash: '#/table?x=1&bidder=bba' })).toBe('bba')
    expect(readBidderParam({ search: '?bidder=gib', hash: '' })).toBe(null)
    expect(readBidderParam({ search: '', hash: '' })).toBe(null)
  })

  it('Rusty needs a package with the auction entry point', () => {
    expect(rustyAvailable(null)).toBe(false)
    expect(rustyAvailable({ tag: 'v0.1.0-rc1', supports_auction: false })).toBe(false)
    expect(rustyAvailable({ tag: 'v0.2.0', supports_auction: true })).toBe(true)
  })
})
