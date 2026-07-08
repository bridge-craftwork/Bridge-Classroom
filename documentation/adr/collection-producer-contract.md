# Collection Producer Contract

**Who this is for:** anyone who produces a deal collection that Bridge Classroom
serves — today that's **Baker Bridge** and **David Bailey's
Practice-Bidding-Scenarios**, and any future collection.

**What it is:** the obligations you take on as a content producer so that Bridge
Classroom can track student mastery reliably and never corrupt a student's
history. (If Bridge Classroom **does not** track results from your source — a
private repo, a teaching-console-only set — you want the far lighter
[Non-Persisting Deal Source Contract](./non-persisting-deal-source-contract.md)
instead; this document is the *persisting* case.) It is the producer-facing distillation of [ADR-0001](./0001-positional-board-identity.md)
and its [companion spec](./board-identity-and-history-integrity.md); those two
documents are the normative source, and the contracts C1–C7 there govern if
anything here is ambiguous.

**Status:** Accepted 2026-07-06 (Rick + David). Changes to this contract require
agreement from both the consumer (Bridge Classroom) and the producers.

**Amended 2026-07-08** ([ADR-0002](./0002-collection-manifest-and-library-source.md),
Rick + David): added **R5 — publish a build-generated manifest** (§10).

---

## 0. The one-paragraph version

Bridge Classroom identifies every board by its **position** —
`(collection, subfolder/lesson, board number)` — never by its content. You mark
each board's release status with a **`stable`** flag in the PBN. A `stable` board
counts toward student mastery; a not-stable ("prerelease") board is fully
playable but its results are kept only in the student's private history. **Once a
board is `stable`, its position is frozen:** you may edit or replace it, but you
may not renumber it, and any replacement must occupy the same position, be itself
`stable`, and be of similar difficulty. That's the whole deal — the rest of this
document is the detail.

---

## 1. Why position, not content, is the identity

Every time a student plays a board, Bridge Classroom stores a **self-contained
observation**: the full deal, auction, contract, and cardplay are frozen into
that record. Teacher drill-downs render entirely from the stored record and
**never re-fetch the board**. Consequences you can rely on:

- **Editing or replacing a board can never corrupt existing student history.**
  What a student already played is frozen; nothing re-reads the live board to
  redisplay it.
- Bridge Classroom **never** asks you for, computes, or verifies a content hash
  as an identity key. Position is the key.

The flip side — and the reason this contract exists — is that because *position*
is the key, **you must keep positions stable once you've promoted them.** See §4.

---

## 2. Your responsibilities at a glance

| # | You must… | Carrier | Contract |
|---|---|---|---|
| R1 | Declare each board's **release status** (`stable`) | `%bridge-classroom-stable:` (file) + `[Stable "…"]` (board) | C3 |
| R2 | Keep **stable positions frozen** — no renumbering; same-position, same-difficulty, stable replacements only | (behavioral) | C4 |
| R3 | Stamp a **board-version token** on every board | `[BoardVersionToken "…"]` | C2 |
| R4 | Give every **stable** board a **real skill path** (required before `stable=true`; `uncategorized` OK while prerelease) | `[SkillPath "…"]` | C5 |
| R5 | Publish a **build-generated manifest** describing every lesson's board roster | `manifest.json` (build artifact) | ADR-0002 |

Not your responsibility (Bridge Classroom owns these — do **not** put them in your
PBNs): the **`collection` id**, the **`report`-button** flag, and the
**`prerelease`** column. See §6.

---

## 3. R1 — Declare release status with the `stable` flag

Every board has a release status. It is expressed by a single flag, **`stable`**,
at two scopes:

| Scope | Carrier | Meaning |
|---|---|---|
| **File** | `%bridge-classroom-stable: true` or `false` — a header comment near the top of the PBN | The default `stable` value for **every board in the file** |
| **Board** | `[Stable "true"]` or `[Stable "false"]` — a tag inside a single board record | Overrides the file default **for that one board** |

**Default is not-stable.** If neither the file comment nor a board tag says
`stable`, the board is treated as **not stable (prerelease)**. Forgetting the flag
is always safe: the worst case is that vetted content is *withheld* from mastery,
never that beta content silently *reaches* it.

What the two states mean for a student:

| `stable` | Playable? | Counts toward mastery / platform stats? | Selectable into a teacher exercise? | How it displays |
|---|---|---|---|---|
| `true` | Yes | **Yes** | Yes | Normal (circle marker) |
| `false` / absent | Yes | **No** — kept only in the student's own private history | **No** | "Scenario under development" warning; triangle marker |

