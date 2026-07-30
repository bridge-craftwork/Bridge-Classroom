<template>
  <!-- ── Local (solo) mode: the practice table drives itself (LocalEngine). It
       brings its own header/footer; TableView adds no chrome here. "Invite
       friends" emits `host` → we upgrade in place to a served table. ── -->
  <UnifiedTable v-if="mode === 'local'" @host="enterServer" />

  <!-- ── Server (hosted) mode: host chrome around the seated served table. ── -->
  <div v-else class="th-page">
    <nav class="th-nav">
      <a class="th-logo" href="#/"><span class="suit">&spades;</span> Bridge Classroom &middot; Host a Table</a>
      <span v-if="hasSession" class="th-conn" :class="'th-conn-' + connectionStatus">{{ connectionStatus }}</span>
      <div class="th-nav-right">
        <!-- Account circle: same identity menu as the main app (Switch User, edit
             name, display/privacy). Sits the host's own name at the seat below. -->
        <button
          v-if="currentUser"
          class="user-btn"
          :title="userName"
          @click="showSettings = true"
        >{{ userInitials }}</button>
      </div>
    </nav>

    <!-- Not signed in -->
    <div v-if="!currentUser" class="th-card th-center">
      <p>You need to be signed in to host a table.
        Open the <a href="#/">main app</a> and sign in first.</p>
    </div>

    <!-- Resolving / creating the session -->
    <div v-else-if="resolving" class="th-card th-center">
      <p>Setting up your table&hellip;</p>
    </div>

    <div v-else-if="startError" class="th-card th-center">
      <p class="th-error">{{ startError }}</p>
      <button class="th-btn th-btn-primary" @click="ensureSession">Try again</button>
    </div>

    <!-- The host surface: a slim host strip over the seated player table. -->
    <main v-else class="th-main">
      <!-- Host strip: deal source + invite + test players + end. The host is a
           seated player (as_player), so the table itself is the TableView below. -->
      <div class="th-controls">
        <button class="th-btn th-btn-primary" :class="{ 'th-btn-attn': needsDeal }" :disabled="!connected" @click="showPicker = true">
          Deal source&hellip;
        </button>

        <div class="th-invite">
          <button class="th-btn" :disabled="!shareUrl" :title="shareUrl || 'Generating your link…'" @click="copyShareUrl">
            {{ copied ? 'Copied!' : 'Copy invite link' }}
          </button>
        </div>

        <label class="th-spawn" title="Open N tabs that each join as a test player (allow pop-ups)">
          <input v-model.number="spawnCount" type="number" min="1" max="3" class="th-num" :disabled="!shareUrl">
          <button class="th-btn" :disabled="!shareUrl" @click="spawnPlayers">🧪 Test players</button>
        </label>

        <button class="th-btn th-btn-danger" :disabled="!hasSession" @click="endSession">End table</button>
      </div>

      <p v-if="loadError" class="th-error th-inline">{{ loadError }}</p>

      <!-- The seated player table. The host arranges seats ON the table — drag
           the seat labels, use the per-seat pulldown, and the kibitz box. -->
      <UnifiedTable server @exit="onExitTable" />
      <PageFooter />
    </main>

    <!-- Account / identity menu — the same panel the main app uses (Switch User,
         edit name, display + privacy). Switching or signing out leaves the table
         and returns to the main app to re-authenticate. -->
    <SettingsPanel
      :visible="showSettings"
      @close="showSettings = false"
      @switchUser="handleSwitchUser"
      @logout="handleSwitchUser"
      @become-teacher="leaveToMainApp"
    />

    <!-- Deal-source picker modal (materialize the whole set onto the table) -->
    <div v-if="showPicker" class="th-modal-backdrop" @click.self="showPicker = false">
      <DealSourcePicker
        layout="compact"
        mode="materialize"
        :allow="pickerAllow"
        :owner="currentUser?.id || null"
        action-label="Load onto table"
        @submit="onLoadSource"
        @close="showPicker = false"
      />
    </div>

    <!-- Table settings used to live here too, giving the host TWO buttons with
         different contents (2026-07-30 report). It is now one modal inside the
         table shell — the only surface a guest renders — carrying board mode
         alongside deal rotation, PassBot and the BBA comparison. -->
  </div>
</template>

<script setup>
// TableView (#/table) — the ONE practice/host table (unification Stage B).
// Mode is chosen by state, not by route:
//   • local  — the solo practice table (LocalEngine, in-browser bots, no droplet
//              cost). The default; renders <UnifiedTable> which drives itself.
//   • server — a hosted table-service session (real seats, invite, multi-human).
//              Entered on demand: the solo view's "Invite friends" emits `host`,
//              or `?host=1` (an owner returning to their own table). This file
//              adds the host chrome (deal source / invite link / test players /
//              end) around <UnifiedTable server>; the session lifecycle lives in
//              useHostedTable.
//
// The server path reuses the table-service exactly like the teacher console (the
// session owner is the see-all controller — bridge-table-service ws.rs:
// `is_teacher = sub == owner_sub || role == "teacher"`), scoped to ONE casual
// (adhoc) table with none of the multi-table console chrome.
//
// The two branches are still two templates here (server chrome vs the solo view);
// folding them into one engine-driven template is Stage C.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { useHostedTable } from '../composables/useHostedTable.js'
import { useFriendPresence } from '../composables/useFriendPresence.js'
import DealSourcePicker from '../components/dealSource/DealSourcePicker.vue'
import PageFooter from '../components/lobby/PageFooter.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import UnifiedTable from './BiddingPracticeView.vue'

