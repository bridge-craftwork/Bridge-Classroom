<template>
  <router-view />
  <!-- The beetle is app chrome, not a component under test — keep it out of the
       VITE_HARNESS build so it doesn't float over every live gallery tile. -->
  <component v-if="!isHarness" :is="BeetleButton" />

  <!-- Friend toasts (app-wide, so they reach you in A1 or at a table — the
       pull-only Friends tab was invisible to a seated player). Two kinds: an
       incoming request (Accept/Dismiss) and a confirmation that someone accepted
       yours (informational, auto-dismisses). -->
  <div v-if="toasts.length" class="friend-toasts">
    <div v-for="t in toasts" :key="t.id" class="friend-toast">
      <template v-if="t.kind === 'request'">
        <div class="ft-body"><strong>{{ t.name || 'Someone' }}</strong> wants to be friends.</div>
        <div class="ft-actions">
          <button class="ft-btn ft-accept" :disabled="busyIds.has(t.id)" @click="acceptToast(t)">
            {{ busyIds.has(t.id) ? 'Accepting…' : 'Accept' }}
          </button>
          <button class="ft-btn ft-dismiss" @click="dismissToast(t.id)">Dismiss</button>
        </div>
      </template>
      <template v-else-if="t.kind === 'invitation'">
        <div class="ft-body"><strong>{{ t.name || 'A friend' }}</strong> invited you to their table.</div>
        <div class="ft-actions">
          <button class="ft-btn ft-accept" :disabled="busyIds.has(t.id)" @click="acceptInvitation(t)">
            {{ busyIds.has(t.id) ? 'Joining…' : 'Join' }}
          </button>
          <button class="ft-btn ft-dismiss" @click="declineInvitation(t)">Decline</button>
        </div>
      </template>
      <template v-else-if="t.kind === 'declined'">
        <div class="ft-body"><strong>{{ t.name || 'Your friend' }}</strong> declined the invitation.</div>
        <div class="ft-actions">
          <button class="ft-btn ft-dismiss" @click="dismissToast(t.id)">Dismiss</button>
        </div>
      </template>
      <template v-else>
        <div class="ft-body">You're now friends with <strong>{{ t.name || 'someone' }}</strong>.</div>
        <div class="ft-actions">
          <button class="ft-btn ft-dismiss" @click="dismissToast(t.id)">Dismiss</button>
        </div>
      </template>
    </div>
  </div>

  <!-- Generic transient notices (e.g. "Invite link copied"). -->
  <div v-if="appMessages.length" class="app-toasts">
    <div v-for="m in appMessages" :key="m.id" class="app-toast">{{ m.text }}</div>
  </div>
</template>

