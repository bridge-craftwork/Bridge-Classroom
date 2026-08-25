// Seat order at the door — the consumer half of the seat-order contract
// (bridge-classroom-fetch, docs/seat-order-contract.md § Consumer rule).
//
// A normalized envelope carries seats by ARRAY POSITION and nothing else:
//
//   ns_pair.players = [North, South]
//   ew_pair.players = [West,  East ]
//
// Extension builds below schema_version 1.3 emit ACBL `ew_pair.players`
// EAST-first while documenting them as [W, E]. That is deal-proved, not
// inferred: Livermore, 24 Aug 2026 — E-W pair 7 arrived as
// [Arthur Mirin, Dan Bergmann], and Mirin held the EAST hand on both boards he
// wrote in about (a 15-count opening 1NT on board 26, seven spades opening 1S
// on board 22), with Bergmann declaring from West each time. The site's own
// rebuilt BBO hand viewer put Mirin in the West box. Only a deal could settle
// it; PBN tag order and symmetry with the other pair had both already produced
// a wrong answer.
//
// Extension 1.0.1 — live in the Chrome, Edge and Firefox stores since ~14 Aug
// 2026, emitting `1.1` — is affected, and store updates are slow and optional.
// This correction is permanent furniture, not a temporary patch.
//
// Four things this must NOT do:
//   - touch `ns_pair`: it has always been [N, S].
//   - touch `bbo` at any version: its seats come from LIN's `pn|`, which names
//     all four explicitly.
//   - touch an envelope with no `schema_version`: that is the BWS+PBN
//     file-upload path, a different producer with its own seat handling (and
//     its own suspected flip) that is deliberately outside this contract.
//   - swap twice. Fixing restamps `schema_version` to 1.3, so a second pass is
//     a no-op — which is what makes it safe to apply on both write and read.

/** The version at which producers emit the contract's order. */
const FIXED_AT = '1.3'

/** Does this `schema_version` predate the producer-side fix?
 *
 *  Absent/empty means "not an extension envelope" and is left alone. Present
 *  but unparseable counts as below — an envelope claiming a version we cannot
 *  read is older than one that states 1.3 plainly. */
function isPreFixVersion(value) {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  if (!text) return false
  const [rawMajor, rawMinor] = text.split('.')
  const major = Number(rawMajor)
  const minor = Number(rawMinor)
  if (!Number.isFinite(major)) return true
  if (major !== 1) return major < 1
  return !Number.isFinite(minor) || minor < 3
}

/** Every result in an envelope: tournaments → events → sessions → boards. */
function* everyResult(envelope) {
  for (const tournament of envelope?.tournaments ?? []) {
    for (const event of tournament?.events ?? []) {
      for (const session of event?.sessions ?? []) {
        for (const board of session?.boards ?? []) {
          for (const result of board?.results ?? []) yield result
        }
      }
    }
  }
}

/** Would `fixEwSeatOrder` change this envelope? Callers that hold an encoded
 *  copy alongside the decoded one (the ingest page's batch chunks) need to know
 *  before the restamp erases the evidence. */
export function needsEwSeatFix(envelope) {
  if (!envelope || typeof envelope !== 'object') return false
  if (!isPreFixVersion(envelope.schema_version)) return false
  return String(envelope.source ?? '').startsWith('acbl-live')
}

/** Correct E-W seat order in place, then restamp so it cannot happen twice.
 *
 *  Idempotent, and safe to call on anything: an envelope that does not meet
 *  both conditions is returned untouched. A `players` array of any length other
 *  than 2 has no defined seats — it is left exactly as it arrived rather than
 *  reversed or inferred from. */
export function fixEwSeatOrder(envelope) {
  if (!needsEwSeatFix(envelope)) return envelope
  for (const result of everyResult(envelope)) {
    const players = result?.ew_pair?.players
    if (Array.isArray(players) && players.length === 2) players.reverse()
  }
  envelope.schema_version = FIXED_AT
  return envelope
}
