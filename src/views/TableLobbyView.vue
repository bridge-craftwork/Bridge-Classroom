<template>
  <div class="tl-page">
    <!-- ── Joined: the live table ─────────────────────────────────── -->
    <UnifiedTable v-if="mode === 'joined'" server @exit="onExit" />

    <!-- ── Everything else is a centered card ─────────────────────── -->
    <div v-else class="tl-card">
      <!-- Picker: bare #/play — remembered tables -->
      <template v-if="mode === 'picker'">
        <h2>Join a table</h2>
        <template v-if="checkedEntries === null">
          <p class="tl-muted">Checking your remembered tables…</p>
        </template>
        <template v-else-if="checkedEntries.length === 0">
          <p>
            No remembered tables yet. Open the link your teacher (or host)
            shared — it looks like<br>
            <code>…#/play/their-code</code> — and it will be remembered here.
          </p>
        </template>
        <template v-else>
          <p v-if="autoConnecting" class="tl-muted">
            One table is live — taking you there…
          </p>
          <ul class="tl-list">
            <li v-for="entry in checkedEntries" :key="entry.kind + ':' + entry.code">
              <button
                class="tl-entry"
                :class="{ 'tl-entry-active': entry.active }"
                :disabled="!entry.active"
                @click="goToEntry(entry)"
              >
                <span class="tl-entry-name">{{ entry.hostName || entry.code }}</span>
                <span class="tl-entry-code">/{{ entry.kind }}/{{ entry.code }}</span>
                <span class="tl-entry-status" :class="{ on: entry.active }">
                  {{ entry.active ? 'Open now' : 'No open session' }}
                </span>
              </button>
              <button
                class="tl-forget"
                title="Remove from this list"
                @click="forgetEntry(entry)"
              >×</button>
            </li>
          </ul>
          <button class="tl-btn" @click="refreshPicker">Check again</button>
        </template>
      </template>

      <!-- Resolving the code -->
      <template v-else-if="mode === 'resolving'">
        <h2>Joining…</h2>
        <p class="tl-muted">Looking up <code>{{ code }}</code>…</p>
      </template>

      <!-- Unknown code -->
      <template v-else-if="mode === 'unknown'">
        <h2>Unknown link</h2>
        <p>
          We don't recognize the code <code>{{ code }}</code>. Double-check
          the link you were given, or ask your host for a fresh one.
        </p>
        <button class="tl-btn" @click="goPicker">See remembered tables</button>
      </template>

      <!-- Known host, no open session -->
      <template v-else-if="mode === 'waiting'">
        <h2>{{ hostName ? hostName + "'s table" : 'Table' }}</h2>
        <p class="tl-big">Class hasn't started yet.</p>
        <p class="tl-muted">
          There's no open session right now. Keep this page open — it checks
          every few seconds and will let you in as soon as
          {{ hostName || 'the host' }} opens the table.
        </p>
        <div class="tl-pulse"></div>
      </template>

      <!-- Identify: session is live — who are you? -->
      <template v-else-if="mode === 'identify'">
        <h2>{{ hostName ? hostName + "'s table" : 'Join table' }}</h2>
        <p v-if="sessionInfo" class="tl-muted">
          {{ sessionInfo.table_count }} table{{ sessionInfo.table_count === 1 ? '' : 's' }}
          · session is open
        </p>

        <template v-if="currentUser">
          <p>Sit down as <strong>{{ currentUser.firstName }} {{ currentUser.lastName }}</strong>.</p>
          <button class="tl-btn tl-btn-primary" :disabled="joining" @click="joinAsUser">
            {{ joining ? 'Connecting…' : 'Take a seat' }}
          </button>
        </template>
        <template v-else>
          <p>Enter your name to take a seat — no account needed.</p>
          <form class="tl-guest-form" @submit.prevent="joinAsGuest">
            <input
              v-model="guestName"
              class="tl-guest-input"
              type="text"
              maxlength="60"
              placeholder="Your name"
              autocomplete="name"
            >
            <button
              class="tl-btn tl-btn-primary"
              type="submit"
              :disabled="!guestName.trim() || joining"
            >
              {{ joining ? 'Connecting…' : 'Take a seat' }}
            </button>
          </form>
        </template>

        <p v-if="connectionStatus === 'unavailable'" class="tl-error">
          Multiplayer tables aren't set up yet. Please try again later.
        </p>
        <p v-else-if="connectionStatus === 'error'" class="tl-error">
          Couldn't connect: {{ connectionError }}
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
// TableLobbyView — the front door for multiplayer tables:
//   #/play/:hostCode   teacher's evergreen class URL
//   #/table/:inviteCode player's evergreen social URL
//   #/play             remembered-codes picker (auto-connects when exactly
//                      one remembered host has an open session)
// Resolution goes through the public Mac API endpoints; the live game then
// runs over the table-service WebSocket (TableView + useRemoteTable).
// Unknown /table codes fall back to a direct session-id join, which keeps
// the legacy #/table/demo?bot=random dev flow working.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UnifiedTable from './BiddingPracticeView.vue'
import { useRemoteTable } from '../composables/useRemoteTable.js'
import { useRememberedTables } from '../composables/useRememberedTables.js'
import { useUserStore } from '../composables/useUserStore.js'

