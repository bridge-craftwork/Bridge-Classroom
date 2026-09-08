// Seat order at the door — the consumer half of the seat-order contract
// (bridge-classroom-fetch, docs/seat-order-contract.md § Consumer rule).
//
// A normalized envelope carries E-W seat identity by POSITION, in two separate
// places, and older extension builds get both of them backwards:
//
//   result.ew_pair.players = [West, East]      ← players
//   board.double_dummy     = { N, S, E, W }    ← the double-dummy table
//
// Both are the same mistake in different clothing. ACBL publishes a pair, and
// the two digits of a double-dummy slash form ("3/4H"), in the order the
// direction label itself reads — `E-W` means [East, West] — and the adapters
// read both as West-first.
//
// Deal-proved, not inferred. For players: Livermore, 24 Aug 2026 — E-W pair 7
// arrived as [Arthur Mirin, Dan Bergmann], and Mirin held the EAST hand on both
// boards he wrote in about (a 15-count opening 1NT on board 26, seven spades
// opening 1S on board 22), with Bergmann declaring from West each time. For the
// double-dummy table: all 88 distinct deals in the extension's `fixtures/
// my-acbl` were solved, and of the tokens whose two seats differ, 22 of 22 on
// the EW row match East-first and 14 of 14 on the NS row match North-first,
// with nothing contradicting either.
//
// Extension 1.0.1 — live in the Chrome, Edge and Firefox stores since ~14 Aug
// 2026, emitting `1.1` — is affected by both, and store updates are slow and
// optional. This correction is permanent furniture, not a temporary patch.
//
// ## Two boundaries, because the two fixes ship separately
//
// | `schema_version` | players | double_dummy |
// |---|---|---|
// | below 1.3 | swapped | swapped |
// | exactly 1.3 | correct | **swapped** |
// | 1.4 and up | correct | correct |
//
// 1.3 is the awkward one, and it is not hypothetical: no producer has ever
// emitted it. Every 1.3 envelope in existence was stamped by THIS function's
// previous version, which corrected players alone — and the ingest page stores
// what it corrects, so the club_games archive is full of 1.3 games whose
// double-dummy table is still transposed. Folding the new correction in under
// the old 1.3 gate would have skipped every one of them permanently. Hence a
// second boundary rather than a wider one.
//
// The producer therefore goes straight from 1.2 to 1.4 (provenance.js in the
// extension) and 1.3 stays reserved for our own restamp. A build that published
// 1.3 would be read as "double-dummy still swapped" and get a table swapped
// back to wrong.
//
// Four things this must NOT do:
//   - touch `ns_pair` or the N/S rows of the table: those have always been
//     [N, S] and North-first.
//   - touch `bbo` at any version: its seats come from LIN's `pn|`, which names
//     all four explicitly, and its boards carry no double-dummy table at all.
//   - touch an envelope with no `schema_version`: that is the BWS+PBN
//     file-upload path, a different producer with its own seat handling (and
//     its own suspected flip) that is deliberately outside this contract.
//   - swap twice. Fixing restamps to the top of the ladder, so a second pass is
//     a no-op — which is what makes it safe to apply on both write and read.

/** Minor version at which the producer emits correct `ew_pair.players`. */
const PLAYERS_FIXED_AT = 3

/** Minor version at which the producer emits a correct `double_dummy` table. */
const DOUBLE_DUMMY_FIXED_AT = 4

/** What a corrected envelope is stamped with: everything above is applied. */
const FIXED_AT = '1.4'

/** Is this `schema_version` below `1.<minor>`?
 *
 *  Absent/empty means "not an extension envelope" and is left alone. Present
 *  but unparseable counts as below — an envelope claiming a version we cannot
 *  read is older than one that states its version plainly. */
function isBelow(value, minor) {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  if (!text) return false
  const [rawMajor, rawMinor] = text.split('.')
  const major = Number(rawMajor)
  const parsedMinor = Number(rawMinor)
  if (!Number.isFinite(major)) return true
  if (major !== 1) return major < 1
  return !Number.isFinite(parsedMinor) || parsedMinor < minor
}

/** Is this an envelope the contract's consumer rule applies to at all? */
function isAcblEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return false
  return String(envelope.source ?? '').startsWith('acbl-live')
}

/** Every board in an envelope: tournaments → events → sessions → boards. */
function* everyBoard(envelope) {
  for (const tournament of envelope?.tournaments ?? []) {
    for (const event of tournament?.events ?? []) {
      for (const session of event?.sessions ?? []) {
        for (const board of session?.boards ?? []) yield board
      }
    }
  }
}

/** Every result in an envelope. */
function* everyResult(envelope) {
  for (const board of everyBoard(envelope)) {
    for (const result of board?.results ?? []) yield result
  }
}

/** Would `fixEwSeatOrder` change this envelope? Callers that hold an encoded
 *  copy alongside the decoded one (the ingest page's batch chunks) need to know
 *  before the restamp erases the evidence. */
export function needsEwSeatFix(envelope) {
  if (!isAcblEnvelope(envelope)) return false
  return isBelow(envelope.schema_version, DOUBLE_DUMMY_FIXED_AT)
}

/** Correct E-W seat order in place, then restamp so it cannot happen twice.
 *
 *  Idempotent, and safe to call on anything: an envelope that does not meet the
 *  conditions is returned untouched. The two corrections are gated separately,
 *  so a 1.3 envelope has its table fixed without having its already-correct
 *  players swapped back.
 *
 *  A `players` array of any length other than 2, or a table missing either
 *  E or W, has no defined seats — it is left exactly as it arrived rather than
 *  reversed or inferred from. */
export function fixEwSeatOrder(envelope) {
  if (!needsEwSeatFix(envelope)) return envelope
  const version = envelope.schema_version

  if (isBelow(version, PLAYERS_FIXED_AT)) {
    for (const result of everyResult(envelope)) {
      const players = result?.ew_pair?.players
      if (Array.isArray(players) && players.length === 2) players.reverse()
    }
  }

  if (isBelow(version, DOUBLE_DUMMY_FIXED_AT)) {
    for (const board of everyBoard(envelope)) {
      const table = board?.double_dummy
      if (!table || typeof table !== 'object') continue
      if (table.E == null || table.W == null) continue
      const east = table.E
      table.E = table.W
      table.W = east
    }
  }

  envelope.schema_version = FIXED_AT
  return envelope
}
