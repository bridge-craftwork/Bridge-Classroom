/**
 * Observation Schema and Helpers
 *
 * An observation records a single bid prompt attempt by a student,
 * capturing the deal context, expected bid, student's response,
 * and correctness.
 */

/**
 * @typedef {Object} DealContext
 * @property {string} subfolder - Lesson category (e.g., "Stayman")
 * @property {string} [filename] - Source filename
 * @property {number} [deal_number] - Deal number in the set
 * @property {string} [kind] - Deal type (e.g., "BID+NEXT")
 * @property {string} dealer - Dealer position (N, E, S, W)
 * @property {string} [vulnerability] - Vulnerability (None, NS, EW, Both)
 * @property {string} student_seat - Student's position
 * @property {Object} hands - All four hands
 * @property {string} hands.north - North's hand
 * @property {string} hands.east - East's hand
 * @property {string} hands.south - South's hand
 * @property {string} hands.west - West's hand
 * @property {string} full_auction - Complete auction sequence
 * @property {string} [contract] - Final contract
 * @property {string} [declarer] - Declarer position
 * @property {string} [lead] - Opening lead
 */

/**
 * @typedef {Object} BidPrompt
 * @property {number} prompt_index - 0-based index of this prompt in the deal
 * @property {number} total_prompts - Total prompts in this deal
 * @property {string[]} auction_so_far - Bids made before this prompt
 * @property {string} expected_bid - The correct bid
 * @property {string} student_hand - Student's hand
 */

/**
 * @typedef {Object} BidResult
 * @property {string} student_bid - What the student actually bid
 * @property {boolean} correct - Whether it was correct
 * @property {number} attempt_number - 1 = first try, 2+ = retry
 * @property {number} time_taken_ms - Milliseconds from prompt to bid
 */

/**
 * @typedef {Object} AssignmentTag
 * @property {string} id - Assignment ID
 * @property {string} name - Assignment name
 * @property {string} [teacherName] - Teacher who assigned it
 * @property {string} assignedAt - When it was assigned
 */

/**
 * @typedef {Object} Observation
 * @property {string} observation_id - Unique ID for this observation
 * @property {string} timestamp - ISO8601 timestamp
 * @property {string} user_id - User who made this observation
 * @property {string} session_id - Practice session ID
 * @property {DealContext} deal - Deal information
 * @property {BidPrompt} bid_prompt - Bid prompt context
 * @property {BidResult} result - What happened
 * @property {string} skill_path - Skill classification (e.g., "bidding_conventions/stayman")
 * @property {AssignmentTag|null} assignment - Assignment info if part of homework
 */

/**
 * Create a new observation from a bid attempt
 * @param {Object} params
 * @param {string} params.userId - Current user ID
 * @param {string} params.sessionId - Current session ID
 * @param {Object} params.deal - Current deal object
 * @param {number} params.promptIndex - Which prompt (0-indexed)
 * @param {string[]} params.auctionSoFar - Bids shown so far
 * @param {string} params.expectedBid - The correct bid
 * @param {string} params.studentBid - What student bid
 * @param {boolean} params.correct - Was it correct
 * @param {number} params.attemptNumber - 1, 2, 3...
 * @param {number} params.timeTakenMs - Time in milliseconds
 * @param {string} params.skillPath - Skill classification
 * @param {AssignmentTag|null} [params.assignment] - Assignment if applicable
 * @returns {Observation}
 */
export function createObservation({
  observationId = null,
  userId,
  sessionId,
  deal,
  promptIndex,
  auctionSoFar,
  expectedBid,
  studentBid,
  correct,
  attemptNumber,
  timeTakenMs,
  skillPath,
  assignment = null,
  prompts = null,
  boardResult = null,
  // Correctness & Mastery v2 context — see CORRECTNESS_AND_MASTERY.md §11.1.
  // The practice flow supplies whichever of these applies; the backend
  // derives wilderness from the combination. Default values mean "regular
  // self-directed lesson practice → Tame".
  exerciseId = null,
  jungle = false
}) {
  const totalPrompts = deal.steps?.filter(s => s.type === 'bid').length || 1
  const studentSeat = deal.studentSeat || 'S'
  const studentHand = deal.hands?.[studentSeat.toLowerCase()] || ''

  return {
    observation_id: observationId || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    user_id: userId,
    session_id: sessionId,

    deal: {
      subfolder: deal.subfolder || deal.category || 'Unknown',
      filename: deal.filename || null,
      deal_number: deal.boardNumber || deal.dealNumber || null,
      kind: deal.kind || null,
      dealer: deal.dealer || 'N',
      vulnerability: deal.vulnerable || 'None',
      student_seat: studentSeat,
      hands: {
        north: deal.hands?.N || deal.hands?.north || '',
        east: deal.hands?.E || deal.hands?.east || '',
        south: deal.hands?.S || deal.hands?.south || '',
        west: deal.hands?.W || deal.hands?.west || ''
      },
      full_auction: deal.auction?.join(' ') || '',
      contract: deal.contract || null,
      declarer: deal.declarer || null,
      lead: deal.lead || null
    },

    bid_prompt: {
      prompt_index: promptIndex,
      total_prompts: totalPrompts,
      auction_so_far: [...auctionSoFar],
      expected_bid: expectedBid,
      student_hand: studentHand
    },

    result: {
      student_bid: studentBid,
      correct,
      attempt_number: attemptNumber,
      time_taken_ms: timeTakenMs
    },

    skill_path: skillPath,
    board_result: boardResult,
    assignment,
    prompts: prompts || [],
    exercise_id: exerciseId,
    jungle
  }
}

