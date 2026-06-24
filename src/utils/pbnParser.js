/**
 * PBN (Portable Bridge Notation) Parser
 * Parses PBN 2.1 format files into structured deal objects
 */

/**
 * Parse a PBN file content into an array of deals
 * @param {string} pbnContent - Raw PBN file content
 * @returns {Array} Array of parsed deal objects
 */
export function parsePbn(pbnContent) {
  const deals = []
  const lines = pbnContent.split('\n')

  let currentDeal = null
  let currentCommentary = []
  let inCommentary = false
  let commentaryBuffer = ''
  let fileBridgeContext = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Capture file-level %bridge-context: line, then skip all % header lines
    if (line.startsWith('%')) {
      const ctxMatch = line.match(/^%\s*bridge-context\s*:\s*(.+?)\s*$/i)
      if (ctxMatch) fileBridgeContext = ctxMatch[1]
      continue
    }

    // Handle commentary blocks {...}
    if (inCommentary) {
      if (line.includes('}')) {
        commentaryBuffer += line.substring(0, line.indexOf('}'))
        currentCommentary.push(commentaryBuffer.trim())
        commentaryBuffer = ''
        inCommentary = false
      } else {
        commentaryBuffer += line + '\n'
      }
      continue
    }

    if (line.includes('{')) {
      const startIdx = line.indexOf('{')
      if (line.includes('}')) {
        // Single line commentary
        const endIdx = line.indexOf('}')
        currentCommentary.push(line.substring(startIdx + 1, endIdx).trim())
      } else {
        // Multi-line commentary starts
        commentaryBuffer = line.substring(startIdx + 1) + '\n'
        inCommentary = true
      }
      continue
    }

    // Parse [Play "X"]card format (opening lead)
    const playMatch = line.match(/\[Play\s+"([NESW])"\](\w+)/)
    if (playMatch && currentDeal) {
      currentDeal.openingLeader = playMatch[1]
      currentDeal.openingLead = playMatch[2]
      continue
    }

    // Parse tag lines [TagName "value"]
    const tagMatch = line.match(/\[(\w+)\s+"([^"]*)"\]/)
    if (tagMatch) {
      const [, tagName, tagValue] = tagMatch

      if (tagName === 'Board') {
        // Save previous deal if exists
        if (currentDeal) {
          currentDeal.commentary = formatCommentary(currentCommentary)
          currentDeal.steps = parseUnifiedSteps(currentCommentary)
          currentDeal.auction = trimAuction(currentDeal.auction)
          deals.push(currentDeal)
        }
        // Start new deal
        currentDeal = createEmptyDeal()
        currentDeal.boardNumber = parseInt(tagValue, 10)
        currentDeal.bridgeContext = fileBridgeContext
        currentCommentary = []
      } else if (currentDeal) {
        switch (tagName) {
          case 'Dealer':
            currentDeal.dealer = tagValue
            break
          case 'Vulnerable':
            currentDeal.vulnerable = tagValue
            break
          case 'Contract':
            currentDeal.contract = tagValue
            break
          case 'Declarer':
            currentDeal.declarer = tagValue
            break
          case 'Student':
            currentDeal.studentSeat = tagValue
            break
          case 'Deal':
            // Keep the raw PBN string too — it's the stable key for a board
            // (board numbers drift on re-curation), used by the Report button.
            currentDeal.dealString = tagValue
            currentDeal.hands = parseDealString(tagValue)
            break
          case 'OriginalBoard':
            currentDeal.originalBoard = tagValue
            break
          case 'Auction':
            currentDeal.auctionDealer = tagValue
            break
          case 'Result':
            currentDeal.result = tagValue
            break
          // Metadata tags (embedded by lesson builder)
          case 'Event':
            currentDeal.event = tagValue
            break
          case 'SkillPath':
            currentDeal.skillPath = tagValue
            break
          case 'Category':
            currentDeal.category = tagValue
            break
          case 'Difficulty':
            currentDeal.difficulty = tagValue
            break
        }
      }
      continue
    }

    // Parse auction lines (bids after [Auction "X"]) - can span multiple lines
    if (currentDeal && currentDeal.auctionDealer) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        // Append bids from this line to the auction
        const bids = parseAuctionString(trimmed)
        currentDeal.auction.push(...bids)
      }
    }
  }

  // Don't forget the last deal
  if (currentDeal) {
    currentDeal.commentary = formatCommentary(currentCommentary)
    currentDeal.steps = parseUnifiedSteps(currentCommentary)
    currentDeal.auction = trimAuction(currentDeal.auction)
    deals.push(currentDeal)
  }

  return deals
}

