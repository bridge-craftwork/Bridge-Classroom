# Board Identity, Readiness, and History Integrity

**Bridge Classroom ↔ bridge-craftwork deal repositories**
Companion specification to [ADR-0001](./0001-positional-board-identity.md).
Status: Accepted — 2026-07-05, accepted 2026-07-06 (Rick + David). Slices 1–2 deployed; remainder per the [implementation plan](./implementation-plan.md).

**Terminology (canonical):** the producer-facing release flag is **`stable`** (`%bridge-classroom-stable:` / `[Stable "…"]`); the consumer stores **`prerelease` = `NOT stable`**. The word *ready* used in earlier drafts is retired. See §4.1 for how this board-level release flag differs from the collection-level `report` flag.

---

## 0. TL;DR

- Board identity is **positional**: `(collection_id, deal_subfolder, deal_number)`. Content is never a key.
- Observations are **self-contained** — they embed the deal that was played — so a board changing later cannot corrupt history. There is no re-fetch and no display-time verification.
- The producer stamps a **rotation-independent board-version token** in the PBN. Bridge Classroom records it in the clear and echoes it into "Report a Problem". BC never computes, verifies, or compares it.
- Not-stable boards still **record** observations, flagged **`prerelease`** — excluded from mastery and platform stats, kept for the student's history/navigation/drill-down (shown as a triangle), never assignable. A replacement for a stable board must itself be stable.
- Every **stable** board maps to a **real skill path** (`uncategorized` is allowed only while prerelease; the requirement binds at promotion).

---

## 1. What each side needs

**Bridge Classroom (consumer)**

- Mastery and progress are presented **by board position** (Collection → Lesson/subfolder → Board 1..n). Position stays the key.
- Mastery is evidence about a **topic**, earned at a moment in time. If a board is later edited or replaced, students who earned mastery keep it. History is never invalidated or re-attached to different content.
- The teacher drill-down reconstructs past play **from the stored observation**, which already contains the deal. It does not re-fetch the board.
- Board identity must be **globally unique**. Subfolder names collide across collections (see §2.2), so the collection must be part of the key.

**Deal repository (producer)**

- Lesson sets are generated in bulk and **churn freely during development**. Weak boards are retired and replaced in response to reports.
- The "Report a Problem" button must produce issues that **unambiguously identify the reported deal**, immune to renumbering or editing between report and fix, and must let the producer find the same deal in **other files where it appears in other rotations**.
- Editing a board's narrative, commentary, or teaching notes must be possible **without consequence** on the Bridge Classroom side.
- Lessons are **progressive** (lower board number = easier). A replacement should match the difficulty of the board it replaces so it can occupy the same position.

---

## 2. Findings from the implementation (the facts this rests on)

### 2.1 Observations are self-contained

[`createObservation`](../../src/utils/observationSchema.js) embeds, in each observation's encrypted payload: all four **hands**, **dealer**, **vulnerability**, the **full auction**, **contract**, **declarer**, **lead**, and the **cardplay prompts** (expected vs. played card per trick). The teacher drill-down [ObservationViewer.vue](../../src/components/ObservationViewer.vue) (shown via [ObservationPopupManager.vue](../../src/components/ObservationPopupManager.vue)) renders **entirely from `props.obs.deal`** — no history/detail component re-fetches a deal by position. The only server fetches in the teacher panels are aggregate board-status and lesson-mastery, never board content.

**Consequence:** the deal a student played is frozen in the observation. Editing or replacing a board in the repo cannot change what any past drill-down shows. The misbinding problem a content hash would guard against **cannot occur** in this architecture.

### 2.2 Board identity is `(subfolder, number)` only — and it collides

The `observations` table has no collection column; boards are keyed by `(deal_subfolder, deal_number)`, with `skill_path` a parallel classifier that is **not in the key**. Mastery is recomputed by `(user_id, subfolder, deal_number)` ([observations.rs `recompute_board_history`](../../bridge-classroom-api/src/routes/observations.rs)).

