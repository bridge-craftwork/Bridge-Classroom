<template>
  <!-- B1 (Practice Table — local / solo) faithful composition. Renders the REAL
       B1 layout from a frozen fixture: the same grid arranger B1 uses
       (BridgeTable arrangement='grid' + table.tableConfig.js) with all four seats
       named as live occupants, plus the shell around it (nav, scenario bar, right
       rail) reproduces B1's shell so the whole surface can be compared to A1/B2/B3.

       SHELL FIDELITY (2026-07-29 audit). The grid is real — real components, real
       config, real arranger — but everything OUTSIDE it is hand-copied from
       BiddingPracticeView and therefore drifts silently. The audit found the whole
       review block and the deal-controls row missing, which is why the gallery
       under-reported exactly the controls we're planning to relocate. Two rules to
       keep it honest from here:
         1. Relocation candidates render through the SHARED component the live view
            uses (DealControls, DealSourceButton) — not a copy. A move then lands in
            both places at once.
         2. Anything knowingly NOT modelled is named here rather than left silent.
            Currently excluded: the modal overlays (deal-source picker, Table
            settings, scenario chat) and the dev beetle. Modals cover the layout, so
            rendering them in a layout gallery hides the thing under review; they
            want their own scenes if they ever need layout work. -->
  <div class="b1-app">
    <nav class="b1-nav">
      <span class="b1-logo"><span class="suit">&spades;</span> Bridge Classroom &middot; Bidding Practice</span>
      <span class="b1-user">{{ heroInitials }}</span>
    </nav>

    <!-- Error box — above the scenario bar in the live #notes slot. -->
    <div v-if="f.dealError" class="b1-error-box">
      {{ f.dealError }}
      <div v-if="f.dealErrorHint" class="b1-error-hint">{{ f.dealErrorHint }}</div>
    </div>

    <ScenarioBar :name="f.scenario || 'Practice deal'" :meta="metaLines">
      <template #actions>
        <DealSourceButton :attention="!f.hands" />
        <button class="b1-btn" type="button">Invite friends&hellip;</button>
        <button class="b1-btn" type="button">Description</button>
        <span class="b1-actions-spacer"></span>
        <button class="b1-btn" type="button">&#9881; Table settings</button>
      </template>
    </ScenarioBar>

    <div class="b1-table-wrap" :class="{ 'b1-table-wrap--stacked': railStacked }">
      <div class="b1-frame">
        <!-- Review banner — the "you gave away N tricks" strip above the table. -->
        <div v-if="f.inspect" class="b1-review-banner">
          {{ f.inspect.label }}
          <span v-if="f.inspect.cost > 0" class="b1-review-bad">gave away {{ f.inspect.cost }} trick<span v-if="f.inspect.cost > 1">s</span></span>
        </div>

        <BridgeTable
          arrangement="grid"
          :table-config="tableConfig"
          :region-reserves="regionReserves"
          :phase="arrangerPhase"
          :hero-seat="f.seat || 'S'"
          :hands="f.hands"
          :hidden-seats="f.hiddenSeats || []"
          :occupants="f.occupants || {}"
          :show-hcp="true"
          :show-total-points="true"
          :played-cards="f.playedCards || null"
          :hide-played-cards="phase === 'play'"
        >
          <!-- CENTER: live auction (bidding) / trick (play + review). -->
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

          <!-- NW: board · dealer · vul glyph (+ StatusStrip once out of bidding).
               This is the corner the deal controls are moving INTO — the reserve is
               currently the board glyph's extent alone (STATUS_RESERVE). -->
          <template #nw>
            <div class="b1-nw">
              <BoardIndicator
                :board-number="f.board ?? 1"
                :dealer="f.dealer || null"
                :vulnerable="f.vulnerable || null"
                :size="A1_BOARD_SIZE"
              />
              <StatusStrip v-if="phase !== 'bidding'" :status="status" :show-vul="false" />
              <DealControls
                can-restart
                can-next
                :show-restart-cardplay="cardplayCompleted"
                can-restart-cardplay
              />
            </div>
          </template>

          <!-- NE: completed auction pinned through play AND review (matching the
               live view's `trick-area || review` gate — the scene previously pinned
               it in play only, so review lost the reference auction). -->
          <template v-if="pinnedAuction" #ne>
            <AuctionTable v-bind="auctionProps" :show-turn-indicator="false" />
          </template>

          <!-- SE — the action corner: bidding box + Undo, Undo/Claim during play,
               the double-dummy table at review (2026-07-29 relocation). -->
          <template v-if="seSlot" #se>
            <div class="b1-se-stack">
              <BiddingBox
                v-if="seSlot === 'bidding'"
                :last-bid="f.lastBid || null"
                :can-double="!!f.canDouble"
                :can-redouble="!!f.canRedouble"
              />
              <DoubleDummyTable
                v-else-if="seSlot === 'double-dummy'"
                compact
                :ddtricks="f.ddtricks"
                :final-contract="{ contract: f.contract, declarer: f.declarer }"
                :diverged="!!f.divergence"
              />
              <ActionCluster
                v-if="seSlot !== 'double-dummy'"
                can-undo
                :show-claim="seSlot === 'cardplay'"
                can-claim
                :bot-status="seSlot === 'cardplay' && f.lineNote ? '↝ ' + f.lineNote : null"
              />
            </div>
          </template>
        </BridgeTable>
      </div>

      <!-- Right rail: cardplay controls in play, the contract/result block in
           review; empty in bidding (the auction + box live in the grid). -->
      <aside v-if="phase !== 'bidding'" class="b1-rail" :class="{ 'b1-rail--stacked': railStacked }">
        <RailCard v-if="phase === 'play'" title="Cardplay">
          <div class="b1-rail-note">Tricks <strong>NS&nbsp;{{ tricks.NS }} · EW&nbsp;{{ tricks.EW }}</strong></div>
          <div v-if="f.lineNote" class="b1-line-note">↝ {{ f.lineNote }}</div>
          <div v-if="f.botStats" class="b1-stats">
            Bot: {{ f.botStats.count }} calls · avg {{ fmtMs(f.botStats.mean) }} · max {{ fmtMs(f.botStats.max) }}
          </div>
          <!-- (Claim moved to the SE action cluster; Restart cardplay to NW.) -->
        </RailCard>

        <!-- Review: contract + result + DD + the deal-level actions. -->
        <RailCard v-if="phase === 'review'">
          <div class="b1-contract-line">{{ f.contract }} by {{ seatName(f.declarer) }}</div>
          <div class="b1-contract-meta">{{ f.summary }}</div>
          <div v-if="f.result" class="b1-result">
            You took <strong>{{ f.result.took }}</strong> trick{{ f.result.took === 1 ? '' : 's' }}
            <span v-if="f.result.needed != null">
              · needed {{ f.result.needed }} to make
              <span :class="f.result.made ? 'b1-made' : 'b1-down'">— {{ f.result.made ? 'made' : 'down ' + (f.result.needed - f.result.took) }}</span>
            </span>
          </div>
          <div v-if="f.lineNote" class="b1-line-note">↝ {{ f.lineNote }}</div>
          <div v-if="f.botStats" class="b1-stats">
            Bot: {{ f.botStats.count }} calls · avg {{ fmtMs(f.botStats.mean) }} ·
            max {{ fmtMs(f.botStats.max) }} · total {{ fmtMs(f.botStats.total) }}
          </div>
          <!-- (Double dummy moved to the SE grid corner at review.) -->
          <!-- (Next deal / Replay removed 2026-07-29 — NW carries both now.) -->
        </RailCard>
      </aside>
    </div>

    <footer class="b1-footer">
      <span>Bridge Classroom · Free educational tool · Provided as-is</span>
      <span class="b1-footer-links">Discord · GitHub</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
