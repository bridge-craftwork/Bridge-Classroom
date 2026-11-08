import { describe, it, expect } from 'vitest'
import {
  SHOW_DESCRIPTION_IN_MIX_KEY, loadShowDescriptionInMix, saveShowDescriptionInMix, autoOpensDescription,
} from '../scenarioDescriptionSetting.js'

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

describe('show-description-in-a-mix setting', () => {
  it('is off for a new user', () => {
    expect(loadShowDescriptionInMix(memoryStorage())).toBe(false)
  })

  it('round-trips through storage', () => {
    const storage = memoryStorage()
    saveShowDescriptionInMix(true, storage)
    expect(storage.getItem(SHOW_DESCRIPTION_IN_MIX_KEY)).toBe('1')
    expect(loadShowDescriptionInMix(storage)).toBe(true)
    saveShowDescriptionInMix(false, storage)
    expect(loadShowDescriptionInMix(storage)).toBe(false)
  })

  it('survives storage that throws or is missing', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    expect(loadShowDescriptionInMix(broken)).toBe(false)
    expect(() => saveShowDescriptionInMix(true, broken)).not.toThrow()
    expect(loadShowDescriptionInMix(null)).toBe(false)
  })
})

describe('autoOpensDescription', () => {
  it('always opens for a single source, whatever the setting', () => {
    expect(autoOpensDescription({ itemCount: 1, showInMix: false })).toBe(true)
    expect(autoOpensDescription({ itemCount: 1, showInMix: true })).toBe(true)
  })

  it('opens for a mix only when the setting is on', () => {
    expect(autoOpensDescription({ itemCount: 2, showInMix: false })).toBe(false)
    expect(autoOpensDescription({ itemCount: 5, showInMix: true })).toBe(true)
  })
})
