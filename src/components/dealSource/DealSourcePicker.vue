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
import { fetchScenarioManifest, fetchCuratedMenu } from '@/utils/pbsScenarios.js'
import { useDealSourceMemory, refKey } from '@/composables/useDealSourceMemory.js'
import { useClubGames } from '@/composables/useClubGames.js'
import { clubGameBoards } from '@/utils/normalizedDeal.js'
import DealLibraryPicker from '@/components/table/DealLibraryPicker.vue'

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
  // Where unregistered users go to save Favorites/History/Club/Library to their
  // account. Host-provided; the notes hide their link when it's not set.
  registerUrl: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue', 'submit', 'close'])

// Local-only memory (Favorites + History), localStorage-backed.
const { favorites, history, isFavorite, toggleFavorite, recordHistory, clearHistory } = useDealSourceMemory()

const ALL_TABS = [
  { key: 'favorites', label: 'Favorites', icon: '♥' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'curated', label: 'Curated' },
  { key: 'clubgames', label: 'Club' },
  { key: 'library', label: 'Library' },
  { key: 'pbn', label: 'Paste' },
  { key: 'random', label: 'Random' },
  { key: 'history', label: 'History', icon: '🕐' },
]
const visibleTabs = computed(() => ALL_TABS.filter((t) => props.allow.tabs.includes(t.key)))

// Remember the last-used tab across invocations (only restore if still allowed).
const TAB_KEY = 'dsp-active-tab'
function initialTab() {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved && visibleTabs.value.some((t) => t.key === saved)) return saved
  } catch { /* ignore */ }
  // No saved tab → default to Scenarios (not the leftmost, which is Favorites).
  if (visibleTabs.value.some((t) => t.key === 'scenarios')) return 'scenarios'
  return visibleTabs.value[0]?.key || 'scenarios'
}
const activeTab = ref(initialTab())
watch(activeTab, (t) => {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch { /* ignore */ }
})
const isScenarioTab = computed(() => activeTab.value === 'scenarios' || activeTab.value === 'curated')

// single (default) vs multi selection
const multi = ref(false)
// "Fresh deals (generate)" toggle — scenarios only; Filtered = static board set.
const fresh = ref(false)
const allowFresh = computed(() => props.allow.options.includes('fresh'))
// Global filter text (searches across menus).
const filter = ref('')
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')
function clearFilter() {
  filter.value = ''
}

// ── Settings: manifest tier (Beta layout / Test mode) — persisted locally ────
// The two toggles are orthogonal → 4 manifest tiers (PBS #167). Default: off/off.
const SETTINGS_KEY = 'dsp-settings'
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return { betaLayout: !!s.betaLayout, testMode: !!s.testMode }
  } catch {
    return { betaLayout: false, testMode: false }
  }
}
const settings = ref(loadSettings())
const showSettings = ref(false)
const manifestTier = computed(() => {
  const b = settings.value.betaLayout
  const t = settings.value.testMode
  if (b && t) return 'test'
  if (b) return 'beta'
  if (t) return 'release-test'
  return 'release'
})
watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } catch { /* ignore */ }
  },
  { deep: true },
)
// Changing the tier reloads the Scenarios menu (curated is unaffected).
watch(manifestTier, () => {
  scenarioMenu.value = []
  fileMeta.value = {}
  if (props.allow.tabs.includes('scenarios') || filter.value) loadScenarioMenu()
})

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
  recordHistory([ref_])
  emit('update:modelValue', sel)
  emit('submit', sel)
}

// ── Scenario (button-layout) + Curated (toc.json) menus ────────────────────
// Two distinct sources: Scenarios = the full bba-filtered set (button layout,
// names/tooltips from each .btn); Curated = a much smaller hand-picked set with
// its own manifest (coaching-curated/toc.json), names + descriptions built in.
const scenarioMenu = ref([])
const curatedMenu = ref([])
const menuLoading = ref(false)
const menuError = ref('')
const fileMeta = ref({}) // scenario file -> { bbaWorks, buttonText, title, description }

const activeMenu = computed(() => (activeTab.value === 'curated' ? curatedMenu.value : scenarioMenu.value))
const activeLoading = computed(() => menuLoading.value)
const activeError = computed(() => menuError.value)

