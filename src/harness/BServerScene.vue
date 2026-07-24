<template>
  <!-- B2 (host) / B3 (player) faithful composition — the SERVER practice table.
       Same grid arranger as B1, but through the REAL SeatControlTable (BridgeTable
       + draggable occupant chips / seat management) with show-hcp OFF (you don't
       see others' points on a shared table). That BridgeTable→SeatControlTable swap
       is B1's real divergence from B2/B3. Chrome differs by role: b2 = host strip
       (deal source / invite link / test players / end), b3 = player bar (leave +
       identity). Harness-only; no socket/engine — the fixture is the frozen state. -->
  <div class="bsrv-app">
    <!-- ── HOST chrome (b2) ─────────────────────────────────────────────── -->
    <template v-if="role === 'host'">
      <nav class="bsrv-nav">
        <span class="bsrv-logo"><span class="suit">&spades;</span> Bridge Classroom &middot; Host a Table</span>
        <span class="bsrv-conn">connected</span>
        <span class="bsrv-user">{{ heroInitials }}</span>
      </nav>
      <div class="bsrv-hoststrip">
        <button class="bsrv-btn" type="button">Deal source&hellip;</button>
        <div class="bsrv-invite">
          <button class="bsrv-btn bsrv-btn-primary" type="button">Copy invite link</button>
          <input class="bsrv-invite-url" readonly :value="inviteUrl">
        </div>
        <button class="bsrv-btn" type="button">&#129514; Test players</button>
        <button class="bsrv-btn bsrv-btn-danger" type="button">End table</button>
      </div>
    </template>

    <!-- ── PLAYER chrome (b3) ───────────────────────────────────────────── -->
    <nav v-else class="bsrv-nav bsrv-nav-player">
      <button class="bsrv-leave" type="button">&larr; Leave table</button>
      <span class="bsrv-title">{{ f.scenario || "Rick's table" }}</span>
      <span class="bsrv-user">{{ heroInitials }}</span>
    </nav>

    <div class="bsrv-table-wrap">
      <div class="bsrv-frame">
        <SeatControlTable
          arrangement="grid"
          :table-config="tableConfig"
          :phase="phase"
          :hero-seat="f.seat || 'S'"
          :hands="f.hands"
          :hidden-seats="f.hiddenSeats || []"
          :occupants="f.occupants || {}"
          :active-seat="f.nextSeat || null"
          :show-hcp="false"
          :clickable-seat="f.clickableSeat || null"
          :hide-played-cards="phase === 'play'"
          :played-cards="f.playedCards || null"
          :seats="f.seats || {}"
          :your-seats="f.yourSeats || [f.seat || 'S']"
          :my-token="f.myToken || null"
          :can-manage="canManage"
          :roster="f.roster || []"
          :session-id="f.sessionId || null"
        >
          <template #nw>
            <div class="bsrv-nw">
              <BoardIndicator
                :board-number="f.board ?? 1"
                :dealer="f.dealer || null"
                :vulnerable="f.vulnerable || null"
                :size="A1_BOARD_SIZE"
              />
              <StatusStrip v-if="phase !== 'bidding'" :status="status" :show-vul="false" />
            </div>
          </template>

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

          <template v-if="pinnedAuction" #ne>
            <AuctionTable v-bind="auctionProps" :show-turn-indicator="false" />
          </template>

          <template v-if="action === 'bidding-box'" #se>
            <BiddingBox :last-bid="f.lastBid || null" :can-double="!!f.canDouble" :can-redouble="!!f.canRedouble" />
          </template>
        </SeatControlTable>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import SeatControlTable from '../components/table/SeatControlTable.vue'
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
const role = computed(() => (f.value.surface === 'b2' ? 'host' : 'player'))
const canManage = computed(() => f.value.canManage ?? (role.value === 'host'))
const inviteUrl = computed(() => f.value.inviteUrl || 'https://bridge-classroom.org/table/BRG-8F2K')

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
.bsrv-app {
  min-height: 100%;
  background: #f5f5f3;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #1a2420;
}
.bsrv-nav {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 20px; background: #fff; border-bottom: 1px solid #e6e8e3;
}
.bsrv-logo { font-weight: 600; font-size: 15px; }
.bsrv-logo .suit { color: #1D9E75; margin-right: 4px; }
.bsrv-conn {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: #1f6638; background: #d8efdc; padding: 2px 8px; border-radius: 999px;
}
.bsrv-nav .bsrv-user { margin-left: auto; }
.bsrv-user {
  width: 34px; height: 34px; border-radius: 50%; background: #1f6a4f; color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
}
.bsrv-nav-player .bsrv-title { font-weight: 600; font-size: 15px; }
.bsrv-leave {
  font: 600 13px 'DM Sans', system-ui, sans-serif; padding: 6px 12px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: default;
}
.bsrv-hoststrip {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 16px; padding: 12px 16px; background: #fff; border: 1px solid #e6e8e3; border-radius: 12px;
}
.bsrv-invite { display: flex; align-items: center; gap: 8px; }
.bsrv-invite-url {
  font: 12px ui-monospace, Menlo, monospace; padding: 6px 10px; width: 260px;
  border: 1px solid #e0ddd7; border-radius: 8px; color: #55605a; background: #f7f9f6;
}
.bsrv-btn {
  font: 600 13px 'DM Sans', system-ui, sans-serif; padding: 7px 12px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: default; white-space: nowrap;
}
.bsrv-btn-primary { background: #1f6a4f; border-color: #1f6a4f; color: #fff; }
.bsrv-btn-danger { color: #a12; border-color: #e3b8b8; background: #fbeeee; }
.bsrv-table-wrap { display: flex; align-items: flex-start; margin: 0 16px 16px; }
.bsrv-frame {
  flex: 1 1 auto; min-width: 0;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 14px; padding: 8px;
}
.bsrv-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
