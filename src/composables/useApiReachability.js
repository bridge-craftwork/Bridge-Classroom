// Can this device reach our API right now?
//
// When the API can't be reached, every API call fails at the network level:
// our server down (on 2026-10-05/06 its Mac kept sleeping and the Cloudflare
// Tunnel dropped, Error 1033), or a network filter or security software
// blocking api.bridge-classroom.{org,com}. Practice keeps working (results
// queue in the browser), so the app used to stay quiet, and a student simply
// saw no assignments, with no hint why. This tracks that state so the app can
// say so (ApiUnreachableBanner).
//
// apiFetch reports every outcome here. Any HTTP response, even an error
// status, means the server was reached. A network-level failure doesn't
// raise the alarm by itself: one blip shouldn't put a banner in front of
// everyone, so it triggers a probe of the API's /health, and only a failed
// probe marks the API unreachable. While unreachable, the probe repeats every
// RECHECK_MS; when one succeeds, `recovered` turns on so the banner can offer
// a reload (the lists that came back empty need refetching).
//
// A device that is simply offline (navigator.onLine false) isn't "blocked":
// SyncStatus already says so, and the probe would only fail for that reason.

import { ref } from 'vue'
import { API_URL } from '../utils/apiUrl.js'

const RECHECK_MS = 60_000
const PROBE_TIMEOUT_MS = 8_000

const unreachable = ref(false)
const recovered = ref(false)
const since = ref(null)
const checking = ref(false)

let probeInFlight = null
let recheckTimer = null

/** The API's origin, e.g. https://api.bridge-classroom.org (health lives at /health, not /api/health). */
export function apiOrigin(apiUrl = API_URL) {
  try { return new URL(apiUrl).origin } catch { return '' }
}

function online() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** A fetch failure that says nothing about reachability (we cancelled it). */
function isAbort(err) {
  return err?.name === 'AbortError'
}

async function probe() {
  if (probeInFlight) return probeInFlight
  checking.value = true
  probeInFlight = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS) : null
    try {
      // Plain fetch, no key or cookie: /health needs neither, and this must not
      // loop back through apiFetch.
      const res = await fetch(`${apiOrigin()}/health`, { cache: 'no-store', signal: ctl?.signal })
      return res.ok
    } catch {
      return false
    } finally {
      if (timer) clearTimeout(timer)
    }
  })()
  try {
    const ok = await probeInFlight
    if (ok) markReachable()
    else if (online()) markUnreachable()
    return ok
  } finally {
    probeInFlight = null
    checking.value = false
  }
}

function markUnreachable() {
  if (!unreachable.value) {
    unreachable.value = true
    recovered.value = false
    since.value = new Date()
  }
  if (!recheckTimer) recheckTimer = setInterval(probe, RECHECK_MS)
}

function markReachable() {
  if (unreachable.value) recovered.value = true
  unreachable.value = false
  since.value = null
  if (recheckTimer) { clearInterval(recheckTimer); recheckTimer = null }
}

/** apiFetch: the server answered (any status). */
export function noteApiResponse() {
  if (unreachable.value) markReachable()
}

/** apiFetch: the request failed before any response. */
export function noteApiFailure(err) {
  if (isAbort(err) || !online()) return
  probe()
}

export function useApiReachability() {
  return {
    unreachable,
    recovered,
    since,
    checking,
    host: apiOrigin().replace(/^https?:\/\//, ''),
    /** Check again now (the banner's "Try again"). Resolves true if reachable. */
    retry: probe,
    dismissRecovered: () => { recovered.value = false },
  }
}

/** Tests only: back to the initial state. */
export function __resetApiReachability() {
  unreachable.value = false
  recovered.value = false
  since.value = null
  checking.value = false
  probeInFlight = null
  if (recheckTimer) { clearInterval(recheckTimer); recheckTimer = null }
}
