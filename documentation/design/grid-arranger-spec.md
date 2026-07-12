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

**Bidding-scene vertical model — bottom-anchored, `reserveRounds`-sized stage
(2026-07-11, final).** During bidding the working cluster is **bottom-anchored**:
the hand + bidding box sit at the floor (the BB is never above the hand — the whole
reason to anchor at the bottom, not the top), and the AuctionTable — **sized to its
actual content, one row initially** — sits directly above them, its top fixed just
below the status strip. The center stage reserves a fixed height of **`reserveRounds`
call-rounds** (`auctionMetrics.auctionGrowthReservePx`, scaled by the center's own
scale). While the auction fits the reserve it grows into it with the hand/BB holding
position; once it exceeds the reserve the cluster takes the **monotone displacement
path** — auction top fixed, the auction bottom + hand + BB pushed down one round at a
time. **A1 sets `reserveRounds: 1`** (final): the stage is one row, so every extra
round displaces — the auction top stays pinned below the status and the cluster
slides down as the auction lengthens. A larger `reserveRounds` (another surface)
buys upward-growth room before displacement. Play/review keep the weighted-fr rows.
`reserveRounds` is a top-level tableConfig field; `anchor: { bidding: 'bottom' }`
selects the model.

**Occupancy model (2026-07-11) — the grid collapses around what isn't there.** A
region is *occupied* iff it renders content this deal (evaluated at load): the
centre stage always; a corner iff its role is configured AND the shell provided its
slot; a seat iff it's visible (the deal's display directive). Unoccupied regions
don't render, and three things are pure functions of occupancy:
- **Area template.** When the top-centre seat `n` is unoccupied, `center` absorbs
  its cell (spans rows 1–2 in the centre column), lifting the stage so the auction
  top aligns with the top-row status instead of sitting a row below. The stage is
  **top-anchored** in its span (`align-self/align-items: start`) so its top is fixed
  regardless of reserve/scale — no wobble.
- **Column widths from whole-column occupancy** (NOT just the seat). The centre
  column is the flexible stage (`1fr`); a side column is sized to the widest
  *reserve* among the regions occupying it, plus its margin box — so an occupied
  corner (the bidding box) sets the column and never overflows the hand, and an
  empty column collapses to `0`. **Caveat:** BiddingBox is fixed-width with no
  container-responsive narrow form (touch targets rule out shrinking by scale), so
  its reserve is its real footprint (~308px); a genuinely narrow BB is a separate
  BiddingBox change. At the primary teaching viewport the fat BB squeezes the stage
  column — the strongest argument for building that narrow form.
- **The legend** lists the unoccupied areas (diagnostic).

