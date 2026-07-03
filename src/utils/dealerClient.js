// Client for the bridge-dealer-service REST API (dealer3 wrapper).
// Deployed at https://dealer.bridge-craftwork.com (see bridge-dealer-service repo).
// Stateless: every call carries the full dealer script.
//
// Browser-direct, like benClient — no proxy, no auth. dealer-service is a
// public peer of BEN/BBA (auth relaxed 2026-07-03); the wall-clock + output/
// concurrency caps at the service bound abuse (see deal-source-spec §4.7).
//
// Endpoint: POST /deal  body { script, seed? } → { seed, produced, generated,
// elapsed_ms, output }. `output` is raw dealer stdout; we keep only its PBN
// tag lines (see generateBoardPbn). The input/output shaping mirrors the
// table-service twin in bridge-table-service/src/dealer.rs verbatim.

const DEFAULT_DEALER_URL = 'https://dealer.bridge-craftwork.com'

export function getDealerUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEALER_URL) {
    return import.meta.env.VITE_DEALER_URL
  }
  if (typeof process !== 'undefined' && process.env?.DEALER_URL) {
    return process.env.DEALER_URL
  }
  return DEFAULT_DEALER_URL
}

// ── Script shaping ───────────────────────────────────────────────────────

// The PBS `.dlr` scripts end in `action printoneline, <stats…>`. Swap in
// `printpbn` (leaving any stats actions harmless) and force `produce 1`, so a
// single board comes back as PBN tag lines. Ported from dealer.rs.
export function prepareScript(script) {
  if (typeof script !== 'string') throw new Error('prepareScript: script must be a string')
  return `produce 1\n${script.replace('action printoneline', 'action printpbn')}`
}

// Keep only the `[Tag "…"]` lines of dealer stdout, dropping the trailing
// frequency tables / stats so the PBN parser never sees them. Throws if the
// result has no `[Deal ` (script filtered everything out). Ported from dealer.rs.
export function extractPbn(output) {
  const pbn = String(output || '')
    .split('\n')
    .filter(l => l.trimStart().startsWith('['))
    .join('\n')
  if (!pbn.includes('[Deal ')) {
    throw new Error('dealer produced no deal (script may filter everything out)')
  }
  return pbn
}

// ── HTTP ───────────────────────────────────────────────────────────────

// dealer-service caps each request at ~5s wall-clock; 15s gives network margin.
async function dealerFetch(path, body, { timeoutMs = 15000, signal } = {}) {
  const url = `${getDealerUrl()}${path}`
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs)
  // Caller can also pass an outer signal; abort the inner ctrl if it fires.
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  const startedAt = (typeof performance !== 'undefined') ? performance.now() : Date.now()
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`
      try {
        const j = await resp.json()
        if (j?.error) detail = j.error
      } catch { /* fall through */ }
      throw new Error(`dealer ${path}: ${detail}`)
    }
    const json = await resp.json()
    const elapsedMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - startedAt
    return { json, elapsedMs }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Public API ─────────────────────────────────────────────────────────

// POST /deal — run a dealer script and return one fresh board as PBN tag lines.
// `script` is the raw `.dlr` text (e.g. from pbsScenarios.fetchScenarioScript).
// Pass `seed` for a reproducible deal; omit for a fresh one (the service picks
// a seed and returns it). Returns { pbn, seed, elapsedMs, raw }.
export async function generateBoardPbn(script, { seed, timeoutMs, signal } = {}) {
  const body = { script: prepareScript(script) }
  if (seed !== undefined && seed !== null) body.seed = seed
  const { json, elapsedMs } = await dealerFetch('/deal', body, { timeoutMs, signal })
  return { pbn: extractPbn(json.output), seed: json.seed, elapsedMs, raw: json }
}
