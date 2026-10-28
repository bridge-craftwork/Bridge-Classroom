// bridge-solver in the browser: claim checking and double dummy, over a module
// Web Worker (src/workers/solverWorker.js) running the WASM package, so a slow
// check never blocks the table. Sibling of rbbClient.js.
//
// Claims are checked here, on the claimer's computer, not by a service: the
// load stays off the droplet (claims design, 2026-10-27). A served table sends
// the verdict to the table service with the play count it was computed at.
//
// Every claim number this module returns is in "additional tricks": tricks
// beyond those the side has already won, out of the ones still to play
// (including the trick in progress). That is what the claim panel offers
// (0 … remaining, 0 being a concession). The solver works in totals for the
// hand; the conversion happens only here.
//
// Nothing is loaded until the first request: the worker, and in it the WASM
// (~390 KB), start on the first claim.

import { handsToPbnString } from './handAnalysis.js'

// Build info of the installed package (vite.config.js → scripts/fetch-solver-wasm.mjs):
// { source, tag, sha256, version, supports_claim } or null.
export const SOLVER_WASM_INFO = typeof __SOLVER_WASM__ !== 'undefined' ? __SOLVER_WASM__ : null

const SIDE_OF = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' }
export const sideOf = (seat) => SIDE_OF[seat] || null

const plural = (n) => `${n} more trick${n === 1 ? '' : 's'}`

/**
 * What to tell a claimer whose claim of `additional` more tricks was not
 * accepted, by verdict ('' for a valid one). Every table says the same thing.
 */
export function claimRejectionMessage(verdict, additional) {
  switch (verdict) {
    case 'valid': return ''
    case 'invalid': return `Not guaranteed: some way the unseen cards could lie holds you below ${plural(additional)}. Play on.`
    case 'undecided': return `Too complex to prove in time, so the claim can't be accepted. Play on.`
    default: return `The claim checker couldn't run, so the claim can't be accepted. Play on.`
  }
}

// Where the package is served (public/solver-wasm/ → /solver-wasm/).
function defaultBase() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return new URL(base.replace(/\/?$/, '/') + 'solver-wasm/', globalThis.location?.href || 'http://localhost/').href
}

function defaultWorker() {
  return new Worker(new URL('../workers/solverWorker.js', import.meta.url), { type: 'module' })
}

/**
 * The solver's play request, shared by every call. `play` is the shape the DD
 * overlay already uses (ddsClient.js):
 *   { hands, trump, declarer, leader, plays }
 *   hands    — the ORIGINAL deal, { N:{spades,hearts,diamonds,clubs}, ... }
 *   trump    — 'S'|'H'|'D'|'C'|'NT' (null → 'NT')
 *   declarer — 'N'|'E'|'S'|'W'; leader — the opening leader
 *   plays    — every card played so far, in order: ['H4','CT', ...]
 */
export function solverPlayRequest({ hands, trump, declarer, leader, plays }) {
  return {
    dealstr: 'N:' + handsToPbnString(hands),
    trump: trump || 'NT',
    declarer,
    leader,
    plays: plays || [],
  }
}

/**
 * createSolverClient({ createWorker, base }) → client
 *   client.call(fn, request)        raw: resolves the solver's parsed response
 *   client.checkClaim(args)         one claim → { verdict, accepted, nodes }
 *   client.maxClaim(args)           → { claimable, undecided, remaining }
 *   client.makable(args)            → { makable, remaining }
 *   client.claimOptions(args)       → { remaining, claimable, claimableUndecided, makable }
 *   client.terminate()
 *
 * `args` = { play, claimer, tricksTaken: {NS, EW} } (+ `additional` for
 * checkClaim). tricksTaken counts completed tricks only.
 */
