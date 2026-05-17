#!/usr/bin/env node
// Smoke test for the BEN bridge engine.
// Hits the real droplet (or BEN_URL override) and walks through:
//   1. /lead — opening lead for the defender on declarer's left.
//   2. /play — declarer's, dummy's, and a defender's plays for the first trick.
//   3. Reports per-call latency, total elapsed, and a small stats summary.
//
// Run from repo root:
//   node scripts/smoke-ben.mjs
//   BEN_URL=https://ben.bridge-craftwork.com node scripts/smoke-ben.mjs
//
// Exits non-zero if any call fails or returns a malformed response.
// CORS is irrelevant here — Node fetch sends no Origin header.

import {
  fetchOpeningLead,
  fetchBotCard,
  handToPbn,
  bidsToCtx,
  vulToBen,
  getBenUrl,
  playerToSeat,
} from '../src/utils/benClient.js'

// ── Fixture: hand-verified 52-card deal ────────────────────────────────
// Dealer S, vul None.  Auction 1S-Pass-4S-Pass-Pass-Pass.
// Declarer S, LHO = W leads.  Hand-checked: 13 cards per seat, 52 unique.
const DEAL = {
  dealer: 'S',
  vulnerable: 'None',
  contract: '4S',
  declarer: 'S',
  hands: {
    N: { spades: ['J','7','3','2'],         hearts: ['Q','5'],                       diamonds: ['A','8','6','4'], clubs: ['K','4','2'] },
    E: { spades: ['T','9'],                 hearts: ['J','T','9','8','7','6','3'],   diamonds: ['9','5'],         clubs: ['A','3'] },
    S: { spades: ['A','K','Q','8','5','4'], hearts: ['A','K'],                       diamonds: ['K','Q','J'],     clubs: ['8','6'] },
    W: { spades: ['6'],                     hearts: ['4','2'],                       diamonds: ['T','7','3','2'], clubs: ['Q','J','T','9','7','5'] },
  },
  bids: ['1S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
}

// Sanity-check the deal has 13 cards per seat and 52 unique cards total.
function assertDealValid(deal) {
  const all = new Set()
  for (const seat of 'NESW') {
    const h = deal.hands[seat]
    const count = h.spades.length + h.hearts.length + h.diamonds.length + h.clubs.length
    if (count !== 13) throw new Error(`${seat} has ${count} cards, expected 13`)
    for (const [suit, ranks] of [['S', h.spades], ['H', h.hearts], ['D', h.diamonds], ['C', h.clubs]]) {
      for (const r of ranks) {
        const key = suit + r
        if (all.has(key)) throw new Error(`duplicate card ${key}`)
        all.add(key)
      }
    }
  }
  if (all.size !== 52) throw new Error(`fixture has ${all.size} unique cards, expected 52`)
}

// LHO of declarer.
const SEAT_ORDER = ['N', 'E', 'S', 'W']
function lho(seat) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(seat) + 1) % 4]
}
function next(seat) {
  return lho(seat)
}

