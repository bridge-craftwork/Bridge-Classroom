// The claim position the solver client checks (solverClient.validateClaimAt /
// claimLimitAt / claimOptions), built from what the table service sends: the
// original deal, the contract, every card played, and the tricks won. Shared by
// the served table (useRemoteTable) and the teacher console (lobby tables).

import { parseDealHands } from './pbnDeal.js'
import { trumpFromContract } from './cardplayRules.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']

/**
 * { deal, contract: {text, declarer}, plays, tricks: {NS, EW}, claimer }
 *   → { play, claimer, tricksTaken, stamp } or null when incomplete.
 * `stamp` is the number of cards played: the server refuses a claim whose
 * stamp no longer matches the table.
 */
export function buildClaimPosition({ deal, contract, plays, tricks, claimer }) {
  if (!deal || !contract?.text || !contract?.declarer || !claimer) return null
  const hands = parseDealHands(deal)
  if (!hands) return null
  const declarer = contract.declarer
  return {
    play: {
      hands,
      trump: trumpFromContract(contract.text) || 'NT',
      declarer,
      leader: SEAT_ORDER[(SEAT_ORDER.indexOf(declarer) + 1) % 4],
      plays: [...(plays || [])],
    },
    claimer,
    tricksTaken: { NS: tricks?.NS ?? 0, EW: tricks?.EW ?? 0 },
    stamp: (plays || []).length,
  }
}
