// Lightweight app-wide transient toasts (e.g. "Invite link copied"). Distinct
// from the friend/invitation toasts in useFriendPresence, which are actionable
// and server-driven; these are fire-and-forget notices. Module singleton so any
// component can `notify(...)` and App.vue renders the stack.

import { ref } from 'vue'

const messages = ref([]) // { id, text }
let seq = 0

export function useAppToast() {
  function notify(text, ms = 3500) {
    const id = ++seq
    messages.value = [...messages.value, { id, text }].slice(-4)
    setTimeout(() => {
      messages.value = messages.value.filter((m) => m.id !== id)
    }, ms)
  }
  return { messages, notify }
}
