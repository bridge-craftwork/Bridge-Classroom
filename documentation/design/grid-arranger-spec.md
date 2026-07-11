# Grid Arranger & Table Config — Specification

**Location:** `documentation/design/grid-arranger-spec.md`
**Status:** Proposed
**Companions:** `rendering-harness-plan.md` (densities, harness axes, clamp
origins), `integration-roadmap.md` (slots contract, invariants, resequenced
order), the layout discussion of 2026-07-10 (A1 corner map)
**Last updated:** 2026-07-11
**Authorship:** design intent (claude.ai) reconciled with repo reality — see
**Reconciliations** below; edits threaded through the body are marked inline.

## Reconciliations with repo reality (2026-07-11)

This spec was drafted against design intent and then reconciled against the
codebase. Four seams, resolved here so the next reader sees where they were
rather than assuming the spec sprang fully formed:

1. **TS → JSDoc-typed JS.** The repo is plain JS (no `tsconfig`, zero `.ts`).
   `TableConfig` is a **plain JS object with a JSDoc `@typedef`**, not a TS
   interface; configs are `*.tableConfig.js`. (Introducing TS is a real decision
   that must not ride in on a layout slice.) — §2.
2. **Center discriminant extension owns the phase content; arrangement owns
   placement.** `useTableSlots` gains `center: 'auction' | 'trick-area' |
   'review' | null` (what the stage *is*, per phase). `arrangement` decides
   *where* it renders: **`legacy` maps `'auction'` to the rail** (today's
   UnifiedTable, byte-preserved — its shell just maps the new value to where the
   auction already lives), **`grid` maps it to the `center` region**. One slot
   contract, no arrangement awareness in the derivation. Lands with A1's plumbing
   slices **1.1/1.3**, before the grid flip. — §1, §2.
3. **`--table-scale` is the input; the clamp's output gets its own name.**
   `--table-scale` keeps its harness-plan meaning (the global preference / design
   axis — the *wish*). The clamp **reads** it and **emits a per-region effective
   scale as `--region-scale`**, leaving `--table-scale` untouched. Input
   preference, computed output, two names — no dual definition. — §3, §5 captions.