Two spacing/sizing rules this model requires (verified with the bounding-box
diagnostic, §5.1):
- **Grid `gap: 0`; spacing is margins on occupied (`.occupied`) regions only.** A
  grid gap still reserves a gutter around a *collapsed* 0-size track (empty
  seat/corner), which put a phantom band between the status strip and the stage.
  Margins on occupied regions collapse with occupancy; the check is `center top =
  one designed margin below NW`. Per-relationship gaps are config constants
  (`spacing.actionHandGap` ≈ 14px on the bidding box's hand-facing side).
- **`auctionMetrics.headerRowPx`/`roundRowPx` must track the real AuctionTable row
  heights** (measured, not guessed): if the reserve overshoots a one-round auction,
  the bottom-anchored auction floats down inside it — a per-round wobble in the
  auction top. Measure with `scripts/measure-auction.mjs` and correct the metric,
  don't fudge the CSS. **Re-measured 2026-07-12** after the glyph-scale restyle
  compressed the header band: 26/33 (reserve 59) → **19/35** (reserve 54, the real
  one-round height). Provenance is now guarded — the a1:gallery walk **asserts** the
  rendered auction height equals `auctionGrowthReservePx(rounds)` within ±2px at
  1.0× (len1/5/9), so the next typography pass that shifts these rows fails the walk
  instead of silently re-floating the auction.

> **The slack bug, and the ruling (2026-07-11).** The first cut made the *shell
> frame* viewport-height and used a `1fr` slack row, so "slack renders above the
> stage" became *the entire screen minus content*, and bottom-anchoring shoved the
> cluster to the floor with a ~500px void above it. The fix is not tuning that
> uncapped quantity — it is **capping it by its purpose**: the slack exists to
> absorb auction growth, so its size is the *expected growth reserve* (a realistic
> long auction, ~6 rounds ≈ 150–200px, not the viewport). **The grid shrink-wraps
> to its content + reserves; the shell owns where the block sits in the viewport**
> (A1: top-weighted, matching today). **Principle — the grid never reads viewport
> dimensions.** Any time the arranger reaches for `100vh`/`window`, something is
> miswired (the seat-tracks-for-absent-hands bug was the same disease). The
> arranger measures its own received boxes (ResizeObserver) and its components'
> exported reserves; nothing else.

> **No-reflow rule, amended (2026-07-11).** The original guarantee — "the grid
> never reflows on visibility/phase change" and "no glyph that isn't itself
> changing state moves by one pixel" — is refined: **content-driven, monotone
> stage growth is permitted mid-phase, reserve-absorbed first.** The auction
> gaining a round is not a forbidden reflow; it grows upward into the bounded
> reserve without moving the hand/BB, and only displaces the cluster when the
> reserve is exhausted. Visibility and phase-change reflow remain forbidden. The
> acceptance is the len1/5/9 triptych (§7): hand/BB stable, auction top rising,
> auction bottom fixed.

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
 *   'bottom' = bottom-anchored working cluster: the AuctionTable is sized to content, its top fixed below the status,
 *   and the hand/BB take the monotone displacement path as the auction lengthens. Default (omitted) = centered.
 * @property {number} [reserveRounds]   bidding stage reserve, in call-rounds (top-level; §1). A1 = 1 (single-row stage,
 *   pure displacement). Larger values buy upward-growth room before the cluster displaces. Default 1.
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

## 3. Scale clamp → one-directional budget allocator + layout ledger (2026-07-11)

**Superseded model below; this is the shipped one.** The clamp is now a single
**pure function** (`computeLayoutLedger` in `gridArranger.js`) that returns a
**layout ledger** — the complete accounting the render applies, the bounding-box
diagnostic reads, and the walker saves beside every capture (`*.ledger.json`).

The four rules, in order:

1. **Budget flows down.** The shell hands the grid a width **budget** (its offered
   content width). This is the *only* geometric input — measured once from the grid
   container's `clientWidth` (stable: the grid fills the frame, which never
   shrink-wraps horizontally). **The arranger never measures rendered content, and
   never reads the viewport.** Applying a scale therefore cannot feed back into the
   budget — verified: successive clamp passes are byte-identical, not a descending
   ratchet. (Vertical is a separate shrink-wrap from reserves; it never touches scale.)
2. **Reserves drive allocation.** Each column's **need** = the widest exported
   reserve among the regions occupying it (+ its margin box). Columns size to need,
   **not** stretched to fill the budget; the surplus becomes **outer margin**
   (`justify-content:center`), so hands cluster one gutter from the stage rather
   than spreading to its extremes.
