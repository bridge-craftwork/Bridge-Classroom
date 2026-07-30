<template>
  <!-- C1 (Teacher multi-table console) faithful composition. Two views from one
       scene, chosen by the fixture's `view`:

         overview  — the console shell (deal bar / class bar / settings bar) around
                     the REAL MiniTable tile grid + lobby roster. This is the one
                     full-table surface deliberately OUTSIDE the grid arranger:
                     MiniTable draws its own compass diagram rather than composing
                     BridgeTable, so nothing in the A1/B galleries exercised it.

         drilldown — the kibitz panel: the real arranger table (same components as
                     B2/B3) inside console chrome, seen by an UNSEATED teacher.

       Same shell-fidelity rules as the B scenes: relocation candidates render through
       the shared components the live view uses, and anything knowingly not modelled
       is named. Not modelled here: the deal-source picker modal, the per-seat action
       menu (a click-triggered popover over a tile), and the Start-session home state.
       -->
  <div class="c1-app">
    <div class="c1-header">
      <div class="c1-header-left">
        <h2 class="c1-title">Teacher console</h2>
        <span class="c1-conn">{{ f.connectionStatus || 'connected' }}</span>
        <span v-if="f.sessionName" class="c1-session">{{ f.sessionName }}</span>
      </div>
      <div class="c1-header-right">
        <button class="c1-btn c1-btn-danger" type="button">End session</button>
        <button class="c1-btn" type="button">🔗 Copy class link</button>
      </div>
    </div>

    <!-- ── OVERVIEW ──────────────────────────────────────────────────────── -->
    <template v-if="view === 'overview'">
      <!-- Deal source + lockstep board navigation. -->
      <div class="c1-bar">
        <div class="c1-bar-left">
          <strong>{{ deck.label }}</strong>
          <span class="c1-muted">board {{ deck.board }} of {{ deck.total }}</span>
        </div>
        <div class="c1-bar-right">
          <button class="c1-btn c1-btn-sm" type="button">&lsaquo; Prev</button>
          <button class="c1-btn c1-btn-sm" type="button">Next &rsaquo;</button>
          <span class="c1-goto">Go to <input class="c1-num" :value="deck.board" readonly><button class="c1-btn c1-btn-sm" type="button">Go</button></span>
          <button class="c1-btn c1-btn-primary" type="button">Change deal source&hellip;</button>
        </div>
      </div>

      <!-- Class management: waiting room + table count. -->
      <div class="c1-bar">
        <div class="c1-bar-left">
          <label class="c1-check"><input type="checkbox" :checked="f.waitToSeat" disabled> Wait to seat</label>
          <button class="c1-btn c1-btn-primary c1-btn-sm" type="button">Seat students ({{ waiting.length }})</button>
        </div>
        <div class="c1-bar-right">
          <span class="c1-muted">{{ tables.length }} tables</span>
          <span class="c1-goto"><input class="c1-num" value="1" readonly><button class="c1-btn c1-btn-sm" type="button">+ Add tables</button></span>
          <span class="c1-goto"><input class="c1-num" value="4" readonly><button class="c1-btn c1-btn-sm" type="button">🧪 Spawn students</button></span>
        </div>
      </div>

      <!-- Session settings. -->
      <div class="c1-bar">
        <div class="c1-bar-left">
          <label class="c1-setting">Seating <select class="c1-sel" disabled><option>{{ settings.seatPolicy }}</option></select></label>
          <label class="c1-setting">Bots <select class="c1-sel" disabled><option>{{ settings.botMode }}</option></select></label>
        </div>
      </div>

      <!-- The tile grid — REAL MiniTable, so tile density is honest. -->
      <div class="c1-grid">
        <div v-for="t in tables" :key="t.table_id" class="c1-panel">
          <MiniTable :t="t" :name="t.name" :loaded="deck.loaded" />
        </div>

        <!-- Lobby roster sits in the same grid as a tile. -->
        <div class="c1-lobby">
          <div class="c1-lobby-head">
            <span class="c1-lobby-name">Lobby</span>
            <span class="c1-tag">{{ waiting.length + parked.length }}</span>
          </div>
          <template v-if="waiting.length">
            <div class="c1-kib-group">Waiting to seat</div>
            <ul class="c1-kib-list"><li v-for="k in waiting" :key="k.sub">{{ k.name }}</li></ul>
          </template>
          <template v-if="parked.length">
            <div class="c1-kib-group">Parked (won't auto-seat)</div>
            <ul class="c1-kib-list c1-kib-parked">
              <li v-for="k in parked" :key="k.sub">{{ k.name }} <span class="c1-muted">· {{ tableName(k.table_id) }}</span></li>
            </ul>
          </template>
        </div>
      </div>
    </template>

    <!-- ── DRILL-IN (kibitz) ─────────────────────────────────────────────── -->
    <template v-else>
      <div class="c1-kibitz-bar">
        <span class="c1-lobby-name">Watching {{ f.watchingName || 'a table' }}</span>
        <button class="c1-btn c1-btn-sm" type="button">Stop watching</button>
      </div>

      <div class="c1-kibitz-panel">
        <div class="c1-frame">
          <SeatControlTable
            arrangement="grid"
            :table-config="tableConfig"
            :region-reserves="regionReserves"
            :phase="phase"
            :hero-seat="f.seat || 'S'"
            :hands="f.hands"
            :hidden-seats="f.hiddenSeats || []"
            :occupants="f.occupants || {}"
            :active-seat="f.nextSeat || null"
            :show-hcp="false"
            :hide-played-cards="phase === 'play'"
            :seats="f.seats || {}"
            :your-seats="[]"
            :can-manage="false"
          >
            <!-- NW: board status only. An unseated teacher gets NO deal transport,
                 so the corner collapses to the glyph and reserves nothing more. -->
            <template #nw>
              <div class="c1-nw">
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
            <template v-else-if="center === 'trick-area' || center === 'review'" #center>
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

            <!-- SE: nothing in bidding or play (a kibitzer acts on nothing); the
                 double-dummy table at review. The emptiest the action corner gets. -->
            <template v-if="seSlot === 'double-dummy'" #se>
              <DoubleDummyTable
                :ddtricks="f.ddtricks"
                :final-contract="{ contract: f.contract || '', declarer: f.declarer || null }"
              />
            </template>
          </SeatControlTable>
        </div>

        <aside class="c1-rail">
          <div v-if="f.ddtricks && phase !== 'review'" class="c1-card">
            <h3>Double dummy</h3>
            <DoubleDummyTable
              :ddtricks="f.ddtricks"
              :final-contract="{ contract: f.contract || '', declarer: f.declarer || null }"
            />
          </div>
          <div class="c1-card">
            <h3>Play</h3>
            <div class="c1-line">Tricks <strong>NS&nbsp;{{ tricks.NS }} · EW&nbsp;{{ tricks.EW }}</strong></div>
            <div class="c1-line">Waiting for {{ seatName(f.nextSeat) }}&hellip;</div>
          </div>
          <div class="c1-card">
            <h3>Kibitzers</h3>
            <div class="c1-line">{{ (f.kibitzers || []).join(', ') || 'None watching' }}</div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MiniTable from '../components/table/MiniTable.vue'
import SeatControlTable from '../components/table/SeatControlTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import StatusStrip from '../components/StatusStrip.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
import DoubleDummyTable from '../components/DoubleDummyTable.vue'
import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../components/boardIndicatorMetrics.js'
import { doubleDummyReservePx } from '../components/table/clusterMetrics.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import tableConfig from '../table-configs/table.tableConfig.js'

const props = defineProps({ fixture: { type: Object, required: true } })
const f = computed(() => props.fixture)
const view = computed(() => f.value.view || 'overview')

// Overview
const tables = computed(() => f.value.tables || [])
const deck = computed(() => f.value.deck || { loaded: false, label: '', board: 0, total: 0 })
const settings = computed(() => f.value.settings || { seatPolicy: '—', botMode: '—' })
const waiting = computed(() => f.value.waiting || [])
const parked = computed(() => f.value.parked || [])
const tableName = (id) => tables.value.find((t) => t.table_id === id)?.name || id

// Drill-in
const phase = computed(() => f.value.phase || 'bidding')
const { status } = useTableStatus({
  phase,
  dealer: computed(() => f.value.dealer),
  vulnerable: computed(() => f.value.vulnerable),
  contract: computed(() => (f.value.contract ? { text: f.value.contract, declarer: f.value.declarer } : null)),
  tricks: computed(() => f.value.tricksTaken || { NS: 0, EW: 0 }),
})
// A kibitzer is never asked for a call, so the action slot is always null here.
const slots = useTableSlots({
  phase,
  wantsCall: computed(() => false),
  hasCardplay: computed(() => phase.value === 'play' || phase.value === 'review'),
  hasContext: computed(() => false),
})
const center = slots.center
const pinnedAuction = computed(
  () => (phase.value === 'play' || phase.value === 'review') && (f.value.bids || []).length > 0,
)
const auctionProps = computed(() => ({
  bids: f.value.bids || [],
  dealer: f.value.dealer || 'N',
  currentBidIndex: (f.value.bids || []).length,
  divergedBids: f.value.divergedBids || [],
}))
const seSlot = computed(() => (phase.value === 'review' && f.value.ddtricks ? 'double-dummy' : null))
const regionReserves = computed(() => ({
  // No transport for an unseated teacher — the glyph's own extent is the whole ask.
  nw: Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE)),
  ...(seSlot.value === 'double-dummy' ? { se: doubleDummyReservePx() } : {}),
}))
const tricks = computed(() => f.value.tricksTaken || { NS: 0, EW: 0 })
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }
const seatName = (s) => SEAT_NAMES[s] || s
</script>

