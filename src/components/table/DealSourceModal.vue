<template>
  <div class="dsm-backdrop" @click.self="$emit('close')">
    <div class="dsm-modal">
      <div class="dsm-header">
        <h3>Deal source</h3>
        <button class="dsm-close" @click="$emit('close')">✕</button>
      </div>

      <div class="dsm-tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="dsm-tab"
          :class="{ active: tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Quick -->
      <div v-if="tab === 'quick'" class="dsm-body">
        <button class="dsm-big" :disabled="busy" @click="dealVia({ kind: 'random' })">
          🎲 Random deal
          <span class="dsm-sub">uniform shuffle · dealer &amp; vulnerability rotate</span>
        </button>
        <button class="dsm-big" :disabled="busy" @click="deal({ source: 'replay' })">
          🔁 Replay this board
          <span class="dsm-sub">same deal, fresh start</span>
        </button>
      </div>

      <!-- Scenarios -->
      <div v-else-if="tab === 'scenarios'" class="dsm-body dsm-scroll">
        <label class="dsm-check">
          <input v-model="useScript" type="checkbox" />
          Generate a fresh deal (dealer script) instead of a pre-made one
        </label>
        <p v-if="menuLoading" class="dsm-muted">Loading scenarios…</p>
        <p v-else-if="menuError" class="dsm-error">{{ menuError }}</p>
        <template v-else>
          <div v-for="(node, i) in menu" :key="i">
            <div v-if="node.type === 'major'" class="dsm-major">{{ node.label }}</div>
            <details v-else class="dsm-section">
              <summary>{{ node.label }}</summary>
              <div class="dsm-items">
                <button
                  v-for="item in node.items"
                  :key="item.file"
                  class="dsm-item"
                  :disabled="busy"
                  @click="dealFromScenario(item)"
                >
                  {{ item.label }}
                </button>
              </div>
            </details>
          </div>
        </template>
      </div>

      <!-- Paste PBN -->
      <div v-else class="dsm-body">
        <textarea
          v-model="pastedPbn"
          class="dsm-textarea"
          rows="7"
          placeholder='[Dealer "N"]
[Vulnerable "None"]
[Deal "N:K843.T542.J6.863 AQJ7.K.Q75.AT942 962.AJ7.KT82.J75 T5.Q9863.A943.KQ"]'
        ></textarea>
        <button class="dsm-big" :disabled="busy || !pastedPbn.trim()" @click="dealFromPaste">
          Deal this board
        </button>
      </div>

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
          <span v-if="error" class="dsm-error">{{ error }}</span>
          <span v-else-if="busy" class="dsm-muted">Dealing…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Deal-source picker for the demo table (roadmap Phase 2): pops up from the
// "New deal" button, sends {"t":"deal", ...} to the table service, closes on
// success. Scenario deals are fetched client-side from the PBS repo and
// handed over as single-board PBN — the server has one door for all
// client-supplied deals.
import { ref, watch } from 'vue'
import { fetchScenarioMenu } from '../../utils/pbsScenarios.js'
import { useRemoteTable } from '../../composables/useRemoteTable.js'
import { useDealSource } from '../../composables/useDealSource.js'

const emit = defineEmits(['close'])

const table = useRemoteTable()
const dealSource = useDealSource()

const MODES = [
  { id: 'bid-and-play', label: 'Bid + play', hint: 'Full board: auction then cardplay' },
  { id: 'bid-only', label: 'Bid only', hint: 'Board ends at the contract; all hands revealed for discussion' },
  { id: 'play-only', label: 'Play only', hint: 'Bots bid the auction automatically; you just play' },
]

const tabs = [
  { id: 'quick', label: 'Quick' },
  { id: 'scenarios', label: 'Bidding scenarios' },
  { id: 'pbn', label: 'Paste PBN' },
]
const tab = ref('quick')
const busy = ref(false)
const error = ref('')
const pastedPbn = ref('')

const ROTATE_KEY = 'bridgeTableRotateDeals'
const rotateRandomly = ref(localStorage.getItem(ROTATE_KEY) === '1')
watch(rotateRandomly, (v) => localStorage.setItem(ROTATE_KEY, v ? '1' : '0'))