4. **The 7-card reserve moved up a level (it was retired *inside* HandDisplay,
   #154).** The arranger's *provisioning* asks "what seat scale makes a 7-card row
   fit this track"; HandDisplay measures whatever box arrives and runs its own
   cascade inside. Reserve width is a **constant computed from HandDisplay's
   exported unit geometry** (label-zone + cell + gap, em at 1.0×): `reserve =
   label + 7·cell + 6·gap`. Single source of truth, no hidden probe, no drift. — §3.

Smaller rulings folded in: the default arrangement is named **`legacy`** (not
`compass` — that would collide with `orientation: 'south'`); always-occupied seat
chips in A1 bidding are **intended** (a North chip gives "1♥ by North" a location),
shipping with the grid-flip visible slice; the gallery is **`gallery-a1/`** and
`a1-long-narrative` is new work built in the gallery step; and this ships on a
**short-lived PR carrying the a1 pixel-diff** (the diff is the gate; the PR is
where the evidence lives — "no long-lived branch," not "no PR").

**Refinement (2026-07-11) — seat uniformity is over *hand-bearing* seats.** Strict
min-across-all-four starves the hero: in A1 bidding only the hero shows a hand, but
the empty chip-only side cells are the narrowest tracks, so strict uniformity would
shrink the hero to fit cells holding only chips. Corrected rule in §3: uniform
scale = min fit over seat tracks currently displaying a hand; chips-only seats
render at the cap-side value; recompute pinned to **phase boundaries** only. §6
now carries the concrete `a1.tableConfig` values and a **prediction table** the
first gallery review will confirm or refute.

## Purpose

Build the real `grid` arrangement inside BridgeTable (the arranger), driven by
a per-surface **table config object**, and regenerate the A1 gallery scenarios
through it — replacing the corner-emulation mockups. Production stays on
`legacy`; the grid ships dark.

## Safety model (ships dark, short-lived PR)

- `arrangement` defaults to `'legacy'` everywhere (= today's BridgeTable layout).
  No surface opts into `'grid'` in this work. The config object activates only
  under `'grid'`.
- This lands on a **short-lived PR** (not a long-lived branch), **and the a1
  pixel-diff obligation is unchanged**: the PR description carries screenshot
  evidence that `legacy` output is byte-identical with the new arranger code
  present, before anything a1 renders deploys. The diff is the definition of done;
  the PR is where that evidence lives.
- Rules of Engagement otherwise apply (test env before prod tag; alpha surfaces
  free).

---

## 1. Named areas

The grid arrangement is a 3×3 CSS Grid with `grid-template-areas`:

```
nw   n    ne
w    center   e
sw   s    se
```

| Area | Role (phase-stable) | Typical occupant |
|---|---|---|
| `n` `e` `s` `w` | Seats | SeatPanel (SeatChip minimum — **always occupied**; the grid never reflows on visibility/phase change) |
| `center` | The stage — phase slot | Bound via the extended `useTableSlots.center` discriminant (`'auction' \| 'trick-area' \| 'review' \| null`, see Reconciliation 2): AuctionTable during bidding, TrickArea during play, annotated reveal in review. Under `grid` the arrangement renders this value in the center region; under `legacy` `'auction'` maps to the rail (unchanged). BiddingBox is NOT here — it lives in `se` (action) |
| `nw` | Status | StatusStrip (board · dealer · vul-diamond → contract/declarer → tricks-vs-target → result) |
| `ne` | Auction reference | AuctionTable at configured density (A1: `full` pinned during play; table apps later: `chip`, Phase 5) |
| `se` | Action | BiddingBox during bidding; Undo/Claim cluster during play. Adjacent to hero seat by design (physical-table bidding-box position) |
| `sw` | Deliberately sparse | Nothing, or small stable items (Back, Report). Empty is a valid and expected state |

Corner **roles are phase-stable**: a corner's job never changes with phase;
only its occupant's content/density does. During bidding, `ne` may be empty
(the live auction is in `center`); during play, `center` hosts tricks and `ne`
holds the completed auction.

**Bidding-scene vertical model — bottom-anchored (2026-07-11, design direction).**
During bidding the row model is `auto 1fr auto` (status band / flexible **slack** /
stage+hand) and the center stage is **bottom-aligned**. The working cluster is
bottom-anchored: the auction grows **upward** into the slack above it, its bottom
edge (the current-round row) holding a fixed screen position adjacent to the
stationary hand + bidding-box row. The hand and BiddingBox do not move as calls are
added; they displace downward **only once the slack is exhausted** at the current
viewport. Play/review keep the weighted-fr rows (centered stage). The grid must be
given a height by its shell frame for the slack to exist (it fills via
`min-height:100%`); with no sized parent it collapses to content height, harmless.
Config-driven: `anchor: { bidding: 'bottom' }` (A1 opts in); default centered.

> **No-reflow rule, amended (2026-07-11).** The original guarantee — "the grid
> never reflows on visibility/phase change" and "no glyph that isn't itself
> changing state moves by one pixel" — is refined: **content-driven, monotone
> stage growth is permitted mid-phase, slack-absorbed first.** The auction gaining
> a round is not a forbidden reflow; it is absorbed by the slack row without moving
> the hand/BB, and only displaces the cluster when the slack is gone. Visibility
> and phase-change reflow remain forbidden; what is newly allowed is the stage
> growing into reserved slack. Acceptance for this is the len1/5/9 triptych (§7).

**Orientation — one rotation, per-surface anchor (plus visibility, independent):**

- **Rotation:** `seatToArea(seat, anchorSeat)` applied by the arranger before
  any region logic. Standard convention relative to the anchor: anchor → `s`,
  partner → `n`, anchor's LHO → screen left, RHO → screen right.
- **Anchor is config:** `orientation: 'hero' | 'south'`.
  - `'south'` — compass-fixed newspaper/book layout (South always at bottom;
    a West-seated student's hand renders at screen left). **A1 uses this**:
    it preserves current A1 behavior, matches the print conventions the
    lessons derive from, and costs nothing in practice — A1's bidding
    exercises seat the student South (where the two anchors render
    identically, so SE bidding-box adjacency is preserved), and the
    hero-E/W defense lessons are cardplay-only.
  - `'hero'` — student's seat at bottom, world rotates. **Table apps use
    this**: it is how online play universally renders, and it matches the
    physical room (a West defender sees dummy North at screen left).
  - Same function, different anchor argument; no second code path.
- **Deal relabeling (renaming the student's seat to South) is rejected**, not
  deferred: it falsifies the auction record, dealer, vulnerability, PBN
  provenance, and any discussion of the hand outside the app. Do not
  repropose.
- **Visibility:** which seats show hands vs. chips is deal data (the PBN's
  display directive, e.g. "show West and North for a West-seated student"),
  flowing through capabilities/props into SeatPanels. All four seat areas are
  ALWAYS occupied (chip minimum); visibility never changes the grid geometry.
  Rotation and visibility are orthogonal; neither consults the other. *(So an A1
  bidding exercise shows the student's hand plus three seat chips — intended: a
  North chip gives "1♥ by North" a location. This is new in the grid flip, a
  visible slice, not the byte-preserved `legacy` path.)*
- **AuctionTable stays compass-fixed** (W N E S columns in standard order,
  hero's column highlighted) under either anchor — auction notation is
  compass-native everywhere students will read it.

## 2. Config object

One file per surface (e.g. `src/table-configs/a1.tableConfig.js`) — a **plain JS
object** validated against a JSDoc `@typedef` (Reconciliation 1; the repo has no
TS). The arranger consumes `config + engine.phase + measured container size` and
computes everything. No layout decisions in views; none in leaves.

```js
/**
 * @typedef {'status'|'auction-ref'|'action'|'nav'|'none'} RegionSpec
 * @typedef {'nw'|'n'|'ne'|'w'|'center'|'e'|'sw'|'s'|'se'} Region
 * @typedef {'chip'|'compact'|'full'} Density
 *
 * @typedef {Object} TableConfig
 * @property {'legacy'|'grid'} arrangement   default 'legacy' (today's BridgeTable); shell may override per viewport
 * @property {'hero'|'south'} orientation    rotation anchor (see §1) — A1: 'south'; tables: 'hero'
 *
 * // ---- grid-only below ----
 * @property {{ nw?: RegionSpec, ne?: RegionSpec, se?: RegionSpec, sw?: RegionSpec, center: 'slot' }} regions
 *   component discriminant per named area; center is always the phase slot; n/e/s/w are implicitly SeatPanel
 *
 * @property {{ columns: [number,number,number], rows: [number,number,number] }} tracks
 *   fr weights, e.g. columns [1, 1.4, 1]; rows [0.8, 1.2, 1.2] (weighted hero row)
 *
 * @property {Object} scale
 * @property {'--table-scale'} scale.wishVar     INPUT: the global preference/design axis the clamp reads (its
 *                                                harness-plan meaning is unchanged); the clamp EMITS a per-region
 *                                                effective scale as `--region-scale` and never writes --table-scale
 * @property {{ center:number, seats:number, nw:number, ne:number, se:number, sw:number }} scale.caps
 *                                                per-region role caps (see §3) — A1 draft: center 1.8, seats 1.4, periphery 1.0
 * @property {number} scale.legibilityFloor      hard minimum, default 0.65 — fit may override the wish down to this, never below
 *
 * @property {{ bidding: Object<Region,Density>, play: Object<Region,Density>, review: Object<Region,Density> }} densities
 *   per phase, per region — e.g. A1 { play: { ne: 'full' } } (pinned auction); tables Phase 5 { play: { ne: 'chip' } }
 *
 * @property {{ bidding?: 'bottom'|'center' }} [anchor]   vertical model per phase (§1 bidding-scene model).
 *   'bottom' = bottom-anchored working cluster: rows become `auto 1fr auto`, the center stage bottom-aligns, and the
 *   auction grows upward into the slack while the hand/BB row holds its screen position. Default (omitted) = centered.
 *
 * @property {{ perViewport: Array<{ minWidth?:number, maxWidth?:number, portrait?:boolean,
 *              mode:'two-column'|'stacked'|'drawer', companionPosition?:'left'|'right'|'above'|'below' }> }} shell
 *   consumed by the APP SHELL, not BridgeTable (see below), matched top-down, first hit wins:
 *   two-column = companion beside a sticky grid; stacked = companion above/below; drawer = companion behind a toggle
 */
```

Semantics and rules:

- **Config is data, reviewed like code.** Surface differences must be config
  diffs. If two surfaces need different *code paths* in the arranger, the
  design is wrong — stop and flag.
- The **shell block is consumed by the app shell**, not by BridgeTable: the
  shell decides two-column/stacked/drawer and places the companion (narrative,
  coach); BridgeTable only ever receives a box and fills it. The grid
  preserves its internal layout and aspect in every shell mode — portrait
  reorders *around* the grid, never *within* it.
- `center: 'slot'` is mandatory in grid mode: the center binds the **extended**
  `slots.center` discriminant (`'auction'|'trick-area'|'review'|null`,
  Reconciliation 2). The derivation stays arrangement-blind — it reports *what
  the stage is*; `arrangement` maps *where* (`grid` → center region; `legacy` →
  `'auction'` to the rail, byte-preserved). **This discriminant extension lands
  with A1's plumbing slices 1.1/1.3, before the grid flip** — `legacy` consumers
  (UnifiedTable) don't change behavior when the value appears; their shell just
  maps `'auction'` to where the auction already lives. The `se` action region
  hosts `slots.action` during bidding (BiddingBox) and the play-controls cluster
  during play (shell-owned discriminant mapping, per the roadmap's rule).

## 3. Scale clamp (the heart of this slice)

Per region, per render. **Input:** `--table-scale` (the *wish* — global
preference/design axis, harness-plan meaning unchanged). **Output:** a per-region
effective scale published as **`--region-scale`** on that region's subtree;
`--table-scale` is never written (Reconciliation 3).

```
wish         = read(--table-scale)                       // global preference, e.g. 1.0
needed       = region reserve width at 1.0×              // NOT content — see below
fit          = availableRegionWidth / needed
regionScale  = clamp(legibilityFloor, min(wish, fit_grown_to_cap), roleCap)
              → set as --region-scale on the region
```

Precisely:

1. Compute `fit` from **measured region geometry** (ResizeObserver size-class —
   NOT container-type; see #88 postmortem), against the component's *reserve*,
   not its content (auction: 4 columns; bidding box: its fixed button matrix).
   **Seat reserve = a constant from HandDisplay's exported unit geometry**
   (Reconciliation 4): HandDisplay exports its `label`, `cell`, `gap` (em at
   1.0×) and the arranger computes `reserve = label + 7·cell + 6·gap`. Single
   source of truth — the reserve was retired from HandDisplay's *fit* (#154) and
   promoted here to the arranger's *provisioning*; the two layers share the
   numbers and can't drift.
2. `regionScale` = `min(wish, fit)` then allowed to **grow to fill** up to
   `roleCap` (fixes "auction tiny in a huge center"), and to **shrink below the
   wish** when the region physically cannot honor it (fixes the clipped-S
   auction) — but never below `legibilityFloor`.
3. **Seat uniformity (refined 2026-07-11):** one `--region-scale` shared by the
   seat regions, but **= min fit over the seat tracks currently displaying a
   hand**, not all four. Strict min-across-all-four is wrong: in an A1 bidding
   exercise only the hero shows a hand (in the wide center-column `s` cell) while
   the empty chip-only side cells are the *narrowest* tracks — strict uniformity
   would shrink the hero's hand to fit cells holding nothing but chips.
   **Chips-only seats always render at the seat scale's cap-side value** (chips
   have no reserve to fit). Computed from track geometry and the reserve, never
   from any hand's content — hands never change size because of shape or play
   state. **Recomputed only at phase boundaries, never mid-phase:** for A1 the
   hand-bearing set is fixed per deal (the PBN display directive), so it's stable
   throughout; for the table apps the dummy appears at the play transition, so the
   recompute pins to the bidding→play boundary — already a scene change (center
   swaps auction→tricks), where a seat-scale adjustment reads as part of the scene
   rather than as jitter.
4. Per-suit-row compression/truncation (HandDisplay's own cascade) operates
   *inside* the seat's `--region-scale` — i.e. HandDisplay measures the box it's
   handed and runs its `handFit` cascade there, unchanged.

The center's generous cap and the periphery's 1.0× caps encode the principle:
**the center region owns prominence; phase decides which component holds the
center and therefore which is big.**

## 4. Leaf blindness (enforced)

HandDisplay, SeatPanel, SeatChip, AuctionTable, BiddingBox, TrickArea,
StatusStrip receive density, scale, and props. They never read arrangement,
region, phase, or viewport. If implementing a region seems to require a leaf
to know where it is, **stop and flag it** — that is design feedback, not an
obstacle to code around.

## 5. Gallery integration

- Reuses the **separate `gallery-a1/`** surface (`npm run a1:gallery`,
  Reconciliation smaller-rulings). The existing `a1-bidding-exercise`,
  `a1-cardplay-exercise`, `a1-review` re-render through the **real arranger** with
  `a1.tableConfig` (replacing the band-mockup `A1Scene`); `a1-long-narrative` A/B
  (stacked-vs-drawer) is **new work built in this step**. Viewports
  `desktop-wide`, `laptop-half`, `tablet-landscape`, `tablet-portrait`; scales
  1.0× and 1.25×.
- **Computed-scale captions:** the walker captions every grid render with the
  per-region `--region-scale` outputs, e.g. `center 1.6× · seats 1.15× · ne 1.0×
  · se 1.0×`. The harness page exposes these via data attributes for the walker to
  read. This converts review from impressions ("auction looks small") to
  parameters ("center capped at 1.2 — raise the cap").
- The current band-mockup renders (this round's `gallery-a1/`, PR #159) are the
  **before-pictures** — keep a copy for side-by-side. First review question: do
  the three named complaints (bidding box below hand at desktop; small center
  auction; huge reference auction at laptop-half cardplay) dissolve under the real
  clamp and area map?

## 6. Initial config drafts (starting points, tuned in gallery)

**a1.tableConfig:** `arrangement: 'grid'`, `orientation: 'south'`; tracks columns
**`[1.1, 1.3, 1.1]`**, rows **`[0.85, 1.15, 1.3]`**; caps **center 1.8 · seats
1.4 · all periphery 1.0**; `legibilityFloor 0.65`; densities bidding `{ne:
none}`, play `{ne: full}` (pinned auction), review `{ne: full}`; shell:
`desktop-wide → two-column (companion left)`, `laptop-half → stacked (companion
above)` + the drawer variant for the A/B, `tablet-portrait → stacked (coach
below)`, `phone → stacked` (rendered for completeness, not optimized).

Why these values:
- **Columns `[1.1, 1.3, 1.1]`** — center widest (it's the stage *and* the hero's
  column), sides **close behind rather than starved**: under the `'south'` anchor,
  A1's defense lessons put a *real hand* in a side column (West at screen-left).
  That case — not the chips — sizes the side tracks.
- **Rows `[0.85, 1.15, 1.3]`** — top short (status, chips, reference-auction
  header), middle for the stage, **bottom heaviest**: the hero row carries the
  hand *plus* the SE action cluster and is the row seniors read continuously.
- **Caps center 1.8 / seats 1.4 / periphery 1.0.** Center 1.8 is deliberately
  *above* what desktop geometry yields (~1.5 computed) so the **cap isn't the
  binding constraint** at current sizes — geometry binds, and bigger screens get
  bigger auctions for free. Seats 1.4 covers senior generosity without ballooning.
  Periphery flat 1.0 **including SE** — the bidding box was designed comfortable at
  1.0 and its floor is *ergonomic* (touch targets), not typographic; identical
  peripheral caps also preserve the clean "center owns prominence" statement.
- **`legibilityFloor 0.65`** — the same constant as the HandDisplay cascade; one
  number, one meaning, one place.

**Predictions (first-review checklist).** These are what the computed-scale
captions must confirm or refute on the first render. **Reserve estimate ≈ 260px**
at 1.0× for a 7-card row (from the suit-fit measured geometry — compute it from
HandDisplay's exported cell metrics per Reconciliation 4, don't hardcode):

| Viewport (A1 shell) | center | seats (hand-bearing) | periphery |
|---|---|---|---|
| desktop-wide, two-column (~1000px grid) | ~1.5× | ~1.15× (hero in center col; ~1.15 via min with any side hand ~1.1) | 1.0× |
| laptop-half, stacked (~680px grid) | ~1.0× | **~0.9× hero-only bidding; ~0.8× when a side column bears a hand** | 1.0× |
| tablet-landscape, two-column | ~1.3× | ~1.05× | 1.0× |

The **bolded cell is the finding to stare at**: at the primary teaching viewport,
a defense lesson's West hand computes **below the 1.0 user floor**. That's not a
config failure — it's the honest geometry of 680px split three ways, and exactly
the tension the clamp exists to make *visible* instead of letting it clip.
Candidate responses, in the order to try them:
1. **Accept it** — 0.8× of the new base may still beat today's A1 rendering.
   *Measure, don't assume.*
2. **Give the grid more width** in stacked mode by tightening shell padding.
3. **Per-shell-mode column re-weight** — e.g. `[1.2, 1.2, 1.2]` for stacked; a
   config extension worth adding *only if the render proves the need*.

Decide from the captions, not in advance — every caption that disagrees with this
table is either a bug or a lesson, and both are what the gallery is for.

**tables.tableConfig (draft only, not adopted):** same region map; densities
play `{ne: chip}` reserved for Phase 5; shell two-column (context right).

## 7. Acceptance

- **a1 unchanged:** pixel diff of a1's current views (`legacy` arrangement) with
  the new arranger code merged — zero diff. This is the merge gate.
- Gallery: all A1 scenarios render through the real arranger; captions show
  computed `--region-scale` per region; **seat scale identical across all
  hand-bearing seats** in every render (chips-only seats at the cap-side value);
  no region below `legibilityFloor`; center auction at desktop ≥1.5× computed;
  ne auction at laptop-half cardplay = 1.0× computed; bidding box and hand
  side-by-side (s + se) at desktop and laptop-half. **Captions match the §6
  prediction table, or each divergence is triaged (bug vs. lesson).**
- Grid renders identically (internal layout) in tablet-portrait stacked mode
  vs. landscape two-column — only the shell placement differs.
- Config-as-data check: the diff between `a1.tableConfig` and
  `tables.tableConfig` is the complete statement of their differences; grep
  confirms no surface-conditional branches inside the arranger.
- **Bottom-anchor triptych (§1 bidding vertical model):** render the bidding
  fixture at auction lengths **1, 5, and 9 calls** (same deal, three snapshots).
  The hand row (`seat-s`) and bidding box (`se`) sit at **identical pixel `top`**
  in len1 and len5 (slack absorbs the growth); len9 shows **graceful displacement
  only if slack is exhausted** at that viewport. Measured by the walk
  (`gallery-a1/anchor-acceptance.json`); len1↔len5 stability is the pass gate,
  len9 displacement is permitted, not required.

## 8. Out of scope

- Any surface adopting `grid` or a non-default scale (separate visible-change
  slices per the resequenced roadmap: A1 flip after gallery sign-off).
- SE-corner Undo/Claim production wiring, cards-to-center replacing A1's
  exposure panels (ride the A1 flip slice).
- Weighted-hero-row tuning beyond the draft values (gallery iteration).
- Phase 5 chip density for `ne` on table surfaces.
- Phone-optimized layouts.
