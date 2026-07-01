// useCardPlay — trick-by-trick cardplay state machine for the bidding-practice
// app. Driven by a pluggable bot (see src/utils/cardplayBots.js) so it can run
// against a fast local stub during development and BEN in production.
//
// Singleton pattern (module-level state) per project convention.

import { ref, computed, reactive, watch } from 'vue'
import {
  handToCards,
  trumpFromContract,
  getLegalCards,
  isLegalPlay,
  trickWinner,
  computeRemaining,
} from '../utils/cardplayRules.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SIDE_OF = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' }

function nextSeat(seat) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(seat) + 1) % 4]
}

// ── Module-level singleton state ───────────────────────────────────────

// Deal context (set once per startPlay).
const dealCtx = ref(null)         // { hands, dealer, vulnerable, bids, contract, declarer, dummySeat, openingLeader, trump, userSeats, bot, pacing }

// Live play state.
const currentTrick = reactive({ leader: null, plays: [] })  // plays: [{seat, suit, rank}]
const completedTricks = ref([])                              // [{leader, plays, winner}]
const played = ref([])                                       // flat chronological [{seat, suit, rank}]
const tricksTaken = ref({ NS: 0, EW: 0 })
const dummyRevealed = ref(false)
const botLoading = ref(false)
const botError = ref('')
const lastFinishedTrick = ref(null)  // for UI animation of completed-trick fade-out
const botLatencies = ref([])         // ms per bot call, in chronological order
// When true, user seats with only one legal card play automatically (no
// click required). Bot seats ALWAYS auto-play forced plays regardless —
// no point asking BEN about a play with no decision in it. This is a BBO
// quality-of-life feature; default off so beginners get full manual control.
const autoplayUserSingletons = ref(false)
// When set, cardplay ended via a claim. Records the declarer-side trick
// count the claim awarded; defenders get the rest of the remaining tricks.
const claim = ref(null)  // { declarerTricks, atTrick }

// §C3: cancellation epoch for the async bot driver. startPlay/reset bump it;
// the driver captures it on entry and bails after every await if it changed.
// Without this, a bot call in flight (BEN cold-start ~20s) could resolve after
// the deal was switched and record a play into the NEW deal, or leave two
// drivers running at once.
let playEpoch = 0

// ── Derived ────────────────────────────────────────────────────────────

const isActive = computed(() => dealCtx.value !== null)
const playComplete = computed(() => completedTricks.value.length === 13 || claim.value !== null)
const remainingTricks = computed(() => 13 - completedTricks.value.length)

// Whose turn it is. Returns null when no deal is loaded or play is complete.
const currentPlayer = computed(() => {
  if (!isActive.value || playComplete.value) return null
  if (currentTrick.plays.length === 0) {
    // Start of a trick: opening leader (trick 1) or last winner.
    if (completedTricks.value.length === 0) return dealCtx.value.openingLeader
    return completedTricks.value[completedTricks.value.length - 1].winner
  }
  if (currentTrick.plays.length === 4) return null  // engine is finalizing
  const last = currentTrick.plays[currentTrick.plays.length - 1]
  return nextSeat(last.seat)
})

// Played cards grouped by seat — the shape HandDisplay/BridgeTable expect for
// their `playedCards` prop: array of 2-char codes like "SK", "H3".
const playedBySeat = computed(() => {
  const out = { N: [], E: [], S: [], W: [] }
  for (const p of played.value) {
    out[p.seat].push(p.suit + p.rank)
  }
  return out
})

// Seats whose cards remain hidden during cardplay. Dummy becomes visible
// after the opening lead.
const hiddenSeats = computed(() => {
  if (!isActive.value) return []
  if (playComplete.value) return []
  const ctx = dealCtx.value
  const visible = new Set(ctx.userSeats)
  if (dummyRevealed.value) visible.add(ctx.dummySeat)
  return SEAT_ORDER.filter(s => !visible.has(s))
})

// Which seat (if any) is currently clickable. Only when it's a user seat's
// turn AND no bot call is in flight.
const clickableSeat = computed(() => {
  if (botLoading.value) return null
  const cur = currentPlayer.value
  if (!cur) return null
  return dealCtx.value.userSeats.includes(cur) ? cur : null
})

