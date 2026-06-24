<template>
  <div class="bp-app" :class="{ embedded: EMBEDDED }">
    <nav v-if="!EMBEDDED" class="bp-nav">
      <a class="bp-logo" href="/"><span class="suit">&spades;</span> Bridge Classroom &middot; Bidding Practice</a>
      <button class="bp-nav-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? 'Hide scenario menu' : 'Show scenario menu'">
        {{ sidebarOpen ? '⟨ Hide scenarios' : '☰ Scenarios' }}
      </button>
      <a class="bp-nav-back" href="/">&larr; All tools</a>
    </nav>

    <div class="bp-main" :class="{ 'sidebar-closed': !sidebarOpen }">
      <aside v-if="!EMBEDDED" class="bp-sidebar" :class="{ open: sidebarOpen }">
        <div v-if="selectedScenarios.size > 0" class="bp-selection-summary">
          <div class="bp-selection-count">
            {{ selectedScenarios.size }} scenario{{ selectedScenarios.size === 1 ? '' : 's' }} selected
          </div>
          <button class="bp-selection-clear" @click="clearSelection">Clear</button>
        </div>
        <div v-if="menuLoading" class="bp-menu-loading">Loading scenarios&hellip;</div>
        <div v-else-if="menuError" class="bp-menu-loading bp-error">{{ menuError }}</div>
        <div v-else>
          <div v-for="(node, idx) in menuTree" :key="idx">
            <div v-if="node.type === 'major'" class="bp-menu-major">{{ node.label }}</div>
            <div v-else-if="node.type === 'section'">
              <div
                class="bp-menu-section"
                :class="{ open: openSections[node.label] }"
                @click="toggleSection(node.label)"
              >
                <span>{{ node.label }}</span>
                <span class="bp-chevron">&#9656;</span>
              </div>
              <div v-if="openSections[node.label]" class="bp-menu-rows">
                <div
                  v-for="(row, ri) in node.rows"
                  :key="ri"
                  class="bp-menu-row"
                  :style="{ gridTemplateColumns: 'repeat(' + row.length + ', 1fr)' }"
                >
                  <div
                    v-for="(cell, ci) in row"
                    :key="ci"
                    class="bp-menu-cell"
                    :class="{
                      clickable: !!cell,
                      empty: !cell,
                      selected: cell && selectedScenarios.has(cell.file),
                      active: cell && cell.file === currentScenario,
                      unsupported: cell && btnMetadata[cell.file] && btnMetadata[cell.file].bbaWorks === false,
                    }"
                    :title="cell && btnMetadata[cell.file] && btnMetadata[cell.file].bbaWorks === false ? 'BBA does not fully support this convention' : ''"
                    @click="cell && toggleScenario(cell.file)"
                  >
                    <span v-if="cell">{{ cell.label }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main class="bp-stage" :class="{ dimmed: sidebarOpen && !EMBEDDED }">
        <div v-if="!currentScenario && !menuLoading" class="bp-empty">
          Pick a scenario from the menu to start bidding.<br>
          <small>(You sit South. Three BBA bots fill the other seats.)</small>
        </div>

        <div v-if="dealError" class="bp-error-box">
          <strong>Error:</strong> {{ dealError }}
          <div v-if="dealErrorHint" class="bp-error-hint">{{ dealErrorHint }}</div>
        </div>

        <template v-if="currentScenario && currentDeal">
          <div class="bp-scenario-bar">
            <div>
              <div class="bp-scenario-name">{{ currentScenarioLabel }}</div>
              <div class="bp-scenario-meta">
                Deal {{ dealIndex + 1 }} of {{ totalDeals }} &middot;
                Dealer {{ currentDeal.dealer }} &middot; Vul {{ currentDeal.vulnerable }}
              </div>
              <div v-if="conventionsUsed" class="bp-scenario-meta">
                CC &middot; NS: {{ conventionsUsed.ns }} &middot; EW: {{ conventionsUsed.ew }}
              </div>
              <div v-if="selectedScenarios.size > 1" class="bp-scenario-meta">
                Drawing from: {{ poolLabels }}
              </div>
            </div>
            <div class="bp-scenario-actions">
              <label v-if="!EMBEDDED" class="bp-rotate-toggle">
                <input type="checkbox" v-model="rotateDeals">
                Rotate randomly
              </label>
              <label v-if="!EMBEDDED" class="bp-rotate-toggle">
                <input type="checkbox" v-model="playCardplay">
                Play the hand after bidding
              </label>
              <label v-if="!EMBEDDED && playCardplay" class="bp-bot-label">
                Bot:
                <select class="bp-bot-select" v-model="cardplayBotName">
                  <option v-for="b in availableBots" :key="b" :value="b">{{ b }}</option>
                </select>
              </label>
              <button v-if="!EMBEDDED" class="bp-btn" @click="newDeal" :disabled="auctionLoading || selectedScenarios.size === 0">Next deal &rarr;</button>
              <button class="bp-btn" @click="resetAuction" :disabled="auctionLoading">Restart this deal</button>
              <button v-if="!EMBEDDED && scenarioChat" class="bp-btn" @click="showScenarioChat = true" title="Show the scenario description">&#8505; Description</button>
            </div>
          </div>

          <div v-if="EMBEDDED && !auctionComplete" class="bp-embedded-bidding">
            <div class="bp-side-col">
              <div class="bp-card">
                <h3>Auction</h3>
                <AuctionTable
                  :bids="bids"
                  :dealer="currentDeal.dealer"
                  :current-bid-index="bids.length"
                  :wrong-bid-indices="wrongIndicesArray"
                  :show-turn-indicator="!auctionComplete"
                  :meanings="meanings"
                  :diverged-bids="divergedBids"
                  :allow-divergence-toggle="!auctionLoading"
                  @toggle-bid="toggleDivergedBid"
                />
              </div>
              <div v-if="currentSeat === STUDENT_SEAT && !auctionLoading" class="bp-card">
                <h3>Your bid</h3>
                <BiddingBox
                  :last-bid="lastNonPassNonDouble"
                  :can-double="canDouble"
                  :can-redouble="canRedouble"
                  @bid="onUserBid"
                />
              </div>
              <div v-if="auctionLoading" class="bp-loading-card">Computing&hellip;</div>
            </div>
            <div class="bp-hand-col">
              <HandDisplay
                :hand="currentDeal.hands[STUDENT_SEAT]"
                :seat="STUDENT_SEAT"
                :show-hcp="true"
                :show-total-points="true"
              />
              <div class="bp-deal-tags">
                <span class="bp-vul-tag" :class="{ 'is-vul': vulForSide('NS') || vulForSide('EW') }">
                  {{ currentDeal.vulnerable === 'None' ? 'None vul' : currentDeal.vulnerable + ' vul' }}
                </span>
                <span class="bp-dealer-tag">Dealer {{ currentDeal.dealer }}</span>
              </div>
            </div>
          </div>

          <div v-else class="bp-table-wrap">
            <BridgeTable
              :hands="visibleHands"
              :hidden-seats="hiddenSeats"
              :show-hcp="true"
              :show-total-points="true"
              :clickable-seat="cardplay.clickableSeat.value"
              :played-cards="cardplay.playedBySeat.value"
              :hide-played-cards="cardplayHidePlayed"
              @card-click="onCardClick"
            >
              <template #center>
                <TrickArea
                  v-if="cardplayPhase === 'playing' || cardplayPhase === 'complete'"
                  :current-trick="cardplay.currentTrick"
                  :last-finished-trick="cardplay.lastFinishedTrick.value"
                  :tricks-taken="cardplay.tricksTaken.value"
                  :next-seat="cardplay.currentPlayer.value"
                  :bot-loading="cardplay.botLoading.value"
                  :bot-name="botName"
                />
                <div v-else class="bp-center">
                  <div class="bp-vul-tag" :class="{ 'is-vul': vulForSide('NS') || vulForSide('EW') }">
                    {{ currentDeal.vulnerable === 'None' ? 'None vul' : currentDeal.vulnerable + ' vul' }}
                  </div>
                  <div class="bp-dealer-tag">Dealer {{ currentDeal.dealer }}</div>
                  <div v-if="auctionLoading" class="bp-loading">Computing&hellip;</div>
                </div>
              </template>
            </BridgeTable>

            <div class="bp-right-rail">
              <div class="bp-card">
                <h3>Auction</h3>
                <AuctionTable
                  :bids="bids"
                  :dealer="currentDeal.dealer"
                  :current-bid-index="bids.length"
                  :wrong-bid-indices="wrongIndicesArray"
                  :show-turn-indicator="!auctionComplete"
                  :meanings="meanings"
                  :diverged-bids="divergedBids"
                  :allow-divergence-toggle="!auctionLoading"
                  @toggle-bid="toggleDivergedBid"
                />
              </div>

              <div v-if="!auctionComplete && currentSeat === STUDENT_SEAT && !auctionLoading" class="bp-card">
                <h3>Your bid</h3>
                <BiddingBox
                  :last-bid="lastNonPassNonDouble"
                  :can-double="canDouble"
                  :can-redouble="canRedouble"
                  @bid="onUserBid"
                />
              </div>

              <div v-if="cardplayPhase === 'playing'" class="bp-card bp-cardplay-card">
                <h3>Cardplay</h3>
                <div class="bp-cardplay-status">
                  Tricks <strong>NS&nbsp;{{ cardplay.tricksTaken.value.NS }} · EW&nbsp;{{ cardplay.tricksTaken.value.EW }}</strong>
                </div>
                <div v-if="cardplay.botLoading.value" class="bp-cardplay-thinking">{{ botName }} thinking&hellip;</div>
                <div v-if="cardplay.botError.value" class="bp-cardplay-error">⚠ {{ cardplay.botError.value }}</div>
                <div v-if="cardplay.botStats.value.count > 0" class="bp-cardplay-stats">
                  {{ botName }}: {{ cardplay.botStats.value.count }} call{{ cardplay.botStats.value.count === 1 ? '' : 's' }} ·
                  last {{ fmtMs(cardplay.botStats.value.last) }} ·
                  avg {{ fmtMs(cardplay.botStats.value.mean) }} ·
                  max {{ fmtMs(cardplay.botStats.value.max) }}
                </div>
                <div class="bp-cardplay-toggles">
                  <label class="bp-cardplay-toggle">
                    <input type="checkbox" v-model="cardplayShowPlayed">
                    Show played cards
                  </label>
                  <label class="bp-cardplay-toggle">
                    <input type="checkbox" v-model="cardplayShowAll">
                    Show all hands
                  </label>
                  <label class="bp-cardplay-toggle">
                    <input type="checkbox" v-model="cardplay.autoplayUserSingletons.value">
                    Auto-play singletons
                  </label>
                </div>
                <!-- Claim flow: button opens an inline picker. v1 trusts the
                     claim; future enhancement is DD validation via libdds. -->
                <div v-if="!claimFormOpen" class="bp-cardplay-actions">
                  <button class="bp-btn" @click="openClaimForm" :disabled="cardplay.botLoading.value || cardplay.remainingTricks.value === 0">Claim&hellip;</button>
                  <button class="bp-btn" @click="restartCardplay" :disabled="cardplay.botLoading.value">Restart cardplay</button>
                </div>
                <div v-else class="bp-claim-form">
                  <div class="bp-claim-prompt">Claim how many of the {{ cardplay.remainingTricks.value }} remaining?</div>
                  <div class="bp-claim-buttons">
                    <button
                      v-for="n in claimOptions"
                      :key="n"
                      class="bp-claim-btn"
                      :disabled="claimValidating"
                      @click="confirmClaim(n)"
                    >{{ n }}</button>
                  </div>
                  <div v-if="claimValidating" class="bp-claim-validating">
                    {{ botName }} checking claim&hellip;
                  </div>
                  <div v-if="claimRejection" class="bp-claim-rejection">
                    <div class="bp-claim-rejection-msg">
                      <strong>{{ botName }} rejected the claim of {{ claimRejection.tricks }} trick{{ claimRejection.tricks === 1 ? '' : 's' }}.</strong>
                      <span v-if="claimRejection.message">{{ claimRejection.message }}</span>
                    </div>
                    <div class="bp-claim-rejection-actions">
                      <button class="bp-btn bp-claim-override" @click="overrideClaim">Override &amp; claim anyway</button>
                      <button class="bp-btn" @click="claimRejection = null">Try a different count</button>
                    </div>
                  </div>
                  <button v-if="!claimValidating" class="bp-btn bp-claim-cancel" @click="cancelClaim">Cancel</button>
                </div>
              </div>

              <div v-if="cardplayPhase === 'unsupported'" class="bp-card bp-cardplay-notice">
                Cardplay is currently only supported when South is declarer.
                Defender and dummy modes will arrive in a future release.
              </div>

              <div v-if="auctionComplete && (cardplayPhase === 'off' || cardplayPhase === 'unsupported' || cardplayPhase === 'complete')" class="bp-contract">
                <div class="bp-contract-line">
                  Final contract:
                  <span v-if="finalContract.contract === 'Pass'">Passed out</span>
                  <span v-else>
                    <span v-html="formatContractHtml(finalContract.contract)"></span>
                    by {{ finalContract.declarer }}
                  </span>
                </div>
                <div class="bp-contract-meta">{{ summary }}</div>

                <div v-if="cardplayPhase === 'complete' && cardplayResult" class="bp-cardplay-result">
                  You took <strong>{{ cardplayResult.took }}</strong> trick{{ cardplayResult.took === 1 ? '' : 's' }}
                  <span v-if="cardplayResult.needed != null">
                    · needed {{ cardplayResult.needed }} to make
                    <span :class="cardplayResult.made ? 'bp-made' : 'bp-down'">— {{ cardplayResult.made ? 'made' : 'down ' + (cardplayResult.needed - cardplayResult.took) }}</span>
                  </span>
                  <span v-if="cardplay.claim.value" class="bp-claim-tag">
                    (claimed at trick {{ cardplay.claim.value.atTrick }}<span v-if="cardplay.claim.value.overridden">, override</span>)
                  </span>
                </div>
                <div v-if="cardplayPhase === 'complete' && cardplay.botStats.value.count > 0" class="bp-cardplay-stats">
                  {{ botName }}: {{ cardplay.botStats.value.count }} calls ·
                  avg {{ fmtMs(cardplay.botStats.value.mean) }} ·
                  max {{ fmtMs(cardplay.botStats.value.max) }} ·
                  total {{ fmtMs(cardplay.botStats.value.total) }}
                </div>

                <div v-if="ddRows" class="bp-dd-label">Double-dummy tricks</div>
                <table v-if="ddRows" class="bp-dd-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th class="bp-black">&clubs;</th>
                      <th class="bp-red">&diams;</th>
                      <th class="bp-red">&hearts;</th>
                      <th class="bp-black">&spades;</th>
                      <th>NT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in ddRows" :key="row.seat">
                      <td class="bp-dd-seat">{{ row.seat }}</td>
                      <td
                        v-for="(c, i) in row.cells"
                        :key="i"
                        :class="{
                          'bp-dd-contract': c.isContract,
                          'bp-dd-match': c.isContract && !hadDivergence,
                          'bp-dd-diverged': c.isContract && hadDivergence,
                        }"
                      >{{ c.tricks }}</td>
                    </tr>
                  </tbody>
                </table>

                <div class="bp-contract-actions">
                  <button v-if="EMBEDDED" class="bp-btn bp-btn-primary" @click="done">Done</button>
                  <button v-else class="bp-btn bp-btn-primary" @click="newDeal">Next deal &rarr;</button>
                  <button class="bp-btn" @click="resetAuction">Replay this deal</button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- Scenario chat — sizable, draggable popup of the .btn @chat -->
    <ScenarioChatPopup
      :visible="showScenarioChat && !!scenarioChat"
      :title="scenarioChat?.title || ''"
      :text="scenarioChat?.text || ''"
      @close="showScenarioChat = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import BridgeTable from '../components/BridgeTable.vue'
