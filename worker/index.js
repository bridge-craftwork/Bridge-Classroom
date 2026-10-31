// The bridge-classroom Worker (bridge-classroom.org). Static assets serve
// everything; this script runs only for /card/print/* (wrangler.jsonc,
// assets.run_worker_first): a convention card's read-only PDF link (#482).
//
//   /card/print/<token>.pdf
//
// The API answers it (GET /api/cards/print/<token>.pdf): it reads the card
// and has card-pdf-service on the droplet render it. A render takes
// 200-300 ms of CPU, past the 10 ms a free Worker may spend (Error 1102),
// so this script only passes the request on, and caches the answer at the
// edge. The link stays the same wherever the API or the renderer move.

const PRINT_PATH = /^\/card\/print\/([A-Za-z0-9_-]{20,128})(?:\.pdf)?$/
const API = 'https://api.bridge-classroom.org/api'

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const m = url.pathname.match(PRINT_PATH)
    if (!m) return env.ASSETS.fetch(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed')

    const cache = caches.default
    // One entry per card, with or without the .pdf suffix
    const key = new Request(`${url.origin}/card/print/${m[1]}.pdf`)
    const hit = await cache.match(key)
    if (hit) return hit
    let res
    try {
      res = await fetch(`${env.API_BASE || API}/cards/print/${m[1]}.pdf`)
    } catch (err) {
      console.error('card print failed', err)
      return text(502, "The convention card couldn't be printed right now. Please try again shortly.")
    }
    // The API's own answer (404 for a link that isn't valid), as it gave it
    res = new Response(res.body, res)
    if (res.ok) ctx.waitUntil(cache.put(key, res.clone()))
    return res
  },
}
