import { describe, it, expect, beforeEach } from 'vitest'
import {
  setReportContextProvider, clearReportContextProvider, captureReportContext,
  __resetReportContextForTests,
} from '../reportContext.js'

describe('reportContext provider registry', () => {
  beforeEach(() => __resetReportContextForTests())

  it('returns null when no provider is registered', () => {
    expect(captureReportContext()).toBeNull()
  })

  it('invokes the registered provider and returns its enrich fragments', () => {
    const frag = { env: { arrangement: 'grid' }, context: { a1: { phase: 'play' } }, fixture: { surface: 'a1' } }
    setReportContextProvider(() => frag)
    expect(captureReportContext()).toBe(frag)
  })

  it('degrades to null when the provider throws (a report must still file)', () => {
    setReportContextProvider(() => { throw new Error('boom') })
    expect(captureReportContext()).toBeNull()
  })

  it('clear removes the provider; a matching-fn clear does not clobber a replacement', () => {
    const a = () => ({ context: { a1: { n: 1 } } })
    const b = () => ({ context: { a1: { n: 2 } } })
    setReportContextProvider(a)
    setReportContextProvider(b)      // b replaces a (one shell at a time)
    clearReportContextProvider(a)    // a's unmount must NOT clear b
    expect(captureReportContext().context.a1.n).toBe(2)
    clearReportContextProvider(b)
    expect(captureReportContext()).toBeNull()
  })

  it('ignores a non-function provider', () => {
    setReportContextProvider(123)
    expect(captureReportContext()).toBeNull()
  })
})
