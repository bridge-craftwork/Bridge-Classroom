<template>
  <!-- A view-tier scene: the REAL table components composed from a frozen
       fixture, so the whole surface can be reviewed across viewports. Not the
       production shell (no header controls / deal source) — a faithful scene of
       the table region + rail + context panel. Harness-only. -->
  <div class="scene">
    <div class="scene-table">
      <div class="scene-head">
        <span class="tag">Board {{ f.board ?? 1 }}</span>
        <StatusStrip v-if="statusSlot === 'status-strip'" :status="status" />
      </div>
      <BridgeTable
        :hands="f.hands"
        :hidden-seats="f.hiddenSeats || []"
        :show-hcp="true"
        :clickable-seat="f.clickableSeat || null"
        :played-cards="f.playedCards || null"
        :hide-played-cards="phase === 'play'"
      >
        <template v-if="center === 'trick-area' || center === 'review'" #center>
          <TrickArea
            :current-trick="f.currentTrick || []"
            :last-finished-trick="f.lastFinishedTrick || null"
            :tricks-taken="f.tricksTaken || { NS: 0, EW: 0 }"
            :next-seat="f.nextSeat || null"
            bot-name="Bot"
          />
        </template>
      </BridgeTable>
    </div>

    <aside class="scene-rail">
      <div class="rail-card">
        <h3>Auction</h3>
        <AuctionTable
          :bids="f.bids || []"
          :dealer="f.dealer || 'N'"
          :current-bid-index="(f.bids || []).length"
          :show-turn-indicator="phase === 'bidding'"
          :meanings="f.meanings || []"
          :wrong-bid-indices="f.wrongBidIndices || []"
          :diverged-bids="f.divergedBids || {}"
          :allow-divergence-toggle="!!f.allowDivergenceToggle"
        />
      </div>

      <div v-if="action === 'bidding-box'" class="rail-card">
        <h3>Your bid</h3>
        <BiddingBox :last-bid="f.lastBid || null" :can-double="!!f.canDouble" :can-redouble="!!f.canRedouble" />
      </div>
      <div v-else-if="phase === 'play'" class="rail-card">
        <h3>Play</h3>
        <div class="rail-line">Tricks <strong>NS {{ f.tricksTaken?.NS ?? 0 }} · EW {{ f.tricksTaken?.EW ?? 0 }}</strong></div>
        <div v-if="f.clickableSeat" class="rail-line rail-turn">Your turn — play a card.</div>
      </div>

      <ContextPanel
        v-if="contextSlot === 'context-panel'"
        :mode="f.context.mode || 'commentary'"
        :title="f.context.title || null"
        :text="f.context.text || ''"
        :messages="f.context.messages || []"
        :stat="f.context.stat || null"
        :actions="f.context.actions || []"
      />
    </aside>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import ContextPanel from '../components/ContextPanel.vue'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'

const props = defineProps({ fixture: { type: Object, required: true } })
const f = computed(() => props.fixture)

const phase = computed(() => f.value.phase || 'bidding')

// Phase-aware status via the real derivation (Phase 0.4): the scene head is a
// StatusStrip fed by useTableStatus, not ad-hoc pills.
const { status } = useTableStatus({
  phase,
  dealer: computed(() => f.value.dealer),
  vulnerable: computed(() => f.value.vulnerable),
  contract: computed(() => (f.value.contract ? { text: f.value.contract, declarer: f.value.declarer } : null)),
  tricks: computed(() => f.value.tricksTaken || { NS: 0, EW: 0 }),
})

// Drive all four slots through the REAL derivation, so the scene exercises the
// same swap contract the shells do.
const wantsCall = computed(() => phase.value === 'bidding' && f.value.clickableSeat === (f.value.seat || 'S'))
const hasCardplay = computed(() => phase.value === 'play' || phase.value === 'review')
const hasContext = computed(() => !!f.value.context)
const slots = useTableSlots({ phase, wantsCall, hasCardplay, hasContext })
const center = slots.center
const action = slots.action
const statusSlot = slots.status
const contextSlot = slots.context
</script>

<style scoped>
/* Wide landscape: table left, rail right. Squarish / portrait: stacks — this is
   the responsive behavior the view-tier gallery is here to expose. */
.scene {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 20px;
  align-items: start;
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.scene-table { min-width: 0; }
.scene-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.tag {
  font-size: 12px;
  font-weight: 600;
  color: #4a5550;
  background: #eef1ee;
  border-radius: 999px;
  padding: 3px 11px;
}
.scene-head :deep(.status-strip) { flex: 1; }
.scene-rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rail-card {
  background: #fff;
  border: 1px solid #e6e8e3;
  border-radius: 12px;
  padding: 14px 16px;
}
.rail-card h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #33403a;
  text-transform: uppercase;
}
.rail-line { font-size: 14px; color: #333; margin-top: 4px; }
.rail-turn { color: #1d6a4f; font-weight: 600; }

@media (max-width: 860px) {
  .scene { grid-template-columns: 1fr; }
  .scene-rail { flex-direction: row; flex-wrap: wrap; }
  .scene-rail .rail-card { flex: 1 1 260px; }
}
@media (max-width: 480px) {
  .scene { padding: 12px; gap: 14px; }
  .scene-rail { flex-direction: column; }
}
</style>