import HandDisplay from '../components/HandDisplay.vue'
import BiddingBox from '../components/BiddingBox.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import ScenarioChatPopup from '../components/ScenarioChatPopup.vue'
import { formatBid } from '../utils/cardFormatting.js'
import { useCardPlay } from '../composables/useCardPlay.js'
import { getBot, listBots } from '../utils/cardplayBots.js'
import { warmBen } from '../utils/benClient.js'

// ── Config ────────────────────────────────────────────────────────────
const CONFIG = {
  BBA_URL: 'https://bba.harmonicsystems.com',
  PBS_RAW_BASE: 'https://raw.githubusercontent.com/ADavidBailey/Practice-Bidding-Scenarios/main',
  BUTTON_LAYOUT: '/btn/-button-layout-release.txt',
  PBN_DIR: '/pbn',
  // For bba-works=true scenarios, prefer this auction-filtered set
  // (deals that pass both the dealer-script filter and the .pbn-side
  // auction filter that runs after BBA bids each hand).
  BBA_FILTERED_DIR: '/bba-filtered',
  // Default convention card when an embedded host doesn't supply one.
  DEFAULT_CARD: '21GF-DEFAULT',
}

// ── Embedded-mode params ──────────────────────────────────────────────
// When the page is loaded with ?pbn=... we run as an iframe-friendly
// single-deal player: scenario menu/nav are hidden, the BBA call uses
// explicit conventions instead of a scenario name, and lifecycle events
// (ready, auction-complete, done, error) are postMessage'd to window.parent.
// The deal is left in its actual compass frame — N is N, the DD table
// matches the board — and we just show the student's specific hand panel.
function readEmbeddedParams() {
  if (typeof window === 'undefined') return null
  // Hash router: query may live before the hash (?pbn=...#/route) or
  // inside it (#/route?pbn=...). Merge both so the host can use either.
  let qs = (window.location.search || '').replace(/^\?/, '')
  const hash = window.location.hash || ''
  const hashQ = hash.indexOf('?')
  if (hashQ !== -1) qs = qs ? qs + '&' + hash.slice(hashQ + 1) : hash.slice(hashQ + 1)
  const sp = new URLSearchParams(qs)
  const pbn = sp.get('pbn')
  if (!pbn) return null
  const card = sp.get('card') || CONFIG.DEFAULT_CARD
  const seat = (sp.get('seat') || 'S').toUpperCase()
  return {
    pbn,
    dealer: sp.get('dealer'),
    vul: sp.get('vul'),
    seat: ['N', 'E', 'S', 'W'].includes(seat) ? seat : 'S',
    cards: {
      ns: sp.get('cardNS') || card,
      ew: sp.get('cardEW') || card,
    },
  }
}
const embeddedParams = readEmbeddedParams()
const EMBEDDED = !!embeddedParams
// The compass seat the human is sitting at. Defaults to S for the
// standalone scenario flow (which has always been South-centric).
const STUDENT_SEAT = EMBEDDED ? embeddedParams.seat : 'S'

