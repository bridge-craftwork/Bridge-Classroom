// Which deals may a "Report a Problem" button appear on?
//
// Two deliberately separate reporting paths (roadmap 2026-07-30 §5.2):
//   beetle           → APP defects              → the app repo
//   Report a Problem → BRIDGE/CONTENT defects   → the content repo that owns the deal
//
// ⚠️ THE GATE HAS A SHARP EDGE, which is why it lives here as a pure function with
// its own tests rather than inline in a template. `POST /api/report` falls back to
// the Bridge-Classroom repo when `collection` is absent — a fine safety net for one
// mis-tagged report, but it means a button shown on a random deal, a dealer-service
// deal or a pasted PBN would file BRIDGE-CONTENT complaints into the APP repo, at
// volume, where nobody is looking for them.
//
// So the button appears ONLY when the deal is genuinely repository-backed: exactly
// one scenario ref, carrying a repo we can map to a collection, plus a board
// identity to point the report at. Anything else returns null.

// Deal-source `repo` ids → the `collection` value route_for_collection understands.
// Adding a content repo means adding it here AND to route_for_collection in
// bridge-classroom-api/src/routes/reports.rs — the two must agree, or reports land
// in the fallback repo.
export const REPO_TO_COLLECTION = Object.freeze({ pbs: 'pbs-coaching' })

/**
 * @param {{items?: Array}|null} selection  the active deal-source selection
 * @param {number|string|null} board        board identity on the table right now
 * @returns {{collection, file, label, board}|null}
 */
export function deriveReportableDeal(selection, board) {
  const items = selection?.items || []
  // A mixed pool has no single owner — a report against "one of these twelve
  // boards, from three repos" isn't actionable by any one maintainer.
  if (items.length !== 1) return null

  const ref = items[0]
  // 'random' / 'pbn' / 'library' / 'clubboard' / 'clubgame' are not authored
  // content: there is no maintainer to tell. 'script' is a dealer script, whose
  // output is generated rather than written, so it isn't reportable content either.
  if (!ref || ref.kind !== 'scenario') return null

  const collection = REPO_TO_COLLECTION[ref.repo]
  if (!collection) return null

  // No board identity → nothing to point at. Guard the empty string too, which is
  // falsy-but-not-null and would otherwise sail through a `== null` check.
  if (board == null || board === '') return null

  return {
    collection,
    file: ref.file || null,
    label: ref.label || null,
    board,
  }
}
