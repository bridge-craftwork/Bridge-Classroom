import { ref, computed, reactive } from 'vue'
import { getSeatForBid } from '../utils/pbnParser.js'
import { useObservationStore } from './useObservationStore.js'

/**
 * Unified composable for deal practice — single step array architecture.
 *
 * All interactive control tags ([BID], [NEXT], [ROTATE], [choose-card]) are parsed
 * into a single ordered steps array by the parser. This composable walks through
 * that array with one index, using sub-states for auction and card-choice tracking.
 */
export function useDealPractice() {
  const observationStore = useObservationStore()

  // Current deal
  const currentDeal = ref(null)

  // ==================== UNIFIED STEP STATE ====================
  const currentStepIndex = ref(0)
  const complete = ref(false)
  const bidAnswered = ref(false)  // true when bid answered but explanation not yet dismissed

  // Auction sub-state (for bid steps)
  const auctionState = reactive({
    displayedBids: [],
    currentBidIndex: 0,
    wrongBid: null,
    correctBid: null,
    wrongBidIndex: -1,
    correctBidIndex: -1,
    auctionComplete: false
  })

  // Card choice sub-state (for choose-card steps)
  const cardChoiceState = reactive({
    answered: {},         // { stepIndex: true }
    wrongCard: null,
    correctCard: null
  })

  // Board scoring
  const boardState = reactive({
    boardHadWrong: false,
    correctCount: 0,
    wrongCount: 0,
    wrongStepIndices: {},  // tracks which step indices had wrong answers (for back-up-fix)
    studentBidStepIndices: {},  // step indices the student bid (vs partner's auto-played calls)
    promptHistory: [],     // accumulates per-prompt details for the observation
    observationId: null    // stable UUID for upsert — generated per board attempt
  })

  // Track played cards { N: [{suit, card}], E: [], S: [], W: [] }
  const playedCards = ref({ N: [], E: [], S: [], W: [] })

  // Timing for observations
  const promptStartTime = ref(null)
  const currentAttemptNumber = ref(1)

  // ==================== COMPUTED: Steps ====================
  const steps = computed(() => currentDeal.value?.steps || [])
  const hasSteps = computed(() => steps.value.length > 0)
  const currentStep = computed(() => steps.value[currentStepIndex.value] || null)
  const hasBidSteps = computed(() => steps.value.some(s => s.type === 'bid'))
  const isBidStep = computed(() => currentStep.value?.type === 'bid')

  // Index from which to start rendering commentary (after most recent clearCommentary)
  const commentaryStartIndex = computed(() => {
    for (let i = currentStepIndex.value; i >= 0; i--) {
      if (steps.value[i]?.clearCommentary) return i
    }
    return 0
  })

  // ==================== COMPUTED: Bidding ====================
  const studentSeat = computed(() => currentDeal.value?.studentSeat || 'S')

  const currentTurnSeat = computed(() => {
    if (!currentDeal.value) return null
    return getSeatForBid(auctionState.currentBidIndex, currentDeal.value.auctionDealer || currentDeal.value.dealer)
  })

  const isStudentTurn = computed(() => currentTurnSeat.value === studentSeat.value)

  // Does current step require a bid from the student?
  const hasBidPrompt = computed(() => {
    if (!isBidStep.value || !isStudentTurn.value) return false
    if (auctionState.auctionComplete) return false
    if (bidAnswered.value) return false  // bid answered, showing explanation

    const step = currentStep.value
    if (!step?.bid) return false

    const expectedBid = currentDeal.value?.auction?.[auctionState.currentBidIndex]
    if (!expectedBid) return false

    return normalizeBid(step.bid) === normalizeBid(expectedBid)
  })

  // Last contract bid (for bidding box validation)
  const lastContractBid = computed(() => {
    for (let i = auctionState.displayedBids.length - 1; i >= 0; i--) {
      const bid = auctionState.displayedBids[i]
      if (bid && bid !== 'Pass' && bid !== 'X' && bid !== 'XX') {
        return bid
      }
    }
    return null
  })

  // Can double?
  const canDouble = computed(() => {
    if (!currentDeal.value || auctionState.displayedBids.length === 0) return false
    const last = auctionState.displayedBids[auctionState.displayedBids.length - 1]
    if (last === 'X' || last === 'XX') return false
    if (!lastContractBid.value) return false

    let lastContractIdx = -1
    for (let i = auctionState.displayedBids.length - 1; i >= 0; i--) {
      const bid = auctionState.displayedBids[i]
      if (bid && bid !== 'Pass' && bid !== 'X' && bid !== 'XX') {
        lastContractIdx = i
        break
      }
    }
    if (lastContractIdx === -1) return false

    const lastContractSeat = getSeatForBid(lastContractIdx, currentDeal.value.auctionDealer || currentDeal.value.dealer)
    const currentSeat = currentTurnSeat.value
    const isOpponent = (
      (currentSeat === 'N' || currentSeat === 'S') && (lastContractSeat === 'E' || lastContractSeat === 'W')
    ) || (
      (currentSeat === 'E' || currentSeat === 'W') && (lastContractSeat === 'N' || lastContractSeat === 'S')
    )
    return isOpponent
  })

  // Can redouble?
  const canRedouble = computed(() => {
    if (!currentDeal.value || auctionState.displayedBids.length === 0) return false
    for (let i = auctionState.displayedBids.length - 1; i >= 0; i--) {
      const bid = auctionState.displayedBids[i]
      if (bid === 'Pass') continue
      if (bid === 'XX') return false
      if (bid === 'X') {
        const doubleSeat = getSeatForBid(i, currentDeal.value.auctionDealer || currentDeal.value.dealer)
        const currentSeat = currentTurnSeat.value
        const isPartner = (
          (currentSeat === 'N' && doubleSeat === 'S') ||
          (currentSeat === 'S' && doubleSeat === 'N') ||
          (currentSeat === 'E' && doubleSeat === 'W') ||
          (currentSeat === 'W' && doubleSeat === 'E')
        )
        return !isPartner
      }
      return false
    }
    return false
  })

  // ==================== COMPUTED: Card Choice ====================
  const hasCardChoice = computed(() => {
    const step = currentStep.value
    if (!step?.chooseCard) return false
    return !cardChoiceState.answered[currentStepIndex.value]
  })

  const currentChooseCard = computed(() => currentStep.value?.chooseCard || null)

  // ==================== COMPUTED: Hand Visibility ====================
  // Walk steps[0..currentStepIndex], applying showSeats with REPLACEMENT semantics
  const hiddenSeats = computed(() => {
    if (!currentDeal.value) return []
    const allSeats = ['N', 'E', 'S', 'W']

    if (!hasSteps.value) {
      // Display-only deal — show all hands
      return []
    }

    // Walk through steps to find the latest [SHOW] directive
    let showSeats = null
    const stepsList = steps.value
    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      const step = stepsList[i]
      if (step?.showSeats) {
        showSeats = step.showSeats  // replacement, not cumulative
      }
      // For bid steps, apply showSeatsAfter if we've passed this step or bid is answered
      if (step?.showSeatsAfter && (i < currentStepIndex.value || (i === currentStepIndex.value && bidAnswered.value))) {
        showSeats = step.showSeatsAfter
      }
    }

    if (showSeats) {
      return allSeats.filter(seat => !showSeats.includes(seat))
    }

    // No [SHOW] directive found — hide all seats
    return allSeats
  })

  // Showcards - specific cards to show from otherwise hidden hands
  // Also tracks showcards for fully-shown seats (these represent already-played cards)
  const currentShowcards = computed(() => {
    if (!currentDeal.value || !hasSteps.value) return null

    let showcards = {}
    const stepsList = steps.value

    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      const step = stepsList[i]

      if (step?.showcards) {
        for (const [seat, cards] of Object.entries(step.showcards)) {
          showcards[seat] = cards
        }
      }

      // If this step reveals a seat fully, clear its showcards
      if (step?.showSeats) {
        for (const seat of step.showSeats) {
          delete showcards[seat]
        }
      }
      if (step?.showSeatsAfter && (i < currentStepIndex.value || (i === currentStepIndex.value && bidAnswered.value))) {
        for (const seat of step.showSeatsAfter) {
          delete showcards[seat]
        }
      }
    }

    return Object.keys(showcards).length > 0 ? showcards : null
  })

  // Track showcards for seats that are also fully shown.
  // When [showcards W:SK] and [show NW] appear together, the SK was already
  // played (e.g. opening lead) and should be highlighted and non-clickable.
  const showcardsPlayedCards = computed(() => {
    if (!currentDeal.value || !hasSteps.value) return {}

    let showcards = {}
    let shownSeats = new Set()
    const stepsList = steps.value

    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      const step = stepsList[i]

      if (step?.showcards) {
        for (const [seat, cards] of Object.entries(step.showcards)) {
          showcards[seat] = cards
        }
      }

      if (step?.showSeats) {
        for (const seat of step.showSeats) {
          shownSeats.add(seat)
        }
      }
    }

    // Return showcards only for seats that are fully shown
    const played = {}
    for (const [seat, cards] of Object.entries(showcards)) {
      if (shownSeats.has(seat)) {
        played[seat] = cards
      }
    }
    return played
  })

  // Seats that have showcards should not be hidden
  const seatsWithShowcards = computed(() => {
    const showcards = currentShowcards.value
    if (!showcards) return []
    return Object.keys(showcards)
  })

  // Effective hidden seats: hidden minus any that have showcards
  const effectiveHiddenSeats = computed(() => {
    const hidden = hiddenSeats.value
    const withShowcards = seatsWithShowcards.value
    if (!withShowcards.length) return hidden
    return hidden.filter(seat => !withShowcards.includes(seat))
  })

  // Helper to convert showcards format to hand object
  function showcardsToHand(cards) {
    const hand = { spades: [], hearts: [], diamonds: [], clubs: [] }
    const suitMap = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
    for (const card of cards) {
      const suit = card[0].toUpperCase()
      const rank = card.slice(1).toUpperCase()
      const suitName = suitMap[suit]
      if (suitName) {
        hand[suitName].push(rank)
      }
    }
    return hand
  }

  // Hands with played cards removed
  const hands = computed(() => {
    if (!currentDeal.value?.hands) return {}

    // If current step has [RESET] flag, show original hands
    if (currentStep.value?.reset) {
      return currentDeal.value.hands
    }

    const showcards = currentShowcards.value
    const result = {}

    for (const seat of ['N', 'E', 'S', 'W']) {
      if (showcards && showcards[seat]) {
        result[seat] = showcardsToHand(showcards[seat])
        continue
      }

      const hand = currentDeal.value.hands[seat]
      if (!hand) {
        result[seat] = null
        continue
      }

      result[seat] = {
        spades: [...(hand.spades || [])],
        hearts: [...(hand.hearts || [])],
        diamonds: [...(hand.diamonds || [])],
        clubs: [...(hand.clubs || [])]
      }
      for (const played of playedCards.value[seat]) {
        const suitName = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[played.suit]
        if (suitName && result[seat][suitName]) {
          const idx = result[seat][suitName].indexOf(played.card)
          if (idx !== -1) result[seat][suitName].splice(idx, 1)
        }
      }
    }
    return result
  })

  // Show HCP?
  const showHcp = computed(() => {
    if (hasBidSteps.value && !auctionState.auctionComplete) return false
    return true
  })

  // ==================== COMPUTED: Auction & Lead Visibility ====================
  const showAuctionTable = computed(() => {
    if (!hasSteps.value) return true

    let visible = true
    const stepsList = steps.value
    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      const step = stepsList[i]
      if (step?.showAuction !== null && step?.showAuction !== undefined) {
        visible = step.showAuction
      }
    }
    return visible
  })

  const showOpeningLead = computed(() => {
    if (!hasSteps.value) return false

    const stepsList = steps.value
    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      if (stepsList[i]?.showLead) return true
    }
    return false
  })

  const openingLead = computed(() => {
    if (!currentDeal.value?.openingLead) return null
    return {
      leader: currentDeal.value.openingLeader,
      card: currentDeal.value.openingLead
    }
  })

  // ==================== COMPUTED: Completion ====================
  const isComplete = computed(() => {
    if (!hasSteps.value) return true  // Display-only
    if (complete.value) return true
    // On last step, type 'end', and no pending card choice
    const step = currentStep.value
    if (step?.type === 'end' && !hasCardChoice.value) return true
    return false
  })

  const canGoBack = computed(() => {
    if (!hasSteps.value) return false
    // Can go back if showing bid explanation
    if (bidAnswered.value) return true
    // Can go back if we've advanced past step 0
    if (currentStepIndex.value > 0) return true
    // On step 0 but a bid has been answered
    if (isBidStep.value && auctionState.currentBidIndex > 0) return true
    return false
  })

  // ==================== METHODS: Visibility & Plays ====================
  function updateVisibilityAndPlays() {
    // Recalculate played cards by walking steps
    playedCards.value = { N: [], E: [], S: [], W: [] }
    const stepsList = steps.value
    for (let i = 0; i <= currentStepIndex.value && i < stepsList.length; i++) {
      const step = stepsList[i]
      if (!step?.plays?.length) continue
      for (const playStr of step.plays) {
        const plays = playStr.split(/[,\s]+/)
        for (const play of plays) {
          if (!play) continue
          const match = play.trim().match(/^([NESW]):([SHDC])(.+)$/i)
          if (match) {
            const seat = match[1].toUpperCase()
            const suit = match[2].toUpperCase()
            let card = match[3].toUpperCase()
            if (card === '10') card = 'T'
            playedCards.value[seat].push({ suit, card })
          }
        }
      }
    }
  }

  // ==================== METHODS: Auction ====================
  /**
   * Advance through the auction, auto-playing non-student bids
   * until we reach the next student prompt or the auction ends.
   * Called after loadDeal and after each successful makeBid.
   */
  function advanceAuctionToNextPrompt() {
    if (!currentDeal.value) return
    const auction = currentDeal.value.auction || []

    // Find the next bid step from current position
    const nextBidStepIdx = findNextBidStep(currentStepIndex.value)

    // If no more bid steps, play out the rest of the auction
    if (nextBidStepIdx === -1) {
      while (auctionState.currentBidIndex < auction.length) {
        auctionState.displayedBids.push(auction[auctionState.currentBidIndex])
        auctionState.currentBidIndex++
      }
      auctionState.auctionComplete = true
      promptStartTime.value = null
      return
    }

    // Advance through bids until we reach the prompted student bid
    const targetStep = steps.value[nextBidStepIdx]
    const targetBid = normalizeBid(targetStep.bid)

    while (auctionState.currentBidIndex < auction.length) {
      const currentSeat = getSeatForBid(auctionState.currentBidIndex, currentDeal.value.auctionDealer || currentDeal.value.dealer)
      const currentBid = normalizeBid(auction[auctionState.currentBidIndex])

      // Is this the prompted student bid?
      if (currentSeat === studentSeat.value && currentBid === targetBid) {
        promptStartTime.value = Date.now()
        currentAttemptNumber.value = 1
        return
      }

      // Auto-play this bid
      auctionState.displayedBids.push(auction[auctionState.currentBidIndex])
      auctionState.currentBidIndex++
    }

    // Reached end of auction
    auctionState.auctionComplete = true
    promptStartTime.value = null
  }

  /**
   * Find the next bid step at or after startIdx that hasn't been answered yet.
   * Returns step index or -1 if none.
   */
  function findNextBidStep(startIdx) {
    const stepsList = steps.value
    for (let i = startIdx; i < stepsList.length; i++) {
      if (stepsList[i].type === 'bid') return i
    }
    return -1
  }

  function makeBid(bid) {
    if (!currentDeal.value || auctionState.auctionComplete) return false
    if (!isBidStep.value) return false

    const expectedBid = currentDeal.value.auction[auctionState.currentBidIndex]
    // Judgment boards may mark extra defensible calls via [ACCEPT ...]; accept
    // those alongside the recorded call. The auction still advances on the
    // recorded call (expectedBid) — acceptedBids only affects scoring.
    const acceptedBids = currentStep.value?.acceptedBids || []
    const isCorrect = normalizeBid(bid) === normalizeBid(expectedBid) ||
      acceptedBids.some(a => normalizeBid(a) === normalizeBid(bid))
    const stepIdx = currentStepIndex.value

    // This step is the student's own bid (vs partner's auto-played calls) —
    // drives the feedback fade in the scrollback.
    boardState.studentBidStepIndices[stepIdx] = true

    // Track wrong steps
    if (!isCorrect) {
      boardState.wrongStepIndices[stepIdx] = true
      boardState.boardHadWrong = true
    } else if (stepIdx in boardState.wrongStepIndices) {
      delete boardState.wrongStepIndices[stepIdx]
    }

    // Record prompt history for the board observation
    const bidPromptIndex = steps.value.slice(0, stepIdx + 1).filter(s => s.type === 'bid').length - 1
    const elapsed = promptStartTime.value ? Date.now() - promptStartTime.value : 0
    boardState.promptHistory.push({
      type: 'bid',
      prompt_index: bidPromptIndex,
      auction_so_far: [...auctionState.displayedBids],
      expected_bid: expectedBid,
      student_bid: bid,
      correct: isCorrect,
      time_ms: elapsed
    })

    // Record/upsert observation immediately on wrong answer
    if (!isCorrect) {
      recordBoardObservation(false)
    }

    // Capture bid position before advancing
    const bidPosition = auctionState.currentBidIndex

    // Always advance the auction after any bid attempt
    auctionState.displayedBids.push(currentDeal.value.auction[auctionState.currentBidIndex])
    auctionState.currentBidIndex++
    promptStartTime.value = null
    currentAttemptNumber.value = 1

    if (isCorrect) {
      auctionState.wrongBid = null
      auctionState.correctBid = null
      auctionState.wrongBidIndex = -1
    } else {
      auctionState.wrongBid = bid
      auctionState.correctBid = expectedBid
      auctionState.wrongBidIndex = bidPosition
    }

    // Check what comes next
    const nextStepIdx = currentStepIndex.value + 1
    const nextStep = steps.value[nextStepIdx]

    if (nextStep?.type === 'bid') {
      // Next step is also a bid — advance immediately and keep going
      currentStepIndex.value = nextStepIdx
      bidAnswered.value = false
      advanceAuctionToNextPrompt()
    } else {
      // Next step is not a bid — pause to show explanation
      bidAnswered.value = true
      finishAuctionIfNeeded()

      // If this is the last step, auto-complete.
      // Wrong answers are already recorded via upsert, so it's safe to complete.
      if (currentStepIndex.value >= steps.value.length - 1) {
        markComplete()
      }
    }

    return isCorrect
  }

  function finishAuctionIfNeeded() {
    if (auctionState.auctionComplete) return
    // Check if there are more bid steps ahead (after current)
    const nextBid = findNextBidStep(currentStepIndex.value + 1)
    if (nextBid === -1) {
      // No more bid steps — play out remaining auction
      const auction = currentDeal.value?.auction || []
      while (auctionState.currentBidIndex < auction.length) {
        auctionState.displayedBids.push(auction[auctionState.currentBidIndex])
        auctionState.currentBidIndex++
      }
      auctionState.auctionComplete = true
    }
  }

  function clearFeedback() {
    auctionState.wrongBid = null
    auctionState.correctBid = null
    auctionState.wrongBidIndex = -1
    auctionState.correctBidIndex = -1
  }

  // ==================== METHODS: Card Choice ====================
  function makeCardChoice(suitLetter, rank) {
    if (!currentDeal.value || !hasCardChoice.value) return false

    const chooseCard = currentChooseCard.value
    if (!chooseCard) return false

    const chosen = (suitLetter + rank).toUpperCase()
    const stepIdx = currentStepIndex.value

    let isCorrect = false
    let expectedDisplay = ''
    if (chooseCard.anyOf) {
      isCorrect = chooseCard.cards.includes(chosen)
      expectedDisplay = chooseCard.cards[0]
    } else {
      isCorrect = chosen === chooseCard.card
      expectedDisplay = chooseCard.card
    }

    // Track wrong steps
    if (!isCorrect) {
      boardState.wrongStepIndices[stepIdx] = true
      boardState.boardHadWrong = true
    } else if (stepIdx in boardState.wrongStepIndices) {
      delete boardState.wrongStepIndices[stepIdx]
    }

    // Record prompt history for the board observation
    const cardElapsed = promptStartTime.value ? Date.now() - promptStartTime.value : 0
    boardState.promptHistory.push({
      type: 'card',
      expected_card: expectedDisplay,
      student_card: chosen,
      correct: isCorrect,
      time_ms: cardElapsed
    })
    promptStartTime.value = null

    // Record/upsert observation immediately on wrong answer
    if (!isCorrect) {
      recordBoardObservation(false)
    }

    // Mark step as answered
    cardChoiceState.answered[stepIdx] = true

    if (isCorrect) {
      cardChoiceState.wrongCard = null
      cardChoiceState.correctCard = null
    } else {
      cardChoiceState.wrongCard = chosen
      cardChoiceState.correctCard = expectedDisplay
    }

    // Advance to next step
    advance()

    return isCorrect
  }

  function clearCardFeedback() {
    cardChoiceState.wrongCard = null
    cardChoiceState.correctCard = null
  }

  // ==================== METHODS: Navigation ====================
  /**
   * Advance to the next step. Blocks if current step needs unanswered bid or card choice.
   * For bid steps, use makeBid() instead — it calls advance internally.
   */
  function advance() {
    // Block if current step needs unanswered input
    if (hasBidPrompt.value) return false
    if (hasCardChoice.value) return false

    // If we're showing a bid explanation, dismiss it and move to next step
    if (bidAnswered.value) {
      bidAnswered.value = false
    }

    if (currentStepIndex.value < steps.value.length - 1) {
      currentStepIndex.value++
      updateVisibilityAndPlays()

      // If new step is a bid, advance auction to it
      if (steps.value[currentStepIndex.value]?.type === 'bid') {
        advanceAuctionToNextPrompt()
      }

      // Start timing for card-choice steps
      if (steps.value[currentStepIndex.value]?.type === 'choose-card') {
        promptStartTime.value = Date.now()
      }

      // Auto-complete if we landed on the last step and it needs no interaction
      if (currentStepIndex.value >= steps.value.length - 1) {
        const step = steps.value[currentStepIndex.value]
        if (step?.type !== 'bid' && step?.type !== 'choose-card') {
          markComplete()
        }
      }
      return true
    }

    // At end of steps (fallback)
    markComplete()
    return false
  }

  function markComplete() {
    complete.value = true
    onBoardComplete()
  }

  function onBoardComplete() {
    // Check if this deal had any interactive steps (bid or choose-card)
    const hadInteractive = steps.value.some(s => s.type === 'bid' || s.type === 'choose-card')
    if (!hadInteractive) return

    if (boardState.boardHadWrong) {
      boardState.wrongCount++
    } else {
      boardState.correctCount++
    }

    const allFixed = Object.keys(boardState.wrongStepIndices).length === 0
    const correct = !boardState.boardHadWrong || allFixed
    recordBoardObservation(correct)
  }

  function goBack() {
    clearFeedback()
    clearCardFeedback()

    // If showing bid explanation, go back to the unanswered bid
    if (bidAnswered.value) {
      bidAnswered.value = false
      rewindAuctionToStep(currentStepIndex.value)
      return true
    }

    if (currentStepIndex.value > 0) {
      const prevIdx = currentStepIndex.value - 1
      const prevStep = steps.value[prevIdx]

      // If going back to a card-choice step, clear its answered state
      if (cardChoiceState.answered[prevIdx]) {
        delete cardChoiceState.answered[prevIdx]
      }

      // If going back to a bid step, rewind the auction
      if (prevStep?.type === 'bid') {
        rewindAuctionToStep(prevIdx)
      }

      currentStepIndex.value = prevIdx
      complete.value = false
      bidAnswered.value = false
      updateVisibilityAndPlays()
      return true
    }

    // On step 0 with a completed bid — rewind to let user retry
    if (isBidStep.value && auctionState.currentBidIndex > 0) {
      rewindAuctionToStep(0)
      complete.value = false
      bidAnswered.value = false
      return true
    }

    return false
  }

  /**
   * Rewind the auction display to the state it was in when we arrived at stepIdx
   * (i.e., the bid for this step hasn't been made yet)
   */
  function rewindAuctionToStep(stepIdx) {
    const step = steps.value[stepIdx]
    if (!step || step.type !== 'bid') return

    const targetBid = normalizeBid(step.bid)
    const auction = currentDeal.value?.auction || []

    // Find where this bid is in the auction
    let targetBidIndex = 0
    for (let i = 0; i < auction.length; i++) {
      if (normalizeBid(auction[i]) === targetBid) {
        targetBidIndex = i
        break
      }
    }

    auctionState.currentBidIndex = targetBidIndex
    auctionState.displayedBids = auction.slice(0, targetBidIndex)
    auctionState.auctionComplete = false
    promptStartTime.value = Date.now()
    currentAttemptNumber.value = 1
  }

  // ==================== METHODS: Observations ====================
  async function recordBoardObservation(correct) {
    if (!currentDeal.value) return
    const boardResult = !correct ? 'failed'
      : boardState.boardHadWrong ? 'corrected'
      : 'correct'
    try {
      await observationStore.recordObservation({
        observationId: boardState.observationId,
        deal: currentDeal.value,
        promptIndex: -1,
        auctionSoFar: [...auctionState.displayedBids],
        expectedBid: 'BOARD',
        studentBid: correct ? 'PASS' : 'FAIL',
        correct,
        attemptNumber: 1,
        timeTakenMs: 0,
        prompts: [...boardState.promptHistory],
        boardResult
      })
    } catch (err) {
      console.error('Failed to record board observation:', err)
    }
  }

  // ==================== METHODS: General ====================
  function loadDeal(deal) {
    currentDeal.value = deal

    // Reset unified state
    currentStepIndex.value = 0
    complete.value = false
    bidAnswered.value = false

    // Reset auction sub-state
    auctionState.displayedBids = []
    auctionState.currentBidIndex = 0
    auctionState.wrongBid = null
    auctionState.correctBid = null
    auctionState.wrongBidIndex = -1
    auctionState.correctBidIndex = -1
    auctionState.auctionComplete = false

    // Reset card choice sub-state
    cardChoiceState.answered = {}
    cardChoiceState.wrongCard = null
    cardChoiceState.correctCard = null

    // Reset board scoring
    boardState.boardHadWrong = false
    boardState.wrongStepIndices = {}
    boardState.studentBidStepIndices = {}
    boardState.promptHistory = []
    boardState.observationId = crypto.randomUUID()

    // Reset plays
    playedCards.value = { N: [], E: [], S: [], W: [] }

    // Reset timing
    promptStartTime.value = null
    currentAttemptNumber.value = 1

    if (deal?.steps?.length) {
      updateVisibilityAndPlays()

      // If first step is a bid, advance auction to it
      if (deal.steps[0]?.type === 'bid') {
        advanceAuctionToNextPrompt()
      }
    }
  }

  function resetStats() {
    boardState.correctCount = 0
    boardState.wrongCount = 0
  }

  function normalizeBid(bid) {
    if (!bid) return ''
    let normalized = bid
      .replace(/!/g, '')
      .replace(/♠/g, 'S').replace(/♥/g, 'H').replace(/♦/g, 'D').replace(/♣/g, 'C')
    const upper = normalized.toUpperCase()
    if (upper === 'PASS' || upper === 'P') return 'PASS'
    if (upper === 'X' || upper === 'DBL' || upper === 'DOUBLE') return 'X'
    if (upper === 'XX' || upper === 'RDBL' || upper === 'REDOUBLE') return 'XX'
    return upper.replace(/(\d)N$/, '$1NT')
  }

  return {
    // State
    currentDeal,
    currentStepIndex,
    bidAnswered,
    auctionState,
    cardChoiceState,
    boardState,

    // Computed: Steps
    steps,
    hasSteps,
    currentStep,
    hasBidSteps,
    isBidStep,
    commentaryStartIndex,

    // Computed: Bidding
    studentSeat,
    currentTurnSeat,
    isStudentTurn,
    hasBidPrompt,
    lastContractBid,
    canDouble,
    canRedouble,
    canGoBack,

    // Computed: Card Choice
    hasCardChoice,
    currentChooseCard,

    // Computed: Display
    hiddenSeats: effectiveHiddenSeats,
    hands,
    showHcp,
    showcardsPlayedCards,
    isComplete,

    // Computed: Auction & Lead
    showAuctionTable,
    showOpeningLead,
    openingLead,

    // Methods
    advance,
    makeBid,
    clearFeedback,
    goBack,
    makeCardChoice,
    clearCardFeedback,
    loadDeal,
    resetStats,
    observationStore
  }
}
