# ADR-0001: Board identity is positional (collection + subfolder + board number); content is never keyed or verified

**Status:** Accepted (2026-07-06; slices 1–2 deployed, remainder rolling out per the implementation plan)
**Date:** 2026-07-05 (accepted 2026-07-06)
**Deciders:** Rick (Bridge Classroom), David (deal repositories)
**Responds to:** `deal-hash-identity-plan.md` (Practice-Bidding-Scenarios) — see "Reconciliation" below.

**Terminology (canonical):** the producer-facing release flag is **`stable`** — carried in the PBN as `%bridge-classroom-stable:` (file default) and `[Stable "…"]` (per-board override). The consumer stores its inverse as **`prerelease` = `NOT stable`** on each observation. Earlier drafts of this ADR used the word *ready*; that word is retired in favor of **`stable`** to match the shipped tags and columns. Do not confuse this board-level `stable`/`prerelease` release flag with the **collection-level `report` flag** (a separate scope that only governs the Report-a-Problem button — see the [companion spec §4.1](./board-identity-and-history-integrity.md#41-scope-summary-three-independent-flags)).

## Context

The deal repositories (Baker Bridge; David's Practice-Bidding-Scenarios) generate lesson sets in bulk and churn freely during development. Bridge Classroom keys mastery, exercises, and observations on board **position** and presents progress to students and teachers by board number. Report-driven cleanup (the "Report a Problem" button) makes editing and replacing boards a normal, ongoing event.

`deal-hash-identity-plan.md` argued that position is fragile — dropping or reordering a board re-points student history to content they never played — and proposed re-keying mastery on a per-deal content hash, plus a one-time position→hash remap.

Checking this against the actual Bridge Classroom implementation changed the picture in three ways:

1. **Observations are self-contained.** Each observation embeds the full deal it was played on — all four hands, dealer, vulnerability, the auction, contract/declarer, and the cardplay — inside its encrypted payload ([`createObservation`](../../src/utils/observationSchema.js)). The teacher drill-down renders **entirely from the stored record** and never re-fetches the board by position ([ObservationViewer.vue](../../src/components/ObservationViewer.vue) via [ObservationPopupManager.vue](../../src/components/ObservationPopupManager.vue)). The deal a student played is frozen at play time. **A board changing later cannot corrupt existing history**, because nothing re-reads the board to display it.

2. **`(subfolder, board number)` is not globally unique.** Board identity today is `(deal_subfolder, deal_number)`; `skill_path` is not part of the key and there is no collection dimension. The subfolder `Drury` exists in **both** collections — Baker's `bidding_conventions/reverse_drury` and David's `uncategorized/drury` — reusing the same board numbers for **different deals**. Mastery is recomputed by `(user_id, subfolder, deal_number)` ([observations.rs](../../bridge-classroom-api/src/routes/observations.rs)), so a single student who plays both would have two unrelated deals merged into one mastery record. This is latent today (the two user populations are disjoint) but activates the moment David's conventions reach existing Baker students.

3. **The producer's real need for a hash is cross-rotation report handling, not keying.** When a report arrives, the same deal may exist in several files in different rotations; a rotation-independent fingerprint lets the producer find and correct every variant.

## Decision

**Position remains the sole identity — extended to include the collection.** Bridge Classroom never uses a content hash as a key or as a display-time verifier.

1. **Board identity is `(collection_id, deal_subfolder, deal_number)`.** `collection_id` becomes a primary-key element across the board-referencing tables — `observations` (new clear column) and `exercise_boards` (column already exists; promote it into the key) — and enters the mastery-recompute and lesson-mastery keys. `collection_id` is a slug (`baker-bridge`, `practice-bidding-scenarios`); there is no `collections` table and no surrogate board id. *(Recorded now; implemented later.)*

2. **No content-hash keying and no re-fetch verification.** Because observations are self-contained, board churn cannot corrupt history and there is nothing to verify at display time. The `deal-hash-identity-plan.md` re-keying and one-time remap are declined.

3. **Board-version token.** The producer stamps a **rotation-independent** board-version token in the PBN. It is **opaque to Bridge Classroom**: BC never computes, verifies, renders from, or compares it. BC **records it in the clear** on each observation and **includes it in the "Report a Problem" text**. Its jobs are (a) letting the producer correct a reported deal across all of its rotational variants, and (b) giving BC passive change-over-time statistics as re-stamped tokens land on new observations. There is **no JavaScript implementation and no cross-language contract** — the producer owns the single implementation and nothing matches against it.

4. **Release status — record, but flag `prerelease`.** The producer marks boards `stable` in the PBN (file-level default `%bridge-classroom-stable:`, per-board override `[Stable "…"]`; absent = not stable). Not-stable boards are fully playable and **their observations are recorded**, each stamped with a consumer-side **`prerelease`** flag — the inverse of the board's `stable` state (`observations.prerelease = NOT board.stable`). Prerelease observations are **excluded from all mastery *and* platform statistics**, but **kept for the student's own history, navigation, and drill-down** and shown with a distinct marker (a triangle rather than a circle). They **cannot be selected into exercises**. **A replacement for a stable board must itself be `stable=true`.** (`prerelease` is deliberately named apart from the producer's `stable` flag so the two concepts don't blur: `stable` is a property of the board in the repo; `prerelease` is a property of a recorded observation.)

5. **Skill-path mapping.** Every **stable** board maps to a real skill path; `uncategorized` is permitted only while a board is prerelease. The requirement binds at promotion (`stable=true`), not before — skill path feeds only mastery, from which prerelease is already excluded, so it need not be assigned until a board is about to count. New paths are minted as needed. (Sequenced after the `collection_id` + `prerelease` backfill, so those become the durable discriminators before the `uncategorized` marker is remapped away.)

6. **Loose exercise binding.** Exercises reference boards by identity `(collection_id, subfolder, number)` only. A same-identity replacement is used transparently; lessons are ordered easiest-to-hardest and replacements match the difficulty of what they replace.

## Alternatives considered and rejected

- **Key mastery on a content hash (`deal-hash-identity-plan.md`).** Rejected: self-contained observations mean board churn cannot corrupt history, so keying on content solves a problem that does not exist here — at the cost of a schema migration and a hash→position reverse-mapping.
- **Bridge Classroom computes its own token.** Rejected: BC never compares the token, so a second (JavaScript) implementation and a byte-identical cross-language contract buy nothing. The producer provides it; BC records it opaquely.
- **Subfolder-only identity.** Rejected: proven non-unique across collections (Drury), which silently conflates mastery.
- **Random board IDs or version counters.** Rejected: a content hash self-updates on change, and being rotation-independent it also solves the producer's cross-rotation report problem — properties a random id or hand-maintained counter lack.

## Consequences

- Producers may freely edit or replace boards; no consumer history or mastery is ever mutated in response. Self-contained observations are the ground truth of what was played.
- `collection_id` must be backfilled where absent (e.g. the 103 blank `exercise_boards` rows) before it can join the keys.
- The board-version token is **producer-asserted, not consumer-derived**: the change-over-time signal is only as complete as the producer's re-stamping discipline. It is evidence, not enforcement — the guarantee is the behavioral contract (stable ⇒ fix-in-place or same-identity similar replacement; no renumbering).
- Renumbering stable boards requires explicit coordination; position is the key.
- Existing Baker observations already contain the full played deal, so no back-history is at risk. David's Practice-Bidding-Scenarios observations are **not deleted** — they are flagged `prerelease = 1` (by `collection_id`), so beta history/navigation survive while mastery and platform stats ignore them.
- The prerelease exclusion is a small, enumerable seam, not a scattered filter: all mastery derives from the `board_status` rollup (so one flag on that rollup, filtered by ~two mastery reads, covers it), every other raw-`observations` aggregate is exercise-scoped (and prerelease boards can't be assigned, so they self-exclude), and platform stats add an explicit `prerelease = 0` filter. Navigation, history, and drill-down read unfiltered. See the spec's "Prerelease observations — the exclusion seam."

## Reconciliation with deal-hash-identity-plan.md

| David's proposal | Disposition |
|---|---|
| Key mastery on `deal_hash` | **Declined** — self-contained observations make content keying unnecessary. |
| One-time position→hash remap (Phases 2–3) | **Declined** — no re-key, so no remap. |
| Stamp a deal hash into served files | **Adopted, repurposed** — as an opaque, rotation-independent *board-version token* that BC records but never keys or verifies. |
| Rotation-independent hash | **Adopted** — it serves the producer's cross-rotation report correction. |
| _(not addressed)_ cross-collection subfolder collision | **Added** — `collection_id` joins board identity. |

## Reference

Full specification, lifecycle, contracts C1–C7, and rollout order: [`board-identity-and-history-integrity.md`](./board-identity-and-history-integrity.md).

Producer-facing distillation of the obligations (for collection authors): [`collection-producer-contract.md`](./collection-producer-contract.md).
