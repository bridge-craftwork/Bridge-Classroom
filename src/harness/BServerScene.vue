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
      <!-- Row 1 — SESSION chrome, owned by TableView (.th-controls), outside the
           TableShell entirely. Host-only by construction. -->
      <div class="bsrv-hoststrip">
        <DealSourceButton />
        <div class="bsrv-invite">
          <button class="bsrv-btn bsrv-btn-primary" type="button">Copy invite link</button>
          <input class="bsrv-invite-url" readonly :value="inviteUrl">
        </div>
        <button class="bsrv-btn" type="button">&#129514; Test players</button>
        <button class="bsrv-btn" type="button">&#9881; Table settings</button>
        <button class="bsrv-btn bsrv-btn-danger" type="button">End table</button>
      </div>
    </template>

    <!-- ── PLAYER chrome (b3) ───────────────────────────────────────────── -->
    <nav v-else class="bsrv-nav bsrv-nav-player">
      <button class="bsrv-leave" type="button">&larr; Leave table</button>
      <span class="bsrv-title">{{ f.scenario || "Rick's table" }}</span>
      <span class="bsrv-user">{{ heroInitials }}</span>
    </nav>

    <!-- Row 2 — the TableShell HEADER, inside the shell and present for both roles.
         B2 therefore carries TWO control rows live (this plus the session strip
         above); the scene modelled only the strip until the 2026-07-29 audit. -->
    <div class="bsrv-shellhead">
      <div class="bsrv-head-left">
        <!-- Board + contract/result chips removed 2026-07-29 — NW carries both. -->
        <span class="bsrv-shell-title">{{ f.scenario || "Rick's table" }}</span>
        <span class="bsrv-tag bsrv-tag-bots">bots: BBA+RulesBot</span>
        <button v-if="canManage" class="bsrv-tag bsrv-tag-toggle" type="button">Show all hands</button>
      </div>
      <div class="bsrv-head-right">
        <!-- Host-only transport. The guest (B3) gets none of it — the same
             owner-vs-guest split that makes the NW reserve context-dependent. -->
        <template v-if="canManage">
          <button class="bsrv-btn" type="button">Pause bots</button>
          <button class="bsrv-btn" type="button">Undo</button>
          <DealSourceButton />
          <button class="bsrv-btn bsrv-btn-primary" type="button">Next deal</button>
          <button v-if="f.canHostAdvance" class="bsrv-btn bsrv-btn-primary" type="button">Next deal &rarr;</button>
        </template>
      </div>
    </div>

    <!-- Notes strip: kibitz / paused cues. -->
    <div v-if="!f.yourSeats?.length || f.pausedSeat" class="bsrv-notes">
      <p v-if="!f.yourSeats?.length" class="bsrv-note">You're watching this table — take a seat to play.</p>
      <p v-if="f.pausedSeat" class="bsrv-note">Bots paused at {{ seatName(f.pausedSeat) }}.</p>
    </div>

    <div class="bsrv-table-wrap" :class="{ 'bsrv-table-wrap--stacked': railStacked }">
      <div class="bsrv-frame">
        <SeatControlTable
          arrangement="grid"
          :table-config="tableConfig"
          :region-reserves="regionReserves"
          :phase="arrangerPhase"
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
              <!-- Owner-only transport. B3 (guest) renders the glyph alone — and
                   reserves nothing for buttons it never shows. -->
              <DealControls v-if="canManage" :show-restart="false" can-next />
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

          <!-- SE — action corner: box + host Undo, DD table at review. No Claim on
               a served table (solo-cardplay affordance today). -->
          <template v-if="seSlot" #se>
            <div class="bsrv-se-stack">
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
                :final-contract="{ contract: f.contract || '', declarer: f.declarer || null }"
                :diverged="!!f.divergence"
              />
              <ActionCluster v-if="seSlot !== 'double-dummy' && canManage" can-undo />
            </div>
          </template>
        </SeatControlTable>
      </div>

      <!-- ── The RAIL. Absent from this scene until 2026-07-29, which is why the
           gallery under-reported the server table so badly: this column holds most
           of the controls that are candidates to move into the grid, and several of
           them are host-only — the split that drives the context-dependent NW
           reserve. Card order matches the live server branch. -->
      <aside class="bsrv-rail" :class="{ 'bsrv-rail--stacked': railStacked }">
        <RailCard v-if="f.ddtricks && phase !== 'review'" title="Double dummy">
          <DoubleDummyTable
            :ddtricks="f.ddtricks"
            :final-contract="{ contract: f.contract || '', declarer: f.declarer || null }"
            :diverged="!!f.divergence"
          />
        </RailCard>

        <!-- Turn cue: your bid (bidding) / your play (play) / waiting on someone. -->
        <RailCard v-if="phase === 'bidding' && yourTurn" title="Your bid">
          <div class="bsrv-line bsrv-turn">Your call — use the bidding box.</div>
        </RailCard>
        <RailCard v-else-if="phase === 'bidding'" tone="waiting">
          <div class="bsrv-line">Waiting for {{ seatName(f.nextSeat) }}&hellip;</div>
        </RailCard>

        <RailCard v-if="phase === 'play'" title="Play">
          <div class="bsrv-line">Tricks <strong>NS&nbsp;{{ tricks.NS }} · EW&nbsp;{{ tricks.EW }}</strong></div>
          <div v-if="yourTurn" class="bsrv-line bsrv-turn">Your turn — play a card.</div>
          <div v-else class="bsrv-line">
            Waiting for {{ seatName(f.nextSeat) }}&hellip;
            <span class="bsrv-bot-note">(bots can take up to ~20s)</span>
          </div>
        </RailCard>

        <!-- CHAT — the rail's reason to exist once its other cards migrate into the
             grid (Rick, 2026-07-29: "we will be adding chat that will need to exist
             there, so I want to keep making room for it"). ContextPanel has had a
             `chat` mode since roadmap Phase 0 and is still 0x in production, so this
             is the component waiting for a host, not a mock-up of one.
             Shown HERE ONLY: the table service has no chat backend yet, so wiring it
             into the live view would be inventing a feature. The gallery is where it
             can be sized and looked at honestly. -->
        <ContextPanel v-if="chatMessages.length" mode="chat" :messages="chatMessages" />

        <RailCard v-if="kibitzers.length || canManage" title="Kibitzers">
          <div class="bsrv-line">{{ kibitzers.length ? kibitzers.join(', ') : 'None watching' }}</div>
        </RailCard>

        <!-- Host-only. -->
        <RailCard v-if="canManage" title="PassBot">
          <div class="bsrv-line">
            {{ passBotSeats.length ? passBotSeats.map(seatName).join(', ') + ' auto-pass' : 'Off' }}
          </div>
        </RailCard>

        <!-- Review: divergence (read-only on a shared table, #304) + result. -->
        <RailCard v-if="phase === 'review' && f.divergence" title="Bidding vs BBA">
          <div class="bsrv-line">Your auction diverged from BBA's — see the pinned auction.</div>
        </RailCard>

        <RailCard v-if="phase === 'review'" title="Result">
          <div class="bsrv-line" v-html="f.resultBanner || (f.contract + ' by ' + seatName(f.declarer))"></div>
        </RailCard>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import SeatControlTable from '../components/table/SeatControlTable.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
import DoubleDummyTable from '../components/DoubleDummyTable.vue'
import DealSourceButton from '../components/table/DealSourceButton.vue'
import RailCard from '../components/table/RailCard.vue'
import ContextPanel from '../components/ContextPanel.vue'
import DealControls from '../components/table/DealControls.vue'
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
const role = computed(() => (f.value.surface === 'b2' ? 'host' : 'player'))
const canManage = computed(() => f.value.canManage ?? (role.value === 'host'))
const inviteUrl = computed(() => f.value.inviteUrl || 'https://bridge-classroom.org/table/BRG-8F2K')

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

// Pinned through play AND review — matches the live server branch's
// `trick-area || review` gate. (Was play-only, which dropped the reference auction
// from every review scene, and review is where the BBA divergence marks show.)
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

const heroInitials = computed(() => {
  const name = (f.value.occupants?.[f.value.seat || 'S']?.name) || f.value.heroName || 'You'
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
})

// SE corner content + shell-owed reserves — mirrors the live server branch.
const seSlot = computed(() => {
  if (phase.value === 'bidding') return 'bidding'
  if (phase.value === 'review' && f.value.ddtricks) return 'double-dummy'
  return null
})
const regionReserves = computed(() => {
  const nw = Math.max(
    Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE)),
    canManage.value ? dealControlsReservePx({ showRestart: false }) : 0,
  )
  const undo = canManage.value ? actionClusterReservePx({ showUndo: true }) : 0
  let se = 0
  if (seSlot.value === 'bidding') se = Math.max(biddingBoxReservePx(), undo)
  else if (seSlot.value === 'double-dummy') se = doubleDummyReservePx()
  return se > 0 ? { nw, se } : { nw }
})

