// useTableStatus — the phase-aware "reference" derivation: the one place that
// turns raw table state (dealer, vul, contract, tricks) into the shape a
// StatusStrip / TrickArea / ConsoleTile shows. Contract-relative by design:
// tricks are reported against the target the contract needs (6 + level), so a
// learner reads "NS 7 · needs 10", not a bare count.
//
// Pure (deriveStatus) + a reactive wrapper (useTableStatus), matching the
// tableSlots.js pattern — Vue-free core, unit-testable, no component refs.

import { computed } from 'vue'

// "4H" → { level: 4, strain: 'H', dbl: '' }, "3NT" → { level: 3, strain: 'NT' },
// "7NTXX" → { level: 7, strain: 'NT', dbl: 'XX' }. Doubling doesn't change the
// target (6 + level). null for a pass-out or absent contract.
export function parseContract(text) {
  const m = /^([1-7])(NT|N|[CDHS])(XX|X)?$/i.exec((text || '').trim())
  if (!m) return null
  const strain = m[2].toUpperCase() === 'N' ? 'NT' : m[2].toUpperCase()
  return { level: Number(m[1]), strain, dbl: (m[3] || '').toUpperCase() }
}

// N/S or E/W — which partnership declares.
export function sideOf(seat) {
  if (seat === 'N' || seat === 'S') return 'NS'
  if (seat === 'E' || seat === 'W') return 'EW'
  return null
}

/**
 * Pure status decision.
 * @param {'bidding'|'play'|'review'} phase
 * @param {string} dealer                seat
 * @param {string} vulnerable            'None' | 'NS' | 'EW' | 'All' | 'Both'
 * @param {{text, declarer}|null} contract
 * @param {{NS, EW}|{ns, ew}} tricks
 * @returns status: { phase, dealer, vul, contract, declarer, declaringSide,
 *   tricks: { ns, ew, target }, result } — result is null until the target is
 *   known (play/review with a contract): { need, made, delta } where delta is
 *   over/undertricks (+1, -2, 0 = exactly made).
 */
export function deriveStatus({ phase, dealer, vulnerable, contract, tricks }) {
  const parsed = contract ? parseContract(contract.text) : null
  const declarer = contract?.declarer || null
  const declaringSide = sideOf(declarer)
  const target = parsed ? 6 + parsed.level : null

  const ns = tricks?.NS ?? tricks?.ns ?? 0
  const ew = tricks?.EW ?? tricks?.ew ?? 0

  let result = null
  if (target != null && declaringSide) {
    const won = declaringSide === 'NS' ? ns : ew
    result = { need: target, made: won >= target, delta: won - target }
  }

  return {
    phase: phase || 'bidding',
    dealer: dealer || null,
    vul: vulnerable || 'None',
    contract: contract?.text || null,
    declarer,
    declaringSide,
    tricks: { ns, ew, target },
    result,
  }
}

/**
 * Reactive wrapper. `src` is refs/computeds { phase, dealer, vulnerable,
 * contract, tricks }. Returns a single `status` computed.
 */
export function useTableStatus(src) {
  return {
    status: computed(() =>
      deriveStatus({
        phase: src.phase?.value,
        dealer: src.dealer?.value,
        vulnerable: src.vulnerable?.value,
        contract: src.contract?.value,
        tricks: src.tricks?.value,
      }),
    ),
  }
}
