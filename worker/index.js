// The bridge-classroom Worker (bridge-classroom.org). Static assets serve
// everything; this script runs only for /card/print/* (wrangler.jsonc,
// assets.run_worker_first): a convention card's read-only PDF link (#482).
//
//   /card/print/<token>.pdf
//
// It reads the card from the API (no sign-in: the token is the permission)
// and renders the official ACBL PDF with the convention-card library, so the
// link always shows the card as it is now. The template PDFs and font come
// from this site's own static files (build-site.sh copies them to
// /card-print-assets/), not the bundle, which keeps the script small.

import { setAssetLoader, TEMPLATE_FILES, FONT_FILE } from '@bridge-craftwork/convention-card/js/assets.js'
import { renderAcblPdfBytes } from '@bridge-craftwork/convention-card/js/acblClassicFillPdf.js'

const PRINT_PATH = /^\/card\/print\/([A-Za-z0-9_-]{20,128})(?:\.pdf)?$/
// Edits show within this long; RealBridge and the like fetch the link often.
const CACHE_SECONDS = 300

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

function filename(card) {
  const base = String(card.card_data?.metadata?.partner_names || card.name || 'convention-card')
    .trim().replace(/[^\w\s.-]+/g, '').replace(/\s+/g, '-')
  return `${base || 'convention-card'}.pdf`
}

async function renderPrint(token, request, env) {
  const api = env.API_BASE || 'https://api.bridge-classroom.org/api'
  const res = await fetch(`${api}/cards/print/${token}`, { headers: { accept: 'application/json' } })
  if (res.status === 404) return text(404, 'This convention card link is not valid.')
  if (!res.ok) return text(502, "The convention card couldn't be loaded right now. Please try again shortly.")
  const card = await res.json()

  const asset = async (file) => {
    const r = await env.ASSETS.fetch(new URL(`/card-print-assets/${file}`, request.url))
    if (!r.ok) throw new Error(`asset ${file}: ${r.status}`)
    return r.arrayBuffer()
  }
  setAssetLoader({ template: (name) => asset(TEMPLATE_FILES[name]), font: () => asset(FONT_FILE) })

  const template = card.template === 'new' ? 'new' : 'classic'
  // Not flattened, like the editor's own export: the library's flatten drops
  // the checkmarks (and leaves dangling objects). The link is still
  // read-only in the sense that matters: editing a copy changes nothing here.
  const bytes = await renderAcblPdfBytes(
    { name: card.name, updated_at: card.updated_at, card_data: card.card_data || {} },
    template,
  )
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename(card)}"`,
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-robots-tag': 'noindex',
    },
  })
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
      res = await renderPrint(m[1], request, env)
    } catch (err) {
      console.error('card print failed', err)
      return text(500, "The convention card couldn't be printed right now.")
    }
    if (res.ok) ctx.waitUntil(cache.put(key, res.clone()))
    return res
  },
}