/**
 * Parse commentary into a unified array of steps.
 * Splits on all interactive control tags: [BID], [NEXT], [ROTATE], [choose-card].
 * Declarative tags ([SHOW], [PLAY], [RESET], etc.) are extracted as properties within each step.
 *
 * @param {Array} commentaryParts Array of commentary strings
 * @returns {Array} Array of step objects
 */
function parseUnifiedSteps(commentaryParts) {
  if (!commentaryParts.length) return []

  const fullText = commentaryParts.join('\n\n')

  // Split on all interactive control tags, keeping the delimiters
  const pattern = /(\[BID\s+[^\]]+\]|\[NEXT\]|\[ROTATE\]|\[choose-card\s+[^\]]+\])/gi
  const parts = fullText.split(pattern)

  // If no control tags found, return empty (display-only deal)
  if (parts.length === 1) return []

  const steps = []
  let textBuffer = ''

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    // Check which control tag this is
    const bidMatch = part.match(/^\[BID\s+([^\]]+)\]$/i)
    const nextMatch = /^\[NEXT\]$/i.test(part)
    const rotateMatch = /^\[ROTATE\]$/i.test(part)
    const chooseCardMatch = part.match(/^\[choose-card\s+([^\]]+)\]$/i)

    if (bidMatch) {
      // [BID x] — text before is the prompt, text after (until next tag) is the explanation
      const cleanBid = replaceSuitSymbols(bidMatch[1]).replace(/!/g, '').trim()

      const promptText = textBuffer.trim()
      textBuffer = ''

      // Collect explanation text — everything after [BID] until the next control tag
      let explanationText = ''
      if (i + 1 < parts.length) {
        const nextPart = parts[i + 1]
        if (!nextPart.match(/^\[(?:BID|NEXT|ROTATE|choose-card)\b/i)) {
          explanationText = nextPart.trim()
          i++ // consume the explanation text
        }
      }

      // Extract declarative tags from prompt and explanation text
      const promptStep = parseStepContent(promptText, 'bid')
      const explStep = parseStepContent(explanationText, 'bid')

      steps.push({
        ...promptStep,
        type: 'bid',
        bid: cleanBid,
        explanationText: explStep.text,
        showSeatsAfter: explStep.showSeats,
      })

    } else if (nextMatch || rotateMatch) {
      const type = nextMatch ? 'next' : 'rotate'
      if (textBuffer.trim()) {
        steps.push(parseStepContent(textBuffer.trim(), type))
      }
      textBuffer = ''

    } else if (chooseCardMatch) {
      // [choose-card x] — creates a step that blocks until user clicks correct card
      const value = chooseCardMatch[1].trim()
      let chooseCard
      if (value.toLowerCase().startsWith('any:')) {
        const cards = value.substring(4).split(',').map(c => normalizeCardCode(c.trim()))
        chooseCard = { cards, anyOf: true }
      } else {
        chooseCard = { card: normalizeCardCode(value) }
      }

      if (textBuffer.trim()) {
        const step = parseStepContent(textBuffer.trim(), 'choose-card')
        step.chooseCard = chooseCard
        steps.push(step)
      }
      textBuffer = ''

    } else {
      // Plain text — accumulate
      textBuffer += part
    }
  }

  // Remaining text after last control tag becomes the final step
  if (textBuffer.trim()) {
    const step = parseStepContent(textBuffer.trim(), 'end')
    steps.push(step)
  }

  return steps
}

/**
 * Parse content of a single instruction step
 * Extracts [SHOW ...] and [PLAY ...] tags
 * @param {string} text Raw step text
 * @param {string} action Step action (next, rotate, end)
 * @returns {Object} Step object with text, action, showSeats, plays
 */