/**
 * Extract metadata from an observation for server-side queries.
 *
 * The new clear-text context fields (exercise_id, assignment_id,
 * jungle) drive the wilderness derivation on the backend — see
 * CORRECTNESS_AND_MASTERY.md §11.1. Practice flows that originate
 * from an exercise/assignment/jungle must populate the corresponding
 * field when constructing the observation; the defaults below mean
 * "regular self-directed lesson practice → Tame".
 *
 * @param {Observation} observation
 * @param {string} classroom - User's classroom
 * @returns {Object} Metadata object
 */
export function extractMetadata(observation, classroom) {
  return {
    observation_id: observation.observation_id,
    user_id: observation.user_id,
    session_id: observation.session_id,
    timestamp: observation.timestamp,
    skill_path: observation.skill_path,
    correct: observation.result.correct,
    board_result: observation.board_result || null,
    classroom: classroom || null,
    deal_subfolder: observation.deal.subfolder,
    deal_number: observation.deal.deal_number,
    // Correctness & Mastery v2 context (clear-text). Lifted from the
    // observation body so the backend can derive wilderness without
    // decryption.
    exercise_id: observation.exercise_id || null,
    assignment_id: observation.assignment?.id || null,
    jungle: observation.jungle === true,
    // Total time the student spent on this board, in ms. Sum of
    // per-prompt times when we have a prompts[] array (board-level
    // observations), else the single per-prompt time. Lifted into
    // the clear so the teacher's assignment-duration analytics
    // doesn't need to decrypt the blob (issue #7).
    time_taken_ms: computeTotalTimeMs(observation)
  }
}

/**
 * Compute total board time in ms from an observation. Board-level
 * observations carry per-prompt times in `prompts[]`; prompt-level
 * observations have a single `result.time_taken_ms`. The fallback
 * returns null when neither is populated rather than 0, so the
 * backend can distinguish "we don't know" from "they took zero
 * milliseconds."
 */
function computeTotalTimeMs(observation) {
  const prompts = Array.isArray(observation.prompts) ? observation.prompts : []
  if (prompts.length > 0) {
    let total = 0
    let any = false
    for (const p of prompts) {
      const t = Number(p?.time_ms)
      if (Number.isFinite(t) && t >= 0) {
        total += t
        any = true
      }
    }
    if (any) return total
  }
  const single = Number(observation?.result?.time_taken_ms)
  if (Number.isFinite(single) && single >= 0) return single
  return null
}

/**
 * Validate an observation object
 * @param {Object} obs - Object to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateObservation(obs) {
  const errors = []

  if (!obs) {
    return { valid: false, errors: ['Observation is null or undefined'] }
  }

  // Required top-level fields
  if (!obs.observation_id) errors.push('Missing observation_id')
  if (!obs.timestamp) errors.push('Missing timestamp')
  if (!obs.user_id) errors.push('Missing user_id')
  if (!obs.session_id) errors.push('Missing session_id')

  // Deal validation
  if (!obs.deal) {
    errors.push('Missing deal object')
  } else {
    if (!obs.deal.dealer) errors.push('Missing deal.dealer')
    if (!obs.deal.student_seat) errors.push('Missing deal.student_seat')
    if (!obs.deal.hands) errors.push('Missing deal.hands')
  }

  // Bid prompt validation (relaxed for board-level observations where prompt_index === -1)
  if (!obs.bid_prompt) {
    errors.push('Missing bid_prompt object')
  } else {
    if (obs.bid_prompt.prompt_index === undefined) errors.push('Missing bid_prompt.prompt_index')
    if (obs.bid_prompt.prompt_index !== -1 && !obs.bid_prompt.expected_bid) errors.push('Missing bid_prompt.expected_bid')
  }

  // Result validation (relaxed for board-level observations)
  if (!obs.result) {
    errors.push('Missing result object')
  } else {
    if (obs.result.correct === undefined) errors.push('Missing result.correct')
  }

  // Skill path
  if (!obs.skill_path) errors.push('Missing skill_path')

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Generate a unique session ID
 * @returns {string}
 */
export function generateSessionId() {
  return crypto.randomUUID()
}
