// Prototype: full defensive play-out with revert-and-correct grading.
// Student sits SOUTH and defends every trick; declarer is EAST. The deal is a
// scripted "coach line" (the full chronological 52-card sequence). Non-user
// seats (N/E/W) play straight from the line; South's clicks are graded — a
// wrong card is reverted (never recorded) and the correct card surfaced.
import { describe, it, expect, beforeEach } from 'vitest'
import { useCardPlay } from '../useCardPlay.js'
import { RandomLegalBot } from '../../utils/cardplayBots.js'

// Simple, legal deal. 4 cards each suit per seat; everyone can always follow.
const HANDS = {
  N: { spades: ['A','K','Q','J'], hearts: ['2','3','4','5'], diamonds: ['2','3','4','5'], clubs: ['2','3','4'] },
  E: { spades: ['T','9','8','7'], hearts: ['A','K','Q','J'], diamonds: ['6','7','8','9'], clubs: ['5','6','7'] },
  S: { spades: ['6','5','4','3'], hearts: ['6','7','8','9'], diamonds: ['A','K','Q','J'], clubs: ['8','9','T'] },
  W: { spades: ['2'],            hearts: ['T'],             diamonds: ['T'],             clubs: ['A','K','Q','J','J' /*placeholder*/] },
}

// Build a clean 4-4-4-1-ish deal programmatically so it is exactly 13 each and
// fully legal. We deal each suit A..2 round-robin N,E,S,W to guarantee validity.
function buildDeal() {
  const ranks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
  const seats = ['N','E','S','W']
  const hands = { N:{spades:[],hearts:[],diamonds:[],clubs:[]},
                  E:{spades:[],hearts:[],diamonds:[],clubs:[]},
                  S:{spades:[],hearts:[],diamonds:[],clubs:[]},
                  W:{spades:[],hearts:[],diamonds:[],clubs:[]} }
  const suits = ['spades','hearts','diamonds','clubs']
  const suitCode = { spades:'S', hearts:'H', diamonds:'D', clubs:'C' }
  let i = 0
  for (const suit of suits) {
    for (const r of ranks) {
      hands[seats[i % 4]][suit].push(r)
      i++
    }
  }
  return { hands, suitCode }
}

// Produce a fully-legal chronological line: opening leader = S (LHO of declarer
// E). Each trick the leader leads its lowest card of a rotating suit; everyone
// follows their lowest card of that suit (all hands have ≥3 of every suit in
// this construction, so following is always possible). Winner leads next.
function buildLine(hands, suitCode) {
  const SEAT_ORDER = ['N','E','S','W']
  const next = s => SEAT_ORDER[(SEAT_ORDER.indexOf(s)+1)%4]
  const remaining = JSON.parse(JSON.stringify(hands))
  const line = []
  let leader = 'S'              // opening leader (LHO of declarer E)
  const suitCycle = ['spades','hearts','diamonds','clubs']
  for (let trick = 0; trick < 13; trick++) {
    const suit = suitCycle[trick % 4]
    let seat = leader
    let winnerSeat = leader, winnerRankIdx = -1
    const RANKVAL = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']
    for (let k = 0; k < 4; k++) {
      // play lowest card of led suit if able, else lowest of any suit
      let s = suit
      if (remaining[seat][s].length === 0) {
        s = suitCycle.find(x => remaining[seat][x].length > 0)
      }
      const arr = remaining[seat][s]
      // pick lowest
      let lowIdx = 0
      for (let j = 1; j < arr.length; j++) if (RANKVAL.indexOf(arr[j]) < RANKVAL.indexOf(arr[lowIdx])) lowIdx = j
      const rank = arr.splice(lowIdx,1)[0]
      const entry = { seat, suit: suitCode[s], rank }
      // Attach a coaching note to each of South's (the student's) cards.
      if (seat === 'S') entry.note = `Play the ${suitCode[s]}${rank} — keeps communication with partner.`
      line.push(entry)
      // track winner only among cards of the led suit
      if (s === suit) {
        const rv = RANKVAL.indexOf(rank)
        if (rv > winnerRankIdx) { winnerRankIdx = rv; winnerSeat = seat }
      }
      seat = next(seat)
    }
    leader = winnerSeat
  }
  return line
}