<script setup>
import { defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from './composables/useUserStore.js'
import { useFriendPresence } from './composables/useFriendPresence.js'
import { useFriends } from './composables/useFriends.js'
import { useTableSocket } from './composables/useTableSocket.js'
import { useInvitationJoin } from './composables/useInvitationJoin.js'
import { useAppToast } from './composables/useAppToast.js'
import { apiFetch, API_URL } from './utils/apiFetch.js'
// Grid-arranger bounding-box diagnostic overlay styles (grid-arranger-spec §5.1),
// available live in the app — inert unless `data-bounding-boxes` is set on <html>, and
// only styles `.grid-table`, so it does nothing on the legacy arrangement.
import './components/table/boundingBoxes.css'
import { initDebugOverlays, toggleDebugOverlays } from './composables/useDebugOverlays.js'

// Bug-report beetle (Slice 1). The GitHub-issue path is public — every user gets
// the button. (The extra LOCAL dev-sink path inside it is separately gated by the
// bcLocalReports localStorage flag; see report/flags.js.) Async so the report lib
// + screenshot rasterizer stay in their own lazily-loaded chunk.
const BeetleButton = defineAsyncComponent(() => import('./report/BeetleButton.vue'))
// Statically replaced at build time: '1' only in the harness bundle (the live
// /dev component gallery), where the floating beetle is visual noise over tiles.
const isHarness = import.meta.env.VITE_HARNESS === '1'

// Debug-overlay toggle: resolve `?bounding-boxes=1` / stored flag on load (and re-read
// on hashchange, inside the composable), and allow live toggling with Ctrl+B or Alt+B.
// Keyed on the PHYSICAL key (`e.code === 'KeyB'`), NOT `e.key` — on macOS Option+B emits
// the character "∫", so an `e.key === 'b'` check never fired (2026-07-12 report). Ctrl OR
// Alt (never Cmd, which is bold in inputs), and focus-guarded so it can't fire while a
// student is typing (the beetle note, name field, etc.).
initDebugOverlays()
function onKey(e) {
  if (e.metaKey) return
  if (!e.altKey && !e.ctrlKey) return
  if (e.code !== 'KeyB') return
  const el = document.activeElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  e.preventDefault()
  toggleDebugOverlays()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// ── Friend presence (Phase 3) ──────────────────────────────────────────────
// Driven from the always-mounted root (NOT MainLayout, which unmounts at /table)
// so presence — and our own `at_table` state — survives navigation to a table.
const userStore = useUserStore()
const presence = useFriendPresence()
const { toasts, dismissToast } = presence
watch(
  () => userStore.currentUserId.value,
  (id) => (id ? presence.start(id) : presence.stop()),
  { immediate: true },
)

// Friend toasts. On any new one, refresh the friends list so the lobby Friends-
// tab badge/count reflects it live; 'confirmed' toasts are informational, so
// auto-dismiss them after a few seconds ('request' toasts persist until acted on).
const friends = useFriends()
const busyIds = ref(new Set())
watch(
  () => toasts.value.length,
  (n, prev) => {
    if (n <= prev) return
    const latest = toasts.value[toasts.value.length - 1]
    // Friend-graph changes should refresh the Friends tab; a table invitation
    // doesn't touch the friend list, so skip the refresh for it.
    if (
      userStore.currentUserId.value &&
      latest &&
      (latest.kind === 'request' || latest.kind === 'confirmed')
    ) {
      friends.refresh(userStore.currentUserId.value)
    }
    // Purely informational toasts auto-dismiss; actionable ones persist.
    if (latest && (latest.kind === 'confirmed' || latest.kind === 'declined')) {
      setTimeout(() => dismissToast(latest.id), 7000)
    }
  },
)
// A request that is no longer pending has already been resolved — accepted from the
// Friends tab, on another device, or by the server's crossing-proposal auto-accept
// (two people who each asked the other are already both consenting). The outcome the
// user wanted is true, so the toast's job is done; leaving it up asks them to keep
// clicking a button that can only fail.
const ALREADY_RESOLVED = new Set([404, 409])

async function acceptToast(t) {
  const uid = userStore.currentUserId.value
  if (!uid || busyIds.value.has(t.id)) return
  busyIds.value = new Set(busyIds.value).add(t.id)
  try {
    await friends.acceptRequest(uid, t.id)
    dismissToast(t.id)
  } catch (e) {
    // Every terminal outcome says something (roadmap 2026-07-30 §3.3). Dismissing
    // mutely turns a failure into "nothing happened" — which is precisely what
    // two of the day's reports described.
    if (ALREADY_RESOLVED.has(e?.status)) {
      dismissToast(t.id)
      notify('Already answered — probably in another window.')
    } else {
      notify("Couldn't accept that request — try again, or use the Friends tab.")
    }
    // Otherwise leave the toast up so they can retry or use the Friends tab.
  } finally {
    const next = new Set(busyIds.value)
    next.delete(t.id)
    busyIds.value = next
  }
}

// Generic transient notices (App-wide toast surface).
const { messages: appMessages, notify } = useAppToast()

// ── Table invitations (Phase 4) ────────────────────────────────────────────
const router = useRouter()
const invitationJoin = useInvitationJoin()

async function acceptInvitation(t) {
  const uid = userStore.currentUserId.value
  if (!uid || busyIds.value.has(t.id)) return
  busyIds.value = new Set(busyIds.value).add(t.id)
  try {
    const res = await apiFetch(`${API_URL}/invitations/${t.invitationId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: uid }),
    })
    // An invitation that's gone (410), already answered (409) or unknown (404) can
    // never be accepted by clicking again — same rule as the friend-request toast.
    // But SAY SO: PR #366 dismissed these silently, which reads as a dead button
    // (roadmap §3.3). 410 is a different story from 409 and deserves its own words.
    if (res.status === 410) {
      dismissToast(t.id)
      notify('That invitation expired — ask them to invite you again.')
      return
    }
    if (ALREADY_RESOLVED.has(res.status)) {
      dismissToast(t.id)
      notify('Already answered — probably in another window.')
      return
    }
    if (!res.ok) throw new Error(`accept failed (${res.status})`)
    const { session_id, ticket, name, role } = await res.json()
    // Hand the minted ticket to TableLobbyView (never via URL — ADR-0006 §2) and
    // navigate; it joins straight into the reserved seat.
    invitationJoin.set({ sessionId: session_id, ticket, name, role })
    dismissToast(t.id)
    router.push(`/table/${session_id}`)
  } catch (e) {
    // Leave the toast up so they can retry — but never silently: a bare catch here
    // is why "I clicked Accept and nothing happened" had no evidence behind it.
    console.warn('[invitation] accept failed:', e)
    notify("Couldn't join that table — check your connection and try again.")
  } finally {
    const next = new Set(busyIds.value)
    next.delete(t.id)
    busyIds.value = next
  }
}

async function declineInvitation(t) {
  const uid = userStore.currentUserId.value
  dismissToast(t.id)
  if (!uid) return
  try {
    await apiFetch(`${API_URL}/invitations/${t.invitationId}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: uid }),
    })
  } catch (e) {
    // Best-effort — the seat reservation expires on its own — but the toast is
    // already gone, so a console line is the only trace this ever happened.
    console.warn('[invitation] decline failed (seat will expire on its own):', e)
  }
}
// `at_table` follows the (singleton) table socket: connected while seated at a
// served table, idle otherwise. Solo practice is a different signal (set by the
// solo view), so this only tracks the real multiplayer socket.
const tableSocket = useTableSocket()
watch(
  () => tableSocket.status.value,
  (s) => presence.setAtTable(s === 'connected'),
  { immediate: true },
)
</script>

<style scoped>
/* Fixed toast stack, bottom-centre — clear of the top-right account avatar and
   the bottom-right beetle. Sits above everything (modals, the table). */
.friend-toasts {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 92vw;
}
.friend-toast {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #1f2937;
  color: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 14px;
}
.ft-body { line-height: 1.35; }
.ft-body strong { font-weight: 600; }
.ft-actions { display: flex; gap: 8px; flex-shrink: 0; }
.ft-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ft-btn:disabled { opacity: 0.6; cursor: default; }
.ft-accept { background: #1d9e75; color: #fff; }
.ft-accept:hover:not(:disabled) { background: #167a5a; }
.ft-dismiss { background: transparent; color: #cbd5e1; }
.ft-dismiss:hover { color: #fff; }

/* Generic transient notices — stacked above the friend toasts, same corner. */
.app-toasts {
  position: fixed;
  left: 50%;
  bottom: 78px;
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.app-toast {
  padding: 9px 16px;
  background: #1f2937;
  color: #fff;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 13px;
}
</style>
