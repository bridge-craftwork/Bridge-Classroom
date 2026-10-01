import { describe, it, expect } from 'vitest'
import {
  createRbbClient, handToRbb, vulToRbb, cardNameFromHeader, cardsFromPbnHeader, cardSpecFor,
  normalizeCall, stepToMeaning, meaningsFromSteps, NO_MEANING,
} from '../rbbClient.js'
import { createRbbDispatcher } from '../../workers/rbbDispatch.js'

// A Worker look-alike that runs the real dispatcher over a fake glue module,
// asynchronously, as a worker would.
function fakeWorkerFactory(glue, log = []) {
  return () => {
    const dispatch = createRbbDispatcher(async () => glue)
    const w = {
      onmessage: null,
      onerror: null,
      terminated: false,
      postMessage(msg) {
        log.push(msg)
        if (msg.fn == null) return
        dispatch(msg).then((reply) => setTimeout(() => w.onmessage?.({ data: reply }), 0))
      },
      terminate() { w.terminated = true },
    }
    return w
  }
}

function fakeGlue(overrides = {}) {
  let engines = 0
  return {
    info: () => JSON.stringify({ ok: true, api: 1, version: '0.2.0', rules_id: 'abc', stock_cards: ['21GF-DEFAULT'], diagnostics: [] }),
    createEngine: (req) => {
      const r = JSON.parse(req)
      if (r.cards.ns === 'bad') return JSON.stringify({ ok: false, engine: null, diagnostics: [{ severity: 'error', message: 'cards.ns: not a card' }] })
      return JSON.stringify({ ok: true, engine: ++engines, diagnostics: [] })
    },
    auction: (req) => JSON.stringify({ ok: true, echo: JSON.parse(req), diagnostics: [] }),
    ...overrides,
  }
}

