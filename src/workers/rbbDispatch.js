// The request dispatcher behind the Rusty bidder's Web Worker (rbbWorker.js).
// Kept apart from the worker's `self.onmessage` wiring so a test can drive it
// in Node with the real WASM package.
//
// Messages in:  { id, fn, request }   fn ∈ FUNCTIONS; request a JSON-able object
// Messages out: { id, result }        the engine's parsed JSON response
//               { id, error }         the package failed to load, lacks `fn`, or panicked
//
// RULES: with `loadPack` (rbbPack.js), the engine bids with the published
// rules: the snapshot is fetched once, on the first request, and sent as the
// `pack` of every request that names no engine handle and no rules of its
// own. When it can't be fetched, or is in a rule language newer than the
// engine reads, nothing is sent and the engine bids with the rules built
// into it. `info` says which: `rules_number` (the rules being bid with) and
// `rules_source` ('published' or 'built-in').
//
// The engine never throws on bad input (it answers `ok: false` with
// diagnostics, rusty-bidding-bot docs/WASM.md); `error` is only for the cases
// above, and the client turns both into rejections.

export const FUNCTIONS = ['info', 'createEngine', 'freeEngine', 'auction', 'meaning', 'interpret', 'bid', 'coverage', 'conventions', 'validate']

// The request fields that bring a rule set (rusty-bidding-bot docs/WASM.md).
const RULE_FIELDS = ['rules', 'fields', 'bbsa_map', 'manifest', 'pack']

// The rules number in a built-in rules id (`21-b9d92729d48b6f97`); null for
// an engine from before its rules were a convention pack.
function builtInNumber(rulesId) {
  const m = /^(\d+)-/.exec(String(rulesId || ''))
  return m ? Number(m[1]) : null
}

// loadGlue: () => Promise<module> — the package's JS glue, initialised.
// loadPack: () => Promise<{ text, rules_number, source_commit, language }>,
//           the published rules; omitted, the engine's built-in rules are used.
export function createRbbDispatcher(loadGlue, loadPack = null) {
  let glue = null
  let published = null // Promise<pack | null>, decided once per worker

  // The published rules this engine can bid with, or null (built-in rules).
  function publishedFor(g) {
    published ??= (async () => {
      if (!loadPack) return null
      try {
        const pack = await loadPack()
        const reads = JSON.parse(g.info()).language
        if (pack.language != null && reads != null && pack.language > reads) {
          console.info(`[rusty] the published rules are in rule language ${pack.language}; this engine reads ${reads}: bidding with its built-in rules`)
          return null
        }
        return pack
      } catch (err) {
        console.info('[rusty] the published rules could not be fetched; bidding with the built-in rules:', String(err?.message || err))
        return null
      }
    })()
    return published
  }

  return async function dispatch({ id, fn, request } = {}) {
    try {
      if (!FUNCTIONS.includes(fn)) throw new Error(`unknown engine function ${fn}`)
      glue ??= loadGlue()
      const g = await glue
      if (typeof g[fn] !== 'function') {
        throw new Error(`this Rusty package has no ${fn}() (the practice table needs rusty-bidding-bot v0.2.0 or later)`)
      }
      const pack = await publishedFor(g)
      if (fn === 'info') {
        const info = JSON.parse(g.info())
        return {
          id,
          result: {
            ...info,
            rules_number: pack ? pack.rules_number : builtInNumber(info.rules_id),
            rules_source: pack ? 'published' : 'built-in',
            rules_commit: pack ? pack.source_commit : null,
          },
        }
      }
      let req = request ?? {}
      if (pack && fn !== 'freeEngine' && req.engine == null && !RULE_FIELDS.some((f) => req[f] != null)) {
        req = { ...req, pack: pack.text }
      }
      return { id, result: JSON.parse(g[fn](JSON.stringify(req))) }
    } catch (err) {
      // A failed load is retried on the next request (e.g. after a network blip).
      if (glue && !(await glue.then(() => true, () => false))) glue = null
      return { id, error: String(err?.message || err) }
    }
  }
}
