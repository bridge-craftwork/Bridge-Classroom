// Post-hand per-card double-dummy analysis (bridge-solver-service #4).
// See documentation/design/dd-cardplay-analysis-spec.md.
//
// Two tiers, matching the two service endpoints:
//   Tier 1 (batch, at hand completion): the running DD trace → each played
//     card's `cost` (tricks its side gave away). Powers the error badges.
//   Tier 2 (on demand, on card tap): one node's alternatives (the DD cost of
//     every legal card there). Powers the inspect modal; memoised per node.
//
// Best-effort throughout: any failure leaves the analysis empty and the overlay
// simply doesn't appear. Latest-wins so a slow solve from a previous hand can
// never annotate the next one (the `dealCtx` singleton resets between deals —
// the caller snapshots the deal + trace at completion and passes them in).

import { ref, computed } from 'vue'
import { fetchDdPlay, fetchDdPlayNode } from '../utils/ddsClient.js'

// NOT a module-level singleton: each engine/table owns its own analysis state,
// so this composable is instance-scoped (unlike the app-config singletons).
export function useCardPlayAnalysis() {
  // The snapshot the trace + node calls were built from — { hands, trump,
  // declarer, leader, plays }. Kept so alternativesForNode can reuse it.
  const snapshot = ref(null)
  const trace = ref(null)            // { contract_tricks, trace: [...] } or null
  const nodeCache = new Map()        // node index → alternatives payload (memoised)
  let token = 0

  // Per played card → cost, for cost > 0 only. Keyed by the card code ("H4"),
  // which is unique across the deal, so a per-seat badge lookup is unambiguous.
  const errorsByCard = computed(() => {
    const out = {}
    for (const t of trace.value?.trace || []) {
      if (t.cost > 0) out[t.card] = t.cost
    }
    return out
  })

  const contractTricks = computed(() => trace.value?.contract_tricks ?? null)

  // Run the batch trace for a completed (or partial) hand. `req` =
  // { hands, trump, declarer, leader, plays }.
  async function analyze(req) {
    reset()
    if (!req?.plays?.length) return
    snapshot.value = req
    const mine = ++token
    const result = await fetchDdPlay(req)
    if (mine === token) trace.value = result
  }

  // Alternatives for the node at play-index `k` (the card played there), fetched
  // on demand and memoised. Returns the payload or null. Safe to call for any
  // card, good or bad.
  async function alternativesForNode(k) {
    if (nodeCache.has(k)) return nodeCache.get(k)
    if (!snapshot.value) return null
    const result = await fetchDdPlayNode(snapshot.value, k)
    // Only memoise successes, so a transient failure can be retried on re-tap.
    if (result) nodeCache.set(k, result)
    return result
  }

  function reset() {
    token++            // invalidate any in-flight trace fetch
    snapshot.value = null
    trace.value = null
    nodeCache.clear()
  }

  return {
    trace,
    errorsByCard,
    contractTricks,
    analyze,
    alternativesForNode,
    reset,
  }
}
