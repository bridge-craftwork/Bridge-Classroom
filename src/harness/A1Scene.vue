<template>
  <!-- A1 (Scenario Mastery) TARGET composition, modeled for the gallery before
       MainLayout is retrofitted. Slot map (Rick's, 2026-07-11):
         center → AuctionTable (bidding) / TrickArea (play)
         SE     → BiddingBox (bidding) / Undo·Claim (play)
         NW     → TableInfo: board # + vul + phase-aware StatusStrip
         NE     → the completed auction, pinned full-density (play / review)
         right  → narrative (ContextPanel), floated right on landscape

       NOTE (finding): true table-corner OVERLAYS collide with BridgeTable's
       seats — N/S span full width and E/W sit in the side columns, so an
       absolutely-positioned NE clips North / hides the East dummy. So NW/NE are
       modeled here as a top BAND above the table and SE as a bottom action band;
       whether A1 instead grows real BridgeTable corner slots (a compass layout
       that frees the corners) is the Phase-1 decision these fixtures inform.
       Harness-only. -->
  <div class="a1-scene">
    <div class="a1-frame">
      <div class="a1-band a1-top">
        <div class="a1-nw">
          <div class="a1-board">Board {{ f.board ?? 1 }}</div>
          <StatusStrip :status="status" />
        </div>
        <div v-if="pinnedAuction" class="a1-ne">
          <div class="a1-corner-label">Auction</div>
          <AuctionTable
            :bids="f.bids || []"
            :dealer="f.dealer || 'N'"
            :current-bid-index="(f.bids || []).length"
            :show-turn-indicator="false"
            :meanings="f.meanings || []"
          />
        </div>
      </div>

      <BridgeTable
        :hands="f.hands"
        :hidden-seats="f.hiddenSeats || []"
        :show-hcp="true"
        :clickable-seat="f.clickableSeat || null"
        :active-seat="f.clickableSeat || null"
        :played-cards="f.playedCards || null"
        :hide-played-cards="phase === 'play'"
      >
        <template v-if="center === 'auction'" #center>
          <div class="a1-center-auction">
            <AuctionTable
              :bids="f.bids || []"
              :dealer="f.dealer || 'N'"
              :current-bid-index="(f.bids || []).length"
              :show-turn-indicator="true"
              :meanings="f.meanings || []"
            />
          </div>
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
      </BridgeTable>

      <div v-if="action === 'bidding-box' || phase === 'play'" class="a1-band a1-bottom">
        <div class="a1-se">
          <BiddingBox
            v-if="action === 'bidding-box'"
            :last-bid="f.lastBid || null"
            :can-double="!!f.canDouble"
            :can-redouble="!!f.canRedouble"
          />
          <div v-else class="a1-controls">
            <button class="a1-ctl" type="button">Undo</button>
            <button class="a1-ctl a1-ctl-primary" type="button">Claim</button>
          </div>
        </div>
      </div>
    </div>

    <ContextPanel
      v-if="f.context"
      class="a1-narrative"
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
import { computed } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import ContextPanel from '../components/ContextPanel.vue'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'

const props = defineProps({ fixture: { type: Object, required: true } })
const f = computed(() => props.fixture)
const phase = computed(() => f.value.phase || 'bidding')

// Real derivations — the scene exercises the same status + action + center
// contract the shell will. center now comes straight from useTableSlots (the
// extended discriminant: 'auction' | 'trick-area' | 'review' | null); under the
// grid arrangement the A1 scene renders 'auction' in the center region.
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

const pinnedAuction = computed(() => (phase.value === 'play' || phase.value === 'review') && (f.value.bids || []).length > 0)
</script>

<style scoped>
/* Landscape: table left, narrative floated to the right (as A1 does today).
   Collapses to a single column (narrative below) at the narrow breakpoint. */
.a1-scene {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.a1-frame {
  background: #fff;
  border: 1px solid #e6e8e3;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Top band: NW info (left) + NE pinned auction (right). A band above the table
   rather than a corner overlay, so it never clips North or hides the dummy. */
.a1-band { display: flex; align-items: flex-start; gap: 12px; }
.a1-top { justify-content: space-between; }
.a1-nw { display: flex; flex-direction: column; gap: 6px; max-width: 240px; }
.a1-board {
  font-size: 12px; font-weight: 700; color: #4a5550;
  background: #eef1ee; border-radius: 999px; padding: 3px 11px; align-self: flex-start;
}
.a1-ne {
  background: #f7f9f6; border: 1px solid #e6e8e3; border-radius: 10px; padding: 8px 10px;
}
.a1-corner-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: #6a726c; margin-bottom: 4px;
}
.a1-center-auction { max-width: 260px; }

/* Bottom action band: SE-anchored (right) bidding box / play controls. */
.a1-bottom { justify-content: flex-end; }
.a1-se { display: flex; }
.a1-controls { display: flex; gap: 8px; }
.a1-ctl {
  font: 600 14px 'DM Sans', system-ui, sans-serif; padding: 8px 16px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: pointer;
}
.a1-ctl-primary { background: #1d6a4f; border-color: #1d6a4f; color: #fff; }

.a1-narrative { align-self: stretch; }

/* Narrow: single column (narrative below the table). */
@media (max-width: 720px) {
  .a1-scene { grid-template-columns: 1fr; }
  .a1-top { flex-direction: column; }
  .a1-ne { align-self: stretch; }
}
</style>