The subfolder `Drury` is used by **both** collections — Baker's `bidding_conventions/reverse_drury` and David's `uncategorized/drury` — reusing the same board numbers `(Drury, 1)`, `(Drury, 2)`, … for **different deals**. A single student playing both would have two unrelated deals merged into one mastery record. It is latent today only because the two user populations are currently disjoint.

### 2.3 `exercise_boards.collection_id` already exists (partly)

[`exercise_boards`](../../bridge-classroom-api/src/routes/exercises.rs) already carries a free-text `collection_id` slug (value in use: `baker-bridge`), threaded through create/read. But it is **not** in the primary key (`(exercise_id, deal_subfolder, deal_number)`) or the board index, and it is only partially populated (40 rows `baker-bridge`, 103 blank). The collection concept is half-built; this design finishes it.

---

## 3. Board identity: adding `collection_id`

### 3.1 The key

Board identity becomes **`(collection_id, deal_subfolder, deal_number)`** everywhere a board is referenced:

- `observations` — add a clear `collection` column; include it in the mastery-recompute key and the lesson-mastery endpoint.
- `exercise_boards` — promote the existing `collection_id` into the primary key and the deal index.

There is **no surrogate board id**; the natural key is used throughout (consistent with today).

### 3.2 `collection_id` is a slug, not a table

A short slug string — `baker-bridge`, `pbs-coaching` — matching the existing `exercise_boards` convention. No `collections` table is introduced. **It is not a PBN carrier:** `collection_id` is BC-owned, sourced from the app's collection config ([`useAppConfig.js`](../../src/composables/useAppConfig.js) `COLLECTIONS[].id`). The collection is a property of *where BC serves a file from*, not of the file's content, and the generators don't know BC's collection names — so the app stamps `collection_id` on each observation from the **active collection** at write time (the same source the "Report a Problem" payload already uses). The config `id` is the stable slug; don't rename it (it also keys localStorage/recent-lessons).

### 3.3 Migration

1. Canonicalize the slug set.
2. Backfill `exercise_boards.collection_id` where blank (the 103 rows) before it can join the key.
3. Add `observations.collection`, populate at write time from the value the app already holds at play time, and backfill existing rows (derive from the current `uncategorized`-vs-categorized split for the one live collision).
4. Promote `collection_id` into the `exercise_boards` PK/index and the observation mastery key.

---

## 4. Board lifecycle: the `stable` flag

Each board carries a release flag — **`stable`** — in its PBN record.

| State | Meaning | Engine behavior | GUI behavior |
|---|---|---|---|
| absent / `stable=false` | Prerelease / beta | Fully playable; observations **recorded and flagged `prerelease`**, with the board-version token; **excluded from mastery and platform stats**; not selectable into exercises | Visible with a "scenario under development" warning; history shown with a **triangle** marker; navigable and drill-down-able |
| `stable=true` | Stable; promoted by the producer | Observations recorded normally, with the board-version token; counted toward mastery | Normal display (circle marker) |

Rules:

- **Default is not-stable.** A freshly generated set is prerelease until promoted. Forgetting the flag can never let beta content reach mastery or platform statistics — only the student's own private history.
- **Granularity:** file-level default (`%bridge-classroom-stable:`) with per-board override (`[Stable "…"]`).
- **Exercises may only include stable boards.** Exercise creation refuses not-stable boards.
- **A replacement for a stable board must itself be `stable=true`.** This is the producer's obligation (C3/C4). It keeps every position an exercise or assignment references continuously live and closes the hole where a swapped-in prerelease board would silently drop student work. (It supersedes any notion of a replacement "re-entering alpha" at a promoted position.)
- **Post-promotion edits are allowed but visible.** Editing a stable board is not forbidden — history survives revisions — but the producer's CI should warn when a stable board's content changes, so it is deliberate.

Recording is now **unconditional**; the `stable` flag only decides the value of the `prerelease` flag, set at the one observation write choke point ([`recordObservation`](../../src/composables/useObservationStore.js), verified to be the sole writer). The exclusion of prerelease observations from higher-level functions is described in §6.5.