// Scenario menu, fetched on first open of the tab.
const menu = ref([])
const menuLoading = ref(false)
const menuError = ref('')
watch(tab, async (t) => {
  if (t !== 'scenarios' || menu.value.length || menuLoading.value) return
  menuLoading.value = true
  try {
    menu.value = await fetchScenarioMenu()
  } catch (err) {
    menuError.value = 'Could not load the scenario menu: ' + err.message
  } finally {
    menuLoading.value = false
  }
})

function rotation() {
  return rotateRandomly.value ? Math.floor(Math.random() * 4) : 0
}

// Send and close. Server-side rejections come back as error frames which
// the table view already toasts; we close optimistically.
function deal(payload) {
  error.value = ''
  if (!table.sendDeal(payload)) {
    error.value = 'Not connected.'
    return
  }
  emit('close')
}

// "Generate fresh": run the scenario's .dlr through the server's dealer
// proxy for a brand-new constrained deal instead of a pre-made PBN one.
const SCRIPT_KEY = 'bridgeTableDealViaScript'
const useScript = ref(localStorage.getItem(SCRIPT_KEY) === '1')
watch(useScript, (v) => localStorage.setItem(SCRIPT_KEY, v ? '1' : '0'))

// Picking here SETS the sticky source (the header's "Next deal" repeats
// it) and deals immediately.
async function dealVia(descriptor) {
  busy.value = true
  error.value = ''
  dealSource.setSource(descriptor)
  const ok = await dealSource.nextDeal(rotation())
  busy.value = false
  if (ok) emit('close')
  else error.value = dealSource.dealError.value || 'Deal failed.'
}

function dealFromScenario(item) {
  dealVia({ kind: 'scenario', file: item.file, label: item.label, useScript: useScript.value })
}

function dealFromPaste() {
  dealVia({ kind: 'pbn', text: pastedPbn.value })
}
</script>

<style scoped>
.dsm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.dsm-modal {
  background: #fff;
  border-radius: 10px;
  width: min(560px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.dsm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 0;
}
.dsm-header h3 {
  margin: 0;
  font-size: 18px;
}
.dsm-close {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #666;
}
.dsm-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 18px 0;
  border-bottom: 1px solid #e5e5e5;
}
.dsm-tab {
  border: none;
  background: none;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 14px;
  color: #555;
  border-bottom: 2px solid transparent;
}
.dsm-tab.active {
  color: #1d6e50;
  border-bottom-color: #1d6e50;
  font-weight: 600;
}
.dsm-body {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsm-scroll {
  overflow-y: auto;
}
.dsm-big {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid #cfd8d3;
  border-radius: 8px;
  background: #f6faf8;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.dsm-big:hover:not(:disabled) {
  background: #eaf4ef;
}
.dsm-big:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsm-sub {
  font-size: 12px;
  font-weight: 400;
  color: #667;
}
.dsm-major {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8a6d1a;
  margin: 10px 0 4px;
}
.dsm-section summary {
  cursor: pointer;
  font-weight: 600;
  padding: 6px 4px;
  color: #24435a;
}
.dsm-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
  padding: 6px 4px 10px;
}
.dsm-item {
  border: 1px solid #d8dee4;
  border-radius: 6px;
  background: #fff;
  padding: 7px 9px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.dsm-item:hover:not(:disabled) {
  background: #f0f5fa;
}
.dsm-textarea {
  width: 100%;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  border: 1px solid #d8dee4;
  border-radius: 6px;
  padding: 8px;
  box-sizing: border-box;
}
.dsm-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 18px 14px;
  border-top: 1px solid #eee;
  font-size: 13px;
}
.dsm-footer-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsm-footer-label {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #99a;
}
.dsm-pill {
  border: 1px solid #cfd8d3; background: #fff; border-radius: 999px;
  padding: 3px 12px; font-size: 12.5px; cursor: pointer; color: #444;
}
.dsm-pill.active { background: #1d6e50; border-color: #1d6e50; color: #fff; font-weight: 600; }
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