const GUEST_NAME_KEY = 'bridgeTableGuestName'
const WAIT_POLL_MS = 10_000

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const table = useRemoteTable()
const remembered = useRememberedTables()

const { connectionStatus, connectionError } = table
const currentUser = userStore.currentUser

// 'picker' | 'resolving' | 'unknown' | 'waiting' | 'identify' | 'joined'
const mode = ref('resolving')
const hostName = ref('')
const sessionInfo = ref(null) // SessionInfo from the resolve/join endpoints
const joining = ref(false)
const guestName = ref(localStorage.getItem(GUEST_NAME_KEY) || '')
const checkedEntries = ref(null) // picker: remembered entries + active flags
const autoConnecting = ref(false)

let waitTimer = null
let navEpoch = 0 // invalidates async work when the route changes

// kind ('play' | 'table') and code from whichever route matched.
const kind = computed(() => (route.params.inviteCode !== undefined ? 'table' : 'play'))
const code = computed(() => route.params.hostCode || route.params.inviteCode || '')

function clearWaitTimer() {
  if (waitTimer) { clearInterval(waitTimer); waitTimer = null }
}

// ── Picker (bare #/play) ───────────────────────────────────────────────

async function refreshPicker() {
  const myEpoch = navEpoch
  checkedEntries.value = null
  const entries = await remembered.checkActive()
  if (myEpoch !== navEpoch) return
  checkedEntries.value = entries
  const active = entries.filter(e => e.active)
  if (active.length === 1) {
    // Exactly one live table: connect automatically (plan §Join URLs).
    autoConnecting.value = true
    setTimeout(() => {
      if (myEpoch === navEpoch) goToEntry(active[0])
    }, 600)
  }
}

function goToEntry(entry) {
  router.push(`/${entry.kind}/${entry.code}`)
}

function forgetEntry(entry) {
  remembered.forget(entry.kind, entry.code)
  checkedEntries.value = checkedEntries.value.filter(
    e => !(e.kind === entry.kind && e.code === entry.code)
  )
}

function goPicker() {
  router.push('/play')
}

// ── Code resolution ────────────────────────────────────────────────────

async function resolveAndRoute() {
  navEpoch++
  const myEpoch = navEpoch
  clearWaitTimer()
  autoConnecting.value = false

  if (!code.value) {
    mode.value = 'picker'
    refreshPicker()
    return
  }

  mode.value = 'resolving'
  const r = await remembered.resolveCode(kind.value, code.value)
  if (myEpoch !== navEpoch) return

  if (!r.ok && r.status === 404 && kind.value === 'table') {
    // Not an invite code — treat it as a raw session id (legacy
    // #/table/demo and direct session links).
    hostName.value = ''
    sessionInfo.value = { id: code.value, table_count: 1 }
    enterIdentify(myEpoch)
    return
  }
  if (!r.ok) {
    mode.value = r.status === 404 ? 'unknown' : 'waiting'
    return
  }

  hostName.value = r.hostName
  remembered.remember(kind.value, code.value, r.hostName)

  if (!r.session) {
    mode.value = 'waiting'
    // Poll until the host opens a session, then fall through to identify.
    waitTimer = setInterval(async () => {
      const again = await remembered.resolveCode(kind.value, code.value)
      if (myEpoch !== navEpoch) return
      if (again.ok && again.session) {
        clearWaitTimer()
        sessionInfo.value = again.session
        enterIdentify(myEpoch)
      }
    }, WAIT_POLL_MS)
    return
  }

  sessionInfo.value = r.session
  enterIdentify(myEpoch)
}

