# Non-Persisting Deal Source Contract

**Who this is for:** anyone who provides a deal source that Bridge Classroom
**plays but does not track** — a private repo of deals (e.g. an instructor's
unreleased ABS set), a personal lesson collection used only in the teaching
console, or any source fed to a casual/teaching table where **no results are
saved**.

**What it is:** the (deliberately small) set of things you provide so your deals
show up as a first-class, well-organized menu in the app — without taking on any of
the obligations that exist to protect *persisted* student history.

**Status:** Proposed 2026-07-08 (Rick). Companion to the
[Collection Producer Contract](./collection-producer-contract.md), which governs the
*persisting* case.

---

## 0. The one-paragraph version

If Bridge Classroom never saves results from your deals, it needs almost nothing
from you. Ship a **menu manifest** — a button/section layout and a list of lessons
with display names (and, if you like, board counts for display) — and the app
renders your source in the picker in one fetch. That's the whole obligation. You do
**not** stamp version tokens, you do **not** mark boards `stable`, you do **not**
freeze positions, and you do **not** assign skill paths. Those exist only to keep
tracked history correct, and nothing about your source is tracked. Edit, reorder,
renumber, and regenerate freely.

---

## 1. Why this contract is so light — the dividing line

Bridge Classroom's whole identity/versioning apparatus
([ADR-0001](./0001-positional-board-identity.md), the
[Producer Contract](./collection-producer-contract.md)) exists for exactly one
reason: to keep **persisted** student mastery correct over time. The governing
invariant ([ADR-0002](./0002-collection-manifest-and-library-source.md#scope--persistence-is-the-dividing-line)):

> **The backend knows about a collection if and only if results from it are
> persisted.**

Your source is on the *non-persisting* side of that line. Deals flow **frontend →
(teaching/casual table) → players**, are played live, and are gone. Nothing is
written to the Bridge Classroom database — no observations, no mastery, no history.
So none of the persistence-protecting obligations can bind you, because there is
nothing to protect.

**Consequence for unreleased/licensed content:** your deals never reach our
database. The app relays them live; it does not store, index, or redistribute them.
This is what makes a private ABS repo usable here without an IP concern.

## 2. What you provide — a menu manifest (the only obligation)

A single JSON manifest describing your menu, fetched by the frontend in one request.
It carries **presentation only**:

```jsonc
{
  "schemaVersion": 2,
  "profile": "menu",                 // discriminator: this is a non-persisting menu manifest
  "layout": [                        // optional: section/row/button tree (same shape as PBS)
    { "type": "section", "title": "My Lessons" },
    { "type": "row", "buttons": [ { "name": "Squeezes" }, { "name": "Endplays" } ] }
  ],
  "lessons": {                       // keyed by the file the app loads (PBN basename)
    "Squeezes":  { "name": "Squeezes",  "boardCount": 20 },
    "Endplays":  { "name": "Endplays",  "boardCount": 18 }
  }
}
```

- **`layout`** (optional) — the button/section tree for the picker. Omit it and the
  app lists lessons flat.
- **`lessons`** — one entry per lesson, keyed by the file the app fetches. `name` is
  the display label; `boardCount` is a display convenience only (the app reads the
  actual boards from the PBN at play time).
- **`profile: "menu"`** — a discriminator so a reader can tell this from a tracked
  collection's manifest at a glance. (A tracked manifest carries the full board
  roster with tokens; see the Producer Contract.)

That's it. No per-board roster is required, because there is no backend consumer
that needs an authoritative count.

## 3. What you do NOT owe (and why)

| Producer-Contract obligation | Applies here? | Why not |
|---|---|---|
| R1 — declare `stable` | **No** | No mastery to gate; nothing is graded. |
| R2 — freeze stable positions | **No** | No persisted history is keyed to your positions. Reorder/renumber freely. |
| R3 — stamp a board-version token | **No** | The token exists to match boards *in stored history and reports*; there is none. |
| R4 — real skill path per stable board | **No** | Skill path feeds mastery/coverage, which you don't produce. |
| R5 — full board roster in the manifest | **No** | Only the menu (§2) is needed; the roster serves persisted denominators. |

In short: **[ADR-0001](./0001-positional-board-identity.md) positional identity does
not bind you.** Churn your deals however you like.

## 4. Promotion — becoming a tracked collection later

If you later want Bridge Classroom to **track** results from your source (mastery,
progress, teacher drill-down), it crosses the dividing line and becomes a persisted
collection. At that point — and only then — you adopt the full
[Collection Producer Contract](./collection-producer-contract.md): extend your
manifest to the tracked profile (add the per-board roster with `number`, `stable`,
`boardVersionToken`, `skillPath`) and take on R1–R5. The menu manifest you already
ship is a strict subset, so promotion is additive, not a rewrite.

## 5. References

- [ADR-0002 — Collection manifest & library source](./0002-collection-manifest-and-library-source.md) (the dividing line, §Scope)
- [Collection Producer Contract](./collection-producer-contract.md) (the persisting counterpart)
- [ADR-0001 — Positional board identity](./0001-positional-board-identity.md) (why the persisting side is heavy)
