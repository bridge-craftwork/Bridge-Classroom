// Signed privileged (teacher/admin) requests — client side of ADR-0003.
//
// Signs a canonical string binding the request (method + path + body hash +
// timestamp + nonce) with the teacher's private key, so the server can prove
// the caller controls their registered public key and is acting on THIS exact
// request. Nothing secret is embedded in the bundle — the signature is produced
// at call time from the key already on the device.

import { importSigningKey, signMessage, sha256Hex } from './crypto.js'
import { API_URL } from './apiUrl.js'

// API_URL is the RESOLVED base from apiUrl.js — NOT `import.meta.env.VITE_API_URL`.
// In production VITE_API_URL is intentionally empty (the Norton/.org host-fallback
// design), so reading the env var directly made signedFetch build a *relative* URL
// that hit the frontend origin (bridge-classroom.com) instead of the API host —
// GitHub Pages then served index.html, and the caller's `res.json()` choked on
// "<html>…". apiUrl.js resolves the correct .com/.org API host at runtime.
const API_KEY = import.meta.env.VITE_API_KEY || ''

// >=16 alphanumeric chars (the server bounds nonce length).
function randomNonce() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 24)
}

/**
 * Fetch a privileged endpoint with a signed request.
 *
 * @param {string} subpath - path under the API root, e.g. `/admin/decrypt-observations`
 * @param {Object} opts
 * @param {string} opts.userId - the caller's user id (x-bc-user)
 * @param {string} opts.privateKeyBase64 - the caller's PKCS8 private key (base64)
 * @param {string} [opts.method='POST']
 * @param {Object} [opts.body=null] - JSON body; the exact serialized bytes are hashed and sent
 * @returns {Promise<Response>}
 */
export async function signedFetch(subpath, { userId, privateKeyBase64, method = 'POST', body = null } = {}) {
  if (!userId || !privateKeyBase64) {
    throw new Error('Signed request requires a teacher key — sign in as a teacher first.')
  }

  const url = `${API_URL}${subpath}`
  // Sign exactly the path the server sees (`uri.path()`), derived from the URL
  // so the /api prefix can't drift between client and server.
  const signedPath = new URL(url, window.location.origin).pathname

  const bodyStr = body == null ? null : JSON.stringify(body)
  const bodyBytes = bodyStr == null ? new Uint8Array(0) : new TextEncoder().encode(bodyStr)
  const bodyHash = await sha256Hex(bodyBytes)

  const ts = Date.now()
  const nonce = randomNonce()
  const canonical = `BC1\n${method}\n${signedPath}\n${bodyHash}\n${ts}\n${nonce}`

  const signingKey = await importSigningKey(privateKeyBase64)
  const signature = await signMessage(signingKey, canonical)

  const headers = {
    'x-api-key': API_KEY,
    'x-bc-user': userId,
    'x-bc-timestamp': String(ts),
    'x-bc-nonce': nonce,
    'x-bc-signature': signature,
  }
  // `credentials: 'include'` so the browser (a) sends any existing durable-session
  // cookie and (b) — crucially for /session/attach — STORES the `Set-Cookie` the
  // API returns. On a cross-origin API response the cookie is dropped without it.
  // Phase 2's CORS `allow_credentials(true)` on the pinned origins makes this safe.
  const init = { method, headers, credentials: 'include' }
  if (bodyStr != null) {
    headers['Content-Type'] = 'application/json'
    init.body = bodyStr // must be the same bytes we hashed
  }
  return fetch(url, init)
}
