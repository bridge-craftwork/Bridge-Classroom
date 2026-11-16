// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { webcrypto } from 'node:crypto'
import { fetchPublishedPack } from '../rbbPack.js'
import { createRbbDispatcher } from '../rbbDispatch.js'

const sha = (text) => createHash('sha256').update(text).digest('hex')
const PACK = '{"schema":"pack/v1"}\n'
const manifest = (over = {}) => ({ rules_number: 21, source_commit: 'abc', rule_language_version: 2, pack_sha256: sha(PACK), ...over })

// A fetch that serves `files` (url ending → body) and records what was asked.
function server(files) {
  const asked = []
  const fetchFn = async (url, init) => {
    asked.push({ url, cache: init?.cache })
    const key = Object.keys(files).find((k) => url.includes(k))
    const body = key && (typeof files[key] === 'function' ? files[key](asked.length) : files[key])
    if (body == null) return { ok: false, status: 404 }
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body }
  }
  return { fetchFn, asked }
}

describe('fetchPublishedPack', () => {
  it('reads the manifest, then the snapshot it names, and checks its hash', async () => {
    const { fetchFn, asked } = server({ 'manifest.json': JSON.stringify(manifest()), 'pack.json': PACK })
    const pack = await fetchPublishedPack({ fetchFn, base: 'https://x/', subtle: webcrypto.subtle })
    expect(pack).toEqual({ text: PACK, rules_number: 21, source_commit: 'abc', language: 2 })
    expect(asked.map((a) => a.url)).toEqual(['https://x/manifest.json', 'https://x/pack.json?n=21'])
    expect(asked[0].cache).toBe('no-cache')
  })

  it('tries once more, fresh, when the snapshot is not the one the manifest names', async () => {
    // The first pack.json is from before this manifest; the second is right.
    const { fetchFn, asked } = server({ 'manifest.json': JSON.stringify(manifest()), 'pack.json': (n) => (n <= 2 ? '{"old":true}' : PACK) })
    const pack = await fetchPublishedPack({ fetchFn, base: 'https://x/', subtle: webcrypto.subtle })
    expect(pack.text).toBe(PACK)
    expect(asked.map((a) => a.cache)).toEqual(['no-cache', 'no-cache', 'reload', 'reload'])
  })

  it('rejects when it stays wrong, or a file is missing', async () => {
    const wrong = server({ 'manifest.json': JSON.stringify(manifest()), 'pack.json': '{"old":true}' })
    await expect(fetchPublishedPack({ fetchFn: wrong.fetchFn, base: 'https://x/', subtle: webcrypto.subtle })).rejects.toThrow(/not the snapshot/)
    const missing = server({ 'manifest.json': JSON.stringify(manifest()) })
    await expect(fetchPublishedPack({ fetchFn: missing.fetchFn, base: 'https://x/', subtle: webcrypto.subtle })).rejects.toThrow(/HTTP 404/)
  })
})

// A stand-in for the engine's glue: records each request it is given.
function fakeGlue({ language = 2, rules_id = '20-0123456789abcdef' } = {}) {
  const seen = []
  const fn = (name) => (json) => { seen.push({ name, request: JSON.parse(json) }); return JSON.stringify({ ok: true }) }
  return {
    seen,
    glue: {
      info: () => JSON.stringify({ api: 1, version: '0.16.0', rules_id, language }),
      createEngine: fn('createEngine'), freeEngine: fn('freeEngine'), auction: fn('auction'), coverage: fn('coverage'),
    },
  }
}
const published = { text: PACK, rules_number: 21, source_commit: 'abc', language: 2 }

describe('the dispatcher and the published rules', () => {
  it('sends the snapshot with requests that name no engine and no rules', async () => {
    const { glue, seen } = fakeGlue()
    let loads = 0
    const dispatch = createRbbDispatcher(async () => glue, async () => { loads++; return published })
    await dispatch({ id: 1, fn: 'createEngine', request: { cards: { ns: 'a', ew: 'b' } } })
    await dispatch({ id: 2, fn: 'auction', request: { engine: 3 } })
    await dispatch({ id: 3, fn: 'coverage', request: { cards: {}, rules: { 'x.bid': '' } } })
    await dispatch({ id: 4, fn: 'freeEngine', request: { engine: 3 } })
    expect(seen[0].request).toEqual({ cards: { ns: 'a', ew: 'b' }, pack: PACK })
    expect(seen[1].request).toEqual({ engine: 3 })
    expect(seen[2].request.pack).toBeUndefined()
    expect(seen[3].request).toEqual({ engine: 3 })
    expect(loads).toBe(1)
    const info = (await dispatch({ id: 5, fn: 'info' })).result
    expect(info).toMatchObject({ rules_number: 21, rules_source: 'published', rules_commit: 'abc', version: '0.16.0' })
  })

  it('bids with the built-in rules when the snapshot cannot be fetched', async () => {
    const { glue, seen } = fakeGlue()
    const dispatch = createRbbDispatcher(async () => glue, async () => { throw new Error('offline') })
    await dispatch({ id: 1, fn: 'createEngine', request: { cards: {} } })
    expect(seen[0].request).toEqual({ cards: {} })
    const info = (await dispatch({ id: 2, fn: 'info' })).result
    expect(info).toMatchObject({ rules_number: 20, rules_source: 'built-in', rules_commit: null })
  })

  it('bids with the built-in rules when the snapshot is in a newer rule language', async () => {
    const { glue, seen } = fakeGlue({ language: 2 })
    const dispatch = createRbbDispatcher(async () => glue, async () => ({ ...published, language: 3 }))
    await dispatch({ id: 1, fn: 'createEngine', request: { cards: {} } })
    expect(seen[0].request.pack).toBeUndefined()
    expect((await dispatch({ id: 2, fn: 'info' })).result.rules_source).toBe('built-in')
  })

  it('has no rules number for an engine from before its rules were a pack', async () => {
    const { glue } = fakeGlue({ rules_id: '0123456789abcdef', language: 1 })
    const dispatch = createRbbDispatcher(async () => glue)
    expect((await dispatch({ id: 1, fn: 'info' })).result).toMatchObject({ rules_number: null, rules_source: 'built-in' })
  })
})