async function loadScenarioMenu() {
  if (scenarioMenu.value.length || menuLoading.value) return
  menuLoading.value = true
  menuError.value = ''
  try {
    // One manifest fetch (PBS #167): layout tree + names/bba-works/tooltips,
    // so the whole Scenarios tab is ready at once (no async fill-in).
    const { sections, meta } = await fetchScenarioManifest(manifestTier.value)
    fileMeta.value = meta
    scenarioMenu.value = sections
  } catch (e) {
    menuError.value = e?.message || 'Could not load the scenario menu.'
  } finally {
    menuLoading.value = false
  }
}
async function loadCuratedMenu() {
  if (curatedMenu.value.length) return
  try {
    curatedMenu.value = await fetchCuratedMenu()
  } catch (e) {
    if (activeTab.value === 'curated') menuError.value = e?.message || 'Could not load the curated menu.'
  }
}
function ensureMenu(tab) {
  if (tab === 'scenarios' && props.allow.tabs.includes('scenarios')) loadScenarioMenu()
  if (tab === 'curated' && props.allow.tabs.includes('curated')) loadCuratedMenu()
  if (tab === 'clubgames' && props.allow.tabs.includes('clubgames')) ensureClub()
}
onMounted(() => ensureMenu(activeTab.value))
watch(activeTab, (t) => {
  showSettings.value = false
  ensureMenu(t)
})
// The filter searches across menus, so load both once the user starts filtering.
watch(filter, (q) => {
  if (!q) return
  if (props.allow.tabs.includes('scenarios')) loadScenarioMenu()
  if (props.allow.tabs.includes('curated')) loadCuratedMenu()
})

// BBA doesn't support this convention → flag it (better with a human partner).
// (Scenarios only; curated items aren't in fileMeta.)
const bbaUnsupported = (file) => fileMeta.value[file]?.bbaWorks === false
// Display name: .btn button-text (scenarios) or toc name (curated), falling back
// to the menu label until metadata resolves. Tooltip: the harvested description.
const displayLabel = (it) => fileMeta.value[it.file]?.buttonText || it.label
const descFor = (it) => fileMeta.value[it.file]?.description || it.description || ''

function makeRef(item, curated) {
  const label = displayLabel(item)
  if (fresh.value && !curated) return { kind: 'script', repo: 'pbs', file: item.file, label }
  const r = { kind: 'scenario', repo: 'pbs', file: item.file, label }
  if (curated) r.curated = true
  return r
}
function isPicked(file, curated) {
  return pool.value.some(
    (r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === file && !!r.curated === !!curated,
  )
}
function onPick(item, curated) {
  const ref_ = makeRef(item, curated)
  if (!multi.value) return choose(ref_)
  const idx = pool.value.findIndex(
    (r) => (r.kind === 'scenario' || r.kind === 'script') && r.file === item.file && !!r.curated === !!curated,
  )
  if (idx >= 0) pool.value.splice(idx, 1)
  else pool.value.push(ref_)
}

// ── Global filter — flat results across both menus, de-duped, with context ──
const flatResults = computed(() => {
  const q = norm(filter.value)
  if (!q) return null
  const out = []
  const seen = new Set()
  const scan = (menu, curated) => {
    for (const node of menu) {
      if (node.type !== 'section') continue
      for (const it of node.items) {
        const label = displayLabel(it)
        const desc = descFor(it)
        if (!(norm(label).includes(q) || norm(it.label).includes(q) || norm(desc).includes(q))) continue
        const key = (curated ? 'c:' : 's:') + it.file
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ file: it.file, label, description: desc, section: node.label, curated })
      }
    }
  }
  scan(scenarioMenu.value, false)
  scan(curatedMenu.value, true)
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
  recordHistory(pool.value)
  emit('update:modelValue', sel)
  emit('submit', sel)
}

