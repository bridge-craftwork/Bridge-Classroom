# Rendering Harness & Component Redesign Plan

**Location:** `documentation/design/rendering-harness-plan.md`
**Status:** Active
**Last updated:** 2026-07-06

## Purpose

Establish a two-tier visual design and certification system for Bridge Classroom's
table components, and use it to drive the HandDisplay/annotation redesign — without
ever breaking the running system. Work proceeds in 1-day slices; every slice ends
releasable.

This document gives global context. Each slice is executed from its own short prompt
("Today is Slice N; do not proceed past it"). Read this whole document before starting
any slice.

---

## Rules of Engagement

These apply to every slice. They are not suggestions.

1. **Every slice ends with production visually unchanged**, unless the slice
   explicitly says otherwise. "Visually unchanged" means pixel-identical rendering of
   existing pages, verified by before/after screenshot diff (see Verification).
2. **Anything behind `VITE_HARNESS` is always safe to add.** Harness routes, specimen
   files, gallery tooling, and harness-only CSS (animation disabling, frozen clock)
   must not exist in a production build.
3. **No slice modifies the engine contract and a component in the same PR.**
   Contract changes and component changes are separate slices.
4. **One branch per slice; prove on the test environment before production.** Use the
   existing test/production two-environment deployment model. Merge to production only
   after the test deploy passes acceptance.
5. **Do not merge adjacent slices**, even when they touch the same file. The boundary
   between "inert restructure" and "first visible change" is the safety mechanism.
   Boring slice boundaries are the feature.
6. **Identical means identical.** In restructure slices, do not improve visuals,
   spacing, colors, or copy. Improvements have their own slices.

### Verification

- For pixel-identical slices: run Playwright against the current production build and
  the branch build, screenshot the affected views, diff with pixelmatch, and attach
  the result to the PR. Zero-diff (or diff confined to explicitly-named regions) is
  the definition of done.
- Once the harness exists (Slice 2+), every PR includes regenerated gallery images.
  The gallery is the review artifact.

---

## Concept: Two-Tier Gallery

### Tier 1 — Component specimens

Answers: *does this component hold up across its input and configuration space?*

- **Axes:** input × configuration × container width. No viewport, no engine, no shell.
- Components are mounted directly from a props file at
  `/harness/component/:component/:specimen`.
- **Enforcement effect:** if a component can't render standalone from a props file,
  it is secretly coupled to a store, composable, or engine. That's a bug in the
  component, not a limitation of the harness.

Container widths (replace viewports at this tier):

| Name | Width | Represents |
|---|---|---|
| `tile` | 160px | Teacher console tile |
| `narrow` | 240px | Compact side panel |
| `panel` | 320px | Standard side panel |
| `drill` | 480px | Drill-in / focused view |

### Tier 2 — View scenarios

Answers: *does this screen compose well at this size?*

- **Axes:** fixture × surface × viewport.
- A **fixture** is a frozen game/classroom state as a JSON literal, served to a
  fixture engine that implements the same contract as localEngine/serverEngine but
  only holds state. Mid-auction at table 3 is data, not navigation.
- **Enforcement effect:** if a view state can't be expressed as a fixture, the view
  is reading state from somewhere other than the engine contract.

Named viewports:

| Name | Size | Represents |
|---|---|---|
| `desktop-wide` | 1440×900 | Full-screen desktop |
| `laptop-half` | 720×900 | Half-screen next to Zoom — **primary teaching case** |
| `tablet-landscape` | 1180×820 | iPad landscape |
| `tablet-portrait` | 820×1180 | iPad portrait |
| `phone` | 390×844 | Phone portrait |

A **manifest** file declares which fixture × surface × viewport combinations are
meaningful (each entry: `{fixture, surface, viewports[], tags[]}`). The matrix is
pruned per surface — console fixtures don't render on phone; solo fixtures don't
need classroom states.

### Gallery output

- Playwright walks the manifest: set viewport/container, navigate, wait for
  `data-harness-ready` (set after mount + fonts loaded), screenshot to
  `gallery/{fixture}/{surface}/{viewport}.png` (scenarios) or
  `gallery/components/{component}/{specimen}/{width}.png` (specimens).
