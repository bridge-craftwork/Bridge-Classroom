# Slice spec — A1 grid flip (production adopts `arrangement: 'grid'`)

Location: `documentation/design/a1-grid-flip-slice-spec.md`
Status: Proposed
Companion to: `integration-roadmap.md` (Phase 1), `grid-arranger-spec.md`, `rendering-harness-plan.md`
Gate: Rick's gallery sign-off on the A1 gallery artifact (three states × three widths, incl. the NE 0.65-floor defense scene) — **not yet passed as of this writing**
Deadline context: must complete (flipped + soak started) before Thursday 2026-07-16; Rick out of town 5 days from Thursday. Homework for the week is intentionally held until post-flip.

This is the first slice in the A1 sequence that changes what students see in the released app. Invariants 1 (pixel-identical XOR visible) and 6 (referee) bind. The slice is split into two moves so that the risky part (live behavior against prod server + prod repos + real decks) is exercised while production remains untouched, and the visible part reduces to a one-line default change with a one-line remote-operable revert.

---

## Slice 1.6a — Dark deploy with per-client override

**Type:** Plumbing / production-invisible (ships dark, same class as #159/#190). Zero diff for all clients not carrying the override.

**Statement.** Merge the grid-arrangement branch to prod with the A1 default still `legacy`. Honor a per-client override selecting `arrangement: 'grid'` for the current client only:

- Mechanism: `?arrangement=grid` query param, persisted to `localStorage` for the session so navigation within the app doesn't shed it; `?arrangement=legacy` (or clearing the key) reverts the client. Prefer localStorage persistence over a visible sticky query string — less discoverable by a curious student who shares a URL.
- Scope: the override selects the arrangement axis only. No other behavior forks on it.
- The override is permanent dev apparatus, not scaffolding to delete in 1.6b — it's the standing mechanism for previewing any future arrangement candidate against prod. **(Extended 2026-07-13):** post-flip this becomes a channel model — `arrangement` takes named config presets (`stable` = shipped grid, `next` = the current candidate, `legacy` until 1.7), each a bundle of `tableConfig` values (tracks, caps, floors, density, shell mode, occupancy), not a code fork. The 1.6b move becomes the repeatable release ritual: iterate on `next` live, capture approved states to the gallery, promote via one-line default change, `next` empties. Disciplines: one candidate in flight at a time, promoted or discarded within a cycle or two (no long-lived forks); channels vary config only — components are shared across all channels and stay under specimen/test discipline. Provenance ring, bug-report channel field, overlay, and the long-press sheet all generalize unchanged.

**Diff assertion:** zero pixel diff on all A1 states without the override. With the override: rendering matches the signed-off gallery composition; deltas from gallery are named per the visible-change discipline even though production defaults are untouched.

**Referee:** prod-before vs branch, same fixture, no override (must be zero). Override-on vs gallery rendering (gallery canonical) for the grid path.

**Contract tests:** none required if the slice is pure config/arrangement plumbing; if any engine or derivation file is touched to thread the override, Invariant 7 applies and the slice ships contract tests alongside.

**Ratchet impact:** none (all metrics flat is acceptable here — this is a config axis, not a migration slice).

### Live verification protocol (the actual iterative loop)

The outer loop is **prod-with-override**: real deployed build, real bridge-classroom.org origin, real magic-link session cookie, real Mac server, real lesson repos. The inner loop is the **local gallery/fixtures** (fast HMR, no auth): reproduce → fix → gallery-verify → redeploy dark → re-verify live with the override. No localhost-against-prod-server configuration; no CORS or auth exceptions on the prod server.

1. **Test identity.** Create/switch to a dedicated test user via Switch User (`session_users`) before any grinding. All repeated exercise runs happen under the test identity so Rick's own mastery history stays clean and later participation analysis isn't polluted.
2. **Deck-driven, not state-driven.** Run complete real exercises end-to-end from **each lesson family currently assigned or about to be assigned in this homework cycle** (all four classes' decks). The gallery's three fixtures are shapes; the live risk is MainLayout's derived phase (`auctionComplete` + `isDeclarerPlay` + `showOpeningLead` + `hasSteps`) hitting a combination the fixtures don't model. Specific attention: the opening-lead moment, step-control edges, review entry/exit, and whatever the real defensive-signals decks do that `a1-cardplay-exercise` approximates.
3. **Fixture-first bug handling.** Any live breakage: capture the state as a fixture *before* fixing (via the 1.6c snapshot serializer — see below), reproduce in the A1 gallery, fix against the fixture, then re-verify live. Every live bug permanently widens fixture coverage; no fix lands verified only "by eyeball on prod."
4. **Embedded-path check.** Load the embedded bidding `?pbn=` path (the Game Analysis integration) with and without the override. This is the one hard functional constraint from the maturity model — break layout, not that integration. Confirm the override key does not leak into or alter the embedded rendering.
5. **Second pair of eyes.** Give David the override key and ask for at least one full exercise run on his hardware/browser before 1.6b.

**Exit criteria for 1.6a:** every currently-assigned lesson family completes end-to-end under the override with no layout breakage or unnamed visual delta; `?pbn=` path verified; David has run clean at least once; **and (added 2026-07-12, phone finding) grid renders a single-column stacked arrangement at phone size-class** — legacy already serves phones acceptably as a 1-column stack, so grid must not regress it. Stack order: indicator/status, auction, hand, bidding box on its own row (improving on legacy's bb-shares-row-with-Report-a-Problem wart); components at natural size (the bb's fixed 222px fits a phone column — no shrink capability needed, and none wanted given touch targets). Trigger is a ResizeObserver size-class on the stage, never `container-type` (#88 constraint). **(Added 2026-07-13, iPad ticket):** the two-column/single-column wrap must be scale-denominated — iPad landscape stays two-column with the narrative visible (see the wrap-threshold item under Post-flip candidates; it gates the flip since iPad is the default student device). Companion fix: reconcile the BoardIndicator's model/DOM disagreement (ledger assigns it a scale; the SVG renders fixed 89px) — either wire it to the scale variable or declare it fixed in the arranger model; a real-device iPhone beetle capture is the acceptance fixture.

---

## Slice 1.6b — Flip the default

**Type:** Visible change (the named region is the entire A1 arrangement — this is the look-and-feel integration the roadmap sequenced everything toward).

**Statement.** Change the A1 default from `legacy` to `grid`. One line. `legacy` remains fully intact and selectable via the same override axis (`?arrangement=legacy`) — this satisfies Invariant 5 (no dual rendering: a config axis is not dual rendering; exactly one arrangement renders per client) while making revert trivial and *remote-operable*.

**Rollback:** the same one line back (or a server-side default if the axis is read from config — prefer whichever is operable from a laptop in a hotel in ≤ 5 minutes without repo-state context). Rollback procedure written into the PR description verbatim, so it's executable by David if Rick is unreachable.

**Diff assertion:** nonzero only within the A1 arrangement (the named region); grid rendering identical to the signed-off gallery composition at all three widths. All non-A1 surfaces zero-diff.

**Referee:** gallery canonical (branch vs gallery rendering).

**Post-flip smoke (same day, before homework goes out):**
1. One complete exercise **under Rick's real account** confirming the mastery record writes correctly to the Mac server post-flip (the only released app recording practice history — two minutes to turn "no reason it would break" into "verified").
2. `?pbn=` embedded path re-check on the flipped default.
3. Quick pass on an iPad/tablet if one is handy — the student population skews toward tablets and large-font settings; laptop-half in the gallery approximates but does not equal a real iPad Safari viewport.

**Then:** send the week's homework. The homework cycle *is* the beta feedback mechanism for the trip window.

**Ratchet impact:** none of the numeric ratchets move; the qualitative milestone is A1 = first production surface on the grid arranger.

---

## Slice 1.6c — A1 diagnostic snapshot: one serializer, two consumers

**Type:** Production-invisible dev apparatus (ships dark alongside or immediately after 1.6a; no render change). Rides the same deploy — it is the capture half of 1.6a's fixture-first protocol made real, and the A1 sibling of the Phase 0.2 capture hook (same rationale: hand-authored state drifts; captured snapshots are honest).

**Statement.** A single `captureA1Snapshot()` serializer producing one JSON payload with two consumers:

- **(a) Bug report context file** — registered as the A1 app-specific context provider per `bug-reporting-spec.md`'s contract. When the beetle button lands, it consumes this provider unchanged.
- **(b) Importable A1 gallery fixture** — the gallery (`gallery-a1/`) gains a load-snapshot path so a captured payload renders directly as a scene.

Because (a) and (b) are the same artifact, a bug report *is* a reproducible fixture — "reconstruct the state" is replaced by "open the attachment."

**Payload contents:**

| Field | Why |
|---|---|
| `arrangement` + provenance (default / localStorage / query) | First triage question during the soak: was the reporter on grid at all |
| `computeLayoutLedger` output | The numeric answer to "why does it look like that" — scales, binding reasons, caps, margins; the existing observability artifact, serialized |
| Phase quad (`auctionComplete`, `isDeclarerPlay`, `showOpeningLead`, `hasSteps`) + derived phase | Phase derivation is A1's flagged hard part; every report answers "what phase did the view think it was in" |
| Content identity: lesson family, board, step index, deal-repo content hash | Compact; the hash catches repo drift between report and repro |
| Fixture-grade rendered-state essentials (same shape as existing `gallery-a1` fixtures) | Direct gallery import without re-deriving from deck content |
| Environment: viewport, `--table-scale`, devicePixelRatio, user agent | The student population's iPads and font settings live here |
| ActionTape tail (ring buffer per `bug-reporting-spec.md`) | The semantic path into the state |
| Identity: user id + class context only | Deliberately minimal — no further student PII in the payload |

**Attachments (two images, distinct roles):** the **plain screenshot** — ground truth of what actually painted, never modified; and an **annotated composite** — the plain screenshot with the shared 1.6d annotation renderer drawn over it from payload data (ledger rects, scale/binding/cap captions), generated at report time with no second capture. Because the composite is drawn from the payload, it cannot disagree with the ledger JSON in the same report, and it is reconstructable retroactively — any archived snapshot can be re-composited later with improved annotations (e.g. once the column-overflow / region-overlap checks land). Coordinate transform (device px screenshot ↔ CSS px ledger rects, via the payload's devicePixelRatio + viewport) is written once in the compositor and unit-tested at dPR 1 and 2.

**Interim affordance (this window):** the beetle button need not ship for 1.6c to pay off. A low-key dev affordance — keystroke or dev-menu "copy diagnostic snapshot" — gives Rick and David capture capability throughout 1.6a testing and the trip window. The beetle, whenever it lands, registers the same provider; nothing is rebuilt.

**Acceptance (round-trip):** capture a snapshot from a live prod session (override on), load it in the A1 gallery, and the render reproduces the captured state at the captured viewport/scale. Passing this makes the bug-report context file trustworthy by construction. Secondary: payload serializes/parses clean, size sane (target < ~50KB — content by hash, not by value).

**Diff assertion:** zero (production-invisible).

**Referee:** the round-trip itself (live capture vs gallery render of the same payload).

**Ratchet impact:** none numeric; qualitative — fixture coverage now grows automatically from real usage instead of by hand-authoring.

---

## Slice 1.6d — Live layout-debug overlay (ledger on-screen, in-app)

**Type:** Production-invisible dev apparatus (ships dark; overlay renders only when explicitly toggled).

**Statement.** The gallery's ledger annotations (region outlines, scale/binding/cap captions, margin readouts), available in the live app as a toggleable debug layer.

- **Extract, don't rebuild:** the annotation renderer moves to a shared module consumed by both the gallery (as today) and the live app (new host). One renderer — the overlay can never disagree with the gallery's reading of the same ledger. `computeLayoutLedger` already runs live; this slice adds only presentation.
- **Paint-only constraint (hard):** the live overlay is an absolutely-positioned, `pointer-events: none` layer drawing from ledger region rects. Zero DOM insertion inside the arranged tree, zero reflow — the overlay must be incapable of perturbing the layout it measures. (Gallery captions may occupy space; the live overlay may not.)
- **Trigger:** keyboard Ctrl-B or `?bounding-boxes=1` (as implemented), persisted per-client in localStorage — same pattern as the arrangement override. **Touch and desktop (uniform):** long-press (~600ms) on the beetle opens a small field-kit sheet — overlay toggle · copy diagnostic snapshot · arrangement grid/legacy — the same gesture on every platform (one Pointer Events code path: `pointerdown` + timer covers mouse press-and-hold and touch alike). Tap/click = report a bug, long-press = field kit. Ctrl-B and the query params remain as keyboard/URL accelerators. Implementation guards: cancel the timer on pointer movement beyond a few px (scroll/drag intent), suppress the click/tap that fires on release after a completed long-press, and on iOS suppress callout/selection on the beetle (`-webkit-touch-callout: none`, `user-select: none`).
- **Co-located capture:** the 1.6c "copy diagnostic snapshot" affordance lives in the same debug layer. Field workflow: see something odd → toggle overlay → capture snapshot.
- **Override-active indicator:** the RW avatar ring renders red whenever the arrangement is override-selected — keyed to **provenance (localStorage/query ≠ default), not to `grid`**. Today that marks the new view; after the flip it marks "this client is pinned to something non-default," so the indicator never goes stale and needs no removal decision. One-line read of the same provenance value 1.6c reports — the ring and the bug report cannot disagree. Border/background swap on an existing element: zero layout impact, meaningless to students.

**Acceptance:** overlay on/off produces zero layout diff (paint-only verified — same ledger output with overlay on as off); overlay rendering of a live state matches the gallery's annotation of the same state loaded via a 1.6c snapshot (shared-renderer round-trip).

**Diff assertion:** zero with overlay off (production-invisible); overlay-on rendering is debug chrome, exempt from pixel discipline.

**Ratchet impact:** none numeric.

**Follow-up (ledger blind spots) — (a) SHIPPED 2026-07-12, PR #197:** the column-overflow check landed, fixtured by the live 914px bug report (bidding box spilling 78px onto the hand while the ledger read a silent `floor`). Measured-width-vs-**track** comparison (not `allocated` — the first cut false-flagged a benign trick-area case), red `overflow` caption with pixel count, red outline in overlay and annotated composite. Shipped alongside the content-driven flex-wrap that replaced the fixed 900px breakpoint (the 900–1040px broken band eliminated by keying the wrap on what actually has to fit). Remaining: **(b)** pairwise rect-intersection over occupied regions (red `overlap` binding) — lower priority now that column overflow, the confirmed failure class, self-announces.

---

## Post-flip candidates (gallery-first, behind the override; not Thursday-gated)

- **Reference auction → companion (play/review) + play-phase legacy-parity audit.** 🟡 **LANDED IN BETA 2026-07-13** — relocation implemented live behind the override; side-by-side confirms parity largely green (played-card strikethrough ✅, HCP captions ✅, contract chip "3NT by S" ✅ — improves on legacy, auction-in-companion ✅, NE absorbed ✅) and the trick area betters legacy (shows the trick as cards vs prose — pedagogically right for signals lessons). Remaining before capture-to-gallery: settle companion width (stage shows 79px slack at shrink-wrap — first ~79px of widening is free, beyond that center pays, dropping from 1.3× toward 1×; iterate live with overlay, stop near designed ~12px fill or legibility judgment on trick cards), then beetle-capture the settled states (play, bidding, review) and promote as fixtures. StatusStrip follow-up noted: trick count `NS 0 · EW 0` → contract-relative ("EW needs 5") when StatusStrip lands. Proposed 2026-07-13 from the live defense-scene capture (NE at `220 → 143, 0.65×, floor`); then **confirmed as a restoration, not a revision** — legacy already renders the auction in the companion at full size, directly above narrative text written to reference it ("The bidding has been as shown"). The NE-pinned reference was a gallery-era invention (#159), not legacy-derived; design risk ≈ zero, years of student validation. Mechanics: stage drops to two columns (NE absorbed), ~155px of budget flows to hands/center (W/N at 0.83× with cap headroom → ~1.0×+); commentary widens via content-driven wrap; builds the first ContextPanel increment (companion = auction · convention note · coach text). Reopens the 0.65-floor ruling via its revisit clause; compact density remains for console tiles. **Scope addition:** audit grid's play phase against legacy's composition wholesale — played-card strikethrough in hero hand (marks passthrough gap from #159), HCP captions, contract display — each difference deliberately named or converged back. **Process (revised 2026-07-13): live-first, gallery-last.** Pre-flip, the override-gated beta is a safe iteration environment with truer conditions than the gallery (real decks, real shell budget — which the gallery famously missed); iterate the relocation live, no gallery ceremony. The retained discipline: on settle, capture the approved states via 1.6c and promote them into the gallery as fixtures so the regression walks defend the new composition. Two boundaries: this mode expires at the flip (grid-as-default returns to the careful regime; legacy-via-override becomes the escape hatch), and any change reaching *inside* a component legacy also renders (e.g. the marks passthrough for played-card strikethrough) reverts to component discipline — specimens and tests. Gallery decisions above become live decisions, same questions.
- **Height budget (the refit's missing axis).** ✅ **SHIPPED 2026-07-13** — reveal now fits (seats `cap`-bound ~1.05–1.12×, hero hand in view). One deliberate-choice residue: the budget claims down to the viewport edge, scrolling the page footer off — acceptable prioritization (cards outrank chrome); bless it or add footer height to `bottomMargin`. **Follow-on gate discovered (iPad, pre-flip): scale-denominated wrap threshold.** The refit inflated the stage's *requested* width, silently raising the content-driven wrap threshold past iPad landscape — which now goes single-column, grows cards past 1.1×, and drops the narrative below the fold on the students' primary device. Fix: the wrap predicate becomes ledger-driven via the ResizeObserver size-class — *stay two-column while the two-column scale ≥ 1.0×*; wrap only below. Priority rule to encode: **scale above 1.0× is a luxury, purchased only with spare width — never by evicting the companion.** **Second half — REVISED 2026-07-13 (Rick): per-lesson-type companion constants, waterfall de-scoped.** A dynamic surplus split (stage satisfied width → companion residual) would re-derive the frame from per-board hand measurements — the shell would breathe board-to-board and the circle strip's wrap point would jump between boards. **Stability outranks optimality:** the frame (column split, companion width, strip width) holds constant across a sitting; only scale adapts inside it. Design — **refined (Rick): clamped percentage, not px constants.** `shell.companionWidth: clamp(320px, ~36%, 620px)` — the percentage depends only on window width (frame stable per sitting, zero board-content coupling), adapts across devices without a size-class matrix (proportionally narrower on iPad), the max clamp enforces the ~65–75ch readability ceiling, the min keeps the narrative viable near the wrap boundary. Pure shell CSS via `clamp()` — no JS, no ledger→shell coupling; "shell CSS does slot layout only" stays literally true. Per-lesson-type keying survives as the percentage varying by preset (auction ~38%, play ~32%) but start with a single value and let live use prove whether the split needs to differ. Keyed by **lesson type (content metadata), not runtime phase** — phase-keying would jump the frame mid-board at reveal. Auction lessons get the wider narrative (~560–600px, within the ~65–75ch readability ceiling); play lessons their own value; one value per (lesson type × size-class) so iPad keeps the stage at 1.0×. Rides the channel system (trial on `next`, promote). The scale-denominated wrap threshold above is unaffected and remains the iPad flip gate. Original height-budget analysis retained below. From the 2026-07-13 bidding-reveal finding: post-refit scales >1.0× grow the stage past the viewport with no vertical constraint — the hero's own hand rendered offscreen at reveal while dummy grew (vertical twin of the phone priority inversion). Tractable in closed form, not iteration: every row's height is affine in scale (fixed borders/gaps + scale-proportional content — the auction guard's `2 + scale·(reserve−2)` is the proven template, and auction rounds are *known* at reveal via `auctionGrowthReservePx(rounds)`), so max fitting scale = `(heightBudget − Σfixed) / Σvariable`, one division, pre-paint. `heightBudget` is measured, not modeled: `viewportHeight − stageTop (getBoundingClientRect) − bottomMargin`, immunizing against banner dismissal and strip wrap. Policy: `scale = clamp(min(widthFit, heightFit), floor, cap)`; if heightFit < the 0.65 floor, **floor wins and the page scrolls** — scroll is the pressure valve, never sub-floor cards. Phone stacked arrangement exempt (scroll is its normal mode). If reveal ever scrolls in practice, revisit stack order so the hero hand stays above the fold.
- **Reserve-honesty walk assertion (hunt the class).** Third model-vs-DOM drift in one week (BoardIndicator fixed-89px vs assigned scale; chip-inflated calibration; `TRICK_RESERVE` omitting `.trick-area` padding — latent for months, surfaced when the refit pass pushed scales past 1.0×, where shortfalls grow instead of shrinking). Generalize the auction-height guard: for every component with a declared reserve, assert rendered border-box width at 1.0× == reserve ±1px in the gallery walk. Rule to encode: *a reserve is a border-box outer width — content + padding + border — or it's a lie.* Build-time complement to the runtime overflow caption.
- **Overlay detached-layer rewrite (retire the observer effect).** `boundingBoxes.css` sets `position: relative` on every `.region`, perturbing stacking (not geometry) — and what it masks is overflow, the overlay's own target class. Rewrite to the original 1.6d design: one fixed, detached layer drawing boxes/labels from ledger rects, `pointer-events: none`, zero styles on region elements — the standard the annotated bug-report composite already meets. Until then, treat "bug looks different with overlay on" as itself a signal of real overflow.
- **Gallery capture debt (due now).** CC could not reproduce the live defense scene — the gallery cardplay fixture still pins the auction at NE while the beta runs `companionAuction`, so the walks currently defend a retired composition. Capture the settled companion states (play, review, bidding) via 1.6c, promote as fixtures, retire the NE cardplay fixture in the same motion. Prerequisite for the reserve-honesty assertion to assert the right world.
- **Content-aware refit pass (arranger).** ✅ **SHIPPED** (PR #208/#209 per the 2026-07-13 trick-overlap report — "actual-width work pushed the play scale past 1.0×"; desktop play confirmed at 1.29×). Original analysis retained below; the >1.0× regime it opened is what surfaced the TRICK_RESERVE padding bug, hence the reserve-honesty assertion above. From the 2026-07-13 review-state capture: seats render at 0.75× (`allocated 196 ÷ reserve 260`) while their *measured* widths (132–143px) fit the 196px allocations at 1.0× — the fixed worst-case reserve is the denominator, so polite hands get punished and the gap renders as dead width. Fix: after budget allocation, grow each region to `min(cap, allocated ÷ measuredNaturalWidth)` — same shape as #190's caps growth pass, consuming measurements the ledger already records. **Stability requirement:** measure once at deal presentation (13 cards) and freeze for the deal's life — no re-scaling as play progresses (strikethrough play-rendering already keeps widths constant; make the freeze policy so a future hide-played-cards option can't reintroduce wobble). Acceptance: the 2026-07-13 capture re-rendered shows seats ~1.0× in unchanged allocations. Secondary observation from the same state: review with no current trick leaves `center 0×0` plus empty corners — a denser review composition is a separate, lower-priority question the refit mostly obviates.
- **bb-below-S in two-column mode** (from the width-sweep finding) — evaluate as `s`-cluster composition first; 4th row only if the cluster can't express it.
- **Wide-viewport budget win** — shell max-width / companion split revisit; acceptance captions: center toward 1.31×, periphery at clean 1.0×.

## Slice 1.7 (deferred, explicitly out of scope for this window) — Legacy retirement

Delete the `legacy` arrangement path once grid has soaked through **at least one full homework cycle plus Rick's return from the trip** (earliest ~2026-07-27). Not before, and never bundled into 1.6b — the PR reviewer should reject any "cleanup" of legacy in the flip PR. Standard deletion-slice discipline applies when it runs (zero diff, gallery canonical).

---

## Trip-window contingency notes

- **Remote rollback** is the designed safety net: `?arrangement=legacy` per-client for triage, the one-line default revert for the fleet. Both documented in the 1.6b PR.
- **David briefed** on: the override axis, the rollback one-liner, and where the A1 gallery lives — he is the on-call path Thursday→Tuesday.
- **Bug intake:** 1.6c ships the diagnostic-snapshot capability regardless of the beetle button's fate. If a minimal beetle is shippable before Thursday, it rides along and consumes the 1.6c provider — student reports arrive as loadable gallery fixtures, diagnosable from the road. If not, students report via the usual email path; David reproduces with the override, captures a 1.6c snapshot at the failure, and attaches it — same repro pipeline, one manual hop.
- **Do not** hot-patch grid layout from the road except for outright breakage; visual polish waits for return. The revert lever exists precisely so remote fixes don't have to.
