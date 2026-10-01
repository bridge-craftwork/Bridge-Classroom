// Rusty — rusty-bidding-bot's rule-based bidding engine — for the solo
// practice table. A promise API over a module Web Worker (src/workers/
// rbbWorker.js) that runs the WASM package, so no engine call blocks the main
// thread. Sibling of bbaClient.js; the engine's contract is rusty-bidding-bot
// docs/WASM.md (API version 1).
//
// Nothing is loaded until the first request: the worker, and in it the WASM
// (~430 KB gzipped), start on the first Rusty table only. Engines are cached
// per card pair (createEngine handles).
//
// Also here: the adapters between the app's shapes and the engine's —
// hands as `S.H.D.C` strings, card names from PBN `% CC1/CC2` headers, and a
// Rusty auction step as the meaning object AuctionTable already takes.

import { fetchPbsBbsa } from './pbsScenarios.js'

// Build info of the installed package (vite.config.js → scripts/fetch-rbb-wasm.mjs):
// { source, tag, sha256, api, version, rules_id, supports_auction } or null.
export const RBB_WASM_INFO = typeof __RBB_WASM__ !== 'undefined' ? __RBB_WASM__ : null

// The engine's API version this client speaks.
export const RBB_API = 1

// Where the package is served (public/rbb-wasm/ → /rbb-wasm/).
function defaultBase() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return new URL(base.replace(/\/?$/, '/') + 'rbb-wasm/', globalThis.location?.href || 'http://localhost/').href
}

function defaultWorker() {
  return new Worker(new URL('../workers/rbbWorker.js', import.meta.url), { type: 'module' })
}

// An engine response with ok:false → an Error carrying its diagnostics.
export function diagnosticsError(res, what) {
  const diags = res?.diagnostics || []
  const first = diags.find((d) => d.severity === 'error') || diags[0]
  const err = new Error(`${what}: ${first?.message || 'the engine refused the request'}`)
  err.diagnostics = diags
  return err
}

/**
 * createRbbClient({ createWorker, base }) → client
 *   client.call(fn, request)   raw: resolves the engine's parsed response (ok or not)
 *   client.info()              info(), cached; rejects on an API mismatch
 *   client.engineFor(cards)    createEngine handle for {ns, ew} card specs, cached
 *   client.auction(request)    auction(); rejects with the diagnostics when !ok
 *   client.meaning(request)    meaning(); rejects with the diagnostics when !ok
 *   client.terminate()
 */
export function createRbbClient({ createWorker = defaultWorker, base = null } = {}) {
  let worker = null
  let nextId = 1
  const pending = new Map()
  let infoPromise = null
  const engines = new Map()

  function failAll(message) {
    for (const { reject } of pending.values()) reject(new Error(message))
    pending.clear()
  }

  function ensureWorker() {
    if (worker) return worker
    worker = createWorker()
    worker.onmessage = (e) => {
      const { id, result, error } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (error) p.reject(new Error(`Rusty: ${error}`))
      else p.resolve(result)
    }
    worker.onerror = (e) => {
      failAll(`Rusty worker failed: ${e?.message || 'unknown error'}`)
      try { worker.terminate() } catch { /* already gone */ }
      worker = null
      infoPromise = null
      engines.clear()
    }
    worker.postMessage({ base: base || defaultBase() })
    return worker
  }

  function call(fn, request) {
    const w = ensureWorker()
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ id, fn, request })
    })
  }

  function info() {
    infoPromise ??= call('info').then((r) => {
      if (r.api !== RBB_API) throw new Error(`Rusty: engine API ${r.api}, this app speaks ${RBB_API}`)
      return r
    })
    infoPromise.catch(() => { infoPromise = null })
    return infoPromise
  }

  function engineFor(cards) {
    const key = JSON.stringify(cards)
    if (!engines.has(key)) {
      const p = call('createEngine', { cards }).then((r) => {
        if (!r.ok || r.engine == null) throw diagnosticsError(r, 'Rusty could not load the cards')
        return r.engine
      })
      p.catch(() => engines.delete(key))
      engines.set(key, p)
    }
    return engines.get(key)
  }

  async function checked(fn, request) {
    const r = await call(fn, request)
    if (!r.ok) throw diagnosticsError(r, `Rusty ${fn}`)
    return r
  }

  return {
    call,
    info,
    engineFor,
    auction: (request) => checked('auction', request),
    meaning: (request) => checked('meaning', request),
    terminate() {
      failAll('Rusty worker terminated')
      if (worker) worker.terminate()
      worker = null
      infoPromise = null
      engines.clear()
    },
  }
}

