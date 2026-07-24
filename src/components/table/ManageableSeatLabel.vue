<template>
  <div
    ref="menuRoot"
    class="msl"
    :class="{ 'drop-over': dropOver, manage: canManage }"
    :draggable="canManage && isHuman"
    :title="menuTitle"
    @dragstart="onDragStart"
    @dragover="canManage ? onDragOver($event) : null"
    @dragleave="dropOver = false"
    @drop="canManage ? onDrop($event) : null"
    @click="hasMenu ? toggleMenu() : null"
  >
    <!-- The name IS the drag handle and the menu trigger (no separate button). -->
    <SeatChip :seat="seat" :name="name" :presence="presence" :card-count="cardCount" :compact="compact" :reserved="isReserved" />
    <div v-if="menuOpen" class="msl-menu" @click.stop>
      <!-- Add friend: available to ANY player, not just the host — this is the
           only way to seed a friends list, since there's no user search. -->
      <button
        v-if="friendAction"
        class="msl-item msl-friend"
        :disabled="friendBusy"
        @click="addFriend"
      >
        {{ friendBusy ? 'Sending…' : 'Add friend' }}
      </button>
      <div v-else-if="friendNote" class="msl-note">{{ friendNote }}</div>

      <!-- Reserved: held for an invited friend until they join. -->
      <div v-if="isReserved" class="msl-note">Invited — waiting for them to join…</div>

      <!-- Seat management (top). -->
      <template v-if="canManage && isYou">
        <button class="msl-item" @click="act({ from: seat, seat: null })">Stand (leave empty)</button>
        <button class="msl-item" @click="act({ from: seat, seat: null, bot: true })">Seat a bot</button>
      </template>
      <template v-else-if="canManage && isHuman">
        <button class="msl-item" @click="act({ seat, token: myToken })">Sit here</button>
        <button class="msl-item" @click="act({ from: seat, seat: null })">Remove &rarr; kibitz</button>
        <button class="msl-item" @click="act({ from: seat, seat: null, bot: true })">Seat a bot</button>
        <button class="msl-item msl-danger" @click="kick">Kick from table</button>
      </template>
      <template v-else-if="canManage && isEmpty">
        <button class="msl-item" @click="act({ seat, token: myToken })">Sit here</button>
        <button class="msl-item" @click="act({ from: seat, seat: null, bot: true })">Seat a bot</button>
      </template>
      <template v-else-if="canManage">
        <button class="msl-item" @click="act({ seat, token: myToken })">Sit here</button>
        <button class="msl-item" @click="act({ from: seat, seat: null })">Make empty</button>
      </template>

      <!-- Reserve an open (empty/bot) seat: hold it for a guest (copies the
           invite link) or a specific online friend (pushes them an invite). -->
      <template v-if="canReserve">
        <div class="msl-sep"></div>
        <div class="msl-label">Reserve:</div>
        <button
          class="msl-item"
          :class="{ 'msl-muted': !guestsAllowed }"
          :disabled="!guestsAllowed || inviteBusy"
          :title="guestsAllowed ? 'Copy an invite link for a guest' : 'Guests are not allowed at this table'"
          @click="reserveGuest"
        >Guest</button>
        <button
          v-for="f in invitableFriends"
          :key="f.user_id"
          class="msl-item msl-friend-row"
          :class="{ 'msl-muted': !friendOnline(f) }"
          :disabled="inviteBusy"
          @click="inviteFriend(f)"
        >
          <span class="msl-fdot" :class="{ on: friendOnline(f) }"></span>{{ f.name }}
        </button>
        <div v-if="!invitableFriends.length" class="msl-note">No friends yet.</div>
        <div v-if="inviteError" class="msl-note">{{ inviteError }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
// The grabbable/droppable seat label for the SeatControlTable variant. Reuses
// SeatChip for the visual; adds host drag (grab a human label), drop (another
// label or a kibitzer chip lands here), and a small pulldown (Sit / Remove /
// Stand). Emits seat-addressed `assign` — the base BridgeTable stays drag-free.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import SeatChip from '../SeatChip.vue'
import { useUserStore } from '../../composables/useUserStore.js'
import { useFriends } from '../../composables/useFriends.js'
import { useFriendPresence } from '../../composables/useFriendPresence.js'
import { useAppToast } from '../../composables/useAppToast.js'
import { apiFetch, API_URL } from '../../utils/apiFetch.js'

// seat/name/presence/cardCount/compact come from SeatPanel; the rest ride in via
// `labelProps` (shared table context + an onAssign callback — no event bubbling
// through the base table). isHuman/isYou are derived from the seat maps.
const props = defineProps({
  seat: { type: String, required: true },
  name: { type: String, default: null },
  presence: { type: String, default: null },
  cardCount: { type: Number, default: null },
  compact: { type: Boolean, default: false },
  seats: { type: Object, default: () => ({}) },
  yourSeats: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
  myToken: { type: String, default: null },
  roster: { type: Array, default: () => [] },
  // Served session id — enables inviting a friend onto this seat (Phase 4).
  sessionId: { type: String, default: null },
  // Whether a guest (invite-link) join is offered on an open seat. Placeholder
  // for ADR-0006 `access_mode` (link|friends); defaults true (link tables).
  guestsAllowed: { type: Boolean, default: true },
  onAssign: { type: Function, default: null },
  onKick: { type: Function, default: null },
})

const kind = computed(() => props.seats[props.seat]?.kind)
const isHuman = computed(() => kind.value === 'human')
const isBot = computed(() => !kind.value || kind.value === 'bot')
const isReserved = computed(() => kind.value === 'reserved')
const isEmpty = computed(() => kind.value === 'empty')
const isYou = computed(() => props.yourSeats.includes(props.seat))
// The occupant's connection token (for Kick), resolved from the roster by seat.
const seatToken = computed(() =>
  (props.roster || []).find(r => (r.seats || []).includes(props.seat))?.token || null)

const menuOpen = ref(false)
const dropOver = ref(false)

// ---- Add friend (ADR-0005 bootstrap) ----
//
// Sharing a table is the ONLY way to seed a friends list — there's deliberately
// no user search — so this affordance is what makes the whole friends feature
// reachable. It's therefore available to every player, not just the host.
//
// `account_id` comes from the table service roster and is null for guests, who
// can't be friended. Older table-service builds don't send the field at all;
// that reads as "no account id", so the button simply doesn't appear rather
// than erroring — the two deploys can land in either order.
const userStore = useUserStore()
const friends = useFriends()

const myUserId = computed(() => userStore.currentUser.value?.id || null)
const seatEntry = computed(() =>
  (props.roster || []).find(r => (r.seats || []).includes(props.seat)) || null)
const seatAccountId = computed(() => seatEntry.value?.account_id || null)

// Someone I could plausibly befriend: an enrolled account, not me, and not a
// bot/empty seat.
const isFriendable = computed(() =>
  !!seatAccountId.value && !!myUserId.value && seatAccountId.value !== myUserId.value)

const friendState = computed(() => {
  if (!isFriendable.value) return null
  if (friends.isFriend(seatAccountId.value)) return 'friends'
  return friends.pendingWith(seatAccountId.value) // 'outgoing' | 'incoming' | null
})

const friendAction = computed(() => isFriendable.value && friendState.value === null)

// Why the button ISN'T offered, when that's worth saying. Silent when we simply
// have nothing to add (a bot, an empty seat, or myself).
const friendNote = computed(() => {
  switch (friendState.value) {
    case 'friends': return 'Already friends'
    case 'outgoing': return 'Friend request sent'
    case 'incoming': return 'They asked you — see the Friends tab'
    default: return null
  }
})

const friendBusy = ref(false)

// ── Reserve an open seat (Phase 4) ──────────────────────────────────────
// The host holds an open (empty/bot) seat for a guest (copies the invite link)
// or a specific online friend (pushes them an invitation → App.vue's toast).
const presence = useFriendPresence()
const appToast = useAppToast()
const inviteBusy = ref(false)
const inviteError = ref('')

const canReserve = computed(
  () => props.canManage && !!props.sessionId && (isEmpty.value || isBot.value),
)
// Accounts already at the table (occupants + reservations) — don't re-offer them.
const seatedAccountIds = computed(() => {
  const ids = new Set()
  for (const r of props.roster || []) if (r.account_id) ids.add(r.account_id)
  return ids
})
// All friends not already at the table, ONLINE first (then offline), each group
// alphabetical. Offline friends are shown (dimmed) so the host sees the whole
// list; inviting one holds the seat and reaches them if they come online in time.
const invitableFriends = computed(() => {
  const online = []
  const offline = []
  for (const f of friends.friends.value || []) {
    if (seatedAccountIds.value.has(f.user_id)) continue
    if (presence.presenceFor(f.user_id) !== 'offline') online.push(f)
    else offline.push(f)
  }
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
  online.sort(byName)
  offline.sort(byName)
  return [...online, ...offline]
})
function friendOnline(f) {
  return presence.presenceFor(f.user_id) !== 'offline'
}

async function inviteFriend(friend) {
  if (!props.sessionId || !myUserId.value || inviteBusy.value) return
  inviteBusy.value = true
  inviteError.value = ''
  try {
    const res = await apiFetch(`${API_URL}/tables/${props.sessionId}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acting_user_id: myUserId.value,
        friend_user_id: friend.user_id,
        seat: props.seat,
      }),
    })
    if (!res.ok) throw new Error(`invite failed (${res.status})`)
    menuOpen.value = false
    appToast.notify(`Invited ${friend.name} to seat ${props.seat}.`)
  } catch (e) {
    inviteError.value = 'Could not invite — the seat may be taken.'
  } finally {
    inviteBusy.value = false
  }
}

// "Guest" reserve: copy the table's invite link so anyone can join via it (the
// host seats them or they take the open seat). Not a seat-specific hold — guests
// have no account to reserve for.
async function reserveGuest() {
  if (!props.guestsAllowed || !myUserId.value || inviteBusy.value) return
  inviteBusy.value = true
  inviteError.value = ''
  try {
    const res = await apiFetch(`${API_URL}/users/${myUserId.value}/invite-code`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.code) throw new Error('no invite code')
    const url = `${window.location.origin}${window.location.pathname}#/table/${data.code}`
    await navigator.clipboard.writeText(url)
    menuOpen.value = false
    appToast.notify('Invite link copied — send it to a guest.')
  } catch {
    inviteError.value = 'Could not copy the invite link.'
  } finally {
    inviteBusy.value = false
  }
}

// The menu is worth opening if it will contain anything.
const hasMenu = computed(() => props.canManage || friendAction.value || !!friendNote.value)
const menuTitle = computed(() => {
  if (!hasMenu.value) return null
  if (props.canManage) return isHuman.value ? 'Drag to move · click for options' : 'Click for options'
  return 'Click for options'
})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  // Load friend state lazily, on first open, so a table full of players doesn't
  // fetch it on mount for seats nobody clicks.
  if (menuOpen.value && myUserId.value && !friends.loaded.value) {
    friends.load(myUserId.value)
  }
}

// Close the menu when anything outside it is clicked (previously you had to
// click the name again). Capture phase so it fires before inner stopPropagation.
const menuRoot = ref(null)
function onDocPointerDown(e) {
  if (menuRoot.value && !menuRoot.value.contains(e.target)) menuOpen.value = false
}
watch(menuOpen, (open) => {
  if (open) document.addEventListener('mousedown', onDocPointerDown, true)
  else document.removeEventListener('mousedown', onDocPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointerDown, true))

async function addFriend() {
  if (!seatAccountId.value || friendBusy.value) return
  friendBusy.value = true
  try {
    await friends.sendRequest(myUserId.value, seatAccountId.value)
    menuOpen.value = false
  } catch {
    // useFriends surfaces the reason; keep the menu open so the note updates.
  } finally {
    friendBusy.value = false
  }
}

function act(payload) { menuOpen.value = false; props.onAssign && props.onAssign(payload) }
function kick() {
  menuOpen.value = false
  if (seatToken.value && props.onKick) props.onKick(seatToken.value)
}

function onDragStart(e) {
  if (!props.canManage || !isHuman.value) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'seat', seat: props.seat }))
}
function onDragOver(e) { e.preventDefault(); dropOver.value = true }
function onDrop(e) {
  e.preventDefault()
  dropOver.value = false
  let p
  try { p = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
  if (!p || !props.onAssign) return
  if (p.kind === 'seat' && p.seat !== props.seat) props.onAssign({ from: p.seat, seat: props.seat })
  else if (p.kind === 'kibitzer') props.onAssign({ token: p.token, seat: props.seat })
}
</script>

<style scoped>
/* Block so the SeatChip/SeatIndicator fills the seat width — otherwise the name
   ladder measures a collapsed inline box and falls to badge-only. */
.msl { position: relative; display: block; }
.msl.manage { cursor: pointer; }
.msl[draggable="true"] { cursor: grab; }
.msl.drop-over { outline: 2px dashed #1d9e75; outline-offset: 2px; border-radius: 6px; }
.msl-menu {
  position: absolute; top: 100%; left: 0; z-index: 20;
  background: #fff; border: 1px solid #ddd; border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); padding: 4px; min-width: 130px;
}
.msl-item {
  display: block; width: 100%; text-align: left;
  padding: 5px 10px; border: none; background: none; font-size: 13px; cursor: pointer; border-radius: 6px; white-space: nowrap;
}
.msl-item:hover { background: #f0f2f5; }
.msl-item:disabled { opacity: 0.6; cursor: default; }
.msl-friend { color: #1565c0; font-weight: 500; }
.msl-friend:hover:not(:disabled) { background: #e3f2fd; }
/* Non-actionable explanation of why there's no Add friend button. */
.msl-note { padding: 5px 10px; font-size: 12px; color: #6b7280; white-space: nowrap; }
.msl-danger { color: #c62828; }
.msl-danger:hover { background: #fdeaea; }
/* Reserve section: a divider + a small section label above the guest/friends. */
.msl-sep { height: 1px; background: #eaecef; margin: 4px 6px; }
.msl-label {
  padding: 3px 10px 2px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em; color: #9aa0a6;
}
.msl-muted { color: #b0b4ba; }
/* Friend row: a presence dot before the name (green = online, grey = offline). */
.msl-friend-row { display: flex; align-items: center; gap: 7px; }
.msl-fdot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #cbd5e1; flex-shrink: 0;
}
.msl-fdot.on { background: #1d9e75; }
</style>