const router = useRouter()
const userStore = useUserStore()
const currentUser = userStore.currentUser

// ── Account circle (top-right) — identity + Switch User, same panel as the main app.
const showSettings = ref(false)
const userName = computed(() => {
  const u = currentUser.value
  return u ? `${u.firstName} ${u.lastName}`.trim() : ''
})
const userInitials = computed(() => {
  const u = currentUser.value
  if (!u) return '?'
  return `${(u.firstName || '').charAt(0)}${(u.lastName || '').charAt(0)}`.toUpperCase() || '?'
})
// Switching user / signing out must not strand a half-owned table: tear it down,
// clear the signed-in user, and hand off to the main app to re-authenticate (its
// welcome screen owns the full switch-user flow).
function leaveToMainApp() {
  showSettings.value = false
  teardown()
  router.push('/')
}
function handleSwitchUser() {
  userStore.stopViewingAs()
  userStore.currentUserId.value = null
  leaveToMainApp()
}
// Session lifecycle lives in useHostedTable (shared with the future unified
// /table view). This view is now just the host chrome around it.
const host = useHostedTable({ onExit: () => router.push('/') })
const {
  connectionStatus, connected, sessionId, hasSession, needsDeal,
  resolving, startError, loadError, shareUrl, copied, spawnCount,
  copyShareUrl, spawnPlayers, ensureSession, endSession, teardown, exit: onExitTable,
} = host

const pickerAllow = {
  tabs: ['favorites', 'scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random', 'history'],
  options: ['fresh'],
}
const showPicker = ref(false)

// Thin view wrapper: delegate to the composable, close the picker on success.
async function onLoadSource(selection) {
  const { ok } = await host.onLoadSource(selection)
  if (ok) showPicker.value = false
}

// ── Mode: local (solo, LocalEngine, no droplet cost) or server (a hosted
// table-service session). /table starts LOCAL; hosting is entered on demand —
// the solo view's "Invite friends" emits `host`, or `?host=1` asks to host
// straight away (the invite-link owner returning to their own table). We never
// downgrade server→local, and the swap only fires between hands.
const route = useRoute()
const mode = ref(route.query.host ? 'server' : 'local')

function enterServer() {
  if (mode.value === 'server') return
  mode.value = 'server'
  ensureSession() // resume the owner's open session, else create one
}

onMounted(() => {
  userStore.initialize()
  if (mode.value === 'server') ensureSession()
})

// Presence: report `practicing` while this is the solo (local) table. Server mode
// is covered by the table-socket `at_table` signal (App.vue), so practicing tracks
// local mode only, and clears when we leave the route.
const presence = useFriendPresence()
watch(mode, (m) => presence.setPracticing(m === 'local'), { immediate: true })
onUnmounted(() => presence.setPracticing(false))
</script>

<style scoped>
.th-page {
  min-height: 100vh;
  background: #f7f7f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #222;
}
.th-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 24px;
  border-bottom: 0.5px solid #ddd;
  background: #fff;
}
.th-logo { font-size: 15px; font-weight: 500; color: #222; text-decoration: none; }
.th-logo .suit { color: #1D9E75; margin-right: 6px; }
.th-nav-right { display: flex; align-items: center; gap: 14px; }
.th-back { font-size: 12px; color: #666; text-decoration: none; }
.th-back:hover { color: #222; }
/* Account circle — matches the main app's header avatar (MainLayout .user-btn). */
.user-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--green-mid, #667eea) 0%, var(--green-dark, #764ba2) 100%);
  color: #fff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
}
.user-btn:hover { transform: scale(1.05); box-shadow: 0 2px 8px rgba(45, 106, 79, 0.4); }
.th-conn { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
.th-conn-connected { color: #1D9E75; }
.th-conn-error, .th-conn-unavailable { color: #c62828; }

.th-card {
  max-width: 560px;
  margin: 48px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 24px;
}
.th-center { text-align: center; }

/* Was 900px — widened so the embedded table + right rail can fill the window
   (names fit on the hands, chat won't wrap). Matches the standalone view's cap
   (.tv-page / .bp-table-wrap, both 1400px) so host and solo look the same. */
.th-main { max-width: 1400px; margin: 0 auto; padding: 20px 24px; }

.th-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 12px 14px;
}
.th-spawn { display: flex; align-items: center; gap: 6px; }
.th-num {
  width: 48px;
  padding: 5px 6px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
}
.th-invite { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.th-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.th-btn:hover:not(:disabled) { border-color: #888; }
.th-btn:disabled { opacity: 0.45; cursor: default; }
.th-btn-primary { background: #1D9E75; color: #fff; border-color: #1D9E75; }
.th-btn-primary:hover:not(:disabled) { background: #167a5a; border-color: #167a5a; }
.th-btn-danger { color: #c62828; border-color: #e2b6b6; margin-left: 4px; }
.th-btn-danger:hover:not(:disabled) { border-color: #c62828; }
/* Spotlight the Deal source button until a deal is picked (mirrors the solo
   Practice Table's bp-btn-attn). */
.th-btn-attn { animation: th-attn-pulse 1.8s ease-out infinite; }
@keyframes th-attn-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(29, 158, 117, 0.45); }
  70%  { box-shadow: 0 0 0 10px rgba(29, 158, 117, 0); }
  100% { box-shadow: 0 0 0 0 rgba(29, 158, 117, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .th-btn-attn { animation: none; }
}

.th-error { color: #c62828; font-size: 14px; }
.th-inline { margin: 10px 0 0; }

.th-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4vh 16px;
  box-sizing: border-box;
  z-index: 60;
}
</style>
