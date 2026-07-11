// useRememberedTables — the client-side list of previously used table
// connect codes (plan §Join URLs): every /play/:hostCode or
// /table/:inviteCode a browser successfully resolves is remembered in
// localStorage, so the bare #/play route can offer "your teachers' tables"
// and auto-connect when exactly one of them has an open session.
//
// Entries: { kind: 'play'|'table', code, hostName, lastUsedAt } — newest
// first, deduped on kind+code, capped so the list stays skimmable.

import { API_URL } from '../utils/apiUrl.js'
import { apiFetch } from '../utils/apiFetch.js'

const STORAGE_KEY = 'bridgeTableRememberedCodes'
const MAX_ENTRIES = 12

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(e => e && e.kind && e.code) : []
  } catch {
    return []
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)))
  } catch {
    // localStorage unavailable — remembering is best-effort.
  }
}

// Record a successfully resolved code (moves it to the top).
function remember(kind, code, hostName) {
  const list = load().filter(e => !(e.kind === kind && e.code === code))
  list.unshift({ kind, code, hostName: hostName || '', lastUsedAt: Date.now() })
  save(list)
}

function forget(kind, code) {
  save(load().filter(e => !(e.kind === kind && e.code === code)))
}

// Resolve a code against the public API.
// Returns { ok, hostName, session } — session is null when the owner has no
// open session; ok:false means the code is unknown (404) or the API failed.
async function resolveCode(kind, code) {
  try {
    const res = await apiFetch(`${API_URL}/${kind}/${encodeURIComponent(code)}`)
    if (!res.ok) return { ok: false, status: res.status, hostName: '', session: null }
    const data = await res.json()
    return { ok: true, status: res.status, hostName: data.host_name || '', session: data.session || null }
  } catch {
    return { ok: false, status: 0, hostName: '', session: null }
  }
}

// Check every remembered code for an open session (in parallel).
// Returns [{ ...entry, active, session }].
async function checkActive() {
  const list = load()
  return Promise.all(
    list.map(async (entry) => {
      const r = await resolveCode(entry.kind, entry.code)
      return { ...entry, active: !!(r.ok && r.session), session: r.session }
    })
  )
}

export function useRememberedTables() {
  return { load, remember, forget, resolveCode, checkActive }
}