So `stable=true` is your statement: *"this board is vetted; it is fair to grade a
student on it and to let a teacher assign it."*

Example PBN header (whole file stable):

```
% PBN 2.1
%bridge-classroom-stable: true
```

Example per-board override (this one board held back in an otherwise-stable file):

```
[Board "7"]
[Stable "false"]
```

---

## 4. R2 — Once stable, freeze the position (C4)

This is the obligation the whole design depends on. Because student mastery is
keyed to `(collection, subfolder, board number)`, that triple must keep pointing
at "the same teaching content" over time.

Once a board is `stable`:

- **Do not renumber it.** Board 5 must stay board 5. Reordering a lesson's boards
  re-points student history at content they never played. If you genuinely must
  renumber a stable lesson, that requires **explicit coordination with Bridge
  Classroom** first — it is not a routine edit.
- **You may edit it in place.** Fixing a hand, a bid, or coaching text on a stable
  board is fine — history survives revisions. (Your build should *warn* when a
  stable board's content changes so it's deliberate; see §5.)
- **A replacement must occupy the same position, be `stable`, and match
  difficulty.** If you retire board 5 and drop in a new deal, the new deal is
  still board 5, is itself `stable=true`, and should be about as hard as what it
  replaced (lessons are ordered easy → hard, and exercises/assignments reference
  positions). A replacement must **never** be prerelease — swapping a prerelease
  board into a promoted position would silently drop the student work recorded
  there.

Before promotion (`stable=false`), none of this binds you: prerelease sets churn
freely, and you can renumber, reorder, and regenerate at will.

**What you never have to worry about:** no edit, replacement, retirement,
regeneration, or (prerelease) renumbering ever requires Bridge Classroom to mutate
or delete student data. Observations are self-contained; history is immutable on
our side (C7). The freeze rule exists to keep *future* tracking correct, not to
protect *past* records.

---

## 5. R3 — Stamp a board-version token (C2)

Stamp `[BoardVersionToken "…"]` on every board from your build pipeline.

- **Value:** a content hash over a **rotation-canonical** form of the deal —
  rotate the deal *and* the auction so the ♠A holder sits North, then
  `sha256( canonical_deal + "|" + canonical_auction )`, lowercase hex, over the
  *extracted* values (not raw file bytes, so cosmetic reformatting doesn't churn
  it). Rotation-canonicalizing means every rotation of the same deal maps to one
  token.
- **It is derived, never hand-maintained** — recompute it each build. For Baker
  Bridge (`CSVtoPBN`, which emits no hash today) this is a **new post-generation
  stamping step**.
- **What it buys you:** when a student reports a problem, the token comes back in
  the report, letting you pin the exact reported board and find the *same deal in
  every other file where it appears in another rotation*. It also gives Bridge
  Classroom a passive change-over-time signal (re-stamped tokens on new
  observations).

**Bridge Classroom treats the token as an opaque string.** We record it and echo
it into reports; we never compute, verify, compare, or render it. There is exactly
one implementation of the hashing scheme — **yours** — and nothing matches against
it, so there is no cross-language contract and no shared test vectors to maintain.
It is *evidence, not enforcement*: if you edit a board but forget to re-stamp, we
record the stale token and the change is invisible — which is why the behavioral
freeze rule in §4, not the token, is the real guarantee.

---

## 6. R4 — Every stable board maps to a real skill path (C5)

Every **stable** board must carry a real `[SkillPath "…"]` — mint new skill paths
as needed. **`uncategorized` is permitted only while a board is prerelease.** The
requirement binds at promotion: assign the real path **before** you set
`stable=true`, not before then. (Skill path feeds only mastery, and prerelease
observations are already excluded from mastery — so an unclassified prerelease
board costs nothing. It's only when the board starts counting that its path has to
be real.) Skill path is also part of how Bridge Classroom presents progress and
(soon) filters lessons by level, so a stable board with no real path is invisible
to those features.

---

## 7. What is NOT your concern (Bridge Classroom owns it)

To avoid confusion, three things that look adjacent are **not** producer
responsibilities and must **not** appear in your PBNs:

- **`collection` id** (`baker-bridge`, `pbs-coaching`, …). This is a Bridge
  Classroom config value describing *where BC serves a file from*, not a property
  of the file. BC stamps it on each observation from its own collection config.
  Do not add a collection tag to a PBN.