describe('rbbClient — the worker client', () => {
  it('loads nothing until the first request', async () => {
    let made = 0
    const client = createRbbClient({ createWorker: () => { made++; return fakeWorkerFactory(fakeGlue())() }, base: 'http://x/rbb-wasm/' })
    expect(made).toBe(0)
    await client.info()
    expect(made).toBe(1)
  })

  it('tells the worker where the package is, then round-trips requests', async () => {
    const log = []
    const client = createRbbClient({ createWorker: fakeWorkerFactory(fakeGlue(), log), base: 'http://x/rbb-wasm/' })
    const r = await client.auction({ engine: 1, auction: ['1NT'] })
    expect(log[0]).toEqual({ base: 'http://x/rbb-wasm/' })
    expect(r.echo).toEqual({ engine: 1, auction: ['1NT'] })
  })

  it('caches engines per card pair', async () => {
    const client = createRbbClient({ createWorker: fakeWorkerFactory(fakeGlue()), base: 'http://x/' })
    const a = await client.engineFor({ ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' })
    const b = await client.engineFor({ ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' })
    const c = await client.engineFor({ ns: '21GF-DEFAULT', ew: '21GF-GIB' })
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('rejects with the engine\'s diagnostic when it refuses', async () => {
    const client = createRbbClient({ createWorker: fakeWorkerFactory(fakeGlue()), base: 'http://x/' })
    await expect(client.engineFor({ ns: 'bad', ew: 'bad' })).rejects.toThrow('cards.ns: not a card')
    const glue = fakeGlue({ auction: () => JSON.stringify({ ok: false, diagnostics: [{ severity: 'error', message: 'auction: call 2 (1C) is not legal here' }] }) })
    const c2 = createRbbClient({ createWorker: fakeWorkerFactory(glue), base: 'http://x/' })
    await expect(c2.auction({})).rejects.toThrow('Rusty auction: auction: call 2 (1C) is not legal here')
  })

  it('says which release it needs when the package lacks `auction`', async () => {
    const glue = fakeGlue()
    delete glue.auction
    const client = createRbbClient({ createWorker: fakeWorkerFactory(glue), base: 'http://x/' })
    await expect(client.auction({})).rejects.toThrow(/no auction\(\).*v0\.2\.0/)
  })

  it('refuses an engine with another API version', async () => {
    const glue = fakeGlue({ info: () => JSON.stringify({ ok: true, api: 2, diagnostics: [] }) })
    const client = createRbbClient({ createWorker: fakeWorkerFactory(glue), base: 'http://x/' })
    await expect(client.info()).rejects.toThrow('engine API 2')
  })

  it('fails pending requests when the worker dies', async () => {
    let worker
    const client = createRbbClient({ createWorker: () => (worker = { postMessage() {}, terminate() {} }), base: 'http://x/' })
    const p = client.auction({})
    worker.onerror({ message: 'boom' })
    await expect(p).rejects.toThrow('Rusty worker failed: boom')
  })
})

describe('rbbClient — adapters', () => {
  it('hands as S.H.D.C, tens as T', () => {
    expect(handToRbb({ spades: ['A', 'K'], hearts: ['10', '9'], diamonds: [], clubs: ['2'] })).toBe('AK.T9..2')
  })

  it('vulnerability', () => {
    expect(vulToRbb('Both')).toBe('All')
    expect(vulToRbb('NS')).toBe('NS')
    expect(vulToRbb(undefined)).toBe('None')
  })

  it('card names from PBN % CC1/CC2 headers', () => {
    expect(cardNameFromHeader('C:\\\\bba\\\\21GF-DEFAULT.bbsa')).toBe('21GF-DEFAULT')
    const pbn = '% CC1 - bbsa/21GF-DEFAULT.bbsa\n% CC2 - https://x/bbsa/21GF-GIB.bbsa\n[Board "1"]'
    expect(cardsFromPbnHeader(pbn)).toEqual({ ns: '21GF-DEFAULT', ew: '21GF-GIB' })
    expect(cardsFromPbnHeader('[Board "1"]')).toEqual({ ns: null, ew: null })
  })

  it('card specs: a built-in card by name, any other as .bbsa text', async () => {
    expect(await cardSpecFor('21GF-DEFAULT', ['21GF-DEFAULT'], null)).toBe('21GF-DEFAULT')
    expect(await cardSpecFor('Mine', ['21GF-DEFAULT'], async () => 'TEXT')).toEqual({ bbsa: 'TEXT', name: 'Mine' })
  })

  it('calls in the app\'s spelling', () => {
    expect(['1N', '1NT', 'P', 'pass', 'X', 'XX', '7S'].map(normalizeCall)).toEqual(['1NT', '1NT', 'Pass', 'Pass', 'X', 'XX', '7S'])
    expect(normalizeCall(null)).toBe('')
  })

  it('a step as an AuctionTable meaning', () => {
    const m = stepToMeaning({
      index: 2, seat: 'S', call: '2C', explanation: 'Stayman: asks for a 4-card major',
      alert: { kind: 'alert' }, rule: { module: 'stayman', file: 'conventions/notrump/stayman.bid', line: 12 },
      artificial: true, knowledge: { summary: '8+ HCP' },
    })
    expect(m).toMatchObject({
      position: 2, bid: '2C', meaning: 'Stayman: asks for a 4-card major', meaningExtended: '8+ HCP',
      isAlert: true, alertText: null, announce: null, artificial: true, known: true, fallback: false,
      ruleRef: { module: 'stayman', file: 'conventions/notrump/stayman.bid', line: 12 },
    })
    expect(m.tooltip).toBe('Stayman: asks for a 4-card major\n8+ HCP')
  })

  it('an announcement leads the tooltip', () => {
    const m = stepToMeaning({ index: 0, call: '1NT', explanation: '15-17 HCP, balanced', alert: { kind: 'announce', text: '15 to 17' }, rule: { module: 'nt' }, knowledge: { summary: '15-17 HCP, balanced' } })
    expect(m.announce).toBe('15 to 17')
    expect(m.tooltip).toBe('15 to 17 — 15-17 HCP, balanced')
  })

  it('a call outside Rusty\'s system: "no meaning", never "No rule applies"', () => {
    const m = stepToMeaning({ index: 3, call: '4C', explanation: null, alert: null, rule: null, knowledge: { summary: '11+ HCP' } })
    expect(m.meaning).toBe(NO_MEANING)
    expect(m.known).toBe(false)
    expect(m.tooltip).toBe(NO_MEANING)
  })

  it('fallback calls keep BBA\'s meaning, flagged in the data', () => {
    const steps = [
      { index: 0, call: '1NT', explanation: 'x', rule: { module: 'nt' }, knowledge: {} },
      { index: 1, call: '2H', explanation: null, rule: null, knowledge: {} },
    ]
    const out = meaningsFromSteps(steps, { 1: { meaning: 'BBA: 2H', meaningExtended: 'long' } })
    expect(out[1]).toMatchObject({ position: 1, bid: '2H', meaning: 'BBA: 2H', meaningExtended: 'long', fallback: true, source: 'bba' })
    expect(out[0].source).toBe('rusty')
  })
})