function postEmbedded(msg) {
  if (typeof window === 'undefined') return
  try { window.parent.postMessage(msg, '*') } catch {}
}

// ── State ─────────────────────────────────────────────────────────────
const menuTree = ref([])
const menuLoading = ref(true)
const menuError = ref('')
const openSections = reactive({})

const isNarrow = () => typeof window !== 'undefined'
  && window.matchMedia('(max-width: 1100px)').matches
// Sidebar visibility — persisted across reloads so a student who hides it
// once stays hidden. Default visible (the student needs to pick a scenario
// to get going).
const SIDEBAR_KEY = 'bp.sidebarOpen'
const sidebarOpen = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_KEY) != null
    ? localStorage.getItem(SIDEBAR_KEY) === '1'
    : !isNarrow()
)
watch(sidebarOpen, (v) => {
  try { localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0') } catch {}
})

// Selected scenario set (multi-select). currentScenario tracks which scenario
// the LOADED deal came from (for display + "next from same set" logic).
const selectedScenarios = ref(new Set())
const dealsByScenario = ref({})  // file -> parsed deals[]
const currentScenario = ref('')
const currentScenarioLabel = ref('')
const dealsForScenario = ref([])
const dealIndex = ref(0)
const currentDeal = ref(null)
const dealError = ref('')
const dealErrorHint = ref('')

// Scenario-chat popup: the .btn @chat for the open scenario, shown auto-on-open
// and reopenable from the scenario bar. { title, text } or null.
const scenarioChat = ref(null)
const showScenarioChat = ref(false)

// Persist the rotate-randomly preference across reloads.
const ROTATE_KEY = 'bp.rotateDeals'
const rotateDeals = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(ROTATE_KEY) === '1'
)
watch(rotateDeals, (v) => {
  try { localStorage.setItem(ROTATE_KEY, v ? '1' : '0') } catch {}
})

// Cardplay toggle — when on, after each auction completes we transition into
// trick-by-trick cardplay (currently South-declarer only).
const PLAY_KEY = 'bp.playCardplay'
const BOT_KEY = 'bp.cardplayBot'
const SHOW_PLAYED_KEY = 'bp.cardplayShowPlayed'
const SHOW_ALL_KEY = 'bp.cardplayShowAll'
const AUTOPLAY_SINGLETONS_KEY = 'bp.cardplayAutoplaySingletons'
const playCardplay = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(PLAY_KEY) === '1'
)
const cardplayBotName = ref(
  (typeof localStorage !== 'undefined' && localStorage.getItem(BOT_KEY)) || 'random'
)
// Teaching toggles — both default OFF.
//   showPlayed: keep played cards visible (strike-through) instead of removing them.
//     Useful for beginners learning trick mechanics. Also forced-true during 'complete'
//     so the user can review all original cards after the deal ends.
//   showAll: expose defender hands during cardplay. Useful for advanced study
//     (squeezes, endplays). At 'complete' all hands are revealed regardless.
const cardplayShowPlayed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_PLAYED_KEY) === '1'
)
const cardplayShowAll = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_ALL_KEY) === '1'
)
watch(playCardplay, (v) => {
  try { localStorage.setItem(PLAY_KEY, v ? '1' : '0') } catch {}
  // Pre-warm BEN when the user opts into cardplay so the cold start happens
  // before the first real call. No-op if BEN isn't the active bot.
  if (v) maybeWarmBen()
})
watch(cardplayBotName, (v) => {
  try { localStorage.setItem(BOT_KEY, v) } catch {}
  if (v === 'ben') maybeWarmBen()
})
watch(cardplayShowPlayed, (v) => {
  try { localStorage.setItem(SHOW_PLAYED_KEY, v ? '1' : '0') } catch {}
})
watch(cardplayShowAll, (v) => {
  try { localStorage.setItem(SHOW_ALL_KEY, v ? '1' : '0') } catch {}
})

const cardplay = useCardPlay()
const availableBots = listBots()

// Claim form: shown inline in the Cardplay status card when the user
// clicks "Claim…". The user picks how many of the remaining tricks they
// claim for the declaring side; defenders implicitly get the rest. If the
// active bot supports claim validation (BenBot does, RandomLegalBot
// doesn't) the engine asks the bot first; a rejection surfaces the bot's
// message and an Override button.
const claimFormOpen = ref(false)
const claimValidating = ref(false)
const claimRejection = ref(null)  // { tricks, message } when the bot rejected
const claimOptions = computed(() => {
  const r = cardplay.remainingTricks.value
  const out = []
  for (let i = 0; i <= r; i++) out.push(i)
  return out
})
function openClaimForm() {
  claimFormOpen.value = true
  claimRejection.value = null
}
function cancelClaim() {
  claimFormOpen.value = false
  claimRejection.value = null
  claimValidating.value = false
}
async function confirmClaim(declarerTricks) {
  claimValidating.value = true
  claimRejection.value = null
  try {
    const result = await cardplay.validateClaim(declarerTricks)
    if (result.accepted) {
      cardplay.claimTricks(declarerTricks)
      claimFormOpen.value = false
    } else {
      // Stash the rejection; user can override or cancel.
      claimRejection.value = { tricks: declarerTricks, message: result.message }
    }
  } finally {
    claimValidating.value = false
  }
}
function overrideClaim() {
  if (!claimRejection.value) return
  cardplay.claimTricks(claimRejection.value.tricks, {
    overridden: true,
    rejectionMessage: claimRejection.value.message,
  })
  claimRejection.value = null
  claimFormOpen.value = false
}

// Keep the engine's autoplay-singletons ref synced to a persisted user pref.
cardplay.autoplayUserSingletons.value = (
  typeof localStorage !== 'undefined' && localStorage.getItem(AUTOPLAY_SINGLETONS_KEY) === '1'
)
watch(cardplay.autoplayUserSingletons, (v) => {
  try { localStorage.setItem(AUTOPLAY_SINGLETONS_KEY, v ? '1' : '0') } catch {}
})

// Pre-warm BEN once per page load. Idempotent.
let _benWarmed = false
function maybeWarmBen() {
  if (_benWarmed) return
  if (!playCardplay.value) return
  if (cardplayBotName.value !== 'ben') return
  _benWarmed = true
  warmBen()
}

// True when played cards should be hidden from the hand display
// (the default during live cardplay; always false at 'complete' so users
// can review the dealt hands).
const cardplayHidePlayed = computed(() => {
  if (cardplayPhase.value === 'complete') return false
  if (cardplayPhase.value !== 'playing') return false
  return !cardplayShowPlayed.value
})