// ── Favorites / History helpers ─────────────────────────────────────────────
// Favorite the scenario itself (not its fresh/script variant).
const favRefFor = (it, curated) => ({
  kind: 'scenario',
  repo: 'pbs',
  file: it.file,
  label: displayLabel(it),
  ...(curated ? { curated: true } : {}),
})
const sameRef = (a, b) => refKey(a) === refKey(b)
function pickRef(r) {
  if (!multi.value) return choose(r)
  if (!pool.value.some((x) => sameRef(x, r))) pool.value.push({ ...r })
}
function refTag(r) {
  switch (r.kind) {
    case 'scenario':
      return r.curated ? 'Curated' : 'Scenario'
    case 'random':
      return 'Random'
    case 'pbn':
      return 'PBN'
    case 'clubboard':
      return 'Club board'
    case 'library':
      return 'Library'
    default:
      return r.kind
  }
}

// ── My library (registered) ─────────────────────────────────────────────────
function onLibrarySelect(entry) {
  pickRef({ kind: 'library', entryId: entry.id, label: entry.name })
}

// ── Club games (registered) — list games, drill into boards (spec §4.3) ─────
const clubStore = useClubGames()
const clubGames = clubStore.games
const clubLoading = clubStore.loading
const clubListError = clubStore.error
let clubLoaded = false
const clubGame = ref(null) // { id, name } once drilled in
const clubBoards = ref([])
const clubBoardsLoading = ref(false)
const clubBoardsError = ref('')

function ensureClub() {
  if (!props.owner || clubLoaded) return
  clubLoaded = true
  clubStore.fetchGames(props.owner)
}
async function openClubGame(g) {
  clubGame.value = { id: g.id, name: g.event_name || 'Club game' }
  clubBoards.value = []
  clubBoardsError.value = ''
  clubBoardsLoading.value = true
  try {
    const game = await clubStore.fetchGame(g.id)
    if (!game || !game.payload) throw new Error('Game is unavailable.')
    clubBoards.value = clubGameBoards(JSON.parse(game.payload))
    if (!clubBoards.value.length) clubBoardsError.value = 'That game has no boards.'
  } catch (e) {
    clubBoardsError.value = e?.message || 'Could not load boards.'
  } finally {
    clubBoardsLoading.value = false
  }
}
function backToClubGames() {
  clubGame.value = null
  clubBoards.value = []
}
const clubRef = (b) => ({
  kind: 'clubboard',
  origin: 'db',
  gameId: clubGame.value.id,
  boardNumber: b.number,
  label: `${clubGame.value.name} · Board ${b.number}`,
})
const isClubPicked = (b) => pool.value.some((r) => sameRef(r, clubRef(b)))
</script>