function parseStepContent(text, action) {
  // Extract [SHOW ...] tags
  let showSeats = null
  const showMatch = text.match(/\[SHOW\s+([^\]]+)\]/i)
  if (showMatch) {
    const showValue = showMatch[1].toUpperCase().trim()
    if (showValue === 'ALL') {
      showSeats = ['N', 'E', 'S', 'W']
    } else {
      // Parse any combination of seat letters: W, NS, EW, NES, NESW, etc.
      const seats = []
      if (showValue.includes('N')) seats.push('N')
      if (showValue.includes('E')) seats.push('E')
      if (showValue.includes('S')) seats.push('S')
      if (showValue.includes('W')) seats.push('W')
      if (seats.length > 0) showSeats = seats
    }
  }

  // Extract [PLAY ...] tags
  const plays = []
  const playPattern = /\[PLAY\s+([^\]]+)\]/gi
  let playMatch
  while ((playMatch = playPattern.exec(text)) !== null) {
    plays.push(playMatch[1])
  }

  // Check for [RESET] tag - resets played cards to show original deal
  const reset = /\[RESET\]/i.test(text)

  // Extract [choose-card ...] tags - card selection for defense lessons
  let chooseCard = null
  const chooseCardMatch = text.match(/\[choose-card\s+([^\]]+)\]/i)
  if (chooseCardMatch) {
    const value = chooseCardMatch[1].trim()
    if (value.toLowerCase().startsWith('any:')) {
      // Multiple correct answers: [choose-card any:DK,DA]
      const cards = value.substring(4).split(',').map(c => normalizeCardCode(c.trim()))
      chooseCard = { cards, anyOf: true }
    } else {
      // Single correct answer: [choose-card HK]
      chooseCard = { card: normalizeCardCode(value) }
    }
  }

  // Check for [AUCTION off/on] - controls auction table visibility
  let showAuction = null  // null = no change, true = show, false = hide
  const auctionOffMatch = /\[AUCTION\s+off\]/i.test(text)
  const auctionOnMatch = /\[AUCTION\s+on\]/i.test(text)
  if (auctionOffMatch) showAuction = false
  if (auctionOnMatch) showAuction = true

  // Check for [SHOW_LEAD] - display the opening lead
  const showLead = /\[SHOW_LEAD\]/i.test(text)

  // Check for [clear-commentary] - clear previous commentary display
  const clearCommentary = /\[clear-commentary\]/i.test(text)

  // Extract [showcards ...] tags - shows specific cards from hidden hands
  let showcards = null
  const showcardsMatch = text.match(/\[showcards\s+([^\]]+)\]/i)
  if (showcardsMatch) {
    const showcardsValue = showcardsMatch[1].trim()
    showcards = {}
    // Parse format like "E:S7,S:S5" or "E:S7,H3,S:S5"
    const seatPattern = /([NESW]):([^,\s]+(?:,[^,\s]+)*)/gi
    let match
    while ((match = seatPattern.exec(showcardsValue)) !== null) {
      const seat = match[1].toUpperCase()
      const cards = match[2].split(',').map(c => c.trim().toUpperCase())
      showcards[seat] = cards
    }
    if (Object.keys(showcards).length === 0) showcards = null
  }

  // Strip control tags from display text
  let displayText = text
    .replace(/\[SHOW\s+[^\]]*\]/gi, '')
    .replace(/\[PLAY\s+[^\]]*\]/gi, '')
    .replace(/\[RESET\]/gi, '')
    .replace(/\[AUCTION\s+(?:on|off)\]/gi, '')
    .replace(/\[SHOW_LEAD\]/gi, '')
    .replace(/\[showcards\s+[^\]]*\]/gi, '')
    .replace(/\[choose-card\s+[^\]]*\]/gi, '')
    .replace(/\[clear-commentary\]/gi, '')
    // Strip deal title lines (e.g., "Stayman 1", "Entries 2") - matches "Word(s) Number" at start of line
    .replace(/^[A-Z][a-zA-Z-]*(?:\s+[A-Z][a-zA-Z-]*)?\s+\d+\s*$/gim, '')
    .trim()

  return {
    text: replaceSuitSymbols(displayText),
    type: action,
    showSeats,    // null means no change, array means show these seats
    plays,        // Array of play sequences
    reset,        // true if [RESET] tag present - show original hands
    showAuction,  // null = no change, true = show, false = hide
    showLead,     // true if [SHOW_LEAD] tag present
    clearCommentary, // true if [clear-commentary] tag present - clear previous text
    showcards,    // null = no change, object = { seat: [cards] } to show
    chooseCard    // null = no card choice, object = { card } or { cards, anyOf: true }
  }
}