const expectedAuction = ref([])
// Snapshot of BBA's original (no-prefix) auction & meanings at deal load time,
// used to restore the auction on Restart after the user has driven divergent
// re-requests that overwrote expectedAuction.
const originalExpectedAuction = ref([])
const originalMeanings = ref([])
const conventionsUsed = ref(null)
const meanings = ref([])
const doubleDummy = ref(null)
const bids = ref([])
// Map idx → { user, bba } for every position where the user diverged from
// BBA's expected bid. Both bids are kept so the cell can show them stacked
// and the user can toggle which is "live" — toggling re-requests the auction
// from BBA with auctionPrefix so the bots actually respond to the new bid.
const divergedBids = ref({})
const auctionLoading = ref(false)

// ── Derived ───────────────────────────────────────────────────────────
const SEAT_ORDER = ['N', 'E', 'S', 'W']

function seatAtIndex(dealer, idx) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(dealer) + idx) % 4]
}

const totalDeals = computed(() => dealsForScenario.value.length)
const auctionComplete = computed(() => currentDeal.value && isAuctionOver(bids.value))
const currentSeat = computed(() => {
  if (!currentDeal.value) return null
  return seatAtIndex(currentDeal.value.dealer, bids.value.length)
})
const lastNonPassNonDouble = computed(() => lastSuitBid(bids.value))
const wrongIndicesArray = computed(() => Object.keys(divergedBids.value).map(Number))
const hadDivergence = computed(() => Object.keys(divergedBids.value).length > 0)
const poolLabels = computed(() => [...selectedScenarios.value].map(prettifyLabel).join(', '))

const visibleHands = computed(() => {
  if (!currentDeal.value) return { N: null, E: null, S: null, W: null }
  // During cardplay, defer to the engine for which seats are visible — but
  // the "Show all hands" teaching toggle overrides to reveal defenders too.
  if (cardplayPhase.value === 'playing') {
    if (cardplayShowAll.value) return currentDeal.value.hands
    const out = { N: null, E: null, S: null, W: null }
    for (const seat of ['N', 'E', 'S', 'W']) {
      if (!cardplay.hiddenSeats.value.includes(seat)) {
        out[seat] = currentDeal.value.hands[seat]
      }
    }
    return out
  }
  if (auctionComplete.value) return currentDeal.value.hands
  // During bidding, only the student's seat is visible.
  const visible = { N: null, E: null, S: null, W: null }
  visible[STUDENT_SEAT] = currentDeal.value.hands[STUDENT_SEAT]
  return visible
})
const hiddenSeats = computed(() => {
  if (!currentDeal.value) return []
  if (cardplayPhase.value === 'playing') {
    if (cardplayShowAll.value) return []
    return cardplay.hiddenSeats.value
  }
  if (auctionComplete.value) return []
  return ['N', 'E', 'S', 'W'].filter(s => s !== STUDENT_SEAT)
})

const canDouble = computed(() => {
  const trailing = []
  for (let i = bids.value.length - 1; i >= 0; i--) {
    if (bids.value[i] === 'Pass') trailing.push('Pass')
    else { trailing.push(bids.value[i]); break }
  }
  const lastNonPass = trailing[trailing.length - 1]
  if (!lastNonPass || lastNonPass === 'Pass') return false
  if (lastNonPass === 'X' || lastNonPass === 'XX') return false
  return (trailing.length % 2) === 1
})
const canRedouble = computed(() => {
  const trailing = []
  for (let i = bids.value.length - 1; i >= 0; i--) {
    if (bids.value[i] === 'Pass') trailing.push('Pass')
    else { trailing.push(bids.value[i]); break }
  }
  const lastNonPass = trailing[trailing.length - 1]
  if (lastNonPass !== 'X') return false
  return (trailing.length % 2) === 1
})

const finalContract = computed(() => {
  if (!currentDeal.value) return { contract: '', declarer: null }
  return determineContract(bids.value, currentDeal.value.dealer) || { contract: '', declarer: null }
})

const summary = computed(() => {
  if (!auctionComplete.value) return ''
  const n = Object.keys(divergedBids.value).length
  if (n === 0) return 'You matched the BBA all the way through.'
  return `${n} of your bids differed from the BBA — see the divergent cells above.`
})

// Cardplay phase derived from auction + toggle + cardplay engine state.
//   bidding     — auction in progress
//   off         — auction done, toggle off (existing flow: reveal all 4 hands)
//   unsupported — toggle on but S isn't declarer (v1 limitation; reveal + notice)
//   playing     — actively playing tricks
//   complete    — 13 tricks done; show DD + result
const cardplayPossible = computed(() => {
  if (!auctionComplete.value) return false
  const fc = finalContract.value
  return fc && fc.contract && fc.contract !== 'Pass' && fc.declarer === STUDENT_SEAT
})
const cardplayPhase = computed(() => {
  if (!auctionComplete.value) return 'bidding'
  if (!playCardplay.value) return 'off'
  if (!cardplayPossible.value) return 'unsupported'
  if (cardplay.playComplete.value) return 'complete'
  if (cardplay.isActive.value) return 'playing'
  // Toggle on, auction done, S declares, but engine not yet started — about
  // to be entered by the watcher below.
  return 'playing'
})
const botName = computed(() => {
  try { return getBot(cardplayBotName.value).name } catch { return cardplayBotName.value }
})

// Result-vs-DD comparison (shown post-cardplay).
const cardplayResult = computed(() => {
  if (!cardplay.playComplete.value) return null
  const fc = finalContract.value
  if (!fc?.contract || fc.contract === 'Pass') return null
  // Tricks declarer's side took.
  const declarerSide = (fc.declarer === 'N' || fc.declarer === 'S') ? 'NS' : 'EW'
  const took = cardplay.tricksTaken.value[declarerSide]
  const m = fc.contract.match(/^(\d)/)
  const needed = m ? parseInt(m[1], 10) + 6 : null
  return { took, needed, made: needed != null && took >= needed }
})

const ddRows = computed(() => {
  if (!doubleDummy.value) return null
  const seats = ['N', 'S', 'E', 'W']
  const colSuitIdx = [4, 3, 2, 1, 0] // display order ♣ ♦ ♥ ♠ NT
  const colStrain = ['C', 'D', 'H', 'S', 'NT']
  const fc = finalContract.value
  const declarerIdx = fc && fc.declarer ? seats.indexOf(fc.declarer) : -1
  let contractStrainIdx = -1
  if (fc && fc.contract && fc.contract !== 'Pass') {
    const m = fc.contract.match(/^\d([CDHSN]T?)(X{0,2})$/)
    if (m) {
      const strain = m[1] === 'N' ? 'NT' : m[1]
      contractStrainIdx = colStrain.indexOf(strain)
    }
  }
  return seats.map((seat, si) => ({
    seat,
    cells: colSuitIdx.map((j, ci) => ({
      tricks: ddTrickAt(doubleDummy.value, si, j),
      isContract: si === declarerIdx && ci === contractStrainIdx,
    })),
  }))
})

// ── Helpers ───────────────────────────────────────────────────────────
function isAuctionOver(arr) {
  if (arr.length < 4) return false
  const last3 = arr.slice(-3)
  if (last3.every(b => b === 'Pass')) {
    const hasBid = arr.slice(0, -3).some(b => b !== 'Pass')
    if (hasBid) return true
    if (arr.length === 4 && arr.every(b => b === 'Pass')) return true
  }
  return false
}

function lastSuitBid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== 'Pass' && arr[i] !== 'X' && arr[i] !== 'XX') return arr[i]
  }
  return null
}

function determineContract(arr, dealer) {
  if (!isAuctionOver(arr)) return null
  if (arr.every(b => b === 'Pass')) return { contract: 'Pass', declarer: null }
  const last = lastSuitBid(arr)
  if (!last) return { contract: 'Pass', declarer: null }
  let dbl = ''
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === 'XX') { dbl = 'XX'; break }
    if (arr[i] === 'X') { dbl = 'X'; break }
    if (arr[i] !== 'Pass') break
  }
  const strain = last.replace(/^\d/, '')
  const lastIdx = arr.lastIndexOf(last)
  const lastSeat = seatAtIndex(dealer, lastIdx)
  const winningSide = (lastSeat === 'N' || lastSeat === 'S') ? ['N', 'S'] : ['E', 'W']
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i]
    if (b === 'Pass' || b === 'X' || b === 'XX') continue
    const bStrain = b.replace(/^\d/, '')
    const seat = seatAtIndex(dealer, i)
    if (bStrain === strain && winningSide.includes(seat)) {
      return { contract: last + dbl, declarer: seat }
    }
  }
  return { contract: last + dbl, declarer: lastSeat }
}