- A static HTML generator walks the output directory and emits one page:
  specimens grouped by component (rows = inputs, columns = widths, one grid per
  configuration); scenarios grouped by surface. Click-to-zoom. No app, no knobs,
  no live prop editing — specimens are files; changing one means editing the file
  and regenerating.
- **Diff mode:** previous run kept in `gallery-prev/`, rendered side-by-side.
- **Notes:** `notes.json` keyed by scenario path, rendered as captions. This is the
  running design-review document.
- `--only <filter>` regenerates a subset. Full matrix is for review sessions;
  filtered runs are the tight loop.

### Harness mechanics

- Playwright `webServer` block with `reuseExistingServer: true`; the dev server is
  used during iteration, `vite build && vite preview` for any CI/regression run.
- Specimen and fixture JSON imported via Vite glob imports (bundled, not fetched);
  no async loading states.
- Harness mode (`VITE_HARNESS=1`) enables: global animation/transition disabling,
  frozen clock for any timers/timestamps.
- Everything is loopback-only; runs headless and offline; unchanged in GitHub Actions.
- **Regression promotion (later, not now):** gallery run and regression run are the
  same script with a different flag; output paths already structured for baseline
  blessing. Do not start blessing baselines during active design iteration.
  Component-tier assertions get promoted to CI first — they drift least.

---

## Concept: Component Structure — HandDisplay · SeatChip · SeatPanel

Holdings and seat identity are **separate components**, composed:

- **HandDisplay** — pure holding renderer: cards, marks, density. No compass, no
  name, no presence, no turn state. Its geometry is a pure function of
  holding + marks + density. Deciding test: HandDisplay renders in contexts with
  no seat at all — combination illustrations in lesson commentary (AQ32 opposite
  54), "here's what North held" reveals, hand records in review summaries,
  gallery specimens.
- **SeatChip** — seat identity: name, compass, presence dot, turn indicator, card
  count when the hand is hidden. Deciding test: the chip renders with no hand
  attached — the teacher console tile's resting state (`S Rick Wilson ●`).
- **SeatPanel** — composes a SeatChip with an optional HandDisplay and owns their
  relationship: chip alone at `chip` density, chip + hand at `compact`/`full`.
  The **layout-inertness obligation** (reserved turn-indicator space) belongs to
  SeatPanel, not HandDisplay.
- **BridgeTable** arranges SeatPanels.

`active-seat` is therefore a **seat-level** state, not a card mark — it ends up in
SeatPanel. Interim: Slice 3 implements it as a HandDisplay mark (matching today's
rendering) to keep that slice minimal; it migrates out at the SeatPanel extraction
(see Directional).

---

## Concept: Annotation Architecture

HandDisplay (and siblings) stay **dumb**: they accept data plus an annotation map and
render marks to visual channels. They do not know what a finesse, a double-dummy
error, or a bot recommendation is. Producers (DD analysis, PBN construction-time
recommendations, bot suggestion, lesson definitions, console-level divergence
computation) emit marks in a shared vocabulary. A new pedagogical feature is a new
producer, not a component change.

### Mark vocabulary (initial)

| Mark | Payload | Meaning |
|---|---|---|
| `played` | `{trick: 1-13}` | Card has been played |
| `active-seat` | — (seat-level) | This seat is on turn. **Interim** HandDisplay mark (Slice 3 only); migrates to SeatPanel at extraction |
| `led` | — | Card led to its trick |
| `won` | — | Card won its trick |
| `recommended` | `{source: 'bot'\|'pbn'\|'dd'}` | Suggested card at this decision point |
| `dd-error` | `{cost: n}` | Play loses tricks double-dummy |
| `group` | `{id, kind: 'promotion'\|'finesse'\|'length'}` | Card combination (may span two hands) |

Notes:
- `group` carries an **id**, not a boolean — combinations span two HandDisplays and
  may coexist on one deal. Cheap now, painful to retrofit.
- PBN construction-time recommendation outranks DD when both exist for a card.
- DD-derived marks shown *during* play are a teacher-controlled option, default off.

### Visual channels

Background fill, border/outline, corner badge, underline/grouping bar, opacity,
weight. Channel allocation is **scoped by mode** (live play / review / lesson setup)
so meanings don't collide. Global assignments:

