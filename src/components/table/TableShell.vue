<template>
  <!-- Shared table-view frame for the solo (/bidding-practice) and host
       (/tables/host) surfaces. Owns ONLY the frame (page wrapper, header row,
       2-column table+rail layout); each surface supplies its own content via
       slots, so they look the same everywhere except where they functionally
       differ. See documentation/design/table-view-unification-plan.md.

       Slots:
         header-left  — title + tags + status
         header-right — action buttons + connection state
         notes        — a full-width strip under the header (kibitz/paused/scenario)
         table        — the BridgeTable / SeatControlTable
         rail         — the companion column: rail cards, and (soon) chat
         overlays     — modals / toasts / diagnostics (position:fixed; DOM order n/a)

       WHERE the rail goes is config-driven, not CSS-driven (2026-07-29). The shell
       resolves `tableConfig.shell.perViewport` for the live viewport and lays itself
       out from the result — beside the table, or stacked under it on portrait and
       narrow frames. It used to hardcode `@media (max-width: 800px)` while the config
       said stack at <=999px, so every viewport in the 801-999 band — iPad portrait is
       820 wide — kept a two-column layout the config had already ruled out. Policy is
       data now; a surface changes its breakpoints in its config.

       The content-primitive classes (.tv-card/.tv-btn/… today) are styled by the
       PARENT that fills the slots, because slotted content compiles in the
       parent's scope — this component only styles its own frame. -->
  <div class="ts-page" :class="{ 'ts-embedded': embedded }">
    <div
      v-if="!embedded && ($slots['header-left'] || $slots['header-right'])"
      class="ts-header"
    >
      <div class="ts-header-left"><slot name="header-left" /></div>
      <div class="ts-header-right"><slot name="header-right" /></div>
    </div>

    <slot name="notes" />

    <div
      class="ts-main"
      :class="{ 'ts-main--no-rail': !$slots.rail, 'ts-main--stacked': stacked, 'ts-main--companion-first': companionFirst }"
    >
      <div class="ts-table-wrap"><slot name="table" /></div>
      <div v-if="$slots.rail" class="ts-rail" :class="{ 'ts-rail--stacked': stacked }"><slot name="rail" /></div>
    </div>

    <slot name="overlays" />
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { matchShell, isStacked, DEFAULT_SHELL } from '../../utils/shellLayout.js'

const props = defineProps({
  // Chromeless mode for the embedded (iframe ?pbn) bidding widget — drops the
  // header so the widget is just the table + rail in a narrow frame.
  embedded: { type: Boolean, default: false },
  // The surface's tableConfig. Only `shell.perViewport` is read here — the rest is
  // the arranger's. Omitted (tests, any legacy caller) falls back to the two-column
  // default, so this is additive.
  tableConfig: { type: Object, default: null },
})

// The shell is the one part of the table stack ALLOWED to read the viewport — that
// boundary is what keeps the arranger's sizing one-directional. Window dims, not a
// container query: the policy is written in viewport terms ("portrait", ">=1000px"),
// and an element query would answer a different question.
const vw = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const vh = ref(typeof window === 'undefined' ? 900 : window.innerHeight)
function onResize() { vw.value = window.innerWidth; vh.value = window.innerHeight }
onMounted(() => window.addEventListener('resize', onResize, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const resolved = computed(
  () => matchShell(props.tableConfig?.shell, { w: vw.value, h: vh.value }) || DEFAULT_SHELL,
)
// The embedded widget is always a single narrow column, whatever the page rule says.
const stacked = computed(() => props.embedded || isStacked(resolved.value))
const companionFirst = computed(
  () => resolved.value.companion === 'above' || resolved.value.companion === 'left',
)
</script>

<style scoped>
.ts-page {
  /* width:100% is load-bearing: without it, `margin: 0 auto` (auto cross-margins)
     overrides `align-items: stretch` in the solo flex-column stage, so ts-page
     shrinks to its WIDEST CHILD (the header row) instead of filling the frame —
     which starves the arranger's table column (2026-07-15 collapse). */
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.ts-embedded { padding: 0; }

.ts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ts-header-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ts-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.ts-main {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(240px, 1fr);
  gap: 16px;
  align-items: start;
}
.ts-table-wrap {
  position: relative;
  background: #fbfbf8;
  border: 1px solid #e5e5e0;
  border-radius: 10px;
}
.ts-rail { display: flex; flex-direction: column; gap: 12px; }

/* Solo has no rail (auction/DD/result live in the grid) → single column. */
.ts-main--no-rail { grid-template-columns: minmax(0, 1fr); }

/* Stacked: one column, companion under (or over) the table. Driven by the resolved
   config rule — NOT a media query, which is exactly what drifted from the config. */
.ts-main--stacked { grid-template-columns: minmax(0, 1fr); }
.ts-main--companion-first .ts-rail { order: -1; }

/* Stacked, the companion goes WIDE rather than tall: a column of narrow cards that
   suddenly spans the full width would be a stack of near-empty boxes. It is also the
   shape chat wants when it lands here — a strip under the table, not a column. */
.ts-rail--stacked {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
}
.ts-rail--stacked > * { flex: 1 1 260px; }
</style>