let shared = null
/** The app's one Rusty client (one worker, one WASM instance), made on first use. */
export function getRbbClient() {
  shared ??= createRbbClient()
  return shared
}

// ── Adapters ────────────────────────────────────────────────────────────

/** The app's hand ({spades:[...], hearts, diamonds, clubs}) as `S.H.D.C`. */
export function handToRbb(hand) {
  const suit = (cards) => (cards || []).map((c) => (c === '10' ? 'T' : c)).join('')
  return [hand.spades, hand.hearts, hand.diamonds, hand.clubs].map(suit).join('.')
}

/** The app's vulnerability ('None' | 'NS' | 'EW' | 'All' | 'Both') for the engine. */
export function vulToRbb(v) {
  return v === 'Both' ? 'All' : (v || 'None')
}

/** A card name from a PBN header value: `…/bbsa/21GF-DEFAULT.bbsa` → `21GF-DEFAULT`. */
export function cardNameFromHeader(value) {
  return String(value ?? '').split(/[\\/]/).pop().replace(/\.bbsa\s*$/i, '').trim() || null
}

/** `% CC1 - …` / `% CC2 - …` of a PBN text as `{ns, ew}` card names (null when absent). */
export function cardsFromPbnHeader(pbnText) {
  const cc = (n) => cardNameFromHeader(new RegExp(`^%\\s*CC${n}\\s*-\\s*(.+)$`, 'm').exec(pbnText ?? '')?.[1])
  return { ns: cc(1), ew: cc(2) }
}

/**
 * The engine's card spec for a card name: the name itself when it is built in
 * (`info().stock_cards`), else the PBS `.bbsa` file's text. Never falls back to
 * another card: a name that cannot be found rejects.
 */
export async function cardSpecFor(name, stockCards, fetchBbsa = fetchPbsBbsa) {
  if ((stockCards || []).includes(name)) return name
  return { bbsa: await fetchBbsa(name), name }
}

// Calls as the app writes them ('1NT', 'Pass', 'X', 'XX').
export function normalizeCall(call) {
  const c = String(call || '').trim().toUpperCase()
  if (c === 'P' || c === 'PASS') return 'Pass'
  if (c === 'X' || c === 'D' || c === 'DBL') return 'X'
  if (c === 'XX' || c === 'R' || c === 'RDBL') return 'XX'
  const m = /^([1-7])(C|D|H|S|N|NT)$/.exec(c)
  if (m) return m[1] + (m[2] === 'N' ? 'NT' : m[2])
  return String(call || '')
}

export const NO_MEANING = 'Rusty has no meaning for this call'

/**
 * One Rusty auction step (docs/WASM.md "A step") as AuctionTable's meaning
 * object. `explanation` → meaning, `knowledge.summary` → meaningExtended,
 * alerts and announcements, `artificial`, `rule` → ruleRef. A step no rule
 * gives a meaning (`rule: null`) reads NO_MEANING, never the engine's
 * "No rule applies" (that is its reason for passing, not what a call shows).
 */
export function stepToMeaning(step) {
  const known = !!step.rule && !!step.explanation
  const meaning = known ? step.explanation : NO_MEANING
  const summary = step.knowledge?.summary || ''
  const alert = step.alert || null
  const out = {
    position: step.index,
    bid: normalizeCall(step.call),
    meaning,
    meaningExtended: summary || null,
    isAlert: alert?.kind === 'alert',
    alertText: alert?.kind === 'alert' ? (alert.text || null) : null,
    announce: alert?.kind === 'announce' ? (alert.text || null) : null,
    artificial: !!step.artificial,
    ruleRef: step.rule || null,
    known,
    fallback: false,
    source: 'rusty',
  }
  // The tooltip names the call's meaning first, then what the hand has shown.
  const lines = [out.announce ? `${out.announce}${meaning === out.announce ? '' : ' — ' + meaning}` : meaning]
  if (known && summary && summary !== meaning) lines.push(summary)
  out.tooltip = lines.join('\n')
  return out
}

/**
 * The meanings to show for an auction: Rusty's reading of every step, except
 * the calls BBA made in Rusty's place (fallbacks), which keep BBA's meaning
 * (decision 6: unflagged in the UI; `fallback: true` stays in the data).
 */
export function meaningsFromSteps(steps, fallbackMeanings = {}) {
  return (steps || []).map((s) => {
    const fb = fallbackMeanings[s.index]
    if (fb) return { ...fb, position: s.index, bid: normalizeCall(s.call), fallback: true, source: 'bba' }
    return stepToMeaning(s)
  })
}