// ── Rail state (2026-07-29: the rail was entirely absent from this scene) ──
const tricks = computed(() => f.value.tricksTaken || { NS: 0, EW: 0 })
const kibitzers = computed(() => f.value.kibitzers || [])
const chatMessages = computed(() => f.value.chat || [])
const passBotSeats = computed(() => f.value.passBotSeats || [])
const yourTurn = computed(() => !!f.value.clickableSeat && f.value.clickableSeat === (f.value.seat || 'S'))
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }
const seatName = (s) => SEAT_NAMES[s] || s
</script>

<style scoped>
/* Production centres the stage and stops it growing at 1400px (TableShell's
   .ts-page: max-width 1400 + margin auto). The scenes hand-roll their page, so they
   grew to the full monitor — 2145px against production's 1366 on a 34" display
   (2026-07-30 report). Mirroring the cap keeps the gallery honest about how big the
   stage actually gets; it is the same hand-copied-chrome drift as the scenario bar.
   NOTE: this does NOT change the centre/West column symptom, which is height-driven
   (it reproduces at 1400 wide) — the two are separate. */
.bsrv-app {
  max-width: 1400px;
  margin: 0 auto;
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
.bsrv-table-wrap { display: flex; gap: 16px; align-items: flex-start; margin: 0 16px 16px; }
.bsrv-frame {
  flex: 1 1 auto; min-width: 0;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 14px; padding: 8px;
}
.bsrv-se-stack { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.bsrv-nw { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

/* Shell header (row 2) — the TableShell's own header, inside the shell. */
.bsrv-shellhead {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  margin: 12px 16px 0; padding: 10px 14px;
  background: #fff; border: 1px solid #e6e8e3; border-radius: 12px;
}
.bsrv-head-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bsrv-head-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bsrv-shell-title { font-weight: 700; font-size: 15px; }
.bsrv-tag {
  font-size: 11px; padding: 3px 8px; border-radius: 999px;
  background: #eef2ee; color: #4a554e; border: 1px solid #e0e6e0; white-space: nowrap;
}
.bsrv-tag-bots { background: #eaf4ef; color: #1f6a4f; }
.bsrv-tag-toggle { cursor: default; }
.bsrv-notes { margin: 8px 16px 0; }
.bsrv-note { margin: 0 0 4px; font-size: 12px; color: #6a726c; }

/* Rail — the column that was missing entirely before 2026-07-29. */
.bsrv-rail { flex: 0 0 300px; display: flex; flex-direction: column; gap: 12px; }
.bsrv-line { font-size: 12px; color: #6a726c; margin-top: 4px; }
.bsrv-turn { color: #1f6a4f; font-weight: 600; }
.bsrv-waiting { opacity: 0.85; }
.bsrv-bot-note { color: #8a938d; }
/* Stacked (portrait / narrow): companion goes UNDER the table, full width, and its
   cards flow in a row rather than a single tall column. These MUST come after the
   base .bsrv-table-wrap / .bsrv-rail rules — same specificity, so source order decides, and
   declaring them earlier is why the first attempt silently kept the column form.
   `align-items: stretch` on the wrap is load-bearing too: the base rule is
   flex-start, which in a COLUMN direction sizes the frame to its content and
   collapsed the table into a narrow strip. */
.bsrv-table-wrap--stacked { flex-direction: column; align-items: stretch; }
.bsrv-rail--stacked {
  flex: 1 1 auto;
  width: 100%;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
}
.bsrv-rail--stacked > * { flex: 1 1 260px; }
</style>