/**
 * Create an empty deal object with default values
 */
function createEmptyDeal() {
  return {
    boardNumber: 0,
    originalBoard: null,  // [OriginalBoard] tag — bba/ source board (drifts on re-curation)
    dealer: 'N',
    vulnerable: 'None',
    contract: '',
    declarer: '',
    studentSeat: 'S',
    hands: { N: null, E: null, S: null, W: null },
    dealString: '',       // raw [Deal] PBN string — stable key for the Report button
    auction: [],
    auctionDealer: '',
    result: '',
    commentary: '',
    steps: [],  // Unified array of {type, text, bid, showSeats, ...} parsed from control tags
    openingLeader: null,  // Position of opening leader (N/E/S/W)
    openingLead: null,    // Opening lead card (e.g., "SJ" for spade jack)
    // Metadata embedded in PBN by lesson builder
    event: '',            // Event name (e.g., "Bridge Lesson - Stayman")
    skillPath: null,      // Skill path (e.g., "bidding_conventions/stayman")
    category: null,       // Category (e.g., "Bidding Conventions")
    difficulty: null,     // Difficulty level (beginner, intermediate, advanced, mixed)
    bridgeContext: ''     // File-level %bridge-context: convention/carding summary
  }
}

/**
 * Normalize a card code to internal format
 * Converts suit+rank like "HK", "D10" to uppercase with T for 10
 * @param {string} code e.g., "HK", "D10", "s4"
 * @returns {string} Normalized code e.g., "HK", "DT", "S4"
 */
function normalizeCardCode(code) {
  const upper = code.toUpperCase()
  // Replace "10" with "T" for internal consistency
  return upper.replace('10', 'T')
}

/**
 * Parse the Deal string into hands for each seat
 * Format: "W:spades.hearts.diamonds.clubs N:... E:... S:..."
 * @param {string} dealString
 * @returns {Object} Hands object with N, E, S, W keys
 */
function parseDealString(dealString) {
  const hands = { N: null, E: null, S: null, W: null }

  // Split by space and get the 4 hands
  // First seat is indicated by prefix (e.g., "W:")
  const parts = dealString.split(' ')
  if (parts.length !== 4) return hands

  // Determine starting seat from first part
  const seatOrder = ['W', 'N', 'E', 'S']
  let startIdx = 0

  const firstPart = parts[0]
  const colonIdx = firstPart.indexOf(':')
  if (colonIdx !== -1) {
    const startSeat = firstPart.charAt(0).toUpperCase()
    startIdx = seatOrder.indexOf(startSeat)
    parts[0] = firstPart.substring(colonIdx + 1)
  }

  // Parse each hand
  for (let i = 0; i < 4; i++) {
    const seatIdx = (startIdx + i) % 4
    const seat = seatOrder[seatIdx]
    hands[seat] = parseHandString(parts[i])
  }

  return hands
}

/**
 * Parse a single hand string into suit arrays
 * Format: "AKQ.JT9.8765.432" (spades.hearts.diamonds.clubs)
 * @param {string} handString
 * @returns {Object} Hand object with spades, hearts, diamonds, clubs arrays
 */
function parseHandString(handString) {
  const suits = handString.split('.')
  if (suits.length !== 4) return null

  return {
    spades: parseCards(suits[0]),
    hearts: parseCards(suits[1]),
    diamonds: parseCards(suits[2]),
    clubs: parseCards(suits[3])
  }
}

/**
 * Parse a card string into an array of card values
 * @param {string} cardString e.g., "AKQ" or "JT9" or ""
 * @returns {Array} Array of card characters
 */
function parseCards(cardString) {
  if (!cardString) return []
  return cardString.split('')
}

/**
 * Trim auction to end after the correct number of closing passes.
 * In bridge, 3 consecutive passes after a non-pass bid end the auction.
 * If no non-pass bid was made, 4 passes (all pass) ends it.
 * @param {Array} bids - Array of normalized bid strings
 * @returns {Array} Trimmed array
 */
