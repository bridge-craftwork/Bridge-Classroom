<template>
  <!-- B1 (Practice Table — local / solo) faithful composition. Renders the REAL
       B1 layout from a frozen fixture: the same grid arranger B1 uses
       (BridgeTable arrangement='grid' + table.tableConfig.js) with all four seats
       named (seatChips:'always' + occupants) — the seat-semantics divergence from
       A1 (which shows only the deal's hero/dummy). Chrome (nav + scenario bar +
       rail) reproduces B1's shell so the whole surface can be compared to A1/B2/B3.
       Harness-only; no engine/BBA (that stalls locally) — the fixture is the state. -->
  <div class="b1-app">
    <nav class="b1-nav">
      <span class="b1-logo"><span class="suit">&spades;</span> Bridge Classroom &middot; Bidding Practice</span>
      <span class="b1-user">{{ heroInitials }}</span>
    </nav>

    <div class="b1-scenario-bar">
      <div class="b1-scenario-info">
        <div class="b1-scenario-name">{{ f.scenario || 'Practice deal' }}</div>
        <div class="b1-scenario-meta">CC &middot; NS: {{ f.systemNS || 'Basic-Bridge' }} &middot; EW: {{ f.systemEW || 'Basic-Bridge' }}</div>
      </div>
      <div class="b1-scenario-actions">
        <button class="b1-btn" type="button">Deal source&hellip;</button>
        <button class="b1-btn" type="button">Invite friends&hellip;</button>
        <button class="b1-btn" type="button">Description</button>
        <button class="b1-btn" type="button">&#9881; Table settings</button>
      </div>
    </div>

    <div class="b1-table-wrap">
      <div class="b1-frame">
        <BridgeTable
          arrangement="grid"
          :table-config="tableConfig"
          :phase="phase"
          :hero-seat="f.seat || 'S'"
          :hands="f.hands"
          :hidden-seats="f.hiddenSeats || []"
          :occupants="f.occupants || {}"
          :show-hcp="true"
          :show-total-points="true"
          :played-cards="f.playedCards || null"
          :hide-played-cards="phase === 'play'"
        >
          <!-- CENTER: live auction (bidding) / trick (play) — via slots.center. -->
          <template v-if="center === 'auction'" #center>
            <AuctionTable v-bind="auctionProps" :show-turn-indicator="true" />
          </template>
          <template v-else-if="center === 'trick-area'" #center>
            <TrickArea
              :current-trick="f.currentTrick || { plays: [] }"
              :last-finished-trick="f.lastFinishedTrick || null"
              :tricks-taken="f.tricksTaken || { NS: 0, EW: 0 }"
              :next-seat="f.nextSeat || null"
              bot-name="Bot"
            />
          </template>

          <!-- NW: board · dealer · vul glyph (+ StatusStrip in play). -->
          <template #nw>
            <div class="b1-nw">
              <BoardIndicator
                :board-number="f.board ?? 1"
                :dealer="f.dealer || null"
                :vulnerable="f.vulnerable || null"
                :size="A1_BOARD_SIZE"
              />
              <StatusStrip v-if="phase !== 'bidding'" :status="status" :show-vul="false" />
            </div>
          </template>

          <!-- NE: completed auction pinned during play. -->
          <template v-if="pinnedAuction" #ne>
            <AuctionTable v-bind="auctionProps" :show-turn-indicator="false" />
          </template>

          <!-- SE: bidding box for the whole auction (dropped in play). -->
          <template v-if="action === 'bidding-box'" #se>
            <BiddingBox :last-bid="f.lastBid || null" :can-double="!!f.canDouble" :can-redouble="!!f.canRedouble" />
          </template>
        </BridgeTable>
      </div>

      <!-- Right rail: cardplay controls in play; empty in bidding (matches B1,
           where the auction + box live in the grid and the rail is bare). -->
      <aside v-if="phase !== 'bidding'" class="b1-rail">
        <div class="b1-rail-card">
          <h3>Cardplay</h3>
          <div class="b1-rail-note">Tricks NS&nbsp;{{ (f.tricksTaken || {}).NS ?? 0 }} · EW&nbsp;{{ (f.tricksTaken || {}).EW ?? 0 }}</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
import { A1_BOARD_SIZE } from '../components/boardIndicatorMetrics.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import tableConfig from '../table-configs/table.tableConfig.js'

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
const slots = useTableSlots({ phase, wantsCall, hasCardplay, hasContext: computed(() => false) })
const action = slots.action
const center = slots.center

const pinnedAuction = computed(() => phase.value === 'play' && (f.value.bids || []).length > 0)
const auctionProps = computed(() => ({
  bids: f.value.bids || [],
  dealer: f.value.dealer || 'N',
  currentBidIndex: (f.value.bids || []).length,
  meanings: f.value.meanings || [],
}))

const heroInitials = computed(() => {
  const name = (f.value.occupants?.[f.value.seat || 'S']?.name) || f.value.heroName || 'You'
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
})
</script>

<style scoped>
.b1-app {
  min-height: 100%;
  background: #f5f5f3;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #1a2420;
}
.b1-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px; background: #fff; border-bottom: 1px solid #e6e8e3;
}
.b1-logo { font-weight: 600; font-size: 15px; }
.b1-logo .suit { color: #1D9E75; margin-right: 4px; }
.b1-user {
  width: 34px; height: 34px; border-radius: 50%; background: #1f6a4f; color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
}
.b1-scenario-bar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  margin: 16px; padding: 12px 16px; background: #fff; border: 1px solid #e6e8e3; border-radius: 12px;
}
.b1-scenario-name { font-weight: 600; font-size: 15px; }
.b1-scenario-meta { font-size: 12px; color: #6a726c; margin-top: 2px; }
.b1-scenario-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.b1-btn {
  font: 600 13px 'DM Sans', system-ui, sans-serif; padding: 7px 12px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: default; white-space: nowrap;
}
.b1-table-wrap {
  display: flex; gap: 16px; align-items: flex-start; margin: 0 16px 16px;
}
.b1-frame {
  flex: 1 1 auto; min-width: 0;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 14px; padding: 8px;
}
.b1-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.b1-rail { flex: 0 0 300px; }
.b1-rail-card { background: #fff; border: 1px solid #e6e8e3; border-radius: 12px; padding: 12px 14px; }
.b1-rail-card h3 { margin: 0 0 6px; font-size: 13px; }
.b1-rail-note { font-size: 12px; color: #6a726c; }
</style>