function vulForSide(side) {
  const v = currentDeal.value?.vulnerable || 'None'
  if (v === 'Both' || v === 'All') return true
  if (v === 'NS' && side === 'NS') return true
  if (v === 'EW' && side === 'EW') return true
  return false
}

function formatContractHtml(contract) {
  return formatBid(contract).html || contract
}

// Format a latency in ms as either "ms" or "Xs" / "X.Ys" depending on magnitude.
function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 1000).toFixed(0)}s`
}

// ── PBN parsing (multi-deal) ──────────────────────────────────────────
function parsePBN(text) {
  const deals = []
  const tagRe = /\[(\w+)\s+"([^"]*)"\]/g
  const blocks = text.split(/\n\s*\n/)
  for (const block of blocks) {
    const tags = {}
    let m
    tagRe.lastIndex = 0
    while ((m = tagRe.exec(block)) !== null) tags[m[1]] = m[2]
    if (!tags.Deal) continue
    const hands = parseDealHandsForBridgeTable(tags.Deal)
    if (!hands) continue
    deals.push({
      board: tags.Board || '?',
      dealer: tags.Dealer || 'N',
      vulnerable: tags.Vulnerable || 'None',
      hands,
      pbn: tags.Deal,
    })
  }
  return deals
}

// HandDisplay expects { spades: [], hearts: [], diamonds: [], clubs: [] } per seat.
function parseDealHandsForBridgeTable(deal) {
  const m = deal.match(/^([NESW]):(.+)$/)
  if (!m) return null
  const start = m[1]
  const startIdx = SEAT_ORDER.indexOf(start)
  const hands = m[2].trim().split(/\s+/)
  if (hands.length !== 4) return null
  const result = {}
  for (let i = 0; i < 4; i++) {
    const seat = SEAT_ORDER[(startIdx + i) % 4]
    const suits = hands[i].split('.')
    if (suits.length !== 4) return null
    result[seat] = {
      spades: [...suits[0]],
      hearts: [...suits[1]],
      diamonds: [...suits[2]],
      clubs: [...suits[3]],
    }
  }
  return result
}

function handsToPbnString(hands) {
  return SEAT_ORDER.map(seat => {
    const h = hands[seat]
    return [h.spades, h.hearts, h.diamonds, h.clubs].map(arr => arr.join('')).join('.')
  }).join(' ')
}

// ── Layout (sidebar menu) parser ──────────────────────────────────────
function parseLayout(text) {
  const tree = []
  const lines = text.split('\n')
  let currentSection = null
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('[Major]')) {
      tree.push({ type: 'major', label: line.substring('[Major]'.length).trim() })
      currentSection = null
      continue
    }
    if (line.startsWith('[Section]')) {
      currentSection = { type: 'section', label: line.substring('[Section]'.length).trim(), rows: [] }
      tree.push(currentSection)
      continue
    }
    if (line.startsWith('[Action]')) continue
    if (!currentSection) continue
    const row = parseRow(line)
    if (row.length > 0) {
      while (row.length < 2) row.push(null)
      currentSection.rows.push(row)
    }
  }
  return tree
}

function parseRow(line) {
  const cells = []
  let depth = 0
  let buf = ''
  for (const ch of line) {
    if (ch === '(') { depth++; buf += ch }
    else if (ch === ')') { depth--; buf += ch }
    else if (ch === ',' && depth === 0) { cells.push(buf.trim()); buf = '' }
    else { buf += ch }
  }
  if (buf.trim()) cells.push(buf.trim())
  return cells.map(parseCell)
}

function parseCell(cell) {
  if (cell.startsWith('(') && cell.endsWith(')')) {
    cell = cell.slice(1, -1).split(',')[0].trim()
  }
  if (cell === '---' || !cell) return null
  const file = cell.replace(/:[a-zA-Z]+/g, '').replace(/:\d+%/g, '').trim()
  if (!file) return null
  return { file, label: prettifyLabel(file) }
}

function prettifyLabel(file) {
  return file.replace(/_/g, ' ').trim()
}

// ── External services ─────────────────────────────────────────────────
async function generateAuction(deal, scenarioName, auctionPrefix = null) {
  const vul = deal.vulnerable === 'All' ? 'Both' : deal.vulnerable
  const body = {
    deal: {
      pbn: 'N:' + handsToPbnString(deal.hands),
      dealer: deal.dealer,
      vulnerability: vul,
      scoring: 'MP',
    },
  }
  if (EMBEDDED) {
    body.conventions = embeddedParams.cards
  } else {
    body.scenario = scenarioName
  }
  if (auctionPrefix && auctionPrefix.length > 0) {
    body.auctionPrefix = auctionPrefix
  }
  const resp = await fetch(CONFIG.BBA_URL + '/api/auction/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let err = `HTTP ${resp.status}`
    try { const j = await resp.json(); if (j.error) err = j.error } catch {}
    throw new Error(err)
  }
  const j = await resp.json()
  if (!j.success) throw new Error(j.error || 'BBA returned success=false')
  return {
    auction: j.auction,
    meanings: j.meanings || [],
    conventionsUsed: j.conventionsUsed || null,
  }
}

async function fetchDoubleDummy(deal) {
  const pbn = ('N:' + handsToPbnString(deal.hands)).replace(/ /g, 'x')
  const vul = deal.vulnerable === 'Both' ? 'All' : deal.vulnerable
  const url = `https://dds.bridgewebs.com/cgi-bin/bsol2/ddummy?request=m&dealstr=${encodeURIComponent(pbn)}&vul=${vul}&club=bridgeclassroom`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const text = await resp.text()
  const json = JSON.parse(text.trim())
  if (!json.sess || !json.sess.ddtricks || json.sess.ddtricks.length < 20) return null
  return json.sess.ddtricks
}

function ddTrickAt(ddtricks, seatIdx, suitIdx) {
  const ch = ddtricks[seatIdx * 5 + suitIdx]
  if (ch >= '0' && ch <= '9') return parseInt(ch, 10)
  if (ch >= 'a' && ch <= 'd') return 10 + ch.charCodeAt(0) - 'a'.charCodeAt(0)
  if (ch >= 'A' && ch <= 'D') return 10 + ch.charCodeAt(0) - 'A'.charCodeAt(0)
  return 0
}

// ── Lifecycle ─────────────────────────────────────────────────────────
onMounted(async () => {
  // If cardplay is already enabled with BEN selected, warm the model now
  // so the user's first opening lead doesn't eat the cold start.
  maybeWarmBen()

  if (EMBEDDED) {
    menuLoading.value = false
    postEmbedded({ type: 'bridge-classroom:ready' })
    await loadEmbeddedDeal()
    return
  }
  try {
    const resp = await fetch(CONFIG.PBS_RAW_BASE + CONFIG.BUTTON_LAYOUT)
    if (!resp.ok) throw new Error(`Layout HTTP ${resp.status}`)
    const text = await resp.text()
    menuTree.value = parseLayout(text)
    const firstSection = menuTree.value.find(n => n.type === 'section')
    if (firstSection) {
      openSections[firstSection.label] = true
      ensureBtnMetadataForSection(firstSection)
    }
  } catch (err) {
    menuError.value = 'Could not load scenario menu: ' + err.message
  } finally {
    menuLoading.value = false
  }
})

async function loadEmbeddedDeal() {
  try {
    const hands = parseDealHandsForBridgeTable(embeddedParams.pbn)
    if (!hands) throw new Error('Invalid PBN deal string (expected "N:hand hand hand hand")')
    const deal = {
      board: '?',
      dealer: embeddedParams.dealer || 'N',
      vulnerable: embeddedParams.vul || 'None',
      hands,
      pbn: embeddedParams.pbn,
    }
    currentScenario.value = '__embedded__'
    currentScenarioLabel.value = 'Replay'
    dealsForScenario.value = [deal]
    await loadDealAt(0)
  } catch (err) {
    dealError.value = 'Could not load embedded deal: ' + err.message
  }
}

function done() {
  postEmbedded({ type: 'bridge-classroom:done' })
}

