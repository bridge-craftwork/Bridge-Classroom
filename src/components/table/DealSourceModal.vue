<template>
  <div class="dsm-backdrop" @click.self="$emit('close')">
    <div class="dsm-shell">
      <!-- The unified picker owns the CONTENT (header, filter, tabs, tray,
           action); this modal owns the FRAME + the table-only footer below. -->
      <DealSourcePicker
        class="dsm-picker"
        layout="compact"
        mode="stream"
        :allow="allow"
        :owner="currentUser?.id || null"
        action-label="Deal"
        @submit="onSubmit"
        @close="$emit('close')"
      />

      <!-- Host-owned footer: Mode (rides on every deal), Rotate, Replay. These
           are table concerns, orthogonal to *where* the board comes from. -->
      <div class="dsm-footer">
        <div class="dsm-footer-row">
          <span class="dsm-footer-label">Mode</span>
          <button
            v-for="m in MODES"
            :key="m.id"
            class="dsm-pill"
            :class="{ active: dealSource.mode.value === m.id }"
            :title="m.hint"
            @click="dealSource.setMode(m.id)"
          >
            {{ m.label }}
          </button>
        </div>
        <div class="dsm-footer-row">
          <label class="dsm-check">
            <input v-model="rotateRandomly" type="checkbox" />
            Rotate deal randomly (the deal moves, not the players)
          </label>
          <button class="dsm-pill dsm-replay" :disabled="busy" @click="replay">
            🔁 Replay board
          </button>
          <span v-if="error" class="dsm-error">{{ error }}</span>
          <span v-else-if="busy" class="dsm-muted">Dealing…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Deal-source picker for the demo table (roadmap Phase 2): pops up from the
// "Deal source…" button, resolves the picked selection to a board, sends
// {"t":"deal", ...} to the table service, closes on success. Board resolution
// runs browser-side via the resolver — the server has one door for all
// client-supplied deals (single-board PBN); a lone Random passes through as a
// server shuffle.
import { ref, computed, watch } from 'vue'
import { useRemoteTable } from '../../composables/useRemoteTable.js'
import { useDealSource } from '../../composables/useDealSource.js'
import { useUserStore } from '../../composables/useUserStore.js'
import DealSourcePicker from '../dealSource/DealSourcePicker.vue'

const emit = defineEmits(['close'])

const table = useRemoteTable()
const dealSource = useDealSource()
const { currentUser } = useUserStore()

const MODES = [
  { id: 'bid-and-play', label: 'Bid + play', hint: 'Full board: auction then cardplay' },
  { id: 'bid-only', label: 'Bid only', hint: 'Board ends at the contract; all hands revealed for discussion' },
  { id: 'play-only', label: 'Play only', hint: 'Bots bid the auction automatically; you just play' },
]

// The "My library" tab is a teacher/admin feature (the deal library is
// per-teacher); "Club games" is any signed-in user's own analyzed boards.
// Favorites/History/Scenarios/Curated/Paste/Random are always available.
const isTeacher = computed(
  () => currentUser.value && ['teacher', 'admin'].includes(currentUser.value.role)
)
const allow = computed(() => ({
  tabs: [
    'favorites',
    'scenarios',
    'curated',
    ...(currentUser.value ? ['clubgames'] : []),
    ...(isTeacher.value ? ['library'] : []),
    'pbn',
    'random',
    'history',
  ],
  options: ['fresh'],
}))

const busy = ref(false)
const error = ref('')

const ROTATE_KEY = 'bridgeTableRotateDeals'
const rotateRandomly = ref(localStorage.getItem(ROTATE_KEY) === '1')
watch(rotateRandomly, (v) => localStorage.setItem(ROTATE_KEY, v ? '1' : '0'))

function rotation() {
  return rotateRandomly.value ? Math.floor(Math.random() * 4) : 0
}

// The picker emits a selection (single-select fires on click; multi fires on
// "Deal"). Stick it as the source so the header's "Next deal" repeats it, then
// deal one board. Server-side rejections come back as error frames the table
// view already toasts; we close optimistically on a successful send.
async function onSubmit(selection) {
  busy.value = true
  error.value = ''
  dealSource.setSelection(selection)
  const ok = await dealSource.nextDeal(rotation())
  busy.value = false
  if (ok) emit('close')
  else error.value = dealSource.dealError.value || 'Deal failed.'
}

// Replay is a table-only action, orthogonal to the deal source (spec §6).
function replay() {
  error.value = ''
  if (!table.sendDeal({ source: 'replay', mode: dealSource.mode.value })) {
    error.value = 'Not connected.'
    return
  }
  emit('close')
}
</script>

<style scoped>
.dsm-backdrop {
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
/* One card: the picker flattens into this shell (below), the footer sits under
   it flush. The shell owns the height cap so the picker body scrolls. */
.dsm-shell {
  display: flex;
  flex-direction: column;
  width: min(560px, 94vw);
  max-height: 92vh;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
/* Flatten the compact picker into the shell: fill the width, drop its own
   frame + height cap, let it flex and its body scroll. */
.dsm-shell :deep(.dsm-picker) {
  width: 100%;
  max-height: none;
  min-height: 0;
  flex: 1 1 auto;
  border-radius: 0;
  box-shadow: none;
}

.dsm-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid #eee;
  font-size: 13px;
  background: #fff;
}
.dsm-footer-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dsm-footer-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #99a;
}
.dsm-pill {
  border: 1px solid #cfd8d3;
  background: #fff;
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12.5px;
  cursor: pointer;
  color: #444;
}
.dsm-pill.active {
  background: #1d6e50;
  border-color: #1d6e50;
  color: #fff;
  font-weight: 600;
}
.dsm-replay {
  margin-left: auto;
}
.dsm-replay:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsm-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #444;
  cursor: pointer;
}
.dsm-error {
  color: #c62828;
}
.dsm-muted {
  color: #777;
}
</style>
