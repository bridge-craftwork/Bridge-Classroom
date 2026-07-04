<script setup>
// Unified deal-source control (deal-source-spec §3/§9, impl-plan §4).
// Layout-agnostic: this owns the CONTENT (tabs, filter, tree, tray, options,
// action); the host owns the FRAME (modal / inline / full-screen) and passes a
// `layout` hint + an `allow` gate. Emits `submit(selection)`; the host wires it
// to the resolver's nextBoard (stream) or materialize (materialize).
//
// SKELETON (build-order item 3): Scenarios / Curated / Paste PBN / Random are
// wired (they resolve today); Club games / My library are shown but marked
// "coming soon" until their backends are wired into the picker.

import { ref, computed, onMounted, watch } from 'vue'
import { fetchScenarioMenu } from '@/utils/pbsScenarios.js'

const props = defineProps({
  allow: {
    type: Object,
    default: () => ({ tabs: ['scenarios', 'curated', 'pbn', 'random'], options: ['mode', 'drawOrder', 'fresh'] }),
  },
  layout: { type: String, default: 'compact' }, // 'compact' | 'full'
  mode: { type: String, default: 'stream' }, // 'stream' | 'materialize'
  owner: { type: String, default: null },
  actionLabel: { type: String, default: 'Deal' },
  modelValue: { type: Object, default: () => ({ items: [], options: {} }) },
})
const emit = defineEmits(['update:modelValue', 'submit', 'close'])

const ALL_TABS = [
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'curated', label: 'Curated' },
  { key: 'clubgames', label: 'Club games' },
  { key: 'library', label: 'My library' },
  { key: 'pbn', label: 'Paste PBN' },
  { key: 'random', label: 'Random' },
]
const WIRED = new Set(['scenarios', 'curated', 'pbn', 'random'])
const visibleTabs = computed(() => ALL_TABS.filter((t) => props.allow.tabs.includes(t.key)))
const activeTab = ref(visibleTabs.value[0]?.key || 'scenarios')

// ── Selection state (v-model) ─────────────────────────────────────────────
const items = ref([...(props.modelValue.items || [])])
const options = ref({
  drawOrder: 'sequential',
  mode: 'bid-and-play',
  fresh: false,
  ...(props.modelValue.options || {}),
})
watch(
  [items, options],
  () => emit('update:modelValue', { items: items.value, options: options.value }),
  { deep: true },
)

// ── Scenarios / Curated menu ───────────────────────────────────────────────
const menu = ref([])
const menuLoading = ref(false)
const menuError = ref('')
async function loadMenu() {
  menuLoading.value = true
  menuError.value = ''
  try {
    menu.value = await fetchScenarioMenu()
  } catch (e) {
    menuError.value = e?.message || 'Could not load the scenario menu.'
  } finally {
    menuLoading.value = false
  }
}
onMounted(() => {
  if (props.allow.tabs.includes('scenarios') || props.allow.tabs.includes('curated')) loadMenu()
})

