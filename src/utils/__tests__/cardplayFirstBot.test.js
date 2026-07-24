import { describe, it, expect, vi } from 'vitest'
import { makeCardplayFirstBot } from '../cardplayBots.js'

// A recorded [Play] line, one card per seat per trick (bySeat queues, as
// pbnParser.parsePlayTable produces). Trick 1: W leads C2, N C3, E CA, S CK;
// Trick 2: E on lead (won CA) plays D5, S D6, W D7, N D8.
const bySeat = {
  W: ['C2', 'D7'],
  N: ['C3', 'D8'],
  E: ['CA', 'D5'],
  S: ['CK', 'D6'],
}

// A distinctive fallback so we can prove delegation happened (and with what ctx).
function makeSpyBot() {
  return {
    name: 'spy',
    chooseOpeningLead: vi.fn(async () => ({ suit: 'S', rank: 'A' })),
    chooseCard: vi.fn(async () => ({ suit: 'H', rank: '2' })),
  }
}

const legalFor = (...cards) => cards.map(c => ({ suit: c[0], rank: c.slice(1) }))

describe('makeCardplayFirstBot (composite: recorded line first, real bot on divergence)', () => {
  it('plays the recorded opening lead while on-book', async () => {
    const spy = makeSpyBot()
    const bot = makeCardplayFirstBot(bySeat, spy)
    const card = await bot.chooseOpeningLead({ seat: 'W', legalCards: legalFor('C2', 'D7', 'H9') })
    expect(card).toEqual({ suit: 'C', rank: '2' })
    expect(spy.chooseOpeningLead).not.toHaveBeenCalled()
  })

  it('plays each seat its recorded card while the whole history matches the line', async () => {
    const spy = makeSpyBot()
    const bot = makeCardplayFirstBot(bySeat, spy)
    // Trick 1 fully on-book; E to play its recorded CA.
    const played = [
      { seat: 'W', suit: 'C', rank: '2' },
      { seat: 'N', suit: 'C', rank: '3' },
    ]
    const card = await bot.chooseCard({ seat: 'E', played, legalCards: legalFor('CA', 'CQ', 'D5') })
    expect(card).toEqual({ suit: 'C', rank: 'A' })
    expect(spy.chooseCard).not.toHaveBeenCalled()
  })

  it('hands off to the fallback bot once the play departs from the line, and fires onDivergence once', async () => {
    const spy = makeSpyBot()
    const onDivergence = vi.fn()
    const bot = makeCardplayFirstBot(bySeat, spy, { onDivergence })
    // N deviated on trick 1 (played C4, line said C3). Now E is on turn.
    const played = [
      { seat: 'W', suit: 'C', rank: '2' },
      { seat: 'N', suit: 'C', rank: '4' }, // off-book here
    ]
    const card = await bot.chooseCard({ seat: 'E', played, legalCards: legalFor('CA', 'CQ') })
    expect(card).toEqual({ suit: 'H', rank: '2' }) // the spy's answer
    expect(spy.chooseCard).toHaveBeenCalledOnce()
    expect(onDivergence).toHaveBeenCalledOnce()
    expect(onDivergence).toHaveBeenCalledWith({ seat: 'N', index: 0, expected: 'C3', actual: 'C4' })

    // A second off-book decision does NOT re-fire onDivergence.
    await bot.chooseCard({ seat: 'S', played: [...played, { seat: 'E', suit: 'C', rank: 'A' }], legalCards: legalFor('CK', 'C7') })
    expect(onDivergence).toHaveBeenCalledOnce()
  })

  it('is undo-safe: recomputes on-book from history, so rewinding past a divergence resumes the line', async () => {
    const spy = makeSpyBot()
    const bot = makeCardplayFirstBot(bySeat, spy)
    // First, off-book (S deviated) — delegates.
    await bot.chooseCard({
      seat: 'E',
      played: [
        { seat: 'W', suit: 'C', rank: '2' },
        { seat: 'N', suit: 'C', rank: '3' },
      ].concat([{ seat: 'X', suit: 'C', rank: 'K' }]), // ignore unknown seat
      legalCards: legalFor('CA'),
    })
    // Now history is rewound to a clean on-book prefix — the recorded card returns.
    const card = await bot.chooseCard({
      seat: 'E',
      played: [
        { seat: 'W', suit: 'C', rank: '2' },
        { seat: 'N', suit: 'C', rank: '3' },
      ],
      legalCards: legalFor('CA', 'CQ'),
    })
    expect(card).toEqual({ suit: 'C', rank: 'A' })
  })

  it('delegates when the recorded card is present but no longer legal (absence)', async () => {
    const spy = makeSpyBot()
    const onDivergence = vi.fn()
    const bot = makeCardplayFirstBot(bySeat, spy, { onDivergence })
    // On-book history, but E can no longer legally play CA (not in the legal set).
    const card = await bot.chooseCard({
      seat: 'E',
      played: [
        { seat: 'W', suit: 'C', rank: '2' },
        { seat: 'N', suit: 'C', rank: '3' },
      ],
      legalCards: legalFor('D5', 'D9'),
    })
    expect(card).toEqual({ suit: 'H', rank: '2' })
    expect(spy.chooseCard).toHaveBeenCalledOnce()
  })

  it('is a pure pass-through when the line is empty (no recorded play)', async () => {
    const spy = makeSpyBot()
    const bot = makeCardplayFirstBot({ N: [], E: [], S: [], W: [] }, spy)
    const card = await bot.chooseOpeningLead({ seat: 'W', legalCards: legalFor('C2') })
    expect(card).toEqual({ suit: 'S', rank: 'A' })
    expect(spy.chooseOpeningLead).toHaveBeenCalledOnce()
  })

  it('exposes validateClaim only when the fallback bot supports it', () => {
    const withClaim = makeCardplayFirstBot(bySeat, { name: 'b', chooseCard: vi.fn(), chooseOpeningLead: vi.fn(), validateClaim: vi.fn() })
    const without = makeCardplayFirstBot(bySeat, makeSpyBot())
    expect(typeof withClaim.validateClaim).toBe('function')
    expect(without.validateClaim).toBeUndefined()
  })
})