- **The `report` flag** — a Bridge-Classroom-side, *collection-level* switch that
  governs whether the **Report-a-Problem button** appears. It is a **different
  scope and a different concern** from your board-level `stable` flag. BC decides
  it in its own `COLLECTIONS[]` config. When BC leaves it unset, the button
  simply follows your `stable` flag (a stable board is reportable). You never set
  it. (See the [scope summary](./board-identity-and-history-integrity.md#41-scope-summary-three-independent-flags)
  for how the three flags — file `stable`, board `stable`, collection `report` —
  relate.)
- **The `prerelease` column.** That is BC's consumer-side inverse of your `stable`
  flag (`prerelease = NOT stable`), stored per observation. You own only the
  `stable` declaration.

---

## 8. What you receive back — the "Report a Problem" payload (C6)

When a learner reports a problem with one of your boards, Bridge Classroom files a
GitHub issue (label `classroom-feedback`) **into your collection's repo**,
containing:

1. **Identity** — collection, subfolder/lesson, board number.
2. **The full verbatim deal text** — treat this as the authoritative locator;
   it's greppable against your repo.
3. **The `[BoardVersionToken]`** — your rotation-canonical stamp, for fast exact
   matching across rotational variants and other files.

Plus context (auction, contract, the student's seat and the prompt they were on)
where available. The deal text is ground truth; the token is your cross-rotation
shortcut.

---

## 9. Checklist for a new or promoted collection

- [ ] Every board carries a fresh `[BoardVersionToken "…"]` from the build.
- [ ] Prerelease content ships with **no** `stable` flag (or explicit `false`) —
      it will be playable and kept in student history but excluded from mastery.
      (A real skill path is **not** required yet; `uncategorized` is fine here.)
- [ ] **Before promoting**, every board being made `stable=true` carries a real
      `[SkillPath "…"]` (no `uncategorized`).
- [ ] When you promote, set `%bridge-classroom-stable: true` (or per-board
      `[Stable "true"]`) — and from then on, treat those positions as frozen (§4).
- [ ] Replacements for stable boards are same-position, `stable=true`, and
      similar difficulty.
- [ ] Your build **warns** when a stable board's content (its token) changes, so
      post-promotion edits are deliberate.
- [ ] You do **not** add a collection id, a `report` flag, or a `prerelease` flag
      to the PBN — those are Bridge Classroom's.
- [ ] Your build emits a **manifest** (§10) with every lesson's board roster
      (`number`, `stable`, `boardVersionToken`, `skillPath`), regenerated each build.

---

## 10. R5 — Publish a build-generated manifest (ADR-0002)

Your build emits a **manifest** — a JSON build artifact (not a PBN) — that is the
**authoritative description of your collection's shape**. Bridge Classroom fetches
it directly (it does **not** re-parse your PBNs to learn sizing), so the manifest is
how BC learns how many boards a lesson has and which of them are stable. Both
Baker Bridge and Practice-Bidding-Scenarios publish the **same** format.

For each lesson (keyed by **PBN basename**, which is exactly the `deal_subfolder`
BC stores on observations), the manifest lists every board with:

| Field | From |
|---|---|
| `number` | the board's position (R2) |
| `stable` | your `stable` flag (R1) — BC derives `prerelease = !stable` from it |
| `boardVersionToken` | your R3 stamp |
| `skillPath` | your R4 classification |

Regenerate it **every build** — it's the companion to the R3 token-stamping step
(for Baker Bridge, both are new post-generation steps in `CSVtoPBN`). The manifest
carries your producer-owned facts (`stable`, tokens, skill paths, board numbers); it
does **not** carry BC's `collection` id, `report` flag, or `prerelease` column — §7
still holds. Full schema in the
[design doc](../design/collection-manifest-and-library-source.md).

---

## References

- [ADR-0001 — Positional board identity](./0001-positional-board-identity.md) (the decision)
- [ADR-0002 — Collection manifest & library source](./0002-collection-manifest-and-library-source.md) (R5)
- [Board Identity, Readiness, and History Integrity](./board-identity-and-history-integrity.md) (full spec, contracts C1–C7, §4.1 scope summary)
- [Implementation plan](./implementation-plan.md) (consumer-side rollout)
- [Report a Problem — Design](../report-a-problem.md) (how reports reach your repo)