3. **When the budget is short, importance decides who shrinks — and importance is
   config.** `allocationPriority` is an array of **tiers**. A higher tier is
   satisfied whole before a lower one gets anything; the first tier that can't fit
   **shares** the remainder (its members compress *together*, proportionally). So
   the working set (stage + hero hand) holds 1.0× while the periphery (bidding box,
   status) compress together — the hand yields a pixel only after they have. Tiers
   differ per surface, so they're data (A1: `[['center','n','e','s','w'],
   ['se','nw','ne','sw']]`).
4. **scale = min(1, allocated / reserve)**, floored. Natural size (1.0×) when it
   fits; below only when the budget genuinely can't. Seat uniformity = the min fit
   over hand-bearing seats, applied to all of them. ⚠️ **The `min(1, …)` upper
   clamp is a known regression** (center/stage growth to the `caps` value existed
   pre-rewrite — see the `1.27×`/`1.40×` captions in earlier gallery runs — and was
   lost here). §2's `caps.center: 1.8` is the intent; restoring `min(cap, fit)` is
   the queued caps-wiring slice (see *Review decisions §2*, 2026-07-12). Until then
   the "grow-to-cap retired" phrasing is the artifact of the regression, not a
   ruling.

**The ledger** (per stage): `budget`, `inputs` (occupancy, tiers), per-`columns`
(need, margin, tier, allocated, width), per-`regions` (`reserve`, `allocated`,
`scale`, `tier`, **`binding`** — which constraint set the scale: `natural` |
`budget` | `floor` | `overflow` — and the losing candidates), `seats.scale`,
`outerMargin`. `overflow` (2026-07-12) is the starved state — `allocated < floor ×
reserve`, i.e. the region can't render legally even clamped to the floor; distinct
from `floor` (pinned at the floor but it fits). Unit-tested directly
(`computeLayoutLedger`): no floor-bound regions at laptop-half bidding, uniform
seat scales across columns, review clustering (surplus → margin).

**Principle — every layout mechanism needs its measurement counterpart.** Spans,
absorption, phantom collapse each change how the render occupies the grid; each
must have a matching rule in the ledger's accounting (the width allocator *and* the
display-only vertical measurement), or the ledger drifts from the layout it
describes and reports phantom defects. Concretely: n-/s-absorption make the stage
span rows, so the vertical accounting measures a spanning stage against its **whole
span**, not one row's track (else it reads a spurious content>track); phantom
collapse excludes absorbed centre seats; and any genuine content>track surfaces as
a red `overflow` vbinding — the same vocabulary the columns use. A mechanism shipped
without its measurement counterpart is an unlabeled-defect generator (the 7px
mid-row artifact of 2026-07-12 was exactly this).

**Floor-protection / corner rule (2026-07-12).** Every occupied column reserves
`floor × need` (its overflow threshold) *before* the surplus grows columns toward
natural need by tier. A lone corner (NW/NE/SE/SW) rides at its floor minimum
instead of starving under a heavier sibling column while the budget has room; a
region only reports `overflow` when even the floor-minimums can't all fit.

### Review decisions (2026-07-12) — accepted tradeoffs & queued slices

1. **NE/SE floor at laptop-half: ACCEPTED (ruling, not just flagged), with a
   revisit trigger.** In three-hand defense scenes at laptop-half the **pinned
   reference auction** (NE) sits at the 0.65 legibility floor rather than shrink the
   hero/dummy hands — working-set protection wins. (After play bottom-pack the play
   controls relocated to the hero's tier-0 column and ride at 1.0×, so the live
   floor case is the NE *reference* auction only; a hero-East scene would put the
   controls at SE, symmetric.) **Accepted on CONTENT grounds, not pixel grounds:**
   in the current A1 defense lessons the student *did not bid the auction* — it
   arrives as given context, the coach text carries what matters from it, and the
   cardplay decisions in the existing decks rarely depend on auction inference. A
   reference the lesson barely references can be small. The restyled typography also
   softens it: today's 0.65× ≈ **15–16px** calls, larger than the old typography's
   0.66× delivered. Shown honestly in the ledger (red `floor`); "no floor bindings"
   is **not** a hard invariant at every viewport. **Revisit trigger:** if defense
   lessons enter the curriculum where *auction inference is the point* (declarer's
   bidding informing the defense), this ruling re-opens — and the prepared response
   is **Phase 5's compact AuctionTable density pulled forward** as a starvation
   response (existing planned machinery, not new capability).

2. **Caps wiring — regression repair, queued as its own slice.** `scale.caps > 1.0`
   is **not wired** (the allocator caps at `min(1, fit)`), but this is a
   **regression, not a design choice**: center/stage growth *existed pre-rewrite*
   (earlier gallery runs show `1.27×` / `1.40×` center captions) and was **lost in
   the pure-allocator rewrite**. So §2's `caps.center: 1.8` is the **intent**, and
   the allocator's `min(1, fit)` is the **bug**; §3.4's "grow-to-cap retired" line
   is itself the incorrect artifact of the regression and gets reconciled in this
   slice. The slice **validates against the §6 prediction table** (center ≈ 1.5).

3. **Play-cluster bottom-pack — SHIPPED (2026-07-12).** Extended the bidding anchor
   model to play (`anchor.play: 'bottom'` → content-sized rows). **s-absorption**
   (mirror of n-absorption) drops the stage into a hidden declarer's empty `s`
   cell, curing the "phantom South" dead band; the ledger's phantom now excludes
   both centre-column seats (`n`/`s`), flagging only a hidden SIDE seat. Content
   rows flip the cardplay stage viewport-fill → shrink-wrap (slack 327→36 desktop /
   261→24 laptop-half). **Undo/Claim ride the hero's bottom corner** via
   `actionCornerFor(heroArea)` — SE for a South/East hero, SW for a screen-left West
   defender — the arranger relocating the configured `action` role and the scene
   placing its slot through the same helper. Did not touch the NE/SE horizontal
   budget (decision 1 still stands). **Measurement-model fix rode along** (commit
   `ac38531`): the vertical accounting is now **span-aware** — a row-spanning stage
   (n-/s-absorption) is measured against its whole span, not one row's track, which
   removed a spurious 7px "content>track" the mid row reported unlabeled — and a
   genuine per-row encroachment now shows a red `overflow` vbinding, the same
   vocabulary the columns section uses. See the §3 measurement-counterpart principle.

4. **Generalize the seats-caption fix.** The gallery caption keyed "seats" to a
   literal `seat-s`, so it vanished when the hero sits W/N/E (fixed 2026-07-12).
   **Audit every caption/label keyed to a literal seat** for hero-relative
   correctness — the same latent bug can hide anywhere a fixed compass seat is
   assumed instead of a role derived from `heroSeat`.

---

### Superseded: the original per-region clamp

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

## 5.1 Bounding-box diagnostic (the layout X-ray)

The arranger already computes every number a layout debugger needs — region
boxes, reserves, scales, the growth reserve — so the diagnostic is just **making
its internal ledger visible**. (Named for the same overlay in `pbn-to-pdf`.)

- **Four layers**, each an overlay, color-coded: **grid tracks** (where the fr
  weights landed), **region content boxes** (what each named area received),
  **component reserves** (the exported need each component declared — the killer
  layer: *reserve larger than its box = encroachment* (the NE auction overflow);
  *box far larger than its reserve = dead space* (the empty seat tracks)), and the
  **growth-reserve / slack band** (the bidding stage's reserved height, hatched
  above the bottom-anchored auction).
- **Labels via pseudo-elements** are the LAYOUT LEDGER (§3), read straight from the
  pure allocator: `center · 115×60 · 1× · r220 · a260 · natural` — region · received
  W×H · scale · reserve · allocated · **binding constraint**. reserve-vs-allocated
  (and vs received) is the encroachment / dead-space / who-won-the-budget diagnosis.
  The arranger sets `data-bounding-box-label` (from the ledger) and
  `data-layout-ledger` (the whole ledger JSON, which the walker saves as
  `*.ledger.json` beside each capture). **Zero-size (collapsed) regions are listed
  in a corner legend**, not floated as `0×0` labels over the layout.
- **Gallery ledger table.** Each grid capture in the gallery HTML gets a `<details>`
  ledger (plus a page-level toggle-all): an inputs header (budget · occupancy ·
  tiers · outerMargin) over a `region · reserve · alloc · scale · tier · binding`
  table, the **binding cell colour-coded** (natural neutral · cap blue · budget
  amber · floor red) so a page scan reveals every floor-bound region at a glance.
  The walker **asserts the on-image labels equal the ledger file** number-for-number
  so the overlay can't drift from the saved accounting. Static HTML, no framework.
  *(Follow-up: a `gallery-prev/` ledger-diff dimension — changed rows highlighted,
  `se: 0.74×→0.88×, binding budget→natural` — riding the existing diff-mode infra.)*
- **Outline, never border** — outlines don't participate in layout, so the debug
  mode cannot perturb the geometry it inspects (the same trap the popup avoided
  with `cs-static`).
- **Zero production bytes** — the stylesheet (`src/harness/boundingBoxes.css`) is
  imported only by the harness scene view, gated exactly like the animation-disabling
  harness CSS. The data attributes on the arranger are inert and negligible.
- **Three consumption points:** `?bounding-boxes=1` (or the `b` key) in a harness
  build for live inspection; the a1-gallery walk captures a `__bounding-boxes.png`
  variant per scene (always for the bidding triptych; all scenes with
  `--bounding-boxes`) so review shows the skeleton beside the skin; and (planned)
  the dev-report bundle captures a second bounding-boxes screenshot when the flag is
  available, so every bug bundle ships its own layout X-ray. The **first render is
  the bidding scene** — it visibly confirms the fix: a single-row stage under the
  status where the viewport-sized void used to be. **Name: "bounding boxes"
  everywhere** (flag, gallery variant, labels, the planned dev-report screenshot).

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
- **Allocator ledger (§3), checked from `*.ledger.json` beside each capture:** at
  laptop-half **bidding** no region is floor-bound — the working set (centre + hero
  hand) is `binding: natural` at 1.0×, the periphery (bidding box, status) is
  `binding: budget`, compressing *together*. Seat scales are **uniform** across
  columns. In **review** the centre hosts the auction + result (NE freed), the four
  hands cluster compass-style around it (surplus → outer margin, not stretched to
  the extremes), and no seat is floor-bound. Three of these are unit tests on the
  pure `computeLayoutLedger`.
- **Known reserve debt:** the bidding box has no responsive narrow form (fixed
  ~308px; the roadmap records sizing as width-independent and touch targets rule
  out scaling it down), so its reserve starves the stage column at laptop-half more
  than an honest narrow form would. The priority rule keeps the *hand* at 1.0×
  regardless (periphery yields first); a narrow BB would lift the periphery too.
- **Bottom-anchor triptych (§1 bidding vertical model, A1 `reserveRounds: 1`):**
  render the bidding fixture at auction lengths **1, 5, and 9 calls** (same deal,
  three snapshots). The auction **top is fixed** (`seat-s`/`se` aside, the auction
  `top` is identical across all three, ±2px), and the hand (`seat-s`) + bidding box
  (`se`) take the **monotone displacement path** — pushed down one round each round
  (`top` strictly rises len1 < len5 < len9, ≈ one round-row per step). Measured by
  the walk (`gallery-a1/anchor-acceptance.json`, model `bottom-anchor+reserve(1)`);
  pass gate = auction top stable ∧ hand/BB rising. The `__bounding-boxes.png`
  variant shows the single-row stage reserve explicitly.

## 8. Out of scope

- Any surface adopting `grid` or a non-default scale (separate visible-change
  slices per the resequenced roadmap: A1 flip after gallery sign-off).
- SE-corner Undo/Claim production wiring, cards-to-center replacing A1's
  exposure panels (ride the A1 flip slice).
- Weighted-hero-row tuning beyond the draft values (gallery iteration).
- Phase 5 chip density for `ne` on table surfaces.
- Phone-optimized layouts.
