// Detects newly-earned "Fresh paw" wild-mastery milestones and queues them for
// a celebration toast. Paws are server-computed (board_status.wild_achievement)
// and only reach the client when board-status is (re)fetched — there is no
// synchronous signal at play time. So we watch board-status data as it lands
// and fire when a Fresh paw appears that we haven't celebrated before.
//
// First time we see a given user's data we SEED silently (record their current
// Fresh paws without celebrating) so a user who already has paws before this
// shipped doesn't get a flood. Only paws that appear afterward celebrate. State
// is persisted per-device; a fresh device re-seeds silently (we don't re-cheer
// old milestones).

import { ref } from 'vue'
import { useUserStore } from './useUserStore.js'

const STORAGE_KEY = 'bridgeCelebratedPaws'

// Queue of { subfolder, dealNumber } awaiting a toast.
const pendingCelebrations = ref([])

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      seededUsers: new Set(raw.seededUsers || []),
      celebrated: new Set(raw.celebrated || []),
    }
  } catch {
    return { seededUsers: new Set(), celebrated: new Set() }
  }
}

const state = loadState()

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ seededUsers: [...state.seededUsers], celebrated: [...state.celebrated] })
    )
  } catch { /* ignore quota / private mode */ }
}

/**
 * Feed board-status entries (as returned by /board-status) for a user. Only the
 * logged-in user's OWN paws are ever considered — a teacher viewing a student's
 * board status won't trigger a celebration on the teacher's screen.
 */
export function registerFreshPaws(userId, entries) {
  const store = useUserStore()
  // Only the genuinely logged-in user's own paws celebrate. Never fire (or seed)
  // while a teacher/admin is "viewing as" a student — realUser is the actual
  // account regardless of view-as, so a viewed student's board-status fetch
  // won't match and won't mark anything on the viewer's device.
  if (store.isViewingAs.value) return
  const ownId = store.realUser.value?.id
  if (!userId || userId !== ownId || !Array.isArray(entries)) return

  const fresh = entries.filter(e => e.wild_achievement === 'Fresh')
  if (fresh.length === 0) return

  const keyOf = e => `${userId}:${e.deal_subfolder}:${e.deal_number}`

  // First data for this user on this device → seed silently.
  if (!state.seededUsers.has(userId)) {
    for (const e of fresh) state.celebrated.add(keyOf(e))
    state.seededUsers.add(userId)
    saveState()
    return
  }

  let changed = false
  for (const e of fresh) {
    const key = keyOf(e)
    if (!state.celebrated.has(key)) {
      state.celebrated.add(key)
      pendingCelebrations.value.push({ subfolder: e.deal_subfolder, dealNumber: e.deal_number })
      changed = true
    }
  }
  if (changed) saveState()
}

export function usePawCelebration() {
  return {
    pendingCelebrations,
    shiftCelebration() {
      return pendingCelebrations.value.shift() || null
    },
    clearPending() {
      pendingCelebrations.value = []
    },
  }
}
