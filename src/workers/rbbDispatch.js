// The request dispatcher behind the Rusty bidder's Web Worker (rbbWorker.js).
// Kept apart from the worker's `self.onmessage` wiring so a test can drive it
// in Node with the real WASM package.
//
// Messages in:  { id, fn, request }   fn ∈ FUNCTIONS; request a JSON-able object
// Messages out: { id, result }        the engine's parsed JSON response
//               { id, error }         the package failed to load, lacks `fn`, or panicked
//
// The engine never throws on bad input (it answers `ok: false` with
// diagnostics, rusty-bidding-bot docs/WASM.md); `error` is only for the cases
// above, and the client turns both into rejections.

export const FUNCTIONS = ['info', 'createEngine', 'freeEngine', 'auction', 'meaning', 'interpret', 'bid', 'coverage', 'validate']

// loadGlue: () => Promise<module> — the package's JS glue, initialised.
export function createRbbDispatcher(loadGlue) {
  let glue = null
  return async function dispatch({ id, fn, request } = {}) {
    try {
      if (!FUNCTIONS.includes(fn)) throw new Error(`unknown engine function ${fn}`)
      glue ??= loadGlue()
      const g = await glue
      if (typeof g[fn] !== 'function') {
        throw new Error(`this Rusty package has no ${fn}() (the practice table needs rusty-bidding-bot v0.2.0 or later)`)
      }
      const out = fn === 'info' ? g.info() : g[fn](JSON.stringify(request ?? {}))
      return { id, result: JSON.parse(out) }
    } catch (err) {
      // A failed load is retried on the next request (e.g. after a network blip).
      if (glue && !(await glue.then(() => true, () => false))) glue = null
      return { id, error: String(err?.message || err) }
    }
  }
}