import DoubleDummyTable from '../components/DoubleDummyTable.vue'
import DealControls from '../components/table/DealControls.vue'
import DealSourceButton from '../components/table/DealSourceButton.vue'
import ScenarioBar from '../components/table/ScenarioBar.vue'
import RailCard from '../components/table/RailCard.vue'
import ActionCluster from '../components/table/ActionCluster.vue'
import { dealControlsReservePx, actionClusterReservePx, doubleDummyReservePx } from '../components/table/clusterMetrics.js'
import { biddingBoxReservePx } from '../components/biddingBoxMetrics.js'
import { boardIndicatorExtentPx } from '../components/boardIndicatorMetrics.js'
import { A1_BOARD_SIZE } from '../components/boardIndicatorMetrics.js'
import { useTableStatus } from '../composables/engines/useTableStatus.js'
import { useTableSlots } from '../composables/engines/tableSlots.js'
import tableConfig from '../table-configs/table.tableConfig.js'
import { matchShell, isStacked, DEFAULT_SHELL } from '../utils/shellLayout.js'

const props = defineProps({ fixture: { type: Object, required: true } })

// The scene resolves its companion placement through the SAME matcher TableShell
// uses, against the same config — so the gallery can't tell you the rail sits beside
// the table when production has already stacked it. (Hand-rolled scene chrome
// drifting from production is exactly what the 2026-07-29 bug report caught.)
const vw = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const vh = ref(typeof window === 'undefined' ? 900 : window.innerHeight)
function onShellResize() { vw.value = window.innerWidth; vh.value = window.innerHeight }
onMounted(() => window.addEventListener('resize', onShellResize, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('resize', onShellResize))
const railStacked = computed(
  () => isStacked(matchShell(tableConfig.shell, { w: vw.value, h: vh.value }) || DEFAULT_SHELL),
)

const f = computed(() => props.fixture)
const phase = computed(() => f.value.phase || 'bidding')

// Pass the engine phase THROUGH, 'review' included. Tempting to map review→'play'
// (production does), but the arranger already knows 'review': `shrinkWrapRows`
// collapses its rows to content while deliberately NOT giving it the bottom-pack
// corner margins and growth reserve that play gets. Mapping it to 'play' would take
// those on for no reason — and measurably changes nothing about the row gaps, which
// come from the top row being sized by the NE auction, not from row-sizing mode.
const arrangerPhase = computed(() => phase.value)

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

// Pinned through play AND review — matches the live view's gate. (Was play-only,
// which silently dropped the reference auction from every review scene.)
const pinnedAuction = computed(
  () => (phase.value === 'play' || phase.value === 'review') && (f.value.bids || []).length > 0,
)
const auctionProps = computed(() => ({
  bids: f.value.bids || [],
  dealer: f.value.dealer || 'N',
  currentBidIndex: (f.value.bids || []).length,
  meanings: f.value.meanings || [],
  divergedBids: f.value.divergedBids || [],
}))

// SE corner content + the reserves the shell owes the arranger — mirrors the live
// view's `seSlot` / `localRegionReserves` so the gallery provisions the corner the
// same way production does.
// Production gates Restart-cardplay on `cardplayPhase === 'complete'`, not on the
// phase being review: a BIDDING-ONLY deal reaches review having never played, and
// must not offer to replay a cardplay that never happened. A fixture signals it by
// carrying trick data.
const cardplayCompleted = computed(
  () => phase.value === 'review' && !!(f.value.tricksTaken?.NS || f.value.tricksTaken?.EW),
)
const seSlot = computed(() => {
  if (phase.value === 'bidding') return 'bidding'
  if (phase.value === 'play') return 'cardplay'
  return f.value.ddtricks ? 'double-dummy' : null
})
const regionReserves = computed(() => {
  const nw = Math.max(
    Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE)),
    dealControlsReservePx({ showRestartCardplay: phase.value === 'review' }),
  )
  let se = 0
  if (seSlot.value === 'bidding') se = Math.max(biddingBoxReservePx(), actionClusterReservePx({ showUndo: true }))
  else if (seSlot.value === 'cardplay') se = actionClusterReservePx({ showUndo: true, showClaim: true })
  else if (seSlot.value === 'double-dummy') se = doubleDummyReservePx()
  return se > 0 ? { nw, se } : { nw }
})