function pad(s, n) {
  s = String(s)
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

async function main() {
  assertDealValid(DEAL)

  console.log(`BEN URL: ${getBenUrl()}`)
  console.log(`Deal: ${DEAL.contract} by ${DEAL.declarer}, dealer ${DEAL.dealer}, vul ${DEAL.vulnerable}`)
  console.log(`Auction: ${DEAL.bids.join(' ')}  →  ctx="${bidsToCtx(DEAL.bids)}"`)
  console.log()

  const dummySeat = SEAT_ORDER[(SEAT_ORDER.indexOf(DEAL.declarer) + 2) % 4]
  const dummyPbn = handToPbn(DEAL.hands[dummySeat])
  const leader = lho(DEAL.declarer)
  console.log(`Opening leader: ${leader} (LHO of ${DEAL.declarer})`)
  console.log(`Dummy seat: ${dummySeat}`)
  console.log()

  // Step 1 — opening lead.
  const startWall = Date.now()
  const latencies = []
  let leadResp
  try {
    leadResp = await fetchOpeningLead({
      hand: DEAL.hands[leader],
      seat: leader,
      dealer: DEAL.dealer,
      vul: vulToBen(DEAL.vulnerable, leader),
      ctx: bidsToCtx(DEAL.bids),
    })
  } catch (err) {
    console.error(`/lead failed: ${err.message}`)
    process.exit(1)
  }
  if (!leadResp.card || !/^[SHDC][AKQJT2-9]$/.test(leadResp.card)) {
    console.error(`/lead returned malformed card: ${JSON.stringify(leadResp.raw)}`)
    process.exit(1)
  }
  latencies.push(leadResp.elapsedMs)
  console.log(`${pad(`/lead → ${leader}`, 18)} ${leadResp.card}   ${leadResp.elapsedMs.toFixed(0)}ms   (quality: ${leadResp.raw?.quality ?? '?'})`)

  // Walk the first trick: 3 more plays after the opening lead.
  //
  // /play perspective rules (see benClient.js for full notes):
  //   seat-param = decision-maker (declarer for declarer-side plays, defender
  //   for defender plays). Never the dummy's seat.
  //   hand-param = decision-maker's hand.
  //   BEN tells us via response.player which seat physically played.
  const declarerSide = ['N', 'E', 'S', 'W'].filter(s =>
    (DEAL.declarer === 'N' || DEAL.declarer === 'S')
      ? (s === 'N' || s === 'S')
      : (s === 'E' || s === 'W')
  )
  const played = [{ seat: leader, suit: leadResp.card[0], rank: leadResp.card[1] }]
  let cur = next(leader)
  for (let i = 0; i < 3; i++) {
    const isDeclarerSide = declarerSide.includes(cur)
    const seatForCall = isDeclarerSide ? DEAL.declarer : cur
    const handForCall = isDeclarerSide ? DEAL.hands[DEAL.declarer] : DEAL.hands[cur]
    process.stdout.write(`${pad(`/play → ${cur}`, 18)} … `)
    let resp
    try {
      resp = await fetchBotCard({
        hand: handForCall,
        dummy: DEAL.hands[dummySeat],
        seat: seatForCall,
        dealer: DEAL.dealer,
        vul: vulToBen(DEAL.vulnerable, seatForCall),
        ctx: bidsToCtx(DEAL.bids),
        played,
      })
    } catch (err) {
      console.log()
      console.error(`/play (expected ${cur}, called as ${seatForCall}) failed: ${err.message}`)
      process.exit(1)
    }
    if (!resp.card || !/^[SHDC][AKQJT2-9]$/.test(resp.card)) {
      console.error(`/play (${cur}) returned malformed card: ${JSON.stringify(resp.raw)}`)
      process.exit(1)
    }
    // Cross-check BEN's player field vs. our expected seat.
    const benSeat = resp.player != null ? playerToSeat(resp.player, DEAL.declarer) : null
    const seatNote = benSeat && benSeat !== cur ? `  ⚠ BEN reports player ${resp.player}=${benSeat}` : ''
    latencies.push(resp.elapsedMs)
    console.log(`${resp.card}   ${resp.elapsedMs.toFixed(0)}ms   (player ${resp.raw?.player ?? '?'}, quality: ${resp.raw?.quality ?? '?'})${seatNote}`)
    played.push({ seat: cur, suit: resp.card[0], rank: resp.card[1] })
    cur = next(cur)
  }

  const wallMs = Date.now() - startWall
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const sorted = [...latencies].sort((a, b) => a - b)
  const max = sorted[sorted.length - 1]
  const min = sorted[0]

  console.log()
  console.log(`First trick:  ${played.map(p => p.suit + p.rank).join(' ')}`)
  console.log(`BEN calls:    ${latencies.length}`)
  console.log(`Latency:      mean ${mean.toFixed(0)}ms · min ${min.toFixed(0)}ms · max ${max.toFixed(0)}ms`)
  console.log(`Wall time:    ${(wallMs / 1000).toFixed(1)}s`)
}

main().catch(err => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
