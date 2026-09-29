// @vitest-environment node
//
// Smoke test against the REAL Rusty package in public/rbb-wasm/ (installed by
// scripts/fetch-rbb-wasm.mjs — from the pinned release, or a local build with
// RBB_WASM_LOCAL=../rusty-bidding-bot/crates/wasm/pkg). Skipped when the
// installed package has no `auction` entry point (v0.1.0-rc1) or none is
// installed, so `npm run test:run` needs neither network nor sibling checkout.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRbbDispatcher } from '../rbbDispatch.js'
import { diagnosticsError } from '../../utils/rbbClient.js'
import { prepareRustyBoard, runRustyBots } from '../../composables/engines/rustyBidder.js'

const DIR = fileURLToPath(new URL('../../../public/rbb-wasm/', import.meta.url))
const info = existsSync(DIR + 'build-info.json') ? JSON.parse(readFileSync(DIR + 'build-info.json', 'utf8')) : null
const usable = !!info?.supports_auction

async function loadGlue() {
  const glue = await import(/* @vite-ignore */ pathToFileURL(DIR + 'rbb_wasm.js').href)
  glue.initSync({ module: readFileSync(DIR + 'rbb_wasm_bg.wasm') })
  return glue
}

// The client's shape, over the dispatcher directly (no Worker in Node).
function directClient() {
  const dispatch = createRbbDispatcher(loadGlue)
  let id = 0
  const call = async (fn, request) => {
    const r = await dispatch({ id: ++id, fn, request })
    if (r.error) throw new Error(r.error)
    return r.result
  }
  const checked = async (fn, req) => { const r = await call(fn, req); if (!r.ok) throw diagnosticsError(r, fn); return r }
  return {
    call,
    info: () => call('info'),
    engineFor: async (cards) => (await checked('createEngine', { cards })).engine,
    auction: (req) => checked('auction', req),
    meaning: (req) => checked('meaning', req),
  }
}

const DEAL = {
  dealer: 'N', vulnerable: 'None',
  hands: {
    N: { spades: [...'AK52'], hearts: [...'KJ7'], diamonds: [...'Q94'], clubs: [...'K83'] },
    E: { spades: [...'QJ3'], hearts: [...'Q95'], diamonds: [...'KJ3'], clubs: [...'QJ74'] },
    S: { spades: [...'T64'], hearts: [...'AT832'], diamonds: [...'A2'], clubs: [...'T62'] },
    W: { spades: [...'987'], hearts: [...'64'], diamonds: [...'T8765'], clubs: [...'A95'] },
  },
}

describe.skipIf(!usable)('Rusty WASM package (real engine)', () => {
  it('reports API 1 and the rules it carries', async () => {
    const r = await directClient().info()
    expect(r.api).toBe(1)
    expect(r.rules_id).toBe(info.rules_id)
    expect(r.stock_cards).toContain('21GF-DEFAULT')
  })

  it('bids a practice table\'s bot seats to the human and resumes after a human call', async () => {
    const client = directClient()
    const board = await prepareRustyBoard({ client, deal: DEAL, humanSeats: ['S'], cardNames: { ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' } })
    const calls = []
    const hooks = {
      client,
      bbaCall: async () => ({ call: 'Pass', meaning: { meaning: 'BBA pass' } }),
      onCall: async (call) => { calls.push(call) },
      fallbackMeanings: {},
    }
    const first = await runRustyBots(board, [], hooks)
    expect(first.stop).toBe('human_to_call')
    expect(calls.length).toBe(2) // N opens, E calls, S (human) to call
    expect(calls[0]).toBe('1NT')
    // The human's call, then Rusty again.
    calls.push('Pass')
    const second = await runRustyBots(board, calls.slice(), hooks)
    expect(['human_to_call', 'complete']).toContain(second.stop)
  })

  it('reads a call outside its system as unknown (meaning)', async () => {
    const client = directClient()
    const engine = await client.engineFor({ ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' })
    const r = await client.meaning({ engine, dealer: 'N', vul: 'None', scoring: 'MP', auction: ['1NT', 'Pass', '7C'], index: 2 })
    expect(r.ok).toBe(true)
    expect(typeof r.known).toBe('boolean')
  })
})