- **Background fill** = trick-order gradient (review): graded by **lightness of a
  single hue** (colorblind-safe; 13 hues don't exist), paired with a small ordinal
  **corner badge** — fill gives gestalt (early/mid/late), badge gives the fact.
- **Outline** = "notable vs optimal": recommendation during play, DD errors in review.
- `led`/`won` = glyph/border treatments layered over fills, never fills themselves.

### Densities

Density is a rendering budget, not a padding tweak. A mark that doesn't fit the
current density is simply not drawn; the annotation map never changes.

| Density | Renders |
|---|---|
| `chip` | Rank text only, suit rows, no annotations |
| `compact` | + one or two channels (background tint, played-state) |
| `full` | Entire channel budget (badges, outlines, fills, group bars) |

Console tile → drill-in is **the same component at different densities**, not two
designs.

### HandDisplay cell structure

- One element ("cell") per card; the ♠Q is the same DOM element from deal through
  review. Transitions animate on the element.
- **Fixed-width cells** per rank; "10" fits the cell via tabular figures/kerning
  (do not use "T" — wrong for this audience). Constant width per suit length
  regardless of ranks present.
- **Width reservation tiers:** reserve layout width for a 7-card suit (~99.5% of
  hands render with zero variation); compress within reserved width for 8–10;
  genuinely grow and let the arranger's `minmax` absorb 11+.
- **Played cards:** live play = collapse the cell (remaining shape reads true);
  review = keep the cell, trick fill, opacity step. The old strikethrough is
  removed (Slice 4, not before). `playedCards`/`hidePlayedCards` props collapse
  into the mode/density system.
- **Layout inertness:** active-seat indication must not shift layout. Reserve
  indicator space always (transparent border of identical width, or
  outline/box-shadow). After the SeatPanel extraction this obligation lives in
  SeatPanel; HandDisplay's guarantee simplifies to "geometry is a pure function
  of holding + marks + density." Acceptance test: step through a full auction and
  play; no glyph that isn't itself changing state moves by one pixel.

---

## Slice Sequence

Each slice is one day's work, one branch, one PR, releasable at end of day.
Do not start slice N+1 in slice N's PR.

### Slice 1 — HandDisplay goes cellular, pixel-identical — ✅ SHIPPED (0/3,046,400 px diff; PR #75)

Rebuild HandDisplay internals as per-card cells. Same fonts, same spacing, **keep
the strikethrough**. The cell structure ships inert.

- **Acceptance:** production pages pixel-identical (screenshot diff in PR).
- **Out of scope:** any visual change, marks prop, density changes.

### Slice 2 — Specimen harness, minimum viable — ✅ SHIPPED (10 specimens × 4 widths; PR #76)

`/harness/component/:component/:specimen` route behind `VITE_HARNESS`; 3–4
HandDisplay specimen files (flat 4333, 6421, 7-card boundary, mid-play with cards
gone); Playwright walk; static gallery generator. No view tier, no fixture engine,
no diff mode.

- **Acceptance:** one command produces a gallery page of HandDisplay at the four
  container widths. Production build contains no harness code.

### Slice 3 — Annotation contract, rendered as today — ✅ SHIPPED (44 renders 0-diff; PR #77)

Add `marks` and `density` props to HandDisplay. Implement exactly two marks:
`played` (rendered as today's strikethrough) and `active-seat` (rendered as today's
frame). Move that logic out of call sites; pass marks instead. (`active-seat` as a
HandDisplay mark is a deliberate interim state — it migrates to SeatPanel at the
extraction slice; do not invent SeatPanel here.) Add the
`full-everything` specimen with placeholder renderings for future marks (trick
fills, badges) — this answers the cell-size question.

- **Acceptance:** production pixel-identical again; `full-everything` specimen
  renders in gallery.
- **Out of scope:** fixing the jitter, changing the strikethrough.

### Slice 4 — First visible change (smallest one) — ✅ SHIPPED (jitter test 0-diff; PR #78; verified in real flow — jitter eliminated)

Fix active-seat jitter (reserved indicator space) and replace strikethrough with
cell-collapse in live play. All inside HandDisplay mark-rendering; trivially
revertible.

- **Acceptance:** jitter test passes (no unrelated pixel movement across an
  auction/play sequence); played cards collapse in live play; review contexts
  unchanged for now. **This slice is visible to students** — deploy to test,
  verify in a real lesson flow, then production.

### Slice 5 — Phase lift (independent; can run parallel any day) — ✅ SHIPPED (merged to `main`)

Move `cardplayPhase` out of BiddingPracticeView into `localEngine.phase` with the
three-state model (`bidding` | `play` | `review`); map serverEngine's `complete` →
`review` at the seam. **Decision to record in the PR:** what `review` reveals for
bidding-only decks (the old `off` state) — collapsing `off`/`unsupported`/`complete`
must be a decision, not a side effect.

Also add — in the **same engine, still inert** — a `wantsCall` field: "the
experience wants a bid from you now." For `localEngine` it is
`!auctionComplete && currentSeat === yourSeat`. It has no consumer until Slice 6, so
adding it here (engine state only, no component change) keeps Slice 6 a pure
consumption slice and satisfies Rule of Engagement #3. Do **not** overload
`isYourBid`, which stays literal-turn (turn indicator, play-phase turn logic);
`wantsCall` is a *distinct* intent field. This is what lets the later coached-track
retrofit map `hasBidPrompt → wantsCall` as a one-line adapter instead of a contract
rewrite (see Slice 6).

- **Acceptance:** local branch behavior reproduces current `cardplayPhase` behavior
  exactly; server branch unchanged; `wantsCall` present and inert (no call site reads
  it yet).

### Slice 6 — `useTableSlots` with discriminants — ✅ SHIPPED (merged to `main`, online test passed)

Pure derivation beside the engine returning **discriminants + props**
(`center: 'trick-area' | null`, `action: 'bidding-box' | null`), not component
references — shells own the string→component mapping (keeps engines importable in
tests; lets the console tile map the same discriminant to compact variants).
The `action` slot keys on `engine.wantsCall` (added inert in Slice 5), **not**
`isYourBid`. Collapse UnifiedTable's two internal branches onto it.

**Resolved — the coached-track divergence (was an open question).** The coached
track gates bidding on `hasBidPrompt` (step machine = turn ∧ script-position ∧
answer-state), not pure turn logic. The chosen bridge is a *distinct intent field*,
not either of the two options originally floated (do **not** overload `isYourBid`;
do **not** give the slot an override): each engine maps its own truth into
`wantsCall` — `localEngine` → `!auctionComplete && currentSeat === yourSeat`,
`serverEngine` → `isYourBid`, coached `useDealPractice` → `hasBidPrompt` verbatim.
Both live engines' `wantsCall` equals turn logic, so this slice ships correct with
no coached consumer yet; naming the field `wantsCall` now is what makes the
Directional MainLayout retrofit a one-line adapter. The divergence is absorbed at
the engine boundary, where capability differences already live — never in the shell.

- **Acceptance:** UnifiedTable server and local paths render through the same slot
  bindings; the `action` slot is driven by `wantsCall`; no behavior change.

**What actually shipped, and the one deferral (feeds Slice 6b).** `deriveSlots`
returns discriminant *strings* (`'trick-area' | 'bidding-box' | null`), not
`{kind, props}` — props stay bound in each shell's template (behavior-safe; the
`+props` richness lands when the branches actually merge, later). Two behavior-safe
findings surfaced during build:
- **center** keys on `hasCardplay` = cardplay *engaged* (`playCardplay &&
  cardplayPossible`), **not** *completed*. An earlier `playComplete` formula
  diverged on two states (the pre-first-card moment; toggled-off-mid-play) — caught
  by the 32-case cross-product test. "Engaged, not completed" is the load-bearing
  distinction; keep it.