// Aggregated stats over the bot's latency samples for this deal.
// Used by the UI to surface how slow BEN (or whatever bot is active) is.
const botStats = computed(() => {
  const arr = botLatencies.value
  if (arr.length === 0) return { count: 0, last: 0, mean: 0, max: 0, total: 0 }
  let sum = 0, max = 0
  for (const v of arr) { sum += v; if (v > max) max = v }
  return {
    count: arr.length,
    last: arr[arr.length - 1],
    mean: sum / arr.length,
    max,
    total: sum,
  }
})

// Legal cards for the current player (computed off remaining cards).
const legalCardsForCurrent = computed(() => {
  const cur = currentPlayer.value
  if (!cur || !isActive.value) return []
  const remaining = computeRemaining(dealCtx.value.hands, played.value)
  return getLegalCards(remaining[cur], currentTrick.plays)
})

// ── Public API ─────────────────────────────────────────────────────────

// Begin cardplay from a finished auction.
// Required: hands, dealer, vulnerable, bids, contract, declarer, bot, userSeats.
// pacing: { betweenPlays: ms, betweenTricks: ms } — UI delay knobs.
export function startPlay({
  hands, dealer, vulnerable, bids, contract, declarer, bot, userSeats, pacing,
}) {
  if (!hands || !contract || !declarer || !bot) {
    throw new Error('startPlay: hands, contract, declarer, and bot are required')
  }
  const trump = trumpFromContract(contract)
  const dummySeat = SEAT_ORDER[(SEAT_ORDER.indexOf(declarer) + 2) % 4]
  const openingLeader = nextSeat(declarer)

  // §C3: invalidate any in-flight driver from a previous deal.
  playEpoch++

  dealCtx.value = {
    hands,
    dealer,
    vulnerable: vulnerable || 'None',
    bids: bids || [],
    contract,
    declarer,
    dummySeat,
    openingLeader,
    trump,
    userSeats: userSeats || [],
    bot,
    pacing: { betweenPlays: 300, betweenTricks: 1000, ...(pacing || {}) },
  }

  currentTrick.leader = openingLeader
  currentTrick.plays = []
  completedTricks.value = []
  played.value = []
  tricksTaken.value = { NS: 0, EW: 0 }
  dummyRevealed.value = false
  botLoading.value = false
  botError.value = ''
  lastFinishedTrick.value = null
  botLatencies.value = []
  claim.value = null

  // Kick off bot driver if the opening leader is a bot.
  return advanceBotsIfTheirTurn()
}

// Ask the active bot whether a claim of `declarerTricks` is achievable. If
// the bot has no validator (e.g. RandomLegalBot), returns { accepted: true,
// message: '', validated: false } so the caller can commit unconditionally.
// On network/bot errors, also accepts silently — claim validation should
// never block the user.
export async function validateClaim(declarerTricks) {
  if (!isActive.value) throw new Error('validateClaim: cardplay not active')
  if (playComplete.value) throw new Error('validateClaim: cardplay already complete')
  const bot = dealCtx.value.bot
  if (!bot || typeof bot.validateClaim !== 'function') {
    return { accepted: true, message: '', validated: false }
  }
  try {
    const result = await bot.validateClaim({
      tricks: declarerTricks,
      declarerHand: dealCtx.value.hands[dealCtx.value.declarer],
      dummyHand: dealCtx.value.hands[dealCtx.value.dummySeat],
      declarer: dealCtx.value.declarer,
      dealer: dealCtx.value.dealer,
      vulnerable: dealCtx.value.vulnerable,
      bids: dealCtx.value.bids,
      played: played.value,
    })
    return { ...result, validated: true }
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[cardplay] claim validation failed; accepting silently:', err.message)
    }
    return { accepted: true, message: '', validated: false }
  }
}