function trimAuction(bids) {
  let lastNonPassIndex = -1
  for (let i = 0; i < bids.length; i++) {
    if (bids[i] !== 'Pass') lastNonPassIndex = i
  }

  if (lastNonPassIndex === -1) {
    // All passes - keep at most 4
    return bids.slice(0, 4)
  }

  // Keep 3 passes after the last non-pass bid
  return bids.slice(0, lastNonPassIndex + 4)
}

/**
 * Parse the auction string into an array of bids
 * @param {string} auctionString e.g., "1S 2H 3H pass 4S pass pass pass"
 * @returns {Array} Array of bid strings
 */
function parseAuctionString(auctionString) {
  const tokens = auctionString
    .split(/\s+/)
    .filter(bid => bid.length > 0)
    // Filter out PBN annotation markers like =1=, =2=, etc.
    .filter(bid => !/^=\d+=?$/.test(bid))

  // Expand AP (All Pass) into individual Pass entries
  const bids = []
  for (const token of tokens) {
    if (token.toUpperCase() === 'AP') {
      // AP means all remaining players pass — need 3 passes to close the auction
      bids.push('Pass', 'Pass', 'Pass')
    } else {
      bids.push(normalizeBid(token))
    }
  }
  return bids
}

/**
 * Normalize a bid string to consistent format
 * @param {string} bid
 * @returns {string} Normalized bid
 */
function normalizeBid(bid) {
  const upper = bid.replace(/!/g, '').toUpperCase()
  if (upper === 'PASS' || upper === 'P') return 'Pass'
  if (upper === 'X' || upper === 'DBL' || upper === 'DOUBLE') return 'X'
  if (upper === 'XX' || upper === 'RDBL' || upper === 'REDOUBLE') return 'XX'
  return upper // e.g., "1S", "2NT", "3H"
}

/**
 * Format commentary text, converting suit symbols
 * @param {Array} commentaryParts Array of commentary strings
 * @returns {string} Formatted commentary
 */
function formatCommentary(commentaryParts) {
  if (!commentaryParts.length) return ''

  return replaceSuitSymbols(commentaryParts.join('\n\n'))
}

/**
 * Replace suit escape sequences with symbols
 * @param {string} text
 * @returns {string}
 */
function replaceSuitSymbols(text) {
  return text
    .replace(/\\S/g, '♠')
    .replace(/\\H/g, '♥')
    .replace(/\\D/g, '♦')
    .replace(/\\C/g, '♣')
    .replace(/\\s/g, '♠')
    .replace(/\\h/g, '♥')
    .replace(/\\d/g, '♦')
    .replace(/\\c/g, '♣')
}


/**
 * Parse commentary to extract bid-type steps (for backward compatibility with tests)
 * @param {Array} commentaryParts Array of commentary strings
 * @returns {Array} Array of bid step objects
 */
export function parsePrompts(commentaryParts) {
  return parseUnifiedSteps(commentaryParts).filter(s => s.type === 'bid')
}

/**
 * Extract the title from the first commentary block (e.g., "Stayman 1", "Cue-bid 5")
 * Matches patterns like "Word(s) Number" at the start of commentary
 * @param {Object} deal
 * @returns {string} Title or board number
 */
export function getDealTitle(deal) {
  if (!deal.commentary) return `Board ${deal.boardNumber}`
  const lines = deal.commentary.split('\n')
  // Check if first line matches "Title Number" pattern (e.g., "Stayman 1", "Baker Cue-bid 5")
  if (lines.length > 0 && /^[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?\s+\d+$/.test(lines[0].trim())) {
    return lines[0].trim()
  }
  return `Board ${deal.boardNumber}`
}

/**
 * Get the seat order starting from dealer
 * @param {string} dealer N/E/S/W
 * @returns {Array} Array of seats in bidding order
 */
export function getSeatOrder(dealer) {
  const seats = ['N', 'E', 'S', 'W']
  const startIdx = seats.indexOf(dealer)
  return [...seats.slice(startIdx), ...seats.slice(0, startIdx)]
}

/**
 * Get the seat for a specific bid index in the auction
 * @param {number} bidIndex 0-based index
 * @param {string} dealer Dealer seat
 * @returns {string} Seat (N/E/S/W)
 */
export function getSeatForBid(bidIndex, dealer) {
  const order = getSeatOrder(dealer)
  return order[bidIndex % 4]
}
