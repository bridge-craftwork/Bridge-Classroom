// @vitest-environment node
//
// Smoke test against the REAL bridge-solver package in public/solver-wasm/
// (installed by scripts/fetch-solver-wasm.mjs — from the pinned release, or a
// local build with SOLVER_WASM_LOCAL=../bridge-solver/wasm/pkg). Skipped when
// none is installed or it has no `check_claim`, so `npm run test:run` needs
// neither network nor sibling checkout.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createSolverDispatcher } from '../solverDispatch.js'
import { createSolverClient } from '../../utils/solverClient.js'
import { parseDealHands } from '../../utils/pbnDeal.js'

const DIR = fileURLToPath(new URL('../../../public/solver-wasm/', import.meta.url))
const info = existsSync(DIR + 'build-info.json') ? JSON.parse(readFileSync(DIR + 'build-info.json', 'utf8')) : null
const usable = !!info?.supports_claim

async function loadGlue() {
  const glue = await import(/* @vite-ignore */ pathToFileURL(DIR + 'bridge_solver_wasm.js').href)
  glue.initSync({ module: readFileSync(DIR + 'bridge_solver_wasm_bg.wasm') })
  return glue
}

// The real client over the real dispatcher, with a Worker look-alike (no
// Worker in Node).
function client() {
  const dispatch = createSolverDispatcher(loadGlue)
  return createSolverClient({
    base: 'http://x/',
    createWorker: () => {
      const w = {
        onmessage: null,
        postMessage(msg) {
          if (msg.fn == null) return
          dispatch(msg).then((reply) => w.onmessage?.({ data: reply }))
        },
        terminate() {},
      }
      return w
    },
  })
}

// bridge-solver's README deal: North makes 10 tricks in spades double dummy,
// but a claim of 10 at trick one is invalid (it needs the cards to lie well).
const README = {
  hands: parseDealHands('N:AKQT3.J6.KJ42.95 652.AK42.AQ87.T4 J74.QT95.T.AK863 98.873.9653.QJ72'),
  trump: 'S', declarer: 'N', leader: 'E', plays: [],
}
// One suit each, North's spades: in notrump with East on lead, East takes
// every trick, so East's claim of all 13 is sure and North's of one is not.
const ONE_SUIT_EACH = {
  hands: parseDealHands('N:AKQJT98765432... .AKQJT98765432.. ..AKQJT98765432. ...AKQJT98765432'),
  trump: 'NT', declarer: 'N', leader: 'E', plays: [],
}
const NONE = { NS: 0, EW: 0 }

describe.skipIf(!usable)('bridge-solver WASM — claims', () => {
  it('accepts a claim that holds however the cards lie', async () => {
    const c = client()
    const r = await c.checkClaim({ play: ONE_SUIT_EACH, claimer: 'E', additional: 13, tricksTaken: NONE })
    expect(r).toMatchObject({ verdict: 'valid', accepted: true })
    const n = await c.checkClaim({ play: ONE_SUIT_EACH, claimer: 'N', additional: 1, tricksTaken: NONE })
    expect(n.accepted).toBe(false)
  })

  it('rejects a claim that only double dummy makes', async () => {
    const c = client()
    const r = await c.checkClaim({ play: README, claimer: 'N', additional: 10, tricksTaken: NONE })
    expect(r.accepted).toBe(false)
    expect(r.verdict).toBe('invalid')
    const { makable } = await c.makable({ play: README, claimer: 'N', tricksTaken: NONE })
    expect(makable).toBe(10)
  })

  it('makable is the claimer side’s share: a defender gets the rest', async () => {
    const { makable, remaining } = await client().makable({ play: README, claimer: 'E', tricksTaken: NONE })
    expect(remaining).toBe(13)
    expect(makable).toBe(3)
  })

  it('claimable ≤ makable ≤ remaining, mid-trick', async () => {
    const play = { ...README, plays: ['HA'] }
    const o = await client().claimOptions({ play, claimer: 'N', tricksTaken: NONE })
    expect(o.remaining).toBe(13)
    expect(o.claimable).toBeLessThanOrEqual(o.makable)
    expect(o.makable).toBeLessThanOrEqual(o.remaining)
  })

  it('refuses a position whose trick count disagrees with the play record', async () => {
    await expect(client().checkClaim({ play: ONE_SUIT_EACH, claimer: 'E', additional: 11, tricksTaken: { NS: 0, EW: 2 } }))
      .rejects.toThrow(/play record gives 0/)
  })

  it('surfaces solver refusals as errors', async () => {
    await expect(client().checkClaim({ play: README, claimer: 'N', additional: 14, tricksTaken: NONE }))
      .rejects.toThrow(/solver/)
  })
})