const metaLines = computed(() => [`CC · NS: ${f.value.systemNS || 'Basic-Bridge'} · EW: ${f.value.systemEW || 'Basic-Bridge'}`])

const tricks = computed(() => f.value.tricksTaken || { NS: 0, EW: 0 })
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }
const seatName = (s) => SEAT_NAMES[s] || s
const fmtMs = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

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
  display: flex;
  flex-direction: column;
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
.b1-error-box {
  margin: 16px 16px 0; padding: 10px 14px; border-radius: 10px;
  background: #fdecea; border: 1px solid #f5c6c2; color: #8a2018; font-size: 13px;
}
.b1-error-hint { margin-top: 4px; font-size: 12px; color: #a4544c; }
.b1-actions-spacer { flex: 1 1 auto; }
.b1-btn {
  font: 600 13px 'DM Sans', system-ui, sans-serif; padding: 7px 12px;
  border: 1px solid #cfd6ce; border-radius: 8px; background: #f7f9f6; color: #33403a; cursor: default; white-space: nowrap;
}
.b1-btn-primary { background: #1D9E75; border-color: #1D9E75; color: #fff; }
.b1-table-wrap {
  display: flex; gap: 16px; align-items: flex-start; margin: 0 16px 16px;
}
.b1-frame {
  flex: 1 1 auto; min-width: 0;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 14px; padding: 8px;
}
.b1-review-banner {
  margin: 0 0 8px; padding: 6px 10px; border-radius: 8px;
  background: #f2f6f3; font-size: 12px; color: #445;
}
.b1-review-bad { color: #d32f2f; font-weight: 600; margin-left: 6px; }
.b1-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.b1-se-stack { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.b1-rail { flex: 0 0 300px; display: flex; flex-direction: column; gap: 12px; }
.b1-rail-note { font-size: 12px; color: #6a726c; }
.b1-contract-line { font-weight: 700; font-size: 15px; }
.b1-contract-meta { font-size: 12px; color: #6a726c; margin-top: 2px; }
.b1-result { font-size: 13px; margin-top: 8px; }
.b1-made { color: #1D9E75; font-weight: 600; }
.b1-down { color: #d32f2f; font-weight: 600; }
.b1-line-note { font-size: 12px; color: #55605a; margin-top: 6px; font-style: italic; }
.b1-stats { font-size: 11px; color: #8a938d; margin-top: 6px; }
.b1-rail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.b1-footer {
  margin-top: auto; display: flex; justify-content: space-between;
  padding: 14px 20px; border-top: 1px solid #e6e8e3;
  font-size: 12px; color: #8a938d;
}
.b1-footer-links { color: #6a726c; }
/* Stacked (portrait / narrow): companion goes UNDER the table, full width, and its
   cards flow in a row rather than a single tall column. These MUST come after the
   base .b1-table-wrap / .b1-rail rules — same specificity, so source order decides, and
   declaring them earlier is why the first attempt silently kept the column form.
   `align-items: stretch` on the wrap is load-bearing too: the base rule is
   flex-start, which in a COLUMN direction sizes the frame to its content and
   collapsed the table into a narrow strip. */
.b1-table-wrap--stacked { flex-direction: column; align-items: stretch; }
.b1-rail--stacked {
  flex: 1 1 auto;
  width: 100%;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
}
.b1-rail--stacked > * { flex: 1 1 260px; }
</style>