watch(() => auctionComplete.value, (isComplete) => {
  if (!EMBEDDED || !isComplete) return
  postEmbedded({
    type: 'bridge-classroom:auction-complete',
    auction: bids.value.slice(),
    contract: finalContract.value.contract,
    declarer: finalContract.value.declarer,
    dealer: currentDeal.value.dealer,
    studentSeat: STUDENT_SEAT,
    meanings: meanings.value.slice(),
  })
})

// Enter cardplay when the auction completes if the toggle is on and the
// contract is South-declared. The engine then drives bots to the first user
// turn (or to completion if no user seat is active).
watch(() => auctionComplete.value, async (isComplete) => {
  if (!isComplete || EMBEDDED) return
  if (!playCardplay.value) return
  if (!cardplayPossible.value) return
  const fc = finalContract.value
  let bot
  try { bot = getBot(cardplayBotName.value) } catch { bot = getBot('random') }
  // v1: South declares → user controls S (own hand) + N (dummy). Defenders
  // are bots. Wider scopes (defender / N-declares) are deferred per plan.
  const dummySeat = fc.declarer === 'N' ? 'S' : fc.declarer === 'S' ? 'N' : fc.declarer === 'E' ? 'W' : 'E'
  await cardplay.startPlay({
    hands: currentDeal.value.hands,
    dealer: currentDeal.value.dealer,
    vulnerable: currentDeal.value.vulnerable,
    bids: bids.value.slice(),
    contract: fc.contract,
    declarer: fc.declarer,
    bot,
    userSeats: [fc.declarer, dummySeat],
  })
})

watch(dealError, (msg) => {
  if (EMBEDDED && msg) postEmbedded({ type: 'bridge-classroom:error', message: msg })
})

function toggleSection(label) {
  openSections[label] = !openSections[label]
  if (openSections[label]) {
    const section = menuTree.value.find(n => n.type === 'section' && n.label === label)
    if (section) ensureBtnMetadataForSection(section)
  }
}

// Per-scenario .btn metadata (currently just the bba-works flag).
// Lazy-fetched per section on expand and cached for the session.
const btnMetadata = ref({})

function ensureBtnMetadataForSection(section) {
  const files = section.rows.flat().filter(c => c).map(c => c.file)
  const toFetch = files.filter(f => !(f in btnMetadata.value))
  if (toFetch.length === 0) return
  // Optimistically mark in-flight so we don't re-fetch on rapid toggle.
  const next = { ...btnMetadata.value }
  for (const f of toFetch) next[f] = { bbaWorks: true, _loading: true }
  btnMetadata.value = next
  Promise.all(toFetch.map(fetchBtnMetadata)).then(results => {
    const merged = { ...btnMetadata.value }
    for (let i = 0; i < toFetch.length; i++) merged[toFetch[i]] = results[i]
    btnMetadata.value = merged
  })
}

