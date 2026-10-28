// useClaimFlow — the state behind a ClaimPanel, shared by the solo table and
// the served tables so a claim is offered, checked, refused and explained the
// same way everywhere.
//
// A table supplies three functions:
//   check(n)          → { accepted, verdict, message, stamp }   (validateClaimAt)
//   limit()           → { claimable, undecided } | null          (claimLimitAt)
//   commit(n, stamp)  → ends the hand; may throw / reject with an Error whose
//                       message is shown (e.g. the server's claim_stale)
//
// After an invalid claim, the panel also shows the most the claimer could
// have guaranteed, fetched without blocking.
//
// NOT a module-level singleton: each table owns its own claim form.

import { ref } from 'vue'

export function useClaimFlow({ check, limit, commit }) {
  const open = ref(false)
  const checking = ref(false)
  const rejection = ref(null)   // { additional, message }
  const claimLimit = ref(null)  // { claimable, undecided }
  let token = 0

  function clear() {
    rejection.value = null
    claimLimit.value = null
  }

  function openForm() {
    open.value = true
    clear()
  }

  function cancel() {
    token++
    open.value = false
    checking.value = false
    clear()
  }

  async function confirm(n) {
    const mine = ++token
    checking.value = true
    clear()
    try {
      const result = await check(n)
      if (mine !== token) return
      if (!result.accepted) {
        rejection.value = { additional: n, message: result.message }
        if (result.verdict === 'invalid') {
          const l = await limit()
          if (mine === token && rejection.value) claimLimit.value = l
        }
        return
      }
      try {
        await commit(n, result.stamp)
        if (mine === token) open.value = false
      } catch (err) {
        if (mine === token) {
          rejection.value = { additional: n, message: err?.message || 'The claim was not accepted.' }
        }
      }
    } finally {
      if (mine === token) checking.value = false
    }
  }

  return { open, checking, rejection, limit: claimLimit, openForm, cancel, confirm }
}