function enterIdentify(myEpoch) {
  // ?student=Name forces a named-guest join (bypasses teacher recognition), so
  // a teacher can sit as a student and the "spawn test students" tool can
  // populate a class. Takes precedence over the teacher-console redirect.
  const forcedStudent =
    typeof route.query.student === 'string' && route.query.student.trim()
  if (forcedStudent) {
    mode.value = 'identify'
    doJoin({ guestName: forcedStudent.trim() }, myEpoch)
    return
  }
  // Teachers/admins get the console, not a seat: the table service seats a
  // teacher-role ticket as the see-all session controller regardless.
  // Exception: "demo" is the standing dev room, not a session — the service
  // has no teacher connection (no lobby frames) for it and seats everyone as
  // a player, so the console would hang at "Connecting…" forever. Teachers
  // take a seat there like anyone else.
  if (currentUser.value && sessionInfo.value?.id && sessionInfo.value.id !== 'demo' &&
      (currentUser.value.role === 'teacher' || currentUser.value.role === 'admin')) {
    // The stable console home (no session id) — it resolves the teacher's open
    // session itself, so the address bar stays bookmarkable across sessions.
    router.replace('/tables/console')
    return
  }
  mode.value = 'identify'
  // Logged-in students join without another click.
  if (currentUser.value) joinAsUser(myEpoch)
}

// ── Joining ────────────────────────────────────────────────────────────

async function doJoin(opts, myEpoch = navEpoch) {
  joining.value = true
  const bot = typeof route.query.bot === 'string' && route.query.bot ? route.query.bot : null
  // ?seat=N (per-seat invite link): request that seat on join. Honored under
  // Manual policy when free; otherwise the host seats you from the table.
  const q = typeof route.query.seat === 'string' ? route.query.seat.toUpperCase() : null
  const seat = ['N', 'E', 'S', 'W'].includes(q) ? q : null
  const ok = await table.join({ sessionId: sessionInfo.value.id, bot, seat, ...opts })
  if (myEpoch !== navEpoch) return
  joining.value = false
  if (ok) mode.value = 'joined'
}

function joinAsUser(myEpoch = navEpoch) {
  doJoin({ userId: currentUser.value.id }, myEpoch)
}

function joinAsGuest() {
  const name = guestName.value.trim()
  if (!name) return
  localStorage.setItem(GUEST_NAME_KEY, name)
  doJoin({ guestName: name })
}

// Session-ended "back to the lobby" from TableView.
function onExit() {
  table.leave()
  goPicker()
}

// ── Lifecycle ──────────────────────────────────────────────────────────

watch(() => [route.params.hostCode, route.params.inviteCode], () => {
  // Route change (picker → code, or a new link pasted over this tab):
  // drop any live connection and start over.
  if (mode.value === 'joined') table.leave()
  resolveAndRoute()
})

onMounted(() => {
  userStore.initialize()
  resolveAndRoute()
})

onBeforeUnmount(() => {
  navEpoch++
  clearWaitTimer()
  table.leave()
})
</script>

<style scoped>
.tl-page {
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.tl-card {
  max-width: 460px;
  margin: 80px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  text-align: center;
}
.tl-card h2 { margin: 0 0 10px; }
.tl-card code {
  background: #f4f4f4;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 14px;
}

.tl-muted { color: #777; font-size: 14px; }
.tl-big { font-size: 18px; font-weight: 600; margin: 12px 0 4px; }
.tl-error { color: #c62828; font-size: 14px; margin-top: 12px; }

.tl-btn {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 10px;
}
.tl-btn:hover:not(:disabled) { border-color: #007bff; }
.tl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tl-btn-primary { background: #1d9e75; border-color: #1d9e75; color: #fff; }
.tl-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }

.tl-guest-form { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
.tl-guest-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 16px;
}

/* Remembered list */
.tl-list { list-style: none; margin: 12px 0 4px; padding: 0; }
.tl-list li { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.tl-entry {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  font-size: 14px;
}
.tl-entry:disabled { cursor: default; opacity: 0.7; }
.tl-entry-active { border-color: #1d9e75; background: #f0faf6; }
.tl-entry-name { font-weight: 600; color: #333; }
.tl-entry-code { color: #888; font-size: 12px; flex: 1; }
.tl-entry-status { font-size: 12px; color: #999; }
.tl-entry-status.on { color: #1d9e75; font-weight: 600; }
.tl-forget {
  border: none;
  background: none;
  color: #bbb;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
}
.tl-forget:hover { color: #c62828; }

/* Waiting pulse */
.tl-pulse {
  width: 14px;
  height: 14px;
  margin: 18px auto 4px;
  border-radius: 50%;
  background: #1d9e75;
  animation: tl-pulse 1.6s ease-in-out infinite;
}
@keyframes tl-pulse {
  0%, 100% { transform: scale(0.8); opacity: 0.5; }
  50% { transform: scale(1.2); opacity: 1; }
}
</style>