describe('useCardPlay — coaching mode (defender full play-out, revert+correct)', () => {
  let cp
  beforeEach(() => { cp = useCardPlay(); cp.reset() })

  it('STRICT mode: South defends vs declarer East; wrong card reverted, correct enforced; full 13 tricks', async () => {
    const { hands, suitCode } = buildDeal()
    const line = buildLine(hands, suitCode)
    expect(line).toHaveLength(52)

    await cp.startPlay({
      hands,
      dealer: 'N',
      contract: '3NT',
      declarer: 'E',            // student South is a DEFENDER
      bot: RandomLegalBot,      // never consulted in coach mode
      userSeats: ['S'],
      coachLine: line,
      coachAutoCorrect: false,  // reject wrong clicks; student must find the card
      pacing: { betweenPlays: 0, betweenTricks: 0 },
    })

    // Opening lead is South's (LHO of East). Engine paused waiting for S.
    expect(cp.currentPlayer.value).toBe('S')
    expect(cp.clickableSeat.value).toBe('S')

    let guard = 0
    while (!cp.playComplete.value && guard++ < 60) {
      expect(cp.currentPlayer.value).toBe('S')   // engine only ever waits on the student
      const want = cp.coachExpected.value
      expect(want).toBeTruthy()

      // 1) Student plays a WRONG (but legal) card → must be reverted.
      const wrong = pickWrongLegal(cp, want)
      if (wrong) {
        const before = cp.played.value.length
        const res = await cp.onUserCard(wrong.suit, wrong.rank)
        expect(res.ok).toBe(false)
        expect(res.reason).toBe('incorrect')
        expect(res.expected).toMatchObject({ seat: 'S', suit: want.suit, rank: want.rank })
        expect(cp.played.value.length).toBe(before)        // nothing recorded — reverted
        expect(cp.lastCoachMiss.value).toBeTruthy()
      }

      // 2) Student plays the CORRECT card → accepted; engine auto-plays N/E/W
      //    from the line until it is South's turn again (or play completes).
      const ok = await cp.onUserCard(want.suit, want.rank)
      expect(ok.ok).toBe(true)
      expect(cp.lastCoachMiss.value).toBeNull()
    }

    expect(cp.playComplete.value).toBe(true)
    expect(cp.completedTricks.value).toHaveLength(13)
    // Every one of South's 13 cards came from the scripted line, in order.
    const southPlays = cp.played.value.filter(p => p.seat === 'S')
    expect(southPlays).toHaveLength(13)
    const southLine = line.filter(p => p.seat === 'S')
    expect(southPlays).toEqual(southLine.map(p => ({ seat:'S', suit:p.suit, rank:p.rank })))
  })

  it('SWAP-AND-EXPLAIN (default): a wrong card is corrected with its note; play continues', async () => {
    const { hands, suitCode } = buildDeal()
    const line = buildLine(hands, suitCode)

    await cp.startPlay({
      hands,
      dealer: 'N',
      contract: '3NT',
      declarer: 'E',
      bot: RandomLegalBot,
      userSeats: ['S'],
      coachLine: line,            // coachAutoCorrect defaults to true
      pacing: { betweenPlays: 0, betweenTricks: 0 },
    })

    let guard = 0, sawCorrection = false, sawConfirmation = false
    while (!cp.playComplete.value && guard++ < 60) {
      expect(cp.currentPlayer.value).toBe('S')
      const want = cp.coachExpected.value
      const wrong = pickWrongLegal(cp, want)

      if (wrong) {
        // Click a WRONG card → engine substitutes the correct one and continues,
        // surfacing the note that explains the right play.
        const before = cp.played.value.length
        const res = await cp.onUserCard(wrong.suit, wrong.rank)
        expect(res.ok).toBe(true)
        expect(res.corrected).toBe(true)
        expect(res.expected).toMatchObject({ seat:'S', suit:want.suit, rank:want.rank })
        expect(res.note).toContain('keeps communication')        // the coaching text
        // The CORRECT card was recorded, not the wrong one.
        const southCard = cp.played.value[before]
        expect(southCard).toMatchObject({ seat:'S', suit:want.suit, rank:want.rank })
        expect(cp.coachNote.value).toMatchObject({
          corrected: true,
          wrong: { suit: wrong.suit, rank: wrong.rank },
          card: { suit: want.suit, rank: want.rank },
        })
        sawCorrection = true
      } else {
        // Forced card → clicking it is correct; the confirmation note still shows.
        const res = await cp.onUserCard(want.suit, want.rank)
        expect(res.ok).toBe(true)
        expect(cp.coachNote.value.corrected).toBe(false)
        sawConfirmation = true
      }
    }

    expect(cp.playComplete.value).toBe(true)
    expect(cp.completedTricks.value).toHaveLength(13)
    expect(sawCorrection).toBe(true)       // at least one wrong card got swapped+explained
    expect(sawConfirmation).toBe(true)     // at least one forced card confirmed
    // South still ends up having played exactly the scripted line.
    const southPlays = cp.played.value.filter(p => p.seat === 'S')
    expect(southPlays).toEqual(line.filter(p => p.seat === 'S').map(p => ({ seat:'S', suit:p.suit, rank:p.rank })))
  })
})

// Find a legal card for South that is NOT the expected one (to exercise revert).
function pickWrongLegal(cp, want) {
  const legal = cp.legalCardsForCurrent.value
  for (const c of legal) {
    if (c.suit !== want.suit || c.rank !== want.rank) return c
  }
  return null  // only one legal card (forced) — no wrong card to try this trick
}