async function fetchBtnMetadata(file) {
  try {
    const resp = await fetch(`${CONFIG.PBS_RAW_BASE}/btn/${file}.btn`)
    if (!resp.ok) return { bbaWorks: true, chat: null } // assume supported on fetch failure
    const text = await resp.text()
    const meta = { bbaWorks: true, chat: extractChat(text) }
    // Metadata lives in leading "# key: value" comment lines.
    for (const raw of text.split('\n').slice(0, 40)) {
      if (!raw.startsWith('#')) continue
      const m = raw.match(/^#\s*bba-works:\s*(\w+)/i)
      if (m) {
        meta.bbaWorks = m[1].toLowerCase() === 'true'
        break
      }
    }
    return meta
  } catch {
    return { bbaWorks: true, chat: null }
  }
}

// Pull the scenario "chat" out of a .btn — the /*@chat ... @chat*/ block.
function extractChat(btnText) {
  const m = btnText.match(/\/\*@chat\s*([\s\S]*?)@chat\*\//)
  return m ? m[1].trim() : null
}

// Show the scenario's @chat popup (fetch the .btn if not cached yet).
async function showChatForScenario(file) {
  let meta = btnMetadata.value[file]
  if (!meta || meta._loading || meta.chat === undefined) {
    meta = await fetchBtnMetadata(file)
    btnMetadata.value = { ...btnMetadata.value, [file]: meta }
  }
  if (meta?.chat) {
    scenarioChat.value = { title: prettifyLabel(file), text: meta.chat }
    showScenarioChat.value = true
  } else {
    scenarioChat.value = null
    showScenarioChat.value = false
  }
}

// Toggle a scenario in the multi-select set.
// Adding when set was empty (or nothing loaded) auto-loads a deal from it.
// Removing the currently-loaded scenario advances to a different one in the set.
async function toggleScenario(file) {
  const newSet = new Set(selectedScenarios.value)
  if (newSet.has(file)) {
    newSet.delete(file)
    selectedScenarios.value = newSet
    if (currentScenario.value === file) {
      if (newSet.size > 0) {
        const next = pickRandomFromSet(newSet)
        await loadFromScenario(next)
      } else {
        currentScenario.value = ''
        currentScenarioLabel.value = ''
        currentDeal.value = null
        dealsForScenario.value = []
      }
    }
  } else {
    newSet.add(file)
    selectedScenarios.value = newSet
    if (!currentScenario.value || !currentDeal.value) {
      await loadFromScenario(file)
    }
  }
  if (isNarrow() && currentDeal.value) sidebarOpen.value = false
}

function pickRandomFromSet(set) {
  const arr = [...set]
  return arr[Math.floor(Math.random() * arr.length)]
}

async function clearSelection() {
  selectedScenarios.value = new Set()
  currentScenario.value = ''
  currentScenarioLabel.value = ''
  currentDeal.value = null
  dealsForScenario.value = []
}

// Fetch + cache the PBN for a scenario, then load a random deal from it.
async function loadFromScenario(file) {
  const isNewScenario = file !== currentScenario.value
  currentScenario.value = file
  currentScenarioLabel.value = prettifyLabel(file)
  dealError.value = ''
  dealErrorHint.value = ''
  let deals = dealsByScenario.value[file]
  if (!deals) {
    try {
      deals = await fetchScenarioDeals(file)
      if (deals.length === 0) throw new Error('No deals in PBN file')
      dealsByScenario.value = { ...dealsByScenario.value, [file]: deals }
    } catch (err) {
      dealError.value = 'Could not load scenario PBN: ' + err.message
      dealErrorHint.value = 'Some scenarios in the menu may not have BBA-compatible PBN files.'
      return
    }
  }
  dealsForScenario.value = deals
  await loadDealAt(Math.floor(Math.random() * deals.length))
  // Auto-show the scenario chat when a NEW scenario is opened (not on every
  // "next deal" within the same scenario, and not in embedded single-deal mode).
  if (isNewScenario && !EMBEDDED) showChatForScenario(file)
}

// For BBA-supported scenarios, prefer /bba-filtered/ — those PBNs apply
// David's auction-side filter on top of the dealer-script filter, so the
// remaining deals are ones BBA actually bids in the intended sequence.
// Fall through to the unfiltered /pbn/ on miss or for non-BBA scenarios.
async function fetchScenarioDeals(file) {
  const meta = btnMetadata.value[file]
  const bbaWorks = !meta || meta.bbaWorks !== false
  if (bbaWorks) {
    try {
      const resp = await fetch(`${CONFIG.PBS_RAW_BASE}${CONFIG.BBA_FILTERED_DIR}/${file}.pbn`)
      if (resp.ok) {
        const text = await resp.text()
        const deals = parsePBN(text)
        if (deals.length > 0) return deals
      }
    } catch {
      /* fall through */
    }
  }
  const resp = await fetch(`${CONFIG.PBS_RAW_BASE}${CONFIG.PBN_DIR}/${file}.pbn`)
  if (!resp.ok) throw new Error(`PBN HTTP ${resp.status}`)
  const text = await resp.text()
  return parsePBN(text)
}

async function loadDealAt(idx) {
  dealError.value = ''
  dealErrorHint.value = ''
  dealIndex.value = idx
  let deal = dealsForScenario.value[idx]
  // 50% chance of 180° rotation when the toggle is on.
  if (rotateDeals.value && Math.random() < 0.5) {
    deal = rotateDeal(deal)
  }
  currentDeal.value = deal
  bids.value = []
  divergedBids.value = {}
  expectedAuction.value = []
  auctionLoading.value = true
  doubleDummy.value = null
  cardplay.reset()

  const dealRef = currentDeal.value
  fetchDoubleDummy(dealRef).then(dd => {
    if (currentDeal.value === dealRef) doubleDummy.value = dd
  }).catch(() => {})

  try {
    const result = await generateAuction(dealRef, currentScenario.value)
    expectedAuction.value = result.auction
    originalExpectedAuction.value = result.auction
    conventionsUsed.value = result.conventionsUsed || null
    meanings.value = result.meanings || []
    originalMeanings.value = result.meanings || []
    await playToHumanTurn()
  } catch (err) {
    dealError.value = 'BBA error: ' + err.message
    if (err.message.includes('Failed to fetch') || err.message.includes('CORS')) {
      dealErrorHint.value = 'Likely a CORS issue — the BBA server must allow this origin.'
    }
  } finally {
    auctionLoading.value = false
  }
}

// "Next deal" — pick a random scenario from the selected set, then a random
// deal from that scenario's PBN. Falls back to the current scenario if only one.
async function newDeal() {
  if (selectedScenarios.value.size === 0) return
  const file = pickRandomFromSet(selectedScenarios.value)
  await loadFromScenario(file)
}

// Rotate a deal 180°: N↔S, E↔W. Dealer and vulnerability flip with the seats.
function rotateDeal(deal) {
  return {
    ...deal,
    dealer: { N: 'S', S: 'N', E: 'W', W: 'E' }[deal.dealer] || deal.dealer,
    vulnerable: deal.vulnerable === 'NS' ? 'EW'
              : deal.vulnerable === 'EW' ? 'NS'
              : deal.vulnerable,
    hands: {
      N: deal.hands.S,
      S: deal.hands.N,
      E: deal.hands.W,
      W: deal.hands.E,
    },
  }
}

// Swap which bid is "live" at a diverged index. Truncates the auction to
// just past the toggle point and re-requests from BBA with auctionPrefix so
// the bots actually respond to the new bid sequence. Any later divergences
// in the prior context are dropped (their auction context no longer exists).
async function toggleDivergedBid(idx) {
  if (auctionLoading.value) return
  const div = divergedBids.value[idx]
  if (!div) return
  const currentLive = bids.value[idx]
  const otherBid = currentLive === div.user ? div.bba : div.user

  // Truncate bids to the position right after the toggled cell.
  bids.value = bids.value.slice(0, idx).concat([otherBid])

  // Drop any divergences after this point — the auction beyond is being replaced.
  const newDivs = {}
  for (const [k, v] of Object.entries(divergedBids.value)) {
    if (Number(k) <= idx) newDivs[k] = v
  }
  divergedBids.value = newDivs

  // Ask BBA to continue the auction from the new prefix.
  auctionLoading.value = true
  try {
    const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
    expectedAuction.value = result.auction
    meanings.value = result.meanings || []
    if (result.conventionsUsed) conventionsUsed.value = result.conventionsUsed
    await playToHumanTurn()
  } catch (err) {
    dealError.value = 'BBA error on toggle: ' + err.message
  } finally {
    auctionLoading.value = false
  }
}

async function resetAuction() {
  if (!currentDeal.value) return
  bids.value = []
  divergedBids.value = {}
  cardplay.reset()
  // Restore BBA's original (no-prefix) auction so the user starts from a
  // clean slate even after divergent re-requests overwrote expectedAuction.
  expectedAuction.value = originalExpectedAuction.value
  meanings.value = originalMeanings.value
  await playToHumanTurn()
}

// Cardplay click handler — routes user clicks on S or N (dummy) into the
// cardplay engine. Mirrors the suit-letter / rank-letter shape that
// HandDisplay emits.
async function onCardClick({ seat, suit, rank }) {
  void seat  // Engine tracks whose turn it is; we just need the card.
  const result = await cardplay.onUserCard(suit, rank)
  if (!result.ok && result.reason) {
    // HandDisplay's clickable-cards UI doesn't yet filter to legal cards, so
    // users can click illegal cards and the engine rejects them silently.
    // TODO: pass legalCardsForCurrent down to HandDisplay for proper greyout.
    if (typeof console !== 'undefined') console.warn('Cardplay click rejected:', result.reason)
  }
}

async function restartCardplay() {
  cardplay.reset()
  // Re-enter cardplay using the same logic as the auction-complete watcher.
  const fc = finalContract.value
  if (!fc || !cardplayPossible.value) return
  let bot
  try { bot = getBot(cardplayBotName.value) } catch { bot = getBot('random') }
  const dummySeat = fc.declarer === 'N' ? 'S' : fc.declarer === 'S' ? 'N' : fc.declarer === 'E' ? 'W' : 'E'
  await cardplay.startPlay({
    hands: currentDeal.value.hands,
    dealer: currentDeal.value.dealer,
    vulnerable: currentDeal.value.vulnerable,
    bids: bids.value.slice(),
    contract: fc.contract,
    declarer: fc.declarer,
    bot,
    userSeats: [fc.declarer, dummySeat],
  })
}

async function playToHumanTurn() {
  while (!isAuctionOver(bids.value) && bids.value.length < expectedAuction.value.length) {
    const seat = seatAtIndex(currentDeal.value.dealer, bids.value.length)
    if (seat === STUDENT_SEAT) break
    const bid = expectedAuction.value[bids.value.length]
    await sleep(300)
    bids.value.push(bid)
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function onUserBid(bid) {
  if (!currentDeal.value) return
  const idx = bids.value.length
  const expected = expectedAuction.value[idx]
  if (expected && bid !== expected) {
    // User diverged. Record both bids, use the USER'S bid as the live one,
    // and re-request from BBA with auctionPrefix so the bots actually
    // respond to this sequence rather than BBA's predicted continuation.
    // Toggling later flips back to BBA's bid (also via re-request).
    divergedBids.value = { ...divergedBids.value, [idx]: { user: bid, bba: expected } }
    bids.value.push(bid)
    auctionLoading.value = true
    try {
      const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
      expectedAuction.value = result.auction
      meanings.value = result.meanings || []
      if (result.conventionsUsed) conventionsUsed.value = result.conventionsUsed
    } catch (err) {
      dealError.value = 'BBA error on divergence: ' + err.message
    } finally {
      auctionLoading.value = false
    }
  } else {
    bids.value.push(bid)
  }
  await playToHumanTurn()
}
</script>

<style scoped>
.bp-app {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: #f7f7f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #222;
}
.bp-app.embedded {
  grid-template-rows: 1fr;
}
.bp-app.embedded .bp-main {
  grid-template-columns: minmax(0, 1fr);
}
.bp-app.embedded .bp-stage {
  padding: 10px 14px;
  gap: 10px;
  align-items: stretch;
}
.bp-app.embedded .bp-scenario-bar {
  padding: 7px 12px;
  max-width: none;
}
.bp-app.embedded .bp-scenario-name { font-size: 14px; }
.bp-app.embedded .bp-scenario-meta { font-size: 11px; }

/* Compact 2-col layout for embedded mode during the auction:
   left = auction + bidding box, right = student's hand. After the auction
   completes we fall back to the full BridgeTable layout for the reveal. */
.bp-embedded-bidding {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 14px;
  align-items: start;
}
.bp-side-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.bp-hand-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 12px 14px;
}
.bp-deal-tags {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
  color: #555;
  margin-top: 4px;
}
.bp-loading-card {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 10px;
  text-align: center;
  color: #1D9E75;
  font-size: 12px;
}
@media (max-width: 640px) {
  .bp-embedded-bidding { grid-template-columns: minmax(0, 1fr); }
  .bp-hand-col { order: -1; }
}

.bp-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 24px;
  border-bottom: 0.5px solid #ddd;
  background: #fff;
  gap: 12px;
}
.bp-logo { font-size: 15px; font-weight: 500; color: #222; text-decoration: none; }
.bp-logo .suit { color: #1D9E75; margin-right: 6px; }
.bp-nav-back { font-size: 12px; color: #666; text-decoration: none; }
.bp-nav-back:hover { color: #222; }
.bp-nav-toggle {
  display: inline-block;
  font-size: 13px;
  color: #1D9E75;
  background: none;
  border: 1px solid #1D9E75;
  border-radius: 6px;
  padding: 4px 10px;
  font-weight: 500;
  cursor: pointer;
}

.bp-main {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  min-height: 0;
  position: relative;
}
/* Sidebar hidden — table area takes the full width. The toggle button in
   the nav brings the sidebar back. */
.bp-main.sidebar-closed {
  grid-template-columns: minmax(0, 1fr);
}
.bp-main.sidebar-closed .bp-sidebar {
  display: none;
}
.bp-sidebar {
  background: #fff;
  border-right: 0.5px solid #ddd;
  overflow-y: auto;
  padding: 14px 0;
}
.bp-stage {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}
@media (max-width: 1100px) {
  .bp-main { grid-template-columns: minmax(0, 1fr); }
  .bp-sidebar { display: none; }
  .bp-sidebar.open { display: block; }
  .bp-stage.dimmed { display: none; }
  .bp-stage { padding: 14px; gap: 12px; }
}

/* Sidebar / scenario menu */
.bp-menu-loading { padding: 14px 16px; font-size: 12px; color: #888; }
.bp-error { color: #b00; }
.bp-menu-major {
  padding: 8px 16px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #856404;
  background: #FFF8DC;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.bp-menu-section {
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #1f4d72;
  background: #d9edf7;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 0.5px solid #b8dbe9;
}
.bp-menu-section:hover { background: #c8e2f0; }
.bp-chevron { font-size: 10px; color: #666; transition: transform 0.15s; }
.bp-menu-section.open .bp-chevron { transform: rotate(90deg); }
.bp-menu-rows { background: #fff; }
.bp-menu-row { display: grid; }
.bp-menu-cell {
  padding: 6px 6px;
  font-size: 12px;
  color: #333;
  text-align: center;
  line-height: 1.2;
  background: #fff;
  border: 0.5px solid #ccc;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: -0.5px 0 0 -0.5px;
}
.bp-menu-cell.clickable { cursor: pointer; }
.bp-menu-cell.clickable:hover { background: #f5fafd; color: #1D9E75; }
.bp-menu-cell.unsupported { background: #fde2cc; color: #7a3a1a; }
.bp-menu-cell.unsupported.clickable:hover { background: #fbcdaa; color: #5a2810; }
.bp-menu-cell.selected { background: #e1f5ee; color: #0f6e56; font-weight: 500; }
.bp-menu-cell.active { background: #c1ead7; color: #0f6e56; font-weight: 600; outline: 1.5px solid #1D9E75; outline-offset: -1.5px; }
.bp-menu-cell.empty { background: #f7f7f5; }

.bp-selection-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #f0fdf6;
  border-bottom: 0.5px solid #c8e8d6;
  font-size: 12px;
}
.bp-selection-count { color: #0f6e56; font-weight: 500; }
.bp-selection-clear {
  background: none;
  border: 1px solid #1D9E75;
  color: #1D9E75;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.bp-selection-clear:hover { background: #1D9E75; color: #fff; }

.bp-rotate-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  user-select: none;
  margin-right: 4px;
}
.bp-rotate-toggle input { cursor: pointer; }

.bp-bot-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
  user-select: none;
  margin-right: 4px;
}
.bp-bot-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #444;
}

.bp-cardplay-card .bp-cardplay-status {
  font-size: 13px;
  color: #444;
  margin-bottom: 8px;
}
.bp-cardplay-card .bp-cardplay-thinking {
  font-size: 11px;
  color: #1D9E75;
  font-style: italic;
  margin-bottom: 8px;
}
.bp-cardplay-stats {
  font-size: 11px;
  color: #666;
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.bp-cardplay-error {
  font-size: 11px;
  color: #b00;
  background: #fee;
  border: 0.5px solid #fbb;
  border-radius: 4px;
  padding: 4px 6px;
  margin-bottom: 8px;
}
.bp-cardplay-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  padding-top: 8px;
  border-top: 0.5px solid #eee;
}
.bp-cardplay-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  user-select: none;
}
.bp-cardplay-toggle input { cursor: pointer; }

.bp-cardplay-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.bp-claim-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #f0fdf6;
  border: 0.5px solid #c8e8d6;
  border-radius: 6px;
}
.bp-claim-prompt {
  font-size: 12px;
  color: #444;
}
.bp-claim-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.bp-claim-btn {
  min-width: 30px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid #1D9E75;
  background: #fff;
  color: #1D9E75;
  border-radius: 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.bp-claim-btn:hover { background: #1D9E75; color: #fff; }
.bp-claim-cancel { align-self: flex-start; font-size: 11px; padding: 3px 8px; }
.bp-claim-tag {
  font-size: 12px;
  color: #1D9E75;
  font-style: italic;
  margin-left: 4px;
}
.bp-claim-validating {
  font-size: 11px;
  color: #1D9E75;
  font-style: italic;
}
.bp-claim-rejection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #fee;
  border: 0.5px solid #fbb;
  border-radius: 4px;
}
.bp-claim-rejection-msg {
  font-size: 12px;
  color: #6e1f1f;
  line-height: 1.4;
}
.bp-claim-rejection-msg strong { display: block; margin-bottom: 4px; }
.bp-claim-rejection-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bp-claim-override {
  color: #fff;
  background: #b00;
  border-color: #b00;
}
.bp-claim-override:hover { background: #900; border-color: #900; }
.bp-cardplay-notice {
  background: #fff8e6;
  border: 0.5px solid #ead38d;
  color: #6e520f;
  font-size: 12px;
  line-height: 1.5;
}
.bp-cardplay-result {
  font-size: 14px;
  color: #444;
  margin-top: 4px;
}
.bp-cardplay-result .bp-made { color: #1D9E75; font-weight: 600; }
.bp-cardplay-result .bp-down { color: #d32f2f; font-weight: 600; }

/* Stage states */
.bp-empty { color: #888; font-size: 14px; padding: 60px 20px; text-align: center; }
.bp-error-box {
  color: #b00;
  font-size: 13px;
  padding: 14px 16px;
  background: #fee;
  border: 1px solid #fbb;
  border-radius: 6px;
  max-width: 560px;
  line-height: 1.5;
}
.bp-error-hint { margin-top: 6px; font-size: 12px; }

/* Scenario header */
.bp-scenario-bar {
  width: 100%;
  max-width: 940px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 8px;
}
.bp-scenario-name { font-size: 15px; font-weight: 500; }
.bp-scenario-meta { font-size: 12px; color: #666; }
.bp-scenario-actions { display: flex; gap: 8px; }
.bp-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.bp-btn:hover { border-color: #888; }
.bp-btn-primary { background: #1D9E75; color: #fff; border-color: #1D9E75; }
.bp-btn-primary:hover { background: #167a5a; border-color: #167a5a; }

/* Main table layout */
.bp-table-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
  width: 100%;
  /* Cardplay needs ~240px for the center trick area; with two 220-min
     hand columns + 320px right rail + 24px gap, 1100px max-width gives
     the table enough breathing room. */
  max-width: 1100px;
}
@media (max-width: 1100px) {
  .bp-table-wrap { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}

.bp-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
}
.bp-vul-tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: #f3f3f0;
  color: #555;
}
.bp-vul-tag.is-vul { background: #fde2e2; color: #b00; }
.bp-dealer-tag { font-size: 12px; color: #555; }
.bp-loading { color: #1D9E75; font-size: 11px; }

.bp-right-rail { display: flex; flex-direction: column; gap: 14px; }
.bp-card {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 12px;
}
.bp-card h3 {
  font-size: 11px;
  color: #666;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

/* Contract / DD */
.bp-contract {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.bp-contract-line { font-size: 18px; font-weight: 500; }
.bp-contract-meta { font-size: 13px; color: #666; }
.bp-contract-actions { display: flex; gap: 8px; margin-top: 10px; }
.bp-red { color: #d32f2f; }

/* Suit colors in the contract panel.
   - DD-table th has its own grey color rule; bump specificity so the
     bp-red/bp-black overrides win.
   - formatBid() emits <span class="red|black">…</span> for the final
     contract; :deep() pierces scoped styles to colour those spans. */
.bp-dd-table th.bp-red { color: #d32f2f; }
.bp-dd-table th.bp-black { color: #1a1a1a; }
.bp-contract :deep(.red) { color: #d32f2f; }
.bp-contract :deep(.black) { color: #1a1a1a; }

.bp-dd-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 10px;
}
.bp-dd-table {
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 13px;
}
.bp-dd-table th,
.bp-dd-table td {
  border: 0.5px solid #ddd;
  padding: 4px 10px;
  text-align: center;
}
.bp-dd-table th { background: #f3f3f0; color: #666; font-weight: 600; }
.bp-dd-seat { background: #f3f3f0; font-weight: 600; }
.bp-dd-contract.bp-dd-match {
  background: #d4edda;
  color: #155724;
  font-weight: 700;
}
.bp-dd-contract.bp-dd-diverged {
  background: #fbd6e5;
  color: #88224a;
  font-weight: 700;
}
</style>
