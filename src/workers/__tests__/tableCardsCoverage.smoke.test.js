// @vitest-environment node
//
// cardCoverage against the REAL Rusty package (public/rbb-wasm/): Rusty's
// `coverage` lists a card's bidding settings, and BBA's share is the ones a
// .bbsa file carries. Checks the two vocabularies meet: a real card must give
// BBA a share strictly between nothing and everything. Skipped without the
// package, like rbbWasm.smoke.test.js.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRbbDispatcher } from '../rbbDispatch.js'
import { cardCoverage } from '../../utils/tableCards.js'

const DIR = fileURLToPath(new URL('../../../public/rbb-wasm/', import.meta.url))
const info = existsSync(DIR + 'build-info.json') ? JSON.parse(readFileSync(DIR + 'build-info.json', 'utf8')) : null
const CARD_FILE = fileURLToPath(new URL('../../../node_modules/@bridge-craftwork/convention-card/web/src/cards/2-1-intermediate.json', import.meta.url))

function directClient() {
  const dispatch = createRbbDispatcher(async () => {
    const glue = await import(/* @vite-ignore */ pathToFileURL(DIR + 'rbb_wasm.js').href)
    glue.initSync({ module: readFileSync(DIR + 'rbb_wasm_bg.wasm') })
    return glue
  })
  let id = 0
  return {
    async coverage(request) {
      const r = await dispatch({ id: ++id, fn: 'coverage', request })
      if (r.error) throw new Error(r.error)
      if (!r.result.ok) throw new Error(JSON.stringify(r.result.diagnostics))
      return r.result
    },
  }
}

describe.skipIf(!info || !existsSync(CARD_FILE))('cardCoverage with the real Rusty package', () => {
  it('scores a real card for both bots', async () => {
    const raw = JSON.parse(readFileSync(CARD_FILE, 'utf8'))
    const card = raw.card_data || raw
    const cov = await cardCoverage(card, directClient())
    expect(cov.report.rusty.total).toBeGreaterThan(10)
    expect(cov.report.bba.total).toBe(cov.report.rusty.total)
    expect(cov.rusty).toBeGreaterThan(0)
    expect(cov.bba).toBeGreaterThan(0)
    expect(cov.bba).toBeLessThan(1)
  })
})
