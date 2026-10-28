import { describe, it, expect, vi } from 'vitest'
import {
  parseCardKey, loadTableCards, saveTableCards, isScenarioDefault, listBbaCards, resolveSide, cardCoverage, TABLE_CARDS_KEY,
} from '../tableCards.js'

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

describe('table card choice', () => {
  it('parses keys', () => {
    expect(parseCardKey('')).toEqual({ kind: 'scenario' })
    expect(parseCardKey('bba:21GF-GIB')).toEqual({ kind: 'bba', name: '21GF-GIB' })
    expect(parseCardKey('mine:abc')).toEqual({ kind: 'mine', id: 'abc' })
    expect(parseCardKey('bba:')).toEqual({ kind: 'scenario' })
    expect(parseCardKey('junk')).toEqual({ kind: 'scenario' })
  })

  it('remembers the choice, and starts on the scenario cards', () => {
    const storage = memoryStorage()
    expect(loadTableCards(storage)).toEqual({ ns: '', ew: '' })
    saveTableCards({ ns: 'mine:abc', ew: 'bba:Precision' }, storage)
    expect(loadTableCards(storage)).toEqual({ ns: 'mine:abc', ew: 'bba:Precision' })
    expect(isScenarioDefault(loadTableCards(storage))).toBe(false)
    expect(loadTableCards(memoryStorage({ [TABLE_CARDS_KEY]: '{bad' }))).toEqual({ ns: '', ew: '' })
    expect(isScenarioDefault({ ns: '', ew: 'junk' })).toBe(true)
  })

  it('lists BBA cards from PBS, falling back to the known set', async () => {
    const names = await listBbaCards(vi.fn(async () => { throw new Error('rate limited') }))
    expect(names).toContain('21GF-DEFAULT')
    expect(names).toContain('Precision')
  })

  it('resolves each kind of side', async () => {
    const loadCard = vi.fn(async () => ({ name: 'Mine', card_data: { notrump: { stayman: { play: true } } } }))
    expect(await resolveSide('', '21GF-GIB', loadCard)).toEqual({ name: '21GF-GIB', rusty: '21GF-GIB', bba: { name: '21GF-GIB' } })
    expect(await resolveSide('bba:Precision', '21GF-GIB', loadCard)).toEqual({ name: 'Precision', rusty: 'Precision', bba: { name: 'Precision' } })
    const mine = await resolveSide('mine:c1', '21GF-GIB', loadCard)
    expect(loadCard).toHaveBeenCalledWith('c1')
    expect(mine.name).toBe('Mine')
    expect(mine.rusty).toEqual({ json: { notrump: { stayman: { play: true } } } })
    expect(mine.bba.name).toBe('Mine')
    expect(mine.bba.content).toMatch(/^System type = \d+\r\n/)
  })

  it('scores coverage over Rusty\'s list of the card\'s settings', async () => {
    const client = {
      coverage: vi.fn(async () => ({
        ns: { read: ['notrump.stayman.play', 'two_level.ogust.play'], ignored: ['two_level.two_spades.min_hcp', 'notrump.stayman.forcing'] },
      })),
    }
    const cov = await cardCoverage({ any: 1 }, client)
    expect(client.coverage).toHaveBeenCalledWith({ cards: { ns: { json: { any: 1 } } } })
    expect(cov.rusty).toBe(0.5)
    // BBA: Stayman (implied) and Ogust (a .bbsa line); not the 2♠ range or Stayman forcing
    expect(cov.bba).toBe(0.5)
    expect(cov.report.bba.total).toBe(4)
  })
})