### 4.1 Scope summary: three independent flags

Three distinct flags at three scopes govern this area. They are **independent** and must not be conflated:

| # | Scope | Flag | Owner / carrier | Governs |
|---|---|---|---|---|
| 1 | **File** | `%bridge-classroom-stable: true\|false` | Producer, in the PBN header comment | Default release status for every board in the file |
| 2 | **Board** | `[Stable "true"\|"false"]` | Producer, per-board PBN tag | Per-board override of the file default |
| 3 | **Collection** | `report` (`true`/`false`/absent) + `reportRepo` | **Bridge Classroom**, in `COLLECTIONS[]` config ([`useAppConfig.js`](../../src/composables/useAppConfig.js)) — **not** a PBN carrier | Whether the **Report-a-Problem** button appears |

Flags **1 + 2** are the *release status* pair: the board-level tag overrides the file-level default, producing `deal.stable`, from which the consumer derives `prerelease = NOT stable`. This pair drives **GUI board-status display** (triangle vs. circle, "under development" warning) and **how far an observation propagates** (prerelease is kept for the student's own history but excluded from mastery and platform stats).

Flag **3** is a *different concern at a different scope* — it governs only the **Report-a-Problem button**, and it lives in Bridge Classroom's own collection config, not in producer PBNs. Its resolution ([`reportEnabled`](../../src/views/MainLayout.vue)):

1. The collection must have a **`reportRepo`** (otherwise there is nowhere to file → button hidden). This is the base gate.
2. Then the collection's **`report`** property is a three-state override:
   - `true` → force the button **on** for every board in the collection, *regardless of release status*.
   - `false` → force it **off** (kill switch).
   - **absent → fall back to the board's release status** (`deal.stable` from flags 1 + 2). So a stable board is reportable and a prerelease board is not, unless the collection overrides.

The fallback in step 3 is the **only** coupling between the collection-level `report` flag and the board-level `stable` flag; otherwise they are orthogonal. See [report-a-problem.md](../report-a-problem.md) for the full reporting design.

---

## 5. The board-version token

### 5.1 Purpose

A producer-supplied, per-board version stamp. Two jobs:

1. **Report identification (producer).** The token travels with a report so the producer can pin the exact board reported and detect whether it still matches the repo.
2. **Change-over-time statistics (consumer).** BC records the token on each observation; when the producer re-stamps a changed board, new observations carry a different token, giving a passive record of when content changed and how many students saw each version.

### 5.2 Producer-computed, rotation-canonical; opaque to BC

To Bridge Classroom the token is an **opaque string**. BC never computes, re-derives, verifies, compares, or renders it. Its construction is the producer's; the agreed scheme is a **content hash over a rotation-canonical form**:

1. **Canonicalize rotation.** Compute the rotation `k` that moves the ♠A holder to North, and apply it to **both the hands and the auction** — the calls keep their order; the dealer and every seat label shift by the same `k`. Every deal has exactly one ♠A, so `k` is always well-defined and unambiguous.
2. **Hash the canonical form:** `sha256( normalize(canonical [Deal]) + "|" + normalize(canonical auction) )`, lowercase hex, over the *extracted* values (not raw file bytes) so cosmetic PBN reformatting doesn't churn it.

Step 1 makes the token **rotation-independent**: any rotation of the same deal+auction maps to one canonical form and thus one token — so it serves change detection *and* the producer's cross-rotation report matching at once. Baker Bridge adopts this scheme via a new stamping step.

### 5.3 Where it lives

- **Stamped in the PBN** as the board-level tag **`[BoardVersionToken "…"]`** by the producer's build pipeline (derived, regenerable, never hand-maintained). For Baker Bridge (`CSVtoPBN`, no native hash) this means adding a post-generation stamping step.
- **Read by BC** from the loaded PBN and **recorded in the clear** on each observation (`board_version_token` column; null if the PBN carries no tag). This is no more revealing than the board id already stored beside it.
- **Echoed into the "Report a Problem" text** so the producer receives it with the report.

### 5.4 What it is NOT

- Not a key. Not a verifier. Not rendered.
- No JavaScript implementation. No cross-language byte-identical requirement, no shared test-vector file — there is only one implementation (the producer's) and nothing compares against it.
- Producer-asserted, not consumer-derived: if the producer edits a board but forgets to re-stamp, BC records the stale token and the change is invisible. The token is **evidence, not enforcement**; the guarantee is the behavioral contract in §7/C4.

---

## 6. Consumer behaviors (Bridge Classroom)

### 6.1 Observation writing

At the single write choke point ([`recordObservation`](../../src/composables/useObservationStore.js)), always write the observation as today, plus three clear columns:

1. `collection` (§3),
2. the board-version token (§5),
3. `prerelease` — set to the inverse of the board's `stable` state (`prerelease = 1` for a not-stable/beta board).

### 6.2 Teacher drill-down

Renders **from the stored observation** (which contains the deal). No re-fetch, no token comparison, no staleness check. Unchanged behavior, now explicitly relied upon.

### 6.3 Exercises and assignments

- Reference boards by identity `(collection_id, subfolder, number)` only.
- A same-identity replacement is used transparently; no notification.
- Exercise creation rejects boards that are not `stable`.

### 6.4 Mastery

Keyed on `(user_id, collection_id, subfolder, deal_number)`, and computed from `prerelease = 0` observations only (§6.5). Otherwise unchanged — no re-key to content, no remap.

### 6.5 Prerelease observations — the exclusion seam

The goal: prerelease (beta) observations are **kept** for the student's own history, board-navigation icons, and drill-down, but **excluded** from every higher-level function (mastery, lesson mastery, teacher/student rollups, platform stats). Two structural facts make this a small, enumerable seam rather than a scattered filter:

- **Almost all mastery funnels through the `board_status` rollup.** Raw observations → [`recompute_board_history`](../../bridge-classroom-api/src/routes/board_status.rs) → `board_status` → lesson mastery ([lesson_mastery.rs](../../bridge-classroom-api/src/routes/lesson_mastery.rs)), student summaries ([student_summaries.rs](../../bridge-classroom-api/src/routes/student_summaries.rs)), and every frontend grid/strip (which fetch `board_status`/`lesson_mastery`, not raw observations).
- **Every raw-`observations` aggregate that bypasses `board_status` is exercise-scoped** (`… IN (SELECT … FROM exercise_boards WHERE exercise_id = ?)` in [teacher_dashboard.rs](../../bridge-classroom-api/src/routes/teacher_dashboard.rs) and [assignments.rs](../../bridge-classroom-api/src/routes/assignments.rs)). Since prerelease boards can't be put in an exercise, those queries never see a prerelease observation — they self-exclude, no change needed.

The seam, therefore:

| Touch point | Change |
|---|---|
| `observations.prerelease` (new column) | Backfill Baker = 0 / David = 1 (`UPDATE observations SET prerelease = (skill_path LIKE 'uncategorized/%')`, later keyed on `collection_id`); going forward set from the board's `stable` state at write time (§6.1). |
| `board_status.prerelease` (new column) | `recompute_board_history` / `recompute_assignment_boards` still compute the beta board's row (so it stays navigable) but stamp `prerelease = 1`. |
| Mastery reads of `board_status` | Add `WHERE prerelease = 0` in the two derived reads — `lesson_mastery.rs` and `student_summaries.rs`. |
| Platform stats | Add `AND prerelease = 0` to the admin metrics that read raw observations (popular lessons, total/active counts in [admin.rs](../../bridge-classroom-api/src/routes/admin.rs)) — we do **not** count beta/test observations in popular-lessons and the like. |
| Navigation strip, history list, drill-down | **No filter** — read `board_status`/`observations` including prerelease rows → triangle marker, "where I left off," and drill-down all work. |
| GUI: `BoardMasteryStrip` / `BoardMasteryGrid` | Render a triangle when `board.prerelease === true` (the indicator is already class-driven by `board.status` — [BoardMasteryStrip.vue](../../src/components/BoardMasteryStrip.vue)); `board-status` responses carry `prerelease` per board; `mergeLocalPending` tags in-progress beta plays so the triangle shows live. |

Not touched (and correctly so): assignment progress/completion, teacher-dashboard student progress, and exercise stats — all exercise-scoped, so prerelease self-excludes.

---

## 7. Producer behaviors (deal repository)

### 7.1 Build pipeline

- Stamp `[BoardVersionToken "…"]` on every board — the rotation-canonical `sha256(deal + "|" + auction)` of §5.2, recomputed each build, never trusted from source. For Baker Bridge this is a **new post-`CSVtoPBN` step** (that pipeline emits no hash today).
- Declare stability: `%bridge-classroom-stable: true|false` at the file level (the default), with a per-board `[Stable "true"|"false"]` override.
- Ensure every **stable** board carries a real `[SkillPath "…"]`; mint new paths as needed. `uncategorized` is acceptable only while a board is prerelease — assign the real path **before** promoting to `stable=true` (skill path feeds only mastery, which prerelease is excluded from).
- (Collection is **not** a producer concern — BC sources it from its own config; see §3.2.)
- **Warn** (not fail) when a stable board's `[BoardVersionToken]` changes, so post-promotion edits are deliberate.

### 7.2 "Report a Problem" issue template

Each issue contains:

1. **Identity** — `collection_id`, subfolder/lesson, board number.
2. **Full verbatim deal text** — the ground-truth locator; greppable against the repo.
3. **`[BoardVersionToken]`** — the rotation-canonical stamp; a fast exact-match for the reported board across its rotational variants and other files.

### 7.3 PBN carriers (the tagging terms)

Vocabulary note: the producer-facing release flag is **`stable`** (earlier drafts called it *ready* — retired); the consumer stores `prerelease = NOT stable`.

| Level | Carrier | Value | Consumer column |
|---|---|---|---|
| File (header `%` comment) | `%bridge-classroom-stable:` | `true` / `false` (absent ⇒ not stable) | `observations.prerelease = NOT stable` |
| Board (`[Tag]`) | `[Stable "true"\|"false"]` | per-board override of the file default | `observations.prerelease` |
| Board (`[Tag]`) | `[BoardVersionToken "…"]` | rotation-canonical `sha256(deal+auction)`, lowercase hex (§5.2) | `observations.board_version_token` |
| Board (`[Tag]`) | `[SkillPath "…"]` | existing; must be a real path once `stable=true` (`uncategorized` allowed only while prerelease) | `observations.skill_path` |

**`collection_id` is not a PBN carrier** — BC sources it from its own collection config (`COLLECTIONS[].id`: `baker-bridge`, `pbs-coaching`), stamped from the active collection at write time (§3.2).

Naming: no `bridge`-prefixed *tags* (a PBN is already a bridge file) and no `BC` prefix (Bridge Composer owns it); file-level comments use the full `bridge-classroom` product namespace.

---

## 8. Flagging the existing Practice-Bidding-Scenarios observations as prerelease

David's development-era observations are **not deleted** — they are set to **`prerelease = 1`** (identified by `collection_id = 'pbs-coaching'`, i.e. the current `uncategorized/` set). They keep their beta history, navigation icons, and drill-down, but are excluded from mastery and platform statistics like any prerelease board (§6.5). This also preserves the beta testers' own progress-through-the-set history.

**Sequencing matters:** backfill `collection_id` + `prerelease` from the `uncategorized` heuristic **first** → *then* remap David's skill paths. Once `collection_id` and `prerelease` are set they become the durable discriminators, so the later skill-path remap is safe and no longer depends on the `uncategorized` marker.

---

## 9. Rollout order

1. **Agree the contract in writing** (§10). Includes the slug set and the token's role (opaque to BC).
2. **Add `collection_id` to board identity** — schema, backfill `exercise_boards` blanks, add `observations.collection`, fold into the mastery key and `exercise_boards` PK/index.
3. **Flag** the Practice-Bidding-Scenarios observations `prerelease = 1` by `collection_id` (not deleted — see §8).
4. **Remap** David's skill paths off `uncategorized` — no longer urgent under C5's relaxed rule (it's a prerequisite for *promoting* his content to `stable`, not for keeping it playable as prerelease). Do it before, or as part of, promotion.
5. **Producer stamps** `stable` + board-version token going forward; David's content records as `prerelease` until promoted.
6. **Ship the app change** — `prerelease` flag set at the writer, `collection` + token recorded per observation, mastery/platform-stat exclusion of `prerelease` (§6.5), triangle marker in the strip/grid, exercise-creation guard.
7. *(Optional)* Backfill the token onto existing Baker observations from the stamped PBNs — low value (a telemetry baseline for static content), gated on the PBNs carrying the token; do it last, if at all.

---

## 10. Contracts

Interface agreements; changes require both sides. A producer-facing distillation
of C1–C7 as author obligations lives in
[`collection-producer-contract.md`](./collection-producer-contract.md).

### C1 — Board identity
Identity is `(collection_id, deal_subfolder, deal_number)`. `collection_id` is the BC-owned collection slug from `COLLECTIONS[].id` (`baker-bridge`, `pbs-coaching`, …) — a BC config value, **not** a PBN carrier and not a producer concern (§3.2); no surrogate id. Subfolder names are **not** assumed unique across collections.

### C2 — Board-version token
Producer stamps `[BoardVersionToken "…"]` per board: `sha256( deal + "|" + auction )` over the **rotation-canonical** form (rotate the deal *and* the auction so ♠A is North; §5.2), lowercase hex, from extracted values. **Opaque to the consumer** — BC records and echoes it but never computes, verifies, or compares it. Producer-owned; there is no consumer implementation and no cross-language matching requirement.

### C3 — Release status (`stable`)
Producer declares the `stable` flag via `%bridge-classroom-stable: true|false` (file default) + `[Stable "true"|"false"]` (per-board override); absent ⇒ not stable. Not-stable: playable; observations ARE recorded but MUST be flagged `prerelease`, MUST NOT count toward mastery or platform statistics, and the board MUST NOT be selectable into exercises; consumer shows a development warning and a distinct (triangle) history marker. Stable: full behavior. Promotion and token publication are atomic from the consumer's view. **A replacement for a stable board MUST itself be stable.** (`prerelease` is a consumer-side column equal to `NOT stable`; the producer owns only the `stable` declaration. This board-level flag is distinct from the collection-level `report` flag — see §4.1.)

### C4 — Position stability
Producer MAY edit or replace stable boards, but MUST NOT renumber them within a lesson except by explicit coordination. A replacement occupies the **same identity** and SHOULD match the difficulty of what it replaces (lessons are ordered easy→hard).

### C5 — Skill-path mapping
Every **stable** board MUST map to a real skill path; `uncategorized` is permitted **only** while a board is prerelease. The requirement binds at promotion: a board MUST carry a real `[SkillPath "…"]` before it is set `stable=true`. (Skill path feeds only mastery, from which prerelease observations are already excluded, so it need not be assigned earlier.) New paths are minted as needed.

### C6 — "Report a Problem" payload
Consumer includes: identity (`collection_id`, subfolder, board number), verbatim deal text, and the board-version token. Producer treats the deal text as the authoritative identification and the token as the cross-rotation locator.

### C7 — History immutability
No producer action (edit, replacement, retirement, regeneration, non-stable renumbering) requires or triggers any mutation of consumer observation or mastery data. Consumer observations are self-contained; the consumer never re-fetches a board to display history.

---

## 11. Reconciliation with `deal-hash-identity-plan.md`

See the table in [ADR-0001](./0001-positional-board-identity.md#reconciliation-with-deal-hash-identity-planmd). In short: the content-hash **keying** and the position→hash **remap** are declined (self-contained observations make them unnecessary); the stamped hash is **adopted and repurposed** as an opaque, rotation-independent board-version token; and a **collection dimension** — which the plan did not address — is added to board identity to fix the cross-collection subfolder collision.
