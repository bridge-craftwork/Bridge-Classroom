// When the table opens a scenario's description by itself. One scenario: always,
// since the student just chose it. A mix (more than one source): the scenario changes
// between boards and the description would announce what is coming, so only if the
// student asks for it. Persisted like the other `bp.*` table settings; off by default.

export const SHOW_DESCRIPTION_IN_MIX_KEY = 'bp.showDescriptionInMix'

function defaultStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

export function loadShowDescriptionInMix(storage = defaultStorage()) {
  try { return storage?.getItem(SHOW_DESCRIPTION_IN_MIX_KEY) === '1' } catch { return false }
}

export function saveShowDescriptionInMix(on, storage = defaultStorage()) {
  try { storage?.setItem(SHOW_DESCRIPTION_IN_MIX_KEY, on ? '1' : '0') } catch { /* private mode etc. */ }
}

export function autoOpensDescription({ itemCount, showInMix }) {
  return itemCount <= 1 || !!showInMix
}
