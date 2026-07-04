<script setup>
// Unified deal-source control (deal-source-spec §3/§9, impl-plan §4).
// Layout-agnostic: this owns the CONTENT (filter, gated tabs, scenario list,
// selection tray, action); the host owns the FRAME (modal / inline / full) and
// passes an `allow` gate + a `layout` hint. Emits `submit(selection)`; the host
// wires it to the resolver's nextBoard (stream) or materialize (materialize).
//
// Two selection modes (toggle "Multi" by the filter):
//  • single (default) — clicking a source resolves immediately (emits submit;
//    the host closes the panel). No pool, no Deal button.
//  • multi — check sources into a pool, then Deal.
//
// drawOrder is asserted by source kind, not a user control: scenario/curated/
// random/script → 'random'; everything else (library/clubboard/pbn) → 'sequential'.
// Mode (bid/play) lives in the containing app, not here.

import { ref, computed, onMounted, watch } from 'vue'
import { fetchScenarioMenu, fetchScenarioMeta } from '@/utils/pbsScenarios.js'

const props = defineProps({
  allow: {
    type: Object,
    default: () => ({ tabs: ['scenarios', 'curated', 'pbn', 'random'], options: ['fresh'] }),
  },
  layout: { type: String, default: 'compact' }, // 'compact' | 'full'
  mode: { type: String, default: 'stream' }, // 'stream' | 'materialize'
  owner: { type: String, default: null },
  actionLabel: { type: String, default: 'Deal' },
  modelValue: { type: Object, default: () => ({ items: [], options: {} }) },
})
const emit = defineEmits(['update:modelValue', 'submit', 'close'])

const ALL_TABS = [
  { key: 'favorites', label: 'Favorites', icon: '♥' },
  { key: 'history', label: 'History', icon: '🕐' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'curated', label: 'Curated' },
  { key: 'clubgames', label: 'Club' },
  { key: 'library', label: 'Library' },
  { key: 'pbn', label: 'Paste' },
  { key: 'random', label: 'Random' },
]
const visibleTabs = computed(() => ALL_TABS.filter((t) => props.allow.tabs.includes(t.key)))
const activeTab = ref(visibleTabs.value[0]?.key || 'scenarios')
const isScenarioTab = computed(() => activeTab.value === 'scenarios' || activeTab.value === 'curated')

// single (default) vs multi selection
const multi = ref(false)
// "Fresh deals (generate)" toggle — scenarios only; Filtered = static board set.
const fresh = ref(false)
const allowFresh = computed(() => props.allow.options.includes('fresh'))

// ── Pool (multi mode only) ─────────────────────────────────────────────────
const pool = ref([...(props.modelValue.items || [])])
watch(pool, () => emit('update:modelValue', selectionFrom(pool.value)), { deep: true })

// drawOrder asserted by kind (no user control).
const RANDOM_KINDS = new Set(['scenario', 'random', 'script'])
function selectionFrom(items) {
  const drawOrder = items.length && items.every((r) => RANDOM_KINDS.has(r.kind)) ? 'random' : 'sequential'
  return { items, options: { drawOrder } }
}

// Resolve a selection: in single mode fire it now; in multi it goes to the pool.
function choose(ref_) {
  const sel = selectionFrom([ref_])
  emit('update:modelValue', sel)
  emit('submit', sel)
}

// ── Scenario / Curated menu + BBA metadata ─────────────────────────────────
const menu = ref([])
const menuLoading = ref(false)
const menuError = ref('')
const fileMeta = ref({}) // file -> { bbaWorks }

async function loadMenu() {
  menuLoading.value = true
  menuError.value = ''
  try {
    menu.value = await fetchScenarioMenu()
    loadMeta() // fire-and-forget; colours fill in when it resolves
  } catch (e) {
    menuError.value = e?.message || 'Could not load the scenario menu.'
  } finally {
    menuLoading.value = false
  }
}
async function loadMeta() {
  const files = []
  for (const node of menu.value) if (node.type === 'section') for (const it of node.items) files.push(it.file)
  const pairs = await Promise.all(files.map(async (f) => [f, await fetchScenarioMeta(f)]))
  fileMeta.value = Object.fromEntries(pairs)
}
onMounted(() => {
  if (props.allow.tabs.includes('scenarios') || props.allow.tabs.includes('curated')) loadMenu()
})

// BBA doesn't support this convention → flag it (better with a human partner).
const bbaUnsupported = (file) => fileMeta.value[file]?.bbaWorks === false