// Award `declarerTricks` of the remaining tricks to the declaring side and
// the rest to the defenders, then end cardplay. No DD validation in v1 — we
// trust the declarer's claim. Future enhancement: pass remaining hands +
// contract through libdds (already used elsewhere for the DD table) to
// verify the claim is achievable.
export function claimTricks(declarerTricks, { overridden = false, rejectionMessage = '' } = {}) {
  if (!isActive.value) throw new Error('claimTricks: cardplay not active')
  if (playComplete.value) throw new Error('claimTricks: cardplay already complete')
  const remaining = remainingTricks.value
  if (declarerTricks < 0 || declarerTricks > remaining) {
    throw new Error(`claimTricks: must be between 0 and ${remaining}`)
  }
  const declarerSide = SIDE_OF[dealCtx.value.declarer]
  const oppSide = declarerSide === 'NS' ? 'EW' : 'NS'
  tricksTaken.value = {
    ...tricksTaken.value,
    [declarerSide]: tricksTaken.value[declarerSide] + declarerTricks,
    [oppSide]: tricksTaken.value[oppSide] + (remaining - declarerTricks),
  }
  claim.value = {
    declarerTricks,
    atTrick: completedTricks.value.length + 1,
    overridden,
    rejectionMessage,
  }
}

// Reset play to pre-cardplay state. Caller can then call startPlay again.
export function reset() {
  // §C3: invalidate any in-flight bot driver so it can't record into the next deal.
  playEpoch++
  dealCtx.value = null
  currentTrick.leader = null
  currentTrick.plays = []
  completedTricks.value = []
  played.value = []
  tricksTaken.value = { NS: 0, EW: 0 }
  dummyRevealed.value = false
  botLoading.value = false
  botError.value = ''
  lastFinishedTrick.value = null
  botLatencies.value = []
  claim.value = null
}

// Handle a user click on one of their seats. Returns { ok, reason }.
// On success the engine advances any subsequent bot plays automatically.
export async function onUserCard(suit, rank) {
  if (!isActive.value) return { ok: false, reason: 'cardplay not active' }
  if (botLoading.value) return { ok: false, reason: 'bot is thinking' }
  const cur = currentPlayer.value
  if (!cur || !dealCtx.value.userSeats.includes(cur)) {
    return { ok: false, reason: `not your turn (current: ${cur})` }
  }
  const remaining = computeRemaining(dealCtx.value.hands, played.value)
  if (!isLegalPlay({ suit, rank }, remaining[cur], currentTrick.plays)) {
    return { ok: false, reason: 'illegal play (must follow suit if able)' }
  }
  await recordPlay({ seat: cur, suit, rank })
  await advanceBotsIfTheirTurn()
  return { ok: true }
}

// ── Internal: bot driver ───────────────────────────────────────────────

async function advanceBotsIfTheirTurn() {
  if (!isActive.value || playComplete.value) return
  // §C3: snapshot the epoch for this driver invocation. If the deal is reset or
  // a new one starts (playEpoch bumps), this driver must stop touching state.
  const myEpoch = playEpoch
  const stale = () => myEpoch !== playEpoch
  while (true) {
    if (stale() || playComplete.value) return
    // Finalize a completed trick first if 4 plays sit in currentTrick.
    if (currentTrick.plays.length === 4) {
      await finalizeTrick()
      if (stale()) return
      continue
    }
    const cur = currentPlayer.value
    if (!cur) return
    const isUser = dealCtx.value.userSeats.includes(cur)

    // Forced-play short-circuit: when there's exactly one legal card, no
    // decision is involved. Skip the bot entirely (saves ~1s per call).
    // For user seats, honor the autoplay-singletons toggle; without it the
    // engine still waits for a click.
    const remaining = computeRemaining(dealCtx.value.hands, played.value)
    const legalCards = getLegalCards(remaining[cur], currentTrick.plays)
    if (legalCards.length === 1 && (!isUser || autoplayUserSingletons.value)) {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.log(`[cardplay] auto → ${cur} ${legalCards[0].suit}${legalCards[0].rank}  (forced)`)
      }
      await recordPlay({ seat: cur, ...legalCards[0] })
      await sleep(dealCtx.value.pacing.betweenPlays)
      if (stale()) return
      continue
    }

    if (isUser) return  // wait for user click

    // Bot's turn (with a real decision to make).
    botLoading.value = true
    const startedAt = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    let card
    try {
      card = await callBotForSeat(cur)
    } catch (err) {
      if (stale()) { botLoading.value = false; return }
      botError.value = err.message || String(err)
      botLoading.value = false
      return
    }
    // §C3: the deal was switched/reset while this bot was thinking — drop the
    // result rather than recording it into the new deal.
    if (stale()) { botLoading.value = false; return }
    const elapsedMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - startedAt
    botLatencies.value = [...botLatencies.value, elapsedMs]
    if (typeof console !== 'undefined') {
      const botName = dealCtx.value?.bot?.name || 'bot'
      // eslint-disable-next-line no-console
      console.log(`[cardplay] ${botName} → ${cur} ${card?.suit}${card?.rank}  ${elapsedMs.toFixed(0)}ms`)
    }
    botLoading.value = false
    if (!card) return
    await recordPlay({ seat: cur, ...card })
    await sleep(dealCtx.value.pacing.betweenPlays)
    if (stale()) return
  }
}