- **action driven by `wantsCall` for LOCAL only.** The **server** bidding-box card
  intentionally shows *disabled while waiting off-turn* — a different affordance
  than local's on-turn-only box. Moving the server action onto `wantsCall` would
  *hide* that off-turn box: a visible change, forbidden in this no-behavior-change
  slice. So Slice 6 unified the server **center** but left the server **action**
  as-is. Finishing it is **Slice 6b**.

### Slice 6b — Server action slot onto `wantsCall` (VISIBLE change; own slice) — ✅ SHIPPED (hidden model; merged, confirmed live)

The one piece Slice 6 couldn't take without changing behavior. Decide the server's
off-turn bidding affordance deliberately, then move the server action card onto the
`slots.action` (`wantsCall`) discriminant so **both** shells drive the action slot
from one place — closing the "action driven by `wantsCall`" goal for the server.

The product decision to make first (this is why it's a visible slice, not a
restructure): when it is **not** your turn during a live auction, should the seated
player see the bidding box **disabled** (today's server behavior) or **hidden**
(local behavior, what `wantsCall` alone yields)? Options:
- **Hidden off-turn** (adopt local's model): server action becomes pure
  `slots.action`; drop the disabled-box card and its "Waiting for {turnLabel}…"
  sibling stays as the waiting affordance. Simplest; unifies cleanly.
- **Disabled off-turn** (keep server's model): the action discriminant must grow a
  `disabled` state (`{kind:'bidding-box', disabled}`) so one derivation expresses
  both shells — local always `disabled:false`, server `disabled: !myTurnToBid`.
  Richer contract, preserves the seated-player "your box is here, greyed" cue.

- **Acceptance:** server action renders through `slots.action`; the chosen off-turn
  behavior verified on a live table; **visible to players** — deploy to test, verify
  in a real seated auction, then production. (Per Rule of Engagement: visible
  changes get their own slice and a test-deploy gate.)

### Slice 7 — Fixture engine + first view scenarios — ✅ SHIPPED (table-scene view tier; 2 fixtures × 5 viewports; PR #79)

Fixture engine implementing the engine contract over frozen JSON. First manifest
rows: `auction-mid-competitive` × UnifiedTable × all five viewports;
`classroom-4tables-one-diverged` × console × `desktop-wide` + `laptop-half`.

- **Acceptance:** view-tier gallery renders; fixtures for edge states (13-card
  suit, long names, disconnected player, everything-alerted auction) are cheap to
  add.

### Directional (not yet sliced)

- **SeatChip/SeatPanel extraction:** ✅ SHIPPED (PR #81; BridgeTable+scenes 0-diff). create SeatChip (identity) and SeatPanel
  (chip + optional HandDisplay); `active-seat` migrates out of HandDisplay marks;
  layout-inertness obligation moves to SeatPanel; BridgeTable arranges SeatPanels.
  Natural predecessor to the responsive-arranger work (chips at small sizes are
  SeatChips).
- MainLayout retrofit onto `useTableSlots`: a coached engine (or `useDealPractice`
  fronting the contract) maps `hasBidPrompt → wantsCall`; the slot contract is
  otherwise unchanged (resolution recorded in Slice 6).
- Context panel as the fourth slot, keyed on `engine.capabilities`
  (narrative/chat/teacher controls). Prerequisite for in-app chat.
- Responsive arranger inside BridgeTable (container queries; seat chips at small
  sizes; tile = smallest breakpoint). The console tile is the forcing function.
- Console divergence producer (relative annotation: auction/contract/tempo
  divergence from field) — pure derivation over already-subscribed table state.
- Diff mode + notes in gallery; CI regression promotion (component tier first).

---

## Specimen Inputs (initial set for HandDisplay)

Geometry stressors: flat `4333`; `6421`; 7-card suit (reserve boundary); 8-card suit
(compression trigger); 11-card freak (growth path); all-four-tens (width jitter);
mid-play hand with 5 cards gone (collapse behavior).

Configurations: `chip` bare; `compact` + played; `full-everything` (trick fills,
badges, won/led glyphs, DD outlines, one group bar) — the permanent noise-ceiling
reference.

Sibling components, same treatment (later slices): **SeatChip** (long-name stressor
— "Katherine Montgomery-Fitzgerald III"; presence states; turn indicator on/off;
with/without card count); AuctionTable (4-call, 19-call
competitive, all-alerted, passout × tile/drill widths); BiddingBox (opening,
late-competitive mostly-illegal, all-disabled); TrickArea (mid-trick, complete with
winner, review overlay).

---

## Daily Prompt Template

> Read `documentation/design/rendering-harness-plan.md`. Today is **Slice N**.
> Acceptance criteria are in the plan. Follow the Rules of Engagement — in
> particular: [pixel-identical / visible-change] slice; branch + test deploy before
> production; do not proceed to Slice N+1; do not merge work from adjacent slices.
> Include the screenshot diff (and, from Slice 2 on, regenerated gallery images)
> in the PR.