export function createSolverClient({ createWorker = defaultWorker, base = null } = {}) {
  let worker = null
  let nextId = 1
  const pending = new Map()

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
      if (error) p.reject(new Error(`solver: ${error}`))
      else p.resolve(result)
    }
    worker.onerror = (e) => {
      failAll(`solver worker failed: ${e?.message || 'unknown error'}`)
      try { worker.terminate() } catch { /* already gone */ }
      worker = null
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

  // The claimer's completed tricks, cross-checked against the solver's own
  // count from the play record: a mismatch means the caller's position and the
  // record disagree, and no verdict about either can be trusted.
  function wonBy(claimer, tricksTaken, res) {
    const won = tricksTaken?.[sideOf(claimer)] ?? 0
    if (res && res.tricks_won !== won) {
      throw new Error(`solver: the play record gives ${res.tricks_won} tricks won, the table says ${won}`)
    }
    return won
  }

  async function checkClaim({ play, claimer, additional, tricksTaken }) {
    const won = tricksTaken?.[sideOf(claimer)] ?? 0
    const res = await call('checkClaim', {
      ...solverPlayRequest(play),
      claimer,
      total_tricks: won + additional,
    })
    wonBy(claimer, tricksTaken, res)
    return { verdict: res.verdict, accepted: res.verdict === 'valid', nodes: res.nodes }
  }

  async function maxClaim({ play, claimer, tricksTaken }) {
    const res = await call('checkClaim', { ...solverPlayRequest(play), claimer })
    const won = wonBy(claimer, tricksTaken, res)
    return { claimable: res.guaranteed - won, undecided: !!res.undecided, remaining: res.tricks_left }
  }

  async function makable({ play, claimer, tricksTaken }) {
    const req = solverPlayRequest(play)
    const line = await call('optimalLine', req)
    // Tricks still to play = the cards the double-dummy line plays, by trick:
    // the line runs from the current card to the end of the hand.
    const completed = (tricksTaken?.NS ?? 0) + (tricksTaken?.EW ?? 0)
    const remaining = 13 - completed
    const declSide = sideOf(play.declarer)
    const declAdditional = line.declaring_tricks - (tricksTaken?.[declSide] ?? 0)
    return {
      makable: sideOf(claimer) === declSide ? declAdditional : remaining - declAdditional,
      remaining,
    }
  }

  async function claimOptions(args) {
    const [limit, dd] = await Promise.all([maxClaim(args), makable(args)])
    return {
      remaining: limit.remaining,
      claimable: limit.claimable,
      claimableUndecided: limit.undecided,
      makable: dd.makable,
    }
  }

  return {
    call,
    checkClaim,
    maxClaim,
    makable,
    claimOptions,
    terminate() {
      failAll('solver worker terminated')
      if (worker) worker.terminate()
      worker = null
    },
  }
}

let shared = null
/** The app's one solver client (one worker, one WASM instance), made on first use. */
export function getSolverClient() {
  shared ??= createSolverClient()
  return shared
}

// ── A claim at a table position ─────────────────────────────────────────
// `pos` = { play, claimer, tricksTaken, stamp } — what useCardPlay's
// claimPosition() and useRemoteTable's claimPosition produce. Shared by every
// table so they all accept, refuse and explain a claim the same way.

/**
 * Check a claim of `additional` more tricks. Resolves
 *   { accepted, verdict, message, stamp }
 * verdict ∈ 'valid' | 'invalid' | 'undecided' | 'error'. Anything but 'valid'
 * is a refusal with a reason; a checker that can't run refuses rather than
 * waving the claim through.
 */
export async function validateClaimAt(pos, additional, checker = getSolverClient()) {
  try {
    const { verdict } = await checker.checkClaim({ ...pos, additional })
    return { accepted: verdict === 'valid', verdict, message: claimRejectionMessage(verdict, additional), stamp: pos.stamp }
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[claim] check failed:', err.message)
    }
    return { accepted: false, verdict: 'error', message: claimRejectionMessage('error', additional), stamp: pos.stamp }
  }
}

/** The most the claimer could claim at `pos`: { claimable, undecided }, or null. */
export async function claimLimitAt(pos, checker = getSolverClient()) {
  try {
    const r = await checker.maxClaim(pos)
    return { claimable: r.claimable, undecided: r.undecided }
  } catch {
    return null
  }
}
