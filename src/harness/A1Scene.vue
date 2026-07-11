<template>
  <!-- A1 (Scenario Mastery) target composition, now rendered through the REAL
       grid arranger (BridgeTable arrangement='grid' + a1.tableConfig) instead of
       the earlier band mockup. The shell owns the companion (narrative) placement
       per config.shell; BridgeTable owns the 3×3 grid + per-region scale clamp.
       Harness-only; production a1 stays on 'legacy'. -->
  <div class="a1-scene" :style="sceneStyle">
    <div class="a1-frame">
      <BridgeTable
        arrangement="grid"
        :table-config="a1Config"
        :phase="phase"
        :hands="f.hands"
        :hidden-seats="f.hiddenSeats || []"
        :show-hcp="true"
        :clickable-seat="f.clickableSeat || null"
        :played-cards="f.playedCards || null"
        :hide-played-cards="phase === 'play'"
      >
        <!-- center: live auction (bidding) or the trick (play); empty in review -->
        <template v-if="center === 'auction'" #center>
          <div class="a1-center-auction"><AuctionTable v-bind="auctionProps" :show-turn-indicator="true" /></div>
        </template>
        <template v-else-if="center === 'trick-area'" #center>
          <TrickArea
            :current-trick="f.currentTrick || { plays: [] }"
            :last-finished-trick="f.lastFinishedTrick || null"
            :tricks-taken="f.tricksTaken || { NS: 0, EW: 0 }"
            :next-seat="f.nextSeat || null"
            bot-name="Defense"
          />
        </template>

        <!-- NW: table info (board / vul / phase-aware status) -->
        <template #nw>
          <div class="a1-nw">
            <div class="a1-board">Board {{ f.board ?? 1 }}</div>
            <StatusStrip :status="status" />
          </div>
        </template>

        <!-- NE: completed auction pinned (play / review) -->
        <template v-if="pinnedAuction" #ne>
          <div class="a1-ne">
            <div class="a1-corner-label">Auction</div>
            <AuctionTable v-bind="auctionProps" :show-turn-indicator="false" />
          </div>
        </template>

        <!-- SE: bidding box (bidding) / play controls (play) -->
        <template #se>
          <div v-if="action === 'bidding-box'" class="a1-se">
            <BiddingBox :last-bid="f.lastBid || null" :can-double="!!f.canDouble" :can-redouble="!!f.canRedouble" />
          </div>
          <div v-else-if="phase === 'play'" class="a1-se a1-controls">
            <button class="a1-ctl" type="button">Undo</button>
            <button class="a1-ctl a1-ctl-primary" type="button">Claim</button>
          </div>
        </template>
      </BridgeTable>
    </div>

    <ContextPanel
      v-if="f.context"
      class="a1-narrative"
      :style="{ order: narrativeOrder }"
      :mode="f.context.mode || 'commentary'"
      :title="f.context.title || null"
      :text="f.context.text || ''"
      :messages="f.context.messages || []"
      :stat="f.context.stat || null"
      :actions="f.context.actions || []"
    />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import ContextPanel from '../components/ContextPanel.vue'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import a1Config from '../table-configs/a1.tableConfig.js'

const props = defineProps({ fixture: { type: Object, required: true } })
const f = computed(() => props.fixture)
const phase = computed(() => f.value.phase || 'bidding')

const { status } = useTableStatus({
  phase,
  dealer: computed(() => f.value.dealer),
  vulnerable: computed(() => f.value.vulnerable),
  contract: computed(() => (f.value.contract ? { text: f.value.contract, declarer: f.value.declarer } : null)),
  tricks: computed(() => f.value.tricksTaken || { NS: 0, EW: 0 }),
})

const wantsCall = computed(() => phase.value === 'bidding' && f.value.clickableSeat === (f.value.seat || 'S'))
const hasCardplay = computed(() => phase.value === 'play' || phase.value === 'review')
const hasContext = computed(() => !!f.value.context)
const slots = useTableSlots({ phase, wantsCall, hasCardplay, hasContext })
const action = slots.action
const center = slots.center

// Fix 4: the SHELL consumes config.shell.perViewport (it was ignored — a
// hardcoded 720px breakpoint left tablet-portrait two-column). Match by real
// viewport width + portrait, first hit wins; apply two-column/stacked +
// companion side. Plumbing fix, config unchanged.
const winW = ref(1440)
const winH = ref(900)
function readWin() { winW.value = window.innerWidth; winH.value = window.innerHeight }
const shell = computed(() => {
  const portrait = winH.value > winW.value
  const rules = a1Config.shell?.perViewport || []
  return rules.find((r) =>
    (r.minWidth == null || winW.value >= r.minWidth) &&
    (r.maxWidth == null || winW.value <= r.maxWidth) &&
    (r.portrait == null || r.portrait === portrait),
  ) || { mode: 'stacked', companionPosition: 'below' }
})
const sceneStyle = computed(() => {
  if (shell.value.mode !== 'two-column') return { gridTemplateColumns: '1fr' }
  return shell.value.companionPosition === 'left'
    ? { gridTemplateColumns: '320px minmax(0, 1fr)' }
    : { gridTemplateColumns: 'minmax(0, 1fr) 320px' }
})
const narrativeOrder = computed(() => (['left', 'above'].includes(shell.value.companionPosition) ? -1 : 1))
onMounted(() => { readWin(); window.addEventListener('resize', readWin) })
onBeforeUnmount(() => window.removeEventListener('resize', readWin))

const pinnedAuction = computed(() => (phase.value === 'play' || phase.value === 'review') && (f.value.bids || []).length > 0)
const auctionProps = computed(() => ({
  bids: f.value.bids || [],
  dealer: f.value.dealer || 'N',
  currentBidIndex: (f.value.bids || []).length,
  meanings: f.value.meanings || [],
}))
</script>

<style scoped>
/* Shell layout is driven by config.shell.perViewport (grid-template-columns +
   narrative order come from `sceneStyle`/`narrativeOrder`, not a media query). */
.a1-scene {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  gap: 16px;
  align-items: start;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.a1-frame {
  background: #fff;
  border: 1px solid #e6e8e3;
  border-radius: 14px;
  /* The frame does NOT tie its height to the viewport — that was the slack bug
     (viewport-height frame → 1fr slack ballooned to the whole screen). The grid
     shrink-wraps to its content + the bidding growth reserve; the shell (this
     scene) owns placement, top-weighting the block via .a1-scene align-items. */
}
.a1-nw { display: flex; flex-direction: column; gap: 6px; }
.a1-board {
  font-size: 12px; font-weight: 700; color: #4a5550;
  background: #eef1ee; border-radius: 999px; padding: 3px 11px; align-self: flex-start;
}
.a1-ne { background: #f7f9f6; border: 1px solid #e6e8e3; border-radius: 10px; padding: 8px 10px; }
.a1-corner-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: #6a726c; margin-bottom: 4px;
}
.a1-center-auction { max-width: 260px; }
.a1-se { display: flex; }
.a1-controls { display: flex; gap: 8px; }
.a1-ctl {
  font: 600 14px 'DM Sans', system-ui, sans-serif; padding: 8px 16px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: pointer;
}
.a1-ctl-primary { background: #1d6a4f; border-color: #1d6a4f; color: #fff; }
.a1-narrative { align-self: stretch; }
</style>