function isPicked(file) {
  return items.value.some((r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === file)
}
function toggleScenario(item) {
  const idx = items.value.findIndex((r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === item.file)
  if (idx >= 0) items.value.splice(idx, 1)
  else items.value.push(makeScenarioRef(item))
}
function makeScenarioRef(item) {
  if (options.value.fresh) return { kind: 'script', repo: 'pbs', file: item.file, label: item.label }
  const ref_ = { kind: 'scenario', repo: 'pbs', file: item.file, label: item.label }
  if (activeTab.value === 'curated') ref_.curated = true
  return ref_
}

// ── Global filter (flat results across the loaded menu) ────────────────────
const filter = ref('')
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')
const flatResults = computed(() => {
  const q = norm(filter.value)
  if (!q) return null
  const out = []
  for (const node of menu.value) {
    if (node.type !== 'section') continue
    for (const it of node.items) if (norm(it.label).includes(q)) out.push({ ...it, section: node.label })
  }
  return out
})

// ── Paste PBN ──────────────────────────────────────────────────────────────
const pastedPbn = ref('')
function addPastedPbn() {
  const text = pastedPbn.value.trim()
  if (!text) return
  items.value.push({ kind: 'pbn', text, label: 'Pasted PBN' })
  pastedPbn.value = ''
}

// ── Random ──────────────────────────────────────────────────────────────────
function addRandom() {
  if (!items.value.some((r) => r.kind === 'random')) items.value.push({ kind: 'random', label: 'Random' })
}

// ── Tray ────────────────────────────────────────────────────────────────────
function removeItem(i) {
  items.value.splice(i, 1)
}
function clearItems() {
  items.value = []
}
const trayLabel = (r) => r.label || r.kind

// ── Action ────────────────────────────────────────────────────────────────
const canSubmit = computed(() => items.value.length > 0)
function submit() {
  if (!canSubmit.value) return
  emit('submit', { items: items.value, options: options.value })
}

const showOpt = (k) => props.allow.options.includes(k)
</script>

<template>
  <div class="dsp" :class="`dsp--${layout}`">
    <header class="dsp-head">
      <h2>Deal source</h2>
      <button class="dsp-x" type="button" aria-label="Close" @click="emit('close')">×</button>
    </header>

    <!-- Global filter -->
    <div class="dsp-filter">
      <span class="dsp-filter-ico">🔎</span>
      <input v-model="filter" type="text" placeholder="Filter across everything… e.g. “Transfer”" />
    </div>

    <!-- Tabs -->
    <nav v-if="!flatResults" class="dsp-tabs">
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        type="button"
        class="dsp-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- Body -->
    <div class="dsp-body">
      <!-- Flat filter results -->
      <ul v-if="flatResults" class="dsp-list">
        <li v-if="flatResults.length === 0" class="dsp-empty">No matches in the loaded menus.</li>
        <li v-for="it in flatResults" :key="it.file" class="dsp-leaf" @click="toggleScenario(it)">
          <input type="checkbox" :checked="isPicked(it.file)" @click.stop="toggleScenario(it)" />
          <span class="dsp-leaf-label">{{ it.label }}</span>
          <span class="dsp-origin">PBS · {{ it.section }}</span>
        </li>
      </ul>

      <!-- Scenarios / Curated tree -->
      <template v-else-if="activeTab === 'scenarios' || activeTab === 'curated'">
        <p v-if="activeTab === 'curated'" class="dsp-note">Auction-predictable subset (BBA-filtered).</p>
        <p v-if="menuLoading" class="dsp-note">Loading scenarios…</p>
        <p v-else-if="menuError" class="dsp-note dsp-err">{{ menuError }}</p>
        <div v-else class="dsp-tree">
          <template v-for="(node, ni) in menu" :key="ni">
            <div v-if="node.type === 'major'" class="dsp-major">{{ node.label }}</div>
            <div v-else class="dsp-section">
              <div class="dsp-section-label">{{ node.label }}</div>
              <div class="dsp-section-items">
                <label v-for="it in node.items" :key="it.file" class="dsp-leaf">
                  <input type="checkbox" :checked="isPicked(it.file)" @change="toggleScenario(it)" />
                  <span class="dsp-leaf-label">{{ it.label }}</span>
                </label>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- Paste PBN -->
      <template v-else-if="activeTab === 'pbn'">
        <textarea v-model="pastedPbn" class="dsp-ta" placeholder="Paste PBN board(s) here…"></textarea>
        <button class="dsp-add" type="button" :disabled="!pastedPbn.trim()" @click="addPastedPbn">Add to pool</button>
      </template>

      <!-- Random -->
      <template v-else-if="activeTab === 'random'">
        <p class="dsp-note">A freshly shuffled deal each time you draw.</p>
        <button class="dsp-add" type="button" @click="addRandom">Add Random to pool</button>
      </template>

      <!-- Not-yet-wired tabs -->
      <template v-else>
        <p class="dsp-note dsp-soon">
          {{ ALL_TABS.find((t) => t.key === activeTab)?.label }} — coming soon in the picker.
        </p>
      </template>
    </div>

    <!-- Selection tray (the shared spine) -->
    <div class="dsp-tray">
      <div class="dsp-tray-head">
        <span>Selected pool ({{ items.length }})</span>
        <button v-if="items.length" type="button" class="dsp-clear" @click="clearItems">Clear</button>
      </div>
      <div class="dsp-chips">
        <span v-if="!items.length" class="dsp-chips-empty">Nothing selected yet.</span>
        <span v-for="(r, i) in items" :key="i" class="dsp-chip" :class="`chip--${r.kind}`">
          {{ trayLabel(r) }}
          <button type="button" aria-label="Remove" @click="removeItem(i)">×</button>
        </span>
      </div>
    </div>

    <!-- Options -->
    <div class="dsp-options">
      <label v-if="showOpt('mode')">
        Mode
        <select v-model="options.mode">
          <option value="bid-and-play">Bid + play</option>
          <option value="bid-only">Bid only</option>
          <option value="play-only">Play only</option>
        </select>
      </label>
      <label v-if="showOpt('drawOrder')">
        Draw
        <select v-model="options.drawOrder">
          <option value="sequential">Sequential</option>
          <option value="random">Random</option>
        </select>
      </label>
      <label v-if="showOpt('fresh')" class="dsp-fresh">
        <input v-model="options.fresh" type="checkbox" />
        Fresh deals (generate)
      </label>
    </div>

    <!-- Action -->
    <footer class="dsp-foot">
      <button class="dsp-action" type="button" :disabled="!canSubmit" @click="submit">{{ actionLabel }}</button>
    </footer>
  </div>
</template>

<style scoped>
.dsp {
  --accent: #2e7d46;
  --accent-weak: #e7f2ec;
  --line: #e2e5e9;
  --ink: #1f2933;
  --muted: #6b7480;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--ink);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow: hidden;
}
.dsp--compact {
  width: min(560px, 94vw);
  max-height: 88vh;
}
.dsp--full {
  width: 100%;
}

.dsp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.dsp-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.dsp-x {
  border: none;
  background: none;
  font-size: 22px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
}

.dsp-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fafbfc;
}
.dsp-filter input {
  border: none;
  background: none;
  outline: none;
  width: 100%;
  font-size: 14px;
}
.dsp-filter-ico {
  opacity: 0.6;
}

.dsp-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 16px;
}
.dsp-tab {
  border: none;
  background: none;
  padding: 7px 10px;
  border-radius: 7px 7px 0 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.dsp-tab.active {
  color: var(--accent);
  background: var(--accent-weak);
}

.dsp-body {
  flex: 1;
  min-height: 180px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: #fcfdfe;
}

.dsp-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsp-major {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-top: 6px;
}
.dsp-section-label {
  font-weight: 600;
  margin: 4px 0 2px;
}
.dsp-section-items {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
}
.dsp-leaf {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 4px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.dsp-leaf:hover {
  background: var(--accent-weak);
}
.dsp-leaf-label {
  flex: 1;
}
.dsp-origin {
  font-size: 11px;
  color: var(--muted);
}
.dsp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsp-note {
  color: var(--muted);
  margin: 4px 0;
}
.dsp-err {
  color: #b23c3c;
}
.dsp-soon {
  font-style: italic;
}
.dsp-empty {
  color: var(--muted);
}

.dsp-ta {
  width: 100%;
  min-height: 120px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  resize: vertical;
}
.dsp-add {
  margin-top: 8px;
  border: 1px solid var(--accent);
  color: var(--accent);
  background: #fff;
  padding: 7px 12px;
  border-radius: 7px;
  font-weight: 600;
  cursor: pointer;
}
.dsp-add:disabled {
  opacity: 0.4;
  cursor: default;
}

.dsp-tray {
  padding: 10px 16px;
}
.dsp-tray-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 6px;
}
.dsp-clear {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dsp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsp-chips-empty {
  color: var(--muted);
  font-style: italic;
}
.dsp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent-weak);
  color: var(--accent);
  border-radius: 999px;
  padding: 4px 6px 4px 10px;
  font-size: 12px;
  font-weight: 600;
}
.dsp-chip button {
  border: none;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
  border-radius: 999px;
  width: 16px;
  height: 16px;
  line-height: 1;
  cursor: pointer;
}
.chip--random {
  background: #eef0ff;
  color: #4a4fb5;
}
.chip--pbn {
  background: #fff2e0;
  color: #b5722a;
}
.chip--script {
  background: #fde8f0;
  color: #b53a6e;
}

.dsp-options {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  padding: 4px 16px 12px;
  font-size: 13px;
  color: var(--muted);
}
.dsp-options select {
  margin-left: 6px;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.dsp-fresh {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsp-foot {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--line);
}
.dsp-action {
  width: 100%;
  border: none;
  background: var(--accent);
  color: #fff;
  padding: 11px;
  border-radius: 9px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.dsp-action:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