async function callBotForSeat(seat) {
  const ctx = dealCtx.value
  const isOpeningLead = played.value.length === 0
  const remaining = computeRemaining(ctx.hands, played.value)
  const legalCards = getLegalCards(remaining[seat], currentTrick.plays)

  // Decision-maker perspective: declarer for declarer-side plays, defender
  // for defender plays. This matches BEN's seat-param convention and is also
  // how a human plays cards (declarer drives dummy's card).
  const isDeclarerSide = SIDE_OF[seat] === SIDE_OF[ctx.declarer]
  const decisionMakerSeat = isDeclarerSide ? ctx.declarer : seat

  const baseCtx = {
    hand: ctx.hands[decisionMakerSeat],
    seat,                                    // physically-playing seat
    decisionMakerSeat,                       // for adapters that need it (BEN)
    declarer: ctx.declarer,
    dealer: ctx.dealer,
    vulnerable: ctx.vulnerable,
    contract: ctx.contract,
    bids: ctx.bids,
    legalCards,
  }
  if (isOpeningLead) {
    return await ctx.bot.chooseOpeningLead(baseCtx)
  }
  return await ctx.bot.chooseCard({
    ...baseCtx,
    dummy: ctx.hands[ctx.dummySeat],
    played: played.value,
    currentTrick: { leader: currentTrick.leader, plays: currentTrick.plays.slice() },
  })
}

async function recordPlay({ seat, suit, rank }) {
  // Validate the play one more time — bots SHOULD return only legal cards,
  // but if they don't we want to surface it clearly rather than corrupt state.
  const remaining = computeRemaining(dealCtx.value.hands, played.value)
  if (!isLegalPlay({ suit, rank }, remaining[seat], currentTrick.plays)) {
    throw new Error(`recordPlay: ${seat} cannot play ${suit}${rank} — not in hand or revokes lead suit`)
  }
  currentTrick.plays.push({ seat, suit, rank })
  played.value = [...played.value, { seat, suit, rank }]
  // Opening lead — reveal dummy now (after the card hits the table).
  if (played.value.length === 1) {
    dummyRevealed.value = true
  }
}

async function finalizeTrick() {
  const trump = dealCtx.value.trump
  const plays = currentTrick.plays.slice()
  const winner = trickWinner(plays, trump)
  const finished = { leader: currentTrick.leader, plays, winner }

  // Let the UI render the completed trick for a moment before clearing.
  lastFinishedTrick.value = finished
  await sleep(dealCtx.value.pacing.betweenTricks)

  completedTricks.value = [...completedTricks.value, finished]
  tricksTaken.value = {
    ...tricksTaken.value,
    [SIDE_OF[winner]]: tricksTaken.value[SIDE_OF[winner]] + 1,
  }
  currentTrick.leader = winner
  currentTrick.plays = []
  lastFinishedTrick.value = null
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// If the user flips the autoplay-singletons toggle while the engine is
// parked at a user-singleton seat, kick the advance loop so the play
// happens without requiring an explicit click.
watch(autoplayUserSingletons, (v) => {
  if (!v) return
  if (!isActive.value || playComplete.value) return
  if (botLoading.value) return
  void advanceBotsIfTheirTurn()
})

// ── Exported reactive surface ──────────────────────────────────────────

export function useCardPlay() {
  return {
    // state
    isActive,
    currentTrick,
    completedTricks,
    played,
    tricksTaken,
    dummyRevealed,
    botLoading,
    botError,
    lastFinishedTrick,
    botLatencies,
    autoplayUserSingletons,
    claim,
    // derived
    playComplete,
    currentPlayer,
    playedBySeat,
    hiddenSeats,
    clickableSeat,
    legalCardsForCurrent,
    botStats,
    remainingTricks,
    // actions
    startPlay,
    reset,
    onUserCard,
    claimTricks,
    validateClaim,
  }
}
