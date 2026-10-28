// The request dispatcher behind the solver's Web Worker (solverWorker.js).
// Kept apart from the worker's `self.onmessage` wiring so a test can drive it
// in Node with the real WASM package.
//
// Messages in:  { id, fn, request }   fn ∈ FUNCTIONS; request a JSON-able object
// Messages out: { id, result }        the solver's parsed JSON response
//               { id, error }         the package failed to load, or the solver
//                                     refused the request (an illegal play record,
//                                     a claim for more tricks than remain, …)
//
//   checkClaim  → bridge-solver `check_claim` (json_api::ClaimRequest)
//   optimalLine → `Analyzer.dd_optimal_line(request, request.plays.length)`:
//                 double-dummy play from the current position to the end, whose
//                 `declaring_tricks` is the "makable" total

export const FUNCTIONS = ['checkClaim', 'optimalLine']

// loadGlue: () => Promise<module> — the package's JS glue, initialised.
export function createSolverDispatcher(loadGlue) {
  let glue = null
  let analyzer = null
  return async function dispatch({ id, fn, request } = {}) {
    try {
      if (!FUNCTIONS.includes(fn)) throw new Error(`unknown solver function ${fn}`)
      glue ??= loadGlue()
      const g = await glue
      const json = JSON.stringify(request ?? {})
      let out
      if (fn === 'checkClaim') {
        if (typeof g.check_claim !== 'function') {
          throw new Error('this solver package has no check_claim() (claims need bridge-solver v2.1.0 or later)')
        }
        out = g.check_claim(json)
      } else {
        analyzer ??= new g.Analyzer()
        out = analyzer.dd_optimal_line(json, (request?.plays || []).length)
      }
      return { id, result: JSON.parse(out) }
    } catch (err) {
      // A failed load is retried on the next request (e.g. after a network blip).
      if (glue && !(await glue.then(() => true, () => false))) glue = null
      return { id, error: String(err?.message || err) }
    }
  }
}
