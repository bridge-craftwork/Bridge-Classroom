// Module Web Worker for bridge-solver's WASM package (claim checking and
// double dummy). The main thread talks to it only through
// src/utils/solverClient.js. The package is loaded lazily, on the first
// request, from `base` (…/solver-wasm/, where scripts/fetch-solver-wasm.mjs
// installs it and Vite serves it), so a hand nobody claims never downloads it.

import { createSolverDispatcher } from './solverDispatch.js'

let base = null

const dispatch = createSolverDispatcher(async () => {
  if (!base) throw new Error('the solver worker was not told where the package is')
  const glue = await import(/* @vite-ignore */ new URL('bridge_solver_wasm.js', base).href)
  await glue.default({ module_or_path: new URL('bridge_solver_wasm_bg.wasm', base) })
  return glue
})

self.onmessage = async (e) => {
  const msg = e.data || {}
  if (msg.base) base = msg.base
  if (msg.fn == null) return
  self.postMessage(await dispatch(msg))
}
