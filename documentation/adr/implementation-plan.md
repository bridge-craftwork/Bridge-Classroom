# Implementation Plan — Positional Board Identity + Prerelease

Companion to [ADR-0001](./0001-positional-board-identity.md) and the [spec](./board-identity-and-history-integrity.md). Assumes ADR sign-off. Sequenced lowest-risk-first.

**Naming:** the new observations column is **`collection_id`** (matches `exercise_boards.collection_id`).

**External dependency (David's repo, parallel):** agree PBN tag names for `ready`, the board-version token, the skill path, and how a served file declares its `collection_id`. The frontend write-path (Phase 3) is gated on these tags existing.

---

## Phase 1 — Schema migration (backend)

Migrations live in [db.rs](../../bridge-classroom-api/src/db.rs) as idempotent `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE ADD COLUMN` (helper `add_column_if_missing`) + `CREATE INDEX IF NOT EXISTS`, run at startup.

| Table | Change | Difficulty |
|---|---|---|
| `observations` | Add `collection_id TEXT`, `board_version_token TEXT`, `prerelease INTEGER NOT NULL DEFAULT 0`; add `collection_id` to the board-lookup indexes | Easy (PK is `id`) |
| `board_status` | Add `collection_id` **into the PK** + `prerelease INTEGER` | **Table rebuild** (SQLite can't alter a PK in place) |
| `exercise_boards` | Backfill 103 blank `collection_id`; promote `collection_id` into PK + deal index | **Table rebuild** |
| `assignment_board_status` | Add `collection_id` into the PK | **Table rebuild** |

**Backfills** (clear columns — no decryption):
- `collection_id` = `CASE WHEN skill_path LIKE 'uncategorized/%' THEN 'practice-bidding-scenarios' ELSE 'baker-bridge' END`
- `prerelease` = `(skill_path LIKE 'uncategorized/%')`
- `board_version_token` = NULL (optional later backfill from stamped PBNs)

Then a **one-time full `board_status` recompute** so existing rows gain `collection_id` + `prerelease`. Backfill **before** any skill-path remap so `collection_id`/`prerelease` become the durable discriminators.

## Phase 2 — Backend keying + read filters

- `recompute_board_history` / `recompute_assignment_boards` ([board_status.rs](../../bridge-classroom-api/src/routes/board_status.rs)): add `collection_id` to signature, query, and upsert key; stamp `prerelease` (still compute beta rows). Update callers ([observations.rs](../../bridge-classroom-api/src/routes/observations.rs) `boards_to_recompute`, [merge.rs](../../bridge-classroom-api/src/routes/merge.rs)).
- Observation ingest ([observations.rs](../../bridge-classroom-api/src/routes/observations.rs)): accept + persist `collection_id`, `board_version_token`, `prerelease`.
- `lesson_mastery.rs`: group by `collection_id`; `WHERE prerelease = 0`.
- `student_summaries.rs`: `WHERE prerelease = 0`.
- `board_status` read endpoint: return `collection_id` + `prerelease` (no filter — navigation needs beta).
- `admin.rs`: `prerelease = 0` on the usage metrics (**done in slice 1**).
- `reports.rs`: accept + include `board_version_token`.

## Phase 3 — Frontend (gated on PBN tags)

- Deal loader / `pbnParser.js` + resolver: surface `collection_id`, `board_version_token`, `ready` (→ `prerelease = !ready`).
- `useObservationStore.js` (`recordObservation` → `createObservation` → `extractMetadata`): populate + send the new clear fields.
- `useBoardStatus.js`: carry `prerelease`; `buildBoardMastery`/`mergeLocalPending` tag beta.
- `BoardMasteryStrip.vue` / `BoardMasteryGrid.vue`: triangle when `prerelease`; "under development" warning.
- `useReportProblem.js`: include the token.

## Phase 4 — Data ops (one-time)

Backfills + full recompute (Phase 1) set David's existing content to `prerelease = 1` (**not deleted** — beta history preserved). David's skill-path remap is decoupled: safe any time after the `collection_id`/`prerelease` backfill.

## Open sub-problems (not free)

1. **Exercise-creation guard needs per-board `ready` at editor time.** The editor sources boards from `bakerBridgeTaxonomy` (no readiness info); it must learn each board's `ready` state from the PBN or a per-lesson manifest.
2. **PK rebuilds on live tables** (`board_status`, `exercise_boards`, `assignment_board_status`) — tested migration script + ad-hoc DB backup immediately pre-migration.

---

## Slices (delivery order + status)

Re-sliced during implementation: the `collection_id`-in-PK rebuild (the Drury cross-collection fix) was split out of slice 2 into its own later slice, because it's the riskiest migration (live-table PK rebuilds) and is independent of the prerelease-mastery exclusion. Slice 2 therefore ships prerelease exclusion **without** any PK change; today's data has no cross-collection straddling, so mastery is already correct without it.

- **Slice 1 — ✅ merged (#53):** `observations.collection_id` + `observations.prerelease` + one-time backfill + `admin.rs` platform-stat `prerelease = 0` filters. No PK rebuilds, no behavior change for Baker content.
- **Slice 2 (prerelease-mastery) — 🔧 in progress:** `board_status.prerelease` column + backfill; `recompute_board_history` stamps it (board prerelease = most-recent observation's flag); `lesson_mastery` + `student_summaries` filter `prerelease = 0`; `get_board_status` returns it. **No PK change.**
- **Frontend triangle — ✅ PR #56:** `BoardMasteryStrip` renders prerelease boards as a triangle; `prerelease` threaded through `useBoardStatus.buildBoardMastery` (+ unit test). No hard dependency on the backend field.
- **Report token (C6) — ✅ PR #57:** `reports.rs` accepts + echoes `board_version_token` (optional, opaque passthrough).
- **Slice 3 (collection identity) — ⏳ deferred:** promote `collection_id` into the PKs of `board_status`, `exercise_boards`, `assignment_board_status` (table rebuilds) + fold into the recompute/mastery keys. Fixes the latent Drury conflation. Do **after** slice 2 merges (heavy `board_status.rs` overlap).
- **Slice 4 (write path + deal loader) — ⏳ pending:** deal loader surfaces `collection_id` / `prerelease` / `board_version_token` from the PBN; observation ingest persists them; report context includes the token; live-play "under development" warning; `BoardMasteryGrid` marker. Gated on the agreed PBN tags.
- **Slice 5 — ⏳ pending:** exercise-creation readiness guard (needs per-board `ready` at editor time).
