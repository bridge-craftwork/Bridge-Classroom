# Integration Roadmap — Components to Production

**Location:** `documentation/design/integration-roadmap.md`
**Status:** Proposed
**Companion to:** `rendering-harness-plan.md` (rules of engagement, harness mechanics,
annotation architecture — all still binding)
**Last updated:** 2026-07-11

> **Revision (2026-07-08):** review deltas applied after repo fact-check — server-path
> fixture driver added to Phase 0 (the referee for Phase 3); `wantsCall` promoted to a
> gating spike with a Phase 1/2 swap contingency; contract tests promoted to Invariant 7;
> instantiation metric corrected to *fork factor*; `.bp-*` target changed to zero-by-rename;
> stale BiddingBox sizing defect removed; ResizeObserver constraint recorded.
>
> **Update (2026-07-08, later):** Phase 0 shipped (0.1–0.4). The `wantsCall` spike is
> **resolved** — shape (c) pure mapping, and the Phase 1/2 order is **swapped** (local
> table first). See the Phase 1 spike block and the execution-order note.
>
> **Update (2026-07-08, maturity model):** added the **Maturity & risk model** —
> Scenario Mastery (the only released app) is careful; the alpha tables + console
> are replace-freely / verify-live. Execution order now **0 → 2 → 3 → 4 → 1 → 5**:
> all alpha surfaces first to settle the look-and-feel, Scenario Mastery integration
> last (but not frozen). Status region already shipped on both Practice Tables
> (#101 local, #102 server).
>
> **Update (2026-07-10, suit-fit + design-scale):** HandDisplay gained a
> **measured-fit suit model** (compress → truncate + `+N` chip → card-selector
> popup) that retires the old width-reservation tiers, plus a `--table-scale`
> design-scale axis. Full model in `rendering-harness-plan.md` → *Concept: Suit
> fit, design-scale & the card-selector popup*. Shipped to `main` (#152/#154);
> a1 pixel-identity holds at `--table-scale: 1.0`. *(This is a separate HandDisplay
> hardening track, not one of the integration phases below.)*
>
> **Update (2026-07-11, Phase 2 status):** **Phase 2 is underway, not "not
> started."** The status region shipped on both Practice-Table paths — local
> (#101) and server header (#102) — on top of the pre-existing center/action slot
> adoption on the local path. Remaining in Phase 2: **ContextPanel** (context
> region, still 0× in BiddingPracticeView), the **instantiation collapse** (still
> **4×** AuctionTable / 4× BiddingBox), and the `.bp-*` deletion. "Where we are"
> and the Phase 2 slice markers below updated accordingly.
>
> **Update (2026-07-11, execution order → A1-FIRST):** Rick's call — **reverse the
> alpha-first strategy and run sequentially with A1 (Phase 1 / Scenario Mastery)
> NEXT.** Rationale: A1 is the **most constrained** surface, and the alpha table
> apps are being built by *extending A1's table* — so settling A1's composition
> first lets the alpha apps develop around it, instead of designing on the alpha
> apps and then facing a hard retrofit into the constrained released app. New
> execution order **1 → 2 → 3 → 4 → 5**. A1's **care invariants still bind**
> (pixel-identical XOR visible; referee) — only the *order* changes, not the
> caution. **A1 layout decided:** AuctionTable → center, BiddingBox → SE, TableInfo
> (board/vul/status) → NW, completed auction pinned → NE (play/review), narrative
> floated right. Kicked off gallery-first: the three A1 states modeled as fixtures
> in a **separate** A1 gallery (#159) — see Phase 1.

## Where we are

- **Shipped:** 9 redesigned components (BridgeTable, SeatPanel, SeatChip,
  HandDisplay, AuctionTable, BiddingBox, TrickArea, **StatusStrip, ContextPanel**),
  pixel-identical/spec'd from frozen specimens; two-tier harness (specimens + view
  scenarios); `useTableSlots` (center/action/**status/context**) + `useTableStatus`
  + the **server-path fixture driver** driving harness scenes only. **Phase 0 complete.**
- **In progress — Phase 2 (BiddingPracticeView, local path):** the local path
  already rides `localEngine` + `useTableSlots` for center/action, and the
  **status region has shipped** on both the local (#101) and server-header (#102)
  Practice Tables (StatusStrip, 3× in the view). What remains in Phase 2:
  **ContextPanel** (context region — not yet wired, 0×), the **instantiation
  collapse** (still **4×** AuctionTable / 4× BiddingBox → 2×), and the `.bp-*`
  deletion (2.3).
- **Not started (but Phase 1 is next):** contract adoption in production —
  **MainLayout / Scenario Mastery** (Phase 1, the released app) now runs **NEXT**
  under the A1-first reorder (🟡 kicked off gallery-first, #159), then
  BiddingPracticeView's **server path** (Phase 3), and the **Teacher console**
  (Phase 4). These surfaces still wire components directly.
- **Gallery clipping debt:** cleared in Phase 0.1 (BridgeTable/AuctionTable/SeatPanel/
  HandDisplay), all via ResizeObserver / `min()` — never `container-type` (see the
  constraint in Component work · Row A; hotfix #88 is why).

## Where we're going

One table surface, slot-driven, phase-aware, capability-gated. Views bind a
handful of slot objects; all state assembly lives in engines and derivations.
Teacher console tiles are the same arranger at its smallest density. Status
indicators and context (commentary / chat / teacher controls) are first-class
slots, not view furniture.

## Invariants (every slice, every phase)

1. Each slice is **either pixel-identical** (plumbing; zero diff proves scope)
   **or precisely visible** (design; nonzero diff only inside the named region).
   Never both in one slice. *(Binding on **Scenario Mastery**; on the alpha
   surfaces this relaxes — see **Maturity & risk model** below.)*
2. Views only get dumber. State assembly moves **down** into
   engines/derivations, never sideways into another view.
3. **Ratchet metrics** — may only decrease; a slice that holds them flat is
   suspect, one that raises them is rejected:
   - `srv.*` occurrences outside `serverEngine.js` (currently 96)
   - `.bp-*` occurrences (currently 209)
   - `.tv-*` occurrences (currently 142)
   - **max component fork factor** in BiddingPracticeView (currently **4×** —
     AuctionTable & BiddingBox, each instantiated local-bid / local-review /
     server-bid / server-review). Secondary: **total surface instantiations**
     (currently **13** — AuctionTable 4, BiddingBox 4, BridgeTable 2, TrickArea 2,
     SeatPanel 1). *There is no "4×7"; BridgeTable/TrickArea are 2× (path fork),
     HandDisplay/SeatChip are 0 (nested).*
4. Shell CSS does slot layout only. Any rule styling component internals is
   deleted (gallery rendering is canonical), not migrated.
5. When a new visualization lands on a surface, the old version is **removed in
   the same slice**. No dual rendering, however temporary.
6. Per-region verification: drive old view and new binding from the same
   fixture; pixel-diff them against each other. The fixture engine is the
   referee. *(Reserved for **Scenario Mastery**; the alpha surfaces verify by
   Rick testing live, not by building referees — see **Maturity & risk model**.)*
7. **Contract tests, not just pixels.** Any slice touching an engine or
   derivation ships contract tests alongside the pixel diff. Pixel-identity is
   evidence of **scope**, never of **correctness** — two states can render
   identically while the engine is wrong (a seat-mapping error is invisible under
   a symmetric fixture: one deal, symmetric-looking state, wrong under rotation).
   Engine slices therefore include at least one **asymmetric fixture** (different
   contracts by seat, a rotated deal) so mapping errors can't hide behind
   symmetry.

## Maturity & risk model (2026-07-08)

The surfaces are NOT equally precious, so the invariants above are NOT applied
uniformly (Rick's calibration). Terminology is the dev launcher's
(`bridge-classroom.org/dev`).

- **Scenario Mastery** (`/#/` → MainLayout) is the **only released app**, heavily
  used, and the only one that records practice history to the Mac server. Treat
  with care: invariants 1 (pixel-identical XOR visible) and 6 (referee) are
  **binding here**; changes are small, non-disruptive, verified before shipping.
  It is **not frozen** — component-level adoptions land opportunistically (the
  merged X/XX BiddingBox already shipped into it) — but the **big look-and-feel
  integration comes LAST**, once the design is proven on the alpha apps.
- **Practice Table — solo / server, Host a Table, Teacher console** (the other
  routes) are **alpha**, built functionality-first with ~1–2 users (David + Rick
  on the solo table; Rick alone on the server/console). Here: **replace UI
  outright — chop and reassemble layouts freely rather than retaining old
  elements.** Invariants 1 & 6 relax; **verify by Rick testing live**, not by
  referees or pixel-diffs. Move fast.
- **The one hard constraint on the alpha work:** preserve *function*, especially
  the embedded bidding `?pbn=` path that **Game Analysis** (a released webapp)
  consumes. Break layout, not that integration.

**Strategy (revised 2026-07-11 — A1-first).** Superseding the alpha-first plan
above: do the **careful Scenario Mastery (A1) integration FIRST**, then let the
alpha surfaces develop around the settled A1 composition. A1 is the most
constrained surface and the alpha table apps *extend A1's table*, so settling A1
first avoids a hard retrofit into the released app later. The care level is
unchanged — A1's invariants 1 & 6 still bind; only the sequencing flips. Execution
order **1 → 2 → 3 → 4 → 5**. A1 is de-risked gallery-first (its target composition
modeled as fixtures, #159) before MainLayout is touched.

---

## Component work

### A. Refactor (existing components)

| Component | Work | Type |
|---|---|---|
| **BridgeTable** | Responsive arranger: per-density seat arrangement (SeatChips-only at `tile`), fix `tile` clipping. This is the console-tile forcing function. **Constraint: density must come from a ResizeObserver size-class, NOT `container-type`.** Inline-size containment breaks the solo view's shrink-wrap layout (the `.bidding-box-wrapper` centers via `align-items`, so the box sizes to content — containment collapses it). That is the root cause of the #88 revert, and the `tile`-clipping fix (0.1) is exactly where someone would otherwise reach for container queries again. | Gallery-first, then pixel-identical where prod already uses it |
| **BiddingBox** | Touch-target audit at tablet widths. (Sizing is width-independent post-#88 — no responsive step to fix; if narrow-tightening is ever wanted, use the same ResizeObserver size-class as BridgeTable, never `container-type`.) | Gallery-first |
| **AuctionTable** | Add density modes: `full` (bidding), `compact` (play reference), `chip` (contract only, tap-to-expand). Divergence display already shipped | Gallery-first; lands with play-phase compression (Phase 5) |
| **HandDisplay** | **Suit-fit rewrite shipped (in-review #154):** measured per-row compression → truncation + `+N` chip → floating `CardSelectorPopup`, on the `--table-scale` axis. Retires the width-reservation tiers. a1-identical at scale 1.0. Remaining: absorb review-mode channels as producers arrive (trick fills, DD outlines already placeholdered) | Specimen-driven; `handFit.js` + unit/hit-area tests |
| **SeatPanel / SeatChip / TrickArea** | Stable. TrickArea gains contract-relative trick framing via StatusStrip data (display only) | Minor |

### B. Create fresh (new visualizations — no pixel-match obligation)

| Component | Role | Notes |
|---|---|---|
| **StatusStrip** | Phase-aware reference indicators: dealer + vul (bidding) → contract + tricks vs. target (play) → result (review). Replaces DealInfo, ad-hoc pill chips, and missing server-path equivalents | Tricks shown **contract-relative** ("NS 7 · needs 10"). Stress specimens: 7NTXX, all vul states, doubled contracts. Keep minimal vul glyph during play |
| **ContextPanel** | Docked context region: lesson commentary / chat / teacher controls, keyed on `engine.capabilities` | Prerequisite for in-app chat. Absorbs MainLayout inline commentary, ScenarioChatPopup |
| **ConsoleTile** | Composition preset: BridgeTable@`tile` + AuctionTable@`compact` + SeatChips + divergence edge tint. Whole tile = one click target (drill-in). **Zero interactive elements inside** | Not a new table implementation — an arrangement |
| **TeacherActionBar** | Persistent console command strip (next board, pause bots, sync) + per-table actions in drill-in | Replaces Shark-style inset controls and floating teacher table |

### C. Derivations (contract layer — no UI)

| Derivation | Emits | Consumers |
|---|---|---|
| `useTableStatus` | `{dealer, vul, contract, declarer, tricks:{ns,ew,target}, phase}` | StatusStrip, TrickArea, ConsoleTile |
| `useTableSlots` (extend) | + `status`, + `context` slots alongside `center`/`action` | All shells |
| `wantsCall` adapter | `hasBidPrompt → wantsCall` (shape decided by the Phase 1 spike) | MainLayout retrofit |
| Divergence producer | Per-table marks: auction divergence (first call off majority line), contract divergence, tempo | ConsoleTile edge tint; drill-in AuctionTable marks. Pure derivation over already-subscribed state |

---

## Integration sequence

Phases are ordered; slices within a phase are one day each, one PR, releasable.
Region order within every surface: **auction (display-only) → action (bidding
box) → center (trick area) → status → context.**

**Execution order (revised 2026-07-11 → A1-FIRST): 1 → 2 → 3 → 4 → 5.** The phase
*numbers* are stable identifiers (slice references like 3.1 don't move). Reversing
the earlier alpha-first plan (was `0 → 2 → 3 → 4 → 1 → 5`): **Scenario Mastery
(1) goes NEXT**, then the alpha surfaces develop around its settled composition —
Practice Table local (2) → server (3) → Host a Table + Teacher console (4) — then
play-phase compression (5). Why: A1 is the most constrained surface and the alpha
apps *extend A1's table*, so proving the composition on A1 first avoids a hard
retrofit into the released app. A1's care invariants (1 & 6) still bind; A1 is
de-risked **gallery-first** (target composition modeled as fixtures — #159) before
MainLayout is touched. *(Phase 2's status region already shipped early on the
Practice Tables via #101/#102 — that work stands regardless of order.)*

### Phase 0 — Gallery debt + referees (before any prod wiring)

0.1 Fix BridgeTable `tile` clipping (ResizeObserver arranger, minimum viable — **not** `container-type`). Gallery-only.
0.2 **Server-path fixture driver.** The referee for Phase 3, without which Invariant 6 is unfulfillable for the server path (it would "merge on faith" — precisely what this apparatus exists to prevent). Two halves:
   - **replay** — feed a frozen `srv` snapshot through `serverEngine` so old-view vs new-binding can be pixel-diffed from identical state;
   - **capture** — a dev-mode hook that snapshots live `srv` state from a real session into a fixture file, because hand-authored server-state JSON drifts from reality; real captured snapshots are what make the referee honest.

   Side benefit worth naming: the replay driver is a permanent **socket-state debugging tool** — not a test-infrastructure tax, something you'd want anyway. *Likely the slowest Phase 0 item and the true long pole for Phase 3.* Gallery/dev-only.
0.3 StatusStrip + ContextPanel specimens (all phases × all widths). Gallery-only.
0.4 `useTableStatus` + slot extensions, driving harness scenes. Gallery-only.

*Everything in Phase 0 is production-invisible. Ship freely.*

### Phase 1 — MainLayout = Scenario Mastery (the released app — careful; runs NEXT, A1-first) — 🟡 KICKED OFF (gallery-first)

**Gallery-first kickoff (2026-07-11, #159).** Before touching MainLayout, A1's
target composition is modeled as fixtures in a **separate** A1 gallery
(`gallery-a1/`, `npm run a1:gallery`), three states: `a1-bidding-exercise`,
`a1-cardplay-exercise` (defensive-signals shape), `a1-review`. **Layout decided:**
AuctionTable → center, BiddingBox → SE, TableInfo (board/vul/status) → NW,
completed auction pinned → NE (play/review), narrative floated right.

Two findings for the slices below:
- **Corner slots vs. spanning seats.** True table-corner regions collide with
  BridgeTable's layout (N/S span full width; E/W in the side columns) — an
  absolute NE clipped North / hid the East dummy. The model uses top-band (NW/NE)
  + bottom action-band (SE) to stay legible; **decide in 1.3/1.4 whether A1 grows
  real BridgeTable corner slots** (a compass layout freeing the corners) or keeps
  the bands.
- **Annotation passthrough (feeds 1.5 / review).** BridgeTable derives only
  `played`/`active-seat` marks — no per-card badge/fill passthrough — so review's
  annotated-hand territory needs a marks prop threaded through BridgeTable → SeatPanel
  → HandDisplay (which already renders badge/fill).

**Spike — RESOLVED (2026-07-08). Shape (c): pure mapping `wantsCall := hasBidPrompt`.**
`hasBidPrompt` is a step-gated turn signal (`isBidStep && isStudentTurn &&
!auctionComplete && !bidAnswered && step.bid === expected`), but at the contract
boundary it is *already* exactly the boolean the action slot wants — "show the bidding
box now." Today's `v-if="hasBidPrompt"` **is** `action = wantsCall ? 'bidding-box' : null`,
so the map is a **rename, not a reconciliation** (and `tableEngine.js` already anticipated
it: "a coached engine substitutes its own truth"). Not **(a)** engine-level `wantsCall`:
MainLayout isn't on an engine (it uses `useDealPractice` directly) and likely never fully
collapses onto a table engine — coached lessons are a distinct interaction model, and the
**slot contract, not the engine, is the unification seam.** Not **(b)** contract override:
(c) needs zero contract change. MainLayout's genuinely hard part is elsewhere — `phase`
(no clean enum; derived from `auctionComplete` + `isDeclarerPlay` + `showOpeningLead` +
`hasSteps`) and the `center`/hand-visibility slot (`isDeclarerPlay` ×7, two `<BridgeTable>`
branches) — i.e. slice **1.3**, not the `wantsCall` of 1.2.

**Order — SUPERSEDED 2026-07-11 (was: local table first).** The earlier plan ran
Phase 2 before Phase 1 to mature the status/context machinery on a lower-traffic
view first; that is now reversed to **A1-first** (see the execution-order note and
the maturity model). The spike resolution below still stands — it's what makes
Phase 1 tractable to run next. Note the status/context machinery *did* already get
a real first home: the status region shipped on the Practice Tables (#101/#102)
independent of the reorder, so A1 debuts on already-exercised StatusStrip/slots.
The `wantsCall` mapping is unchanged.

1.1 Auction region → `slots` binding. Pixel-identical.
1.2 Action region → `slots.action`, using the spike's chosen `wantsCall` shape. Pixel-identical.
1.3 Center region → `slots.center` (kills the two `isDeclarerPlay` BridgeTable branches). Pixel-identical.
1.4 StatusStrip lands; DealInfo + old indicators removed same slice. **Visible change.**
1.5 Commentary extraction → ContextPanel (feedback panel + inline commentary + step controls). Pixel-near; small visible deltas acceptable, named in PR.

### Phase 2 — BiddingPracticeView, local path — 🟡 IN PROGRESS

*(**Runs after Phase 1** under the 2026-07-11 A1-first reorder. Center/action slots
are already adopted here via `localEngine` + `useTableSlots`, so this phase adds the
**status/context** slots and collapses instantiations. The status region already
shipped early (#101/#102) — see the 🟡 status markers below.)*

2.1 Local-bidding + local-review instantiations collapse onto slots (4× → 3×, then 2×). Pixel-identical. Fork-factor + `.bp-*` ratchets drop with each. — ⬜ **not started** (still 4× AuctionTable / 4× BiddingBox).
2.2 StatusStrip + ContextPanel on local path; old chips removed. **Visible change.** — 🟡 **partial: StatusStrip ✅ shipped** (#101 local, #102 server header); **ContextPanel ⬜** (context region not yet wired, 0× in the view).
2.3 Delete `.bp-*` component-internal rules. — ⬜ **not started.** **Any rule that survives the audit as legitimate shell layout is renamed into `.shell-*`, not kept** — so the ratchet reads `.bp-* → 0` (grep-checkable; no "shell-layout-only" judgment call, and the rename forces a one-by-one audit of every survivor). Pixel-identical (gallery is canonical — divergences resolve toward the gallery, each named in the PR).

### Phase 3 — BiddingPracticeView, server path

3.1 serverEngine maps `srv.*` onto the engine contract internally. `srv.*` outside serverEngine → 0. Pixel-identical **+ contract tests (Invariant 7), including an asymmetric fixture** (different contracts by seat, rotated deal) so seat-mapping errors can't hide behind symmetry.
3.2 Server-bidding + server-review instantiations collapse onto the same slots (→ **1× total**, phase-driven — **2× is not done**). Pixel-identical.
   *Verified against the code: the 2× BridgeTable/TrickArea are the local-vs-server path fork, and they are **arrangement-identical** — same `#center`/`#corner` slot structure, differing only in props (data source, `show-hcp`, `played-cards`) and slot content (waiting vs computing message; a capability-gated server `#corner`). So they collapse via **this** engine unification, not Phase 5 density; 1× is the correct 3.2 target. The genuine 4× fork is AuctionTable/BiddingBox (bid/review × path), which needs both the path merge here and slot-driven bid/review state.*
3.3 StatusStrip + ContextPanel on server path (context = chat + connection status per capabilities). **Visible change.**
3.4 Delete `.tv-*` internals (survivors renamed to `.shell-*`, per 2.3's rule → `.tv-* → 0`). Terminal state: one template, two engines, shell CSS = layout only.

### Phase 4 — Teacher console

4.1 ConsoleTile in gallery: BridgeTable@tile composition + fixture `classroom-4tables-one-diverged`. Gallery-only.
4.2 Divergence producer + edge tints, driven in gallery. Gallery-only.
4.3 TeacherConsoleView renders ConsoleTiles; whole-tile click → drill-in = UnifiedTable + teacher capability set + TeacherActionBar. **Visible change** (console is teacher-only; blast radius is you).
4.4 Retire any bespoke console table markup.

### Phase 5 — Play-phase auction compression

5.1 AuctionTable `compact`/`chip` densities in gallery; phase-driven density in `useTableSlots`. Gallery-only.
5.2 Land per surface as a capability: beginner classes pin full auction during play; advanced classes get contract-chip with tap-to-expand. **Visible change**, teacher-dialed.

*Phase 5 is deliberately last: it's pure design refinement riding on machinery
Phases 1–3 built, and the capability dial needs ContextPanel-era capability
plumbing anyway.*

### Queued grid-arranger slices (from the 2026-07-12 gallery review)

Standalone slices under Phase 1 (A1 gallery-first); details in
[grid-arranger-spec.md](grid-arranger-spec.md) *Review decisions (2026-07-12)*.

- **Caps wiring — regression repair.** Restore `min(cap, fit)` for the
  center/stage (growth to ~1.5): it existed pre-rewrite (`1.27×`/`1.40×` center
  captions in earlier runs) and was lost in the pure-allocator rewrite. §2's
  `caps.center: 1.8` is the intent, the allocator's `min(1, fit)` is the bug;
  reconcile the §2/§3.4 wording and validate against the §6 prediction table.
- **Play-cluster bottom-pack — SHIPPED (2026-07-12).** Extended the bidding anchor
  model to the play phase (`anchor.play: 'bottom'` → content-sized rows). Three
  parts: (1) **s-absorption** — the stage absorbs a hidden declarer's empty `s`
  cell (mirror of n-absorption), curing the "phantom South" dead band; (2) content
  rows flip the stage binding viewport-fill → shrink-wrap (cardplay slack 327→36
  desktop / 261→24 laptop-half); (3) `actionCornerFor` relocates Undo/Claim from
  the SE corner to the hero's bottom corner (SW for a screen-left West defender).
  Bidding triptych + review unaffected. **Auction vertical-metric fix rode the same
  branch** (the #178 audit miss): re-measured `auctionMetrics.headerRowPx`/
  `roundRowPx` (26/33 → 19/35) after the restyle compressed the header, and the
  a1:gallery walk now asserts the rendered auction height == the metric reserve at
  1.0× so the constants can't silently go stale again.
- **Caption/label seat-literal audit.** The seats caption was keyed to `seat-s`
  and broke for W/N/E heroes (fixed). Sweep every caption/label for a hard compass
  seat where a `heroSeat`-relative role is meant.

**Open re-eval:** NE/SE at the 0.65 floor at laptop-half is accepted+flagged for
now. Re-check after the **auction glyph restyle**; if still floored, pull **Phase
5.1 compact AuctionTable density** forward as a starvation response (not new
machinery).

---

## Verification quick reference

| Slice type | Diff assertion | Referee |
|---|---|---|
| Plumbing (pixel-identical) | Zero diff on affected views | Prod-before vs branch, same fixture |
| Region rewire | Zero diff | Old path vs new path, same fixture |
| New visualization | Nonzero **only** in named region | Branch vs gallery rendering |
| Deletion (.bp-*/.tv-*) | Zero diff; survivors renamed to `.shell-*` | Gallery canonical |
| Engine / derivation slice | Contract tests pass **+** the applicable diff above; ≥1 asymmetric fixture | Unit tests + fixture engine |

## Ratchet dashboard (update per PR)

| Metric | Start | Target |
|---|---|---|
| `srv.*` outside serverEngine | 96 | 0 (end of 3.1) |
| `.bp-*` | 209 | 0 — survivors renamed `.shell-*` (end of 2.3) |
| `.tv-*` | 142 | 0 — survivors renamed `.shell-*` (end of 3.4) |
| BiddingPracticeView max fork factor | 4× | 1× (end of 3.2) |
| BiddingPracticeView total instantiations | 13 | ~5 |
| Views reading engine state directly | 3 surfaces | 0 — slots only |