function makeScenarioRef(item) {
  if (fresh.value) return { kind: 'script', repo: 'pbs', file: item.file, label: item.label }
  const r = { kind: 'scenario', repo: 'pbs', file: item.file, label: item.label }
  if (activeTab.value === 'curated') r.curated = true
  return r
}
function isPicked(file) {
  return pool.value.some((r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === file)
}
function onScenario(item) {
  if (!multi.value) return choose(makeScenarioRef(item))
  const idx = pool.value.findIndex((r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === item.file)
  if (idx >= 0) pool.value.splice(idx, 1)
  else pool.value.push(makeScenarioRef(item))
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
function usePastedPbn() {
  const text = pastedPbn.value.trim()
  if (!text) return
  const ref_ = { kind: 'pbn', text, label: 'Pasted PBN' }
  if (multi.value) pool.value.push(ref_)
  else choose(ref_)
  pastedPbn.value = ''
}

// ── Random ──────────────────────────────────────────────────────────────────
function useRandom() {
  const ref_ = { kind: 'random', label: 'Random' }
  if (!multi.value) return choose(ref_)
  if (!pool.value.some((r) => r.kind === 'random')) pool.value.push(ref_)
}

// ── Tray (multi) ─────────────────────────────────────────────────────────────
function removeItem(i) {
  pool.value.splice(i, 1)
}
function clearPool() {
  pool.value = []
}
const trayLabel = (r) => r.label || r.kind

const canSubmit = computed(() => pool.value.length > 0)
function submit() {
  if (!canSubmit.value) return
  const sel = selectionFrom(pool.value)
  emit('update:modelValue', sel)
  emit('submit', sel)
}
</script>

<template>
  <div class="dsp" :class="`dsp--${layout}`">
    <header class="dsp-head">
      <h2>Deal Source</h2>
      <button class="dsp-x" type="button" aria-label="Close" @click="emit('close')">×</button>
    </header>

    <!-- Filter + Multi toggle -->
    <div class="dsp-controls">
      <div class="dsp-filter">
        <span class="dsp-filter-ico">🔎</span>
        <input v-model="filter" type="text" placeholder="Filter across everything… e.g. “Transfer”" />
      </div>
      <label class="dsp-multi" title="Pick several sources into a pool">
        <input v-model="multi" type="checkbox" />
        Multi
      </label>
    </div>

    <!-- Tabs -->
    <nav v-if="!flatResults" class="dsp-tabs">
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        type="button"
        class="dsp-tab"
        :class="{ active: activeTab === t.key, 'dsp-tab-icon': !!t.icon, 'dsp-tab-heart': t.key === 'favorites' }"
        :title="t.icon ? t.label : ''"
        :aria-label="t.label"
        @click="activeTab = t.key"
      >
        <span v-if="t.icon">{{ t.icon }}</span>
        <template v-else>{{ t.label }}</template>
      </button>
    </nav>

    <!-- Body -->
    <div class="dsp-body">
      <!-- Flat filter results -->
      <ul v-if="flatResults" class="dsp-list">
        <li v-if="flatResults.length === 0" class="dsp-empty">No matches in the loaded menus.</li>
        <li v-for="it in flatResults" :key="it.file">
          <label v-if="multi" class="dsp-leaf" :class="{ unsupported: bbaUnsupported(it.file) }" :title="bbaUnsupported(it.file) ? 'BBA does not fully support this convention' : ''">
            <input type="checkbox" :checked="isPicked(it.file)" @change="onScenario(it)" />
            <span class="dsp-leaf-label">{{ it.label }}</span>
            <span class="dsp-origin">{{ it.section }}</span>
          </label>
          <button v-else type="button" class="dsp-leaf dsp-leaf-btn" :class="{ unsupported: bbaUnsupported(it.file) }" :title="bbaUnsupported(it.file) ? 'BBA does not fully support this convention' : ''" @click="onScenario(it)">
            <span class="dsp-leaf-label">{{ it.label }}</span>
            <span class="dsp-origin">{{ it.section }}</span>
          </button>
        </li>
      </ul>

      <!-- Scenarios / Curated -->
      <template v-else-if="isScenarioTab">
        <div class="dsp-subbar">
          <div v-if="allowFresh" class="dsp-seg">
            <button type="button" :class="{ active: !fresh }" @click="fresh = false">Filtered</button>
            <button type="button" :class="{ active: fresh }" @click="fresh = true">Fresh</button>
          </div>
          <span class="dsp-subhint">
            <template v-if="activeTab === 'curated'">Hand-curated coaching set.</template>
            <template v-else><span class="dsp-swatch"></span> orange = BBA doesn’t know it (better with a human partner)</template>
          </span>
        </div>

        <p v-if="menuLoading" class="dsp-note">Loading scenarios…</p>
        <p v-else-if="menuError" class="dsp-note dsp-err">{{ menuError }}</p>
        <div v-else class="dsp-tree">
          <template v-for="(node, ni) in menu" :key="ni">
            <div v-if="node.type === 'section'" class="dsp-section">
              <div class="dsp-section-label">{{ node.label }}</div>
              <div class="dsp-section-items">
                <template v-for="it in node.items" :key="it.file">
                  <label
                    v-if="multi"
                    class="dsp-leaf"
                    :class="{ unsupported: bbaUnsupported(it.file) }"
                    :title="bbaUnsupported(it.file) ? 'BBA does not fully support this convention' : ''"
                  >
                    <input type="checkbox" :checked="isPicked(it.file)" @change="onScenario(it)" />
                    <span class="dsp-leaf-label">{{ it.label }}</span>
                  </label>
                  <button
                    v-else
                    type="button"
                    class="dsp-leaf dsp-leaf-btn"
                    :class="{ unsupported: bbaUnsupported(it.file) }"
                    :title="bbaUnsupported(it.file) ? 'BBA does not fully support this convention' : ''"
                    @click="onScenario(it)"
                  >
                    <span class="dsp-leaf-label">{{ it.label }}</span>
                  </button>
                </template>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- Paste PBN -->
      <template v-else-if="activeTab === 'pbn'">
        <textarea v-model="pastedPbn" class="dsp-ta" placeholder="Paste PBN board(s) here…"></textarea>
        <button class="dsp-add" type="button" :disabled="!pastedPbn.trim()" @click="usePastedPbn">
          {{ multi ? 'Add to pool' : 'Use this PBN' }}
        </button>
      </template>

      <!-- Random -->
      <template v-else-if="activeTab === 'random'">
        <p class="dsp-note">A freshly shuffled deal each time you draw.</p>
        <button class="dsp-add" type="button" @click="useRandom">
          {{ multi ? 'Add Random to pool' : 'Use Random' }}
        </button>
      </template>

      <!-- Not-yet-wired tabs -->
      <template v-else>
        <p class="dsp-note dsp-soon">{{ ALL_TABS.find((t) => t.key === activeTab)?.label }} — coming soon in the picker.</p>
      </template>
    </div>

    <!-- Selection tray + action (multi only) -->
    <template v-if="multi">
      <div class="dsp-tray">
        <div class="dsp-tray-head">
          <span>Selected pool ({{ pool.length }})</span>
          <button v-if="pool.length" type="button" class="dsp-clear" @click="clearPool">Clear</button>
        </div>
        <div class="dsp-chips">
          <span v-if="!pool.length" class="dsp-chips-empty">Nothing selected yet.</span>
          <span v-for="(r, i) in pool" :key="i" class="dsp-chip" :class="`chip--${r.kind}`">
            {{ trayLabel(r) }}
            <button type="button" aria-label="Remove" @click="removeItem(i)">×</button>
          </span>
        </div>
      </div>
      <footer class="dsp-foot">
        <button class="dsp-action" type="button" :disabled="!canSubmit" @click="submit">{{ actionLabel }}</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.dsp {
  --accent: #2e7d46;
  --accent-weak: #e7f2ec;
  --line: #e2e5e9;
  --ink: #1f2933;
  --muted: #6b7480;
  --warn-bg: #fde2cc;
  --warn-ink: #7a3a1a;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--ink);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
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

.dsp-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px 8px;
}
.dsp-filter {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
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
.dsp-multi {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
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
.dsp-tab-icon {
  padding: 7px 9px;
  font-size: 15px;
  line-height: 1;
}
.dsp-tab-heart {
  color: #c2455e;
}
.dsp-tab-heart.active {
  color: #c2455e;
  background: #fde8ec;
}

.dsp-body {
  flex: 1 1 auto;
  min-height: 200px;
  overflow-y: auto;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: #fcfdfe;
}

/* Filtered/Fresh sub-bar */
.dsp-subbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.dsp-subhint {
  font-size: 12px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dsp-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--warn-bg);
}

/* Segmented control */
.dsp-seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.dsp-seg button {
  border: none;
  border-right: 1px solid var(--line);
  background: #fff;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
}
.dsp-seg button:last-child {
  border-right: none;
}
.dsp-seg button.active {
  background: var(--accent);
  color: #fff;
}

/* Scenario tree — tight rows */
.dsp-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsp-section-label {
  font-weight: 600;
  font-size: 13px;
  margin: 2px 0 1px;
}
.dsp-section-items {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.dsp-leaf {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 1px 5px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.dsp-leaf:hover {
  background: var(--accent-weak);
}
.dsp-leaf-btn {
  border: none;
  background: none;
  width: 100%;
  color: inherit;
  font: inherit;
}
.dsp-leaf.unsupported {
  background: var(--warn-bg);
  color: var(--warn-ink);
}
.dsp-leaf.unsupported:hover {
  background: #fbcdaa;
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
  gap: 1px;
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
