// useTableHandoff — carries a deal-source selection from the solo Practice Table
// to a freshly hosted server table (the "Invite friends" in-place conversion:
// solo LocalEngine → served ServerEngine at a board boundary, app-architecture
// D9). The solo view stashes its current selection and routes to /tables/host;
// that view, once its session is connected, takes the pending selection and
// materializes it onto the table. Module singleton (survives the navigation).

import { ref } from 'vue'

const pendingSelection = ref(null)

export function useTableHandoff() {
  // Stash the deal source the solo table is currently using.
  function setPending(selection) {
    pendingSelection.value = selection || null
  }
  // Consume it exactly once (returns null if nothing was handed off, so a
  // direct visit to /tables/host is unaffected).
  function takePending() {
    const s = pendingSelection.value
    pendingSelection.value = null
    return s
  }
  return { pendingSelection, setPending, takePending }
}
