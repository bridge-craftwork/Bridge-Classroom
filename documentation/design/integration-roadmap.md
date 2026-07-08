# Integration Roadmap — Components to Production

**Location:** `documentation/design/integration-roadmap.md`
**Status:** Proposed
**Companion to:** `rendering-harness-plan.md` (rules of engagement, harness mechanics,
annotation architecture — all still binding)
**Last updated:** 2026-07-08

> **Revision (2026-07-08):** review deltas applied after repo fact-check — server-path
> fixture driver added to Phase 0 (the referee for Phase 3); `wantsCall` promoted to a
> gating spike with a Phase 1/2 swap contingency; contract tests promoted to Invariant 7;
> instantiation metric corrected to *fork factor*; `.bp-*` target changed to zero-by-rename;
> stale BiddingBox sizing defect removed; ResizeObserver constraint recorded.

## Where we are

- **Shipped:** 7 redesigned components (BridgeTable, SeatPanel, SeatChip,
  HandDisplay, AuctionTable, BiddingBox, TrickArea), pixel-identical from frozen
  specimens; two-tier harness (specimens + view scenarios); `useTableSlots`
  contract driving harness scenes only.
- **Not started:** contract adoption in production. Three surfaces
  (MainLayout; BiddingPracticeView local + server paths; TableHostView /
  TeacherConsoleView as thin wrappers) still wire components directly.
- **Known gallery WIP defect:** BridgeTable clips at `tile` width.
  *(The earlier "BiddingBox smaller at `drill` than `panel`" defect was an artifact
  of container-query sizing and is resolved — hotfix #88 removed it; `drill` and
  `panel` now render identically. See the ResizeObserver constraint in Component
  work · Row A.)*

## Where we're going

One table surface, slot-driven, phase-aware, capability-gated. Views bind a
handful of slot objects; all state assembly lives in engines and derivations.
Teacher console tiles are the same arranger at its smallest density. Status
indicators and context (commentary / chat / teacher controls) are first-class
slots, not view furniture.

## Invariants (every slice, every phase)

1. Each slice is **either pixel-identical** (plumbing; zero diff proves scope)
   **or precisely visible** (design; nonzero diff only inside the named region).
   Never both in one slice.
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
   referee.
7. **Contract tests, not just pixels.** Any slice touching an engine or
   derivation ships contract tests alongside the pixel diff. Pixel-identity is
   evidence of **scope**, never of **correctness** — two states can render
   identically while the engine is wrong (a seat-mapping error is invisible under
   a symmetric fixture: one deal, symmetric-looking state, wrong under rotation).
   Engine slices therefore include at least one **asymmetric fixture** (different
   contracts by seat, a rotated deal) so mapping errors can't hide behind
   symmetry.

---

## Component work

### A. Refactor (existing components)

| Component | Work | Type |
|---|---|---|
| **BridgeTable** | Responsive arranger: per-density seat arrangement (SeatChips-only at `tile`), fix `tile` clipping. This is the console-tile forcing function. **Constraint: density must come from a ResizeObserver size-class, NOT `container-type`.** Inline-size containment breaks the solo view's shrink-wrap layout (the `.bidding-box-wrapper` centers via `align-items`, so the box sizes to content — containment collapses it). That is the root cause of the #88 revert, and the `tile`-clipping fix (0.1) is exactly where someone would otherwise reach for container queries again. | Gallery-first, then pixel-identical where prod already uses it |
| **BiddingBox** | Touch-target audit at tablet widths. (Sizing is width-independent post-#88 — no responsive step to fix; if narrow-tightening is ever wanted, use the same ResizeObserver size-class as BridgeTable, never `container-type`.) | Gallery-first |
| **AuctionTable** | Add density modes: `full` (bidding), `compact` (play reference), `chip` (contract only, tap-to-expand). Divergence display already shipped | Gallery-first; lands with play-phase compression (Phase 5) |
| **HandDisplay** | No structural work. Absorb review-mode channels as producers arrive (trick fills, DD outlines already placeholdered) | Incremental, specimen-driven |
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

### Phase 0 — Gallery debt + referees (before any prod wiring)

0.1 Fix BridgeTable `tile` clipping (ResizeObserver arranger, minimum viable — **not** `container-type`). Gallery-only.
0.2 **Server-path fixture driver.** The referee for Phase 3, without which Invariant 6 is unfulfillable for the server path (it would "merge on faith" — precisely what this apparatus exists to prevent). Two halves:
   - **replay** — feed a frozen `srv` snapshot through `serverEngine` so old-view vs new-binding can be pixel-diffed from identical state;
   - **capture** — a dev-mode hook that snapshots live `srv` state from a real session into a fixture file, because hand-authored server-state JSON drifts from reality; real captured snapshots are what make the referee honest.

   Side benefit worth naming: the replay driver is a permanent **socket-state debugging tool** — not a test-infrastructure tax, something you'd want anyway. *Likely the slowest Phase 0 item and the true long pole for Phase 3.* Gallery/dev-only.
0.3 StatusStrip + ContextPanel specimens (all phases × all widths). Gallery-only.
0.4 `useTableStatus` + slot extensions, driving harness scenes. Gallery-only.

*Everything in Phase 0 is production-invisible. Ship freely.*

### Phase 1 — MainLayout (coached lessons; highest user traffic, so region-sized steps)

**Gate — `wantsCall` spike (time-boxed; deliverable = a written decision, not code).**
MainLayout is a **step machine** (`currentStep.type`, `hasBidSteps`, `bidAnswered`),
not turn logic — `isDeclarerPlay` alone threads through **7 sites**, so the
step-machine/turn-model reconciliation is a genuine unknown. Choose one shape and
write down why:
   (a) the step machine feeds an engine-level `wantsCall`;
   (b) the slot contract accepts an explicit override; or
   (c) MainLayout keeps its gating and the adapter is pure mapping.

**Sequencing hedge — the Phase 1 / Phase 2 order is contingent on this verdict.**
If the reconciliation comes back ugly, **swap Phases 1 and 2.** BiddingPracticeView's
local path is turn-logic-native — the easy customer for the contract — and doing it
first lets the slot machinery mature on friendly terrain before confronting the step
machine. MainLayout was slated first only on the premise that the adapter was
"documented, so the thinking is done"; the 7-sites datum undermines that premise, so
the order is officially decided by the spike, not assumed.

1.1 Auction region → `slots` binding. Pixel-identical.
1.2 Action region → `slots.action`, using the spike's chosen `wantsCall` shape. Pixel-identical.
1.3 Center region → `slots.center` (kills the two `isDeclarerPlay` BridgeTable branches). Pixel-identical.
1.4 StatusStrip lands; DealInfo + old indicators removed same slice. **Visible change.**
1.5 Commentary extraction → ContextPanel (feedback panel + inline commentary + step controls). Pixel-near; small visible deltas acceptable, named in PR.

### Phase 2 — BiddingPracticeView, local path

*(May run before Phase 1 — see the Phase 1 spike hedge.)*

2.1 Local-bidding + local-review instantiations collapse onto slots (4× → 3×, then 2×). Pixel-identical. Fork-factor + `.bp-*` ratchets drop with each.
2.2 StatusStrip + ContextPanel on local path; old chips removed. **Visible change.**
2.3 Delete `.bp-*` component-internal rules. **Any rule that survives the audit as legitimate shell layout is renamed into `.shell-*`, not kept** — so the ratchet reads `.bp-* → 0` (grep-checkable; no "shell-layout-only" judgment call, and the rename forces a one-by-one audit of every survivor). Pixel-identical (gallery is canonical — divergences resolve toward the gallery, each named in the PR).

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
