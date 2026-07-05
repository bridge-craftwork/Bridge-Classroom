// Engine-agnostic post-hand analysis overlay: final contract + double-dummy.
// The local practice table and (later) the server single-table host view both
// feed it the current auction + deal and render the same overlay — the analysis
// is pure presentation, so it doesn't care which engine ran the hand.
//
// Inputs (accepts refs OR zero-arg getters, so callers can pass either):
//   bids    → the auction so far (string[] of calls)
//   dealer  → the dealing seat ('N'|'E'|'S'|'W'), or falsy when no deal
// Exposes:
//   finalContract   computed { contract, declarer } (empty until the auction ends)
//   doubleDummy     ref: raw ddtricks string (null until loaded)
//   loadDoubleDummy(deal)  fetch DD for a deal (best-effort, latest-wins)
//   resetDd()       clear DD + invalidate any in-flight fetch

import { ref, computed } from 'vue'
import { determineContract } from '../utils/handAnalysis.js'
import { fetchDoubleDummy } from '../utils/ddsClient.js'

function read(src) {
  return typeof src === 'function' ? src() : src?.value
}

export function useHandAnalysis({ bids, dealer }) {
  const doubleDummy = ref(null)
  let ddToken = 0

  const finalContract = computed(() => {
    const d = read(dealer)
    const calls = read(bids) || []
    if (!d) return { contract: '', declarer: null }
    return determineContract(calls, d) || { contract: '', declarer: null }
  })

  async function loadDoubleDummy(deal) {
    doubleDummy.value = null
    const token = ++ddToken
    try {
      const dd = await fetchDoubleDummy(deal)
      if (token === ddToken) doubleDummy.value = dd
    } catch {
      /* double-dummy is best-effort; leave it null on failure */
    }
  }

  function resetDd() {
    doubleDummy.value = null
    ddToken++ // invalidate any in-flight fetch
  }

  return { finalContract, doubleDummy, loadDoubleDummy, resetDd }
}