<template>
  <div class="dsp" :class="`dsp--${layout}`">
    <!-- One heart shape for both states: fill (favorited) vs outline (not) is CSS. -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <symbol id="dsp-heart-sym" viewBox="0 0 24 24">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </symbol>
    </svg>
    <header class="dsp-head">
      <h2>Deal Source</h2>
      <button class="dsp-x" type="button" aria-label="Close" @click="emit('close')">×</button>
    </header>

    <!-- Filter + Multi toggle -->
    <div class="dsp-controls">
      <div class="dsp-filter">
        <span class="dsp-filter-ico">🔎</span>
        <input v-model="filter" type="text" placeholder="Filter across everything… e.g. “Transfer”" />
        <button v-if="filter" class="dsp-filter-x" type="button" aria-label="Clear filter" @click="clearFilter">×</button>
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

      <!-- Settings (far right): manifest tier via Beta / Test toggles -->
      <div class="dsp-settings-wrap">
        <button
          type="button"
          class="dsp-tab dsp-tab-icon dsp-gear"
          :class="{ active: showSettings }"
          title="Settings"
          aria-label="Settings"
          @click="showSettings = !showSettings"
        >
          ⚙
        </button>
        <div v-if="showSettings" class="dsp-settings-pop">
          <div class="dsp-settings-title">Scenario source</div>
          <label class="dsp-setting"><input v-model="settings.betaLayout" type="checkbox" /> Beta layout</label>
          <label class="dsp-setting"><input v-model="settings.testMode" type="checkbox" /> Test mode</label>
          <div class="dsp-setting-note">Using <b>{{ manifestTier }}</b> manifest.</div>
        </div>
      </div>
    </nav>

    <!-- Body -->
    <div class="dsp-body">
      <!-- Flat filter results — two-line rows give context to same-named scenarios -->
      <ul v-if="flatResults" class="dsp-list">
        <li v-if="flatResults.length === 0" class="dsp-empty">No matches.</li>
        <li v-for="it in flatResults" :key="(it.curated ? 'c:' : 's:') + it.file">
          <div class="dsp-result-row" :class="{ unsupported: !it.curated && bbaUnsupported(it.file) }">
            <component
              :is="multi ? 'label' : 'button'"
              :type="multi ? undefined : 'button'"
              class="dsp-result dsp-hit"
              :title="it.description || ''"
              @click="!multi && onPick(it, it.curated)"
            >
              <input v-if="multi" type="checkbox" :checked="isPicked(it.file, it.curated)" @change="onPick(it, it.curated)" />
              <span class="dsp-result-main">
                <span class="dsp-result-top">
                  <span class="dsp-result-label">{{ it.label }}</span>
                  <span class="dsp-origin">{{ it.curated ? 'Curated' : 'Scenarios' }} · {{ it.section }}</span>
                </span>
                <span v-if="it.description" class="dsp-result-desc">{{ it.description }}</span>
              </span>
            </component>
            <button
              type="button"
              class="dsp-star"
              :class="{ on: isFavorite(favRefFor(it, it.curated)) }"
              :title="isFavorite(favRefFor(it, it.curated)) ? 'Remove favorite' : 'Add favorite'"
              @click.stop="toggleFavorite(favRefFor(it, it.curated))"
            >
              <svg class="dsp-heart"><use href="#dsp-heart-sym" /></svg>
            </button>
          </div>
        </li>
      </ul>

      <!-- Scenarios / Curated -->
      <template v-else-if="isScenarioTab">
        <div class="dsp-subbar">
          <div v-if="allowFresh && activeTab === 'scenarios'" class="dsp-seg">
            <button type="button" :class="{ active: !fresh }" @click="fresh = false">Filtered</button>
            <button type="button" :class="{ active: fresh }" @click="fresh = true">Fresh</button>
          </div>
          <span class="dsp-subhint">
            <template v-if="activeTab === 'curated'">Hand-curated coaching set — smaller and vetted.</template>
            <template v-else><span class="dsp-swatch"></span> orange = BBA doesn’t know it (better with a human partner)</template>
          </span>
        </div>

        <p v-if="activeError" class="dsp-note dsp-err">{{ activeError }}</p>
        <p v-else-if="!activeMenu.length" class="dsp-note">Loading…</p>
        <div v-else class="dsp-tree">
          <template v-for="(node, ni) in activeMenu" :key="ni">
            <div v-if="node.type === 'section'" class="dsp-section">
              <div class="dsp-section-label">{{ node.label }}</div>
              <div class="dsp-section-items">
                <div
                  v-for="it in node.items"
                  :key="it.file"
                  class="dsp-leaf"
                  :class="{ unsupported: activeTab !== 'curated' && bbaUnsupported(it.file) }"
                >
                  <label v-if="multi" class="dsp-hit" :title="descFor(it)">
                    <input type="checkbox" :checked="isPicked(it.file, activeTab === 'curated')" @change="onPick(it, activeTab === 'curated')" />
                    <span class="dsp-leaf-label">{{ displayLabel(it) }}</span>
                  </label>
                  <button v-else type="button" class="dsp-hit" :title="descFor(it)" @click="onPick(it, activeTab === 'curated')">
                    <span class="dsp-leaf-label">{{ displayLabel(it) }}</span>
                  </button>
                  <button
                    type="button"
                    class="dsp-star"
                    :class="{ on: isFavorite(favRefFor(it, activeTab === 'curated')) }"
                    :title="isFavorite(favRefFor(it, activeTab === 'curated')) ? 'Remove favorite' : 'Add favorite'"
                    @click.stop="toggleFavorite(favRefFor(it, activeTab === 'curated'))"
                  >
                    <svg class="dsp-heart"><use href="#dsp-heart-sym" /></svg>
                  </button>
                </div>
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

      <!-- Favorites (local) -->
      <template v-else-if="activeTab === 'favorites'">
        <p class="dsp-localnote">♥ Saved on this device &amp; browser only — not synced to your account.</p>
        <ul v-if="favorites.length" class="dsp-list">
          <li v-for="(r, i) in favorites" :key="i">
            <div class="dsp-result-row">
              <component :is="multi ? 'label' : 'button'" :type="multi ? undefined : 'button'" class="dsp-result dsp-hit" @click="!multi && pickRef(r)">
                <input v-if="multi" type="checkbox" :checked="pool.some((x) => sameRef(x, r))" @change="pickRef(r)" />
                <span class="dsp-result-main">
                  <span class="dsp-result-top">
                    <span class="dsp-result-label">{{ r.label || r.kind }}</span>
                    <span class="dsp-origin">{{ refTag(r) }}</span>
                  </span>
                </span>
              </component>
              <button type="button" class="dsp-star on" title="Remove favorite" @click.stop="toggleFavorite(r)"><svg class="dsp-heart"><use href="#dsp-heart-sym" /></svg></button>
            </div>
          </li>
        </ul>
        <p v-else class="dsp-note">No favorites yet — tap a scenario's heart to save it here.</p>
      </template>

      <!-- History (local) -->
      <template v-else-if="activeTab === 'history'">
        <div class="dsp-subbar">
          <span class="dsp-subhint">🕐 Recent picks — this device &amp; browser only.</span>
          <button v-if="history.length" type="button" class="dsp-clear" @click="clearHistory">Clear</button>
        </div>
        <ul v-if="history.length" class="dsp-list">
          <li v-for="(r, i) in history" :key="i">
            <div class="dsp-result-row">
              <component :is="multi ? 'label' : 'button'" :type="multi ? undefined : 'button'" class="dsp-result dsp-hit" @click="!multi && pickRef(r)">
                <input v-if="multi" type="checkbox" :checked="pool.some((x) => sameRef(x, r))" @change="pickRef(r)" />
                <span class="dsp-result-main">
                  <span class="dsp-result-top">
                    <span class="dsp-result-label">{{ r.label || r.kind }}</span>
                    <span class="dsp-origin">{{ refTag(r) }}</span>
                  </span>
                </span>
              </component>
              <button type="button" class="dsp-star" :class="{ on: isFavorite(r) }" :title="isFavorite(r) ? 'Remove favorite' : 'Add favorite'" @click.stop="toggleFavorite(r)"><svg class="dsp-heart"><use href="#dsp-heart-sym" /></svg></button>
            </div>
          </li>
        </ul>
        <p v-else class="dsp-note">No history yet — your recent picks will appear here.</p>
      </template>

      <!-- My library (registered → deal_library; unregistered → local note) -->
      <template v-else-if="activeTab === 'library'">
        <DealLibraryPicker v-if="owner" :owner="owner" @select="onLibrarySelect" />
        <p v-else class="dsp-localnote">
          Your deal library is saved to your account.
          <a v-if="registerUrl" :href="registerUrl" target="_blank" rel="noopener">Register</a><template v-if="registerUrl"> or sign in to use it.</template>
        </p>
      </template>

      <!-- Club games (registered → DB, drill to boards; unregistered → note) -->
      <template v-else-if="activeTab === 'clubgames'">
        <template v-if="owner">
          <!-- Game list -->
          <template v-if="!clubGame">
            <p v-if="clubLoading" class="dsp-note">Loading your games…</p>
            <p v-else-if="clubListError" class="dsp-note dsp-err">{{ clubListError }}</p>
            <p v-else-if="!clubGames.length" class="dsp-note">No saved games yet — analyze a club game (signed in) and it lands here.</p>
            <ul v-else class="dsp-list">
              <li v-for="g in clubGames" :key="g.id">
                <button type="button" class="dsp-result dsp-hit" @click="openClubGame(g)">
                  <span class="dsp-result-main">
                    <span class="dsp-result-top">
                      <span class="dsp-result-label">{{ g.event_name || 'Club game' }}</span>
                      <span class="dsp-origin"><template v-if="g.board_count">{{ g.board_count }} boards </template>›</span>
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </template>
          <!-- Board drill -->
          <template v-else>
            <div class="dsp-subbar">
              <button type="button" class="dsp-back" @click="backToClubGames">‹ Games</button>
              <span class="dsp-subhint">{{ clubGame.name }} — pick board(s)</span>
            </div>
            <p v-if="clubBoardsLoading" class="dsp-note">Loading boards…</p>
            <p v-else-if="clubBoardsError" class="dsp-note dsp-err">{{ clubBoardsError }}</p>
            <div v-else class="dsp-section-items">
              <div v-for="b in clubBoards" :key="b.number" class="dsp-leaf">
                <label v-if="multi" class="dsp-hit">
                  <input type="checkbox" :checked="isClubPicked(b)" @change="pickRef(clubRef(b))" />
                  <span class="dsp-leaf-label">Board {{ b.number }}</span>
                </label>
                <button v-else type="button" class="dsp-hit" @click="pickRef(clubRef(b))">
                  <span class="dsp-leaf-label">Board {{ b.number }}</span>
                </button>
              </div>
            </div>
          </template>
        </template>
        <p v-else class="dsp-localnote">
          Club games you analyze are saved to your account.
          <a v-if="registerUrl" :href="registerUrl" target="_blank" rel="noopener">Register</a><template v-if="registerUrl"> or sign in to use them.</template>
        </p>
      </template>

      <!-- Fallback -->
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
.dsp-filter-x {
  border: none;
  background: rgba(0, 0, 0, 0.08);
  color: var(--muted);
  border-radius: 999px;
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex: none;
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
.dsp-settings-wrap {
  position: relative;
  margin-left: auto; /* push the gear to the far right of the tab bar */
}
.dsp-gear {
  color: var(--muted);
}
.dsp-settings-pop {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  margin-top: 4px;
  min-width: 184px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsp-settings-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.dsp-setting {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.dsp-setting-note {
  font-size: 11px;
  color: var(--muted);
  border-top: 1px solid var(--line);
  padding-top: 6px;
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
  gap: 2px;
  padding: 0 2px;
  border-radius: 5px;
  font-size: 13px;
}
.dsp-leaf:hover {
  background: var(--accent-weak);
}
.dsp-leaf.unsupported {
  background: var(--warn-bg);
  color: var(--warn-ink);
}
.dsp-leaf.unsupported:hover {
  background: #fbcdaa;
}
/* Clickable selection area of a row (label/button), star sits beside it. */
.dsp-hit {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 1px 3px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsp-leaf-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsp-star {
  flex: none;
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 2px 4px;
  cursor: pointer;
}
/* Same heart shape for both states — outline when not favorited, filled when on. */
.dsp-heart {
  width: 15px;
  height: 15px;
  display: block;
  fill: none;
  stroke: #c3c8cf;
  stroke-width: 2;
}
.dsp-star:hover .dsp-heart {
  stroke: #c2455e;
}
.dsp-star.on .dsp-heart {
  fill: #c2455e;
  stroke: none;
}
.dsp-star.on:hover .dsp-heart {
  fill: #a5384f;
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
/* Two-line result rows: name + origin on top, description below. */
.dsp-result-row {
  display: flex;
  align-items: flex-start;
  border-radius: 6px;
}
.dsp-result-row:hover {
  background: var(--accent-weak);
}
.dsp-result-row.unsupported {
  background: var(--warn-bg);
  color: var(--warn-ink);
}
.dsp-result-row.unsupported:hover {
  background: #fbcdaa;
}
.dsp-result-row .dsp-star {
  margin-top: 5px;
}
.dsp-result {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 6px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.dsp-result input {
  margin-top: 3px;
}
.dsp-result-main {
  flex: 1;
  min-width: 0;
}
.dsp-result-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.dsp-result-label {
  font-weight: 600;
  font-size: 13px;
}
.dsp-result-desc {
  display: block;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.dsp-result-row.unsupported .dsp-result-desc {
  color: #9a5a37;
}
.dsp-localnote {
  font-size: 12px;
  color: var(--muted);
  background: #f5f6f8;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0 0 10px;
}
.dsp-localnote a {
  color: var(--accent);
  font-weight: 600;
}
.dsp-back {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
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
