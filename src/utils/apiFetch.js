// Central client for the Bridge Classroom API.
//
// Every call to our own API (`api.bridge-classroom.{org,com}` / localhost:3000)
// should go through `apiFetch` rather than a bare `fetch`, so that the shared
// `x-api-key` header — and, from ADR-0004 Phase 2, the session-cookie
// `credentials: 'include'` — live in ONE place instead of being hand-rolled in
// ~20 composables (review §A1). It is a thin, behavior-preserving wrapper: it
// returns the raw `Response` exactly like `fetch`, so callers keep their own
// `.ok` / `.json()` handling.
//
// Do NOT use this for third-party fetches (e.g. `raw.githubusercontent.com`
// lesson content) — those must not carry our key or credentials. Use plain
// `fetch` there.
//
// `API_URL` is re-exported so callers can `import { apiFetch, API_URL }` from a
// single module.

import { API_URL } from './apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

/**
 * `fetch` for our API, with the shared key injected.
 *
 * @param {string} url   Full URL (build it from `API_URL`).
 * @param {RequestInit} [options]  Standard fetch options; `method`, `body`,
 *   and any explicit `Content-Type` are passed through untouched.
 * @returns {Promise<Response>} the raw Response, same as `fetch`.
 */
export function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) }

  // Inject the shared key unless the caller set one explicitly (e.g. a signed
  // request that carries its own auth headers).
  const hasKey = Object.keys(headers).some((h) => h.toLowerCase() === 'x-api-key')
  if (!hasKey) {
    headers['x-api-key'] = API_KEY
  }

  return fetch(url, {
    ...options,
    headers,
    // ADR-0004 Phase 2 will add `credentials: 'include'` here (in lockstep with
    // the CORS `allow_credentials(true)` / pinned-origins change), so the
    // session cookie rides on every API call from this single site.
  })
}

export { API_URL }
