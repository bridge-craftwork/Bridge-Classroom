// Module Web Worker for Rusty, the rule-based bidding engine
// (rusty-bidding-bot's WASM package). The main thread talks to it only through
// src/utils/rbbClient.js. The package is loaded lazily, on the first request,
// from `base` (…/rbb-wasm/, where scripts/fetch-rbb-wasm.mjs installs it and
// Vite serves it), so a BBA-only session never downloads it.

import { createRbbDispatcher } from './rbbDispatch.js'

let base = null

const dispatch = createRbbDispatcher(async () => {
  if (!base) throw new Error('the Rusty worker was not told where the package is')
  const glue = await import(/* @vite-ignore */ new URL('rbb_wasm.js', base).href)
  await glue.default({ module_or_path: new URL('rbb_wasm_bg.wasm', base) })
  return glue
})

self.onmessage = async (e) => {
  const msg = e.data || {}
  if (msg.base) base = msg.base
  if (msg.fn == null) return
  self.postMessage(await dispatch(msg))
}