<style scoped>
.c1-app {
  min-height: 100%;
  background: #f5f5f3;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #1a2420;
  padding-bottom: 24px;
}
.c1-header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 20px; background: #fff; border-bottom: 1px solid #e6e8e3;
}
.c1-header-left { display: flex; align-items: center; gap: 10px; }
.c1-header-right { display: flex; gap: 8px; }
.c1-title { margin: 0; font-size: 17px; }
.c1-conn {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: #eaf4ef; color: #1f6a4f; border: 1px solid #cfe6da;
}
.c1-session { font-size: 12px; color: #6a726c; }
.c1-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin: 12px 16px 0; padding: 10px 14px;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 12px;
}
.c1-bar-left, .c1-bar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.c1-muted { color: #8a938d; font-size: 12px; }
.c1-btn {
  font: 600 13px 'DM Sans', system-ui, sans-serif; padding: 6px 12px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a;
  cursor: default; white-space: nowrap;
}
.c1-btn-sm { font-size: 12px; padding: 4px 9px; }
.c1-btn-primary { background: #1D9E75; border-color: #1D9E75; color: #fff; }
.c1-btn-danger { background: #fdecea; border-color: #f2c3bd; color: #a4291c; }
.c1-check, .c1-setting { font-size: 12px; color: #4a554e; display: inline-flex; align-items: center; gap: 5px; }
.c1-goto { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #6a726c; }
.c1-num { width: 46px; padding: 3px 6px; border: 1px solid #cfd6ce; border-radius: 6px; font-size: 12px; }
.c1-sel { padding: 3px 6px; border: 1px solid #cfd6ce; border-radius: 6px; font-size: 12px; background: #fff; }

/* Tile grid — the bespoke console layout (NOT the grid arranger). */
.c1-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px; margin: 12px 16px 0;
}
.c1-panel, .c1-lobby {
  background: #fff; border: 1px solid #e6e8e3; border-radius: 12px; padding: 10px;
}
.c1-lobby-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.c1-lobby-name { font-weight: 700; font-size: 13px; }
.c1-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eef2ee; color: #4a554e; }
.c1-kib-group { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8a938d; margin-top: 8px; }
.c1-kib-list { margin: 4px 0 0; padding-left: 16px; font-size: 12px; color: #4a554e; }
.c1-kib-parked { color: #8a938d; }

/* Drill-in */
.c1-kibitz-bar {
  display: flex; align-items: center; justify-content: space-between;
  margin: 12px 16px 0; padding: 8px 14px;
  background: #eef2ee; border: 1px solid #e0e6e0; border-radius: 10px;
}
.c1-kibitz-panel { display: flex; gap: 16px; align-items: flex-start; margin: 12px 16px 0; }
.c1-frame {
  flex: 1 1 auto; min-width: 0;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 14px; padding: 8px;
}
.c1-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.c1-rail { flex: 0 0 280px; display: flex; flex-direction: column; gap: 12px; }
.c1-card { background: #fff; border: 1px solid #e6e8e3; border-radius: 12px; padding: 12px 14px; }
.c1-card h3 { margin: 0 0 6px; font-size: 13px; }
.c1-line { font-size: 12px; color: #6a726c; margin-top: 4px; }
</style>
