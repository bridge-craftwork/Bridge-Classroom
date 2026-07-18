# Per-card double-dummy cardplay-error overlay

**Status:** backend LIVE (bridge-solver-service `/dd/play` + `/dd/play/node`);
frontend F0–F3 built (batch trace → badges → on-demand tap modal). Not yet
driven end-to-end in-browser (see verification note at bottom).
**Origin:** bridge-classroom-bug-artifacts#24 (filed from the in-app beetle on
`/bidding-practice`, `app:practice-table`, `feature-request`).
**Related:** bridge-classroom-bug-artifacts#21 — the end-of-play reveal must show
the deal **fresh** (no strike-through). Fixed here (F0); it's the substrate the
DD badges sit on.
**Backend ticket:** bridge-craftwork/bridge-solver-service#4 (the `/dd/play`
endpoint — done in a session in that repo).

## The ask

After a hand is played out, overlay a double-dummy verdict on each **played**
card. A card that gave away a trick under double-dummy (the reporter's example:
"a red 3 covering the spade 7 was an error at trick 3") gets flagged at its
trick. Tapping the flagged card opens the four hands **as they stood at that
point in play** and shows the double-dummy cost of **every** card that was still
in that hand at that moment.

This is exactly what DDS's `AnalysePlay` produces; we build the equivalent on
our own `bridge-solver` core, which already has every primitive needed.

## Two parts, split across two repos

1. **`bridge-solver-service` — two new endpoints** (ticket #4). The current
   `POST /dd` only solves the initial 20-cell table (`solve_ddtricks`) and has no
   notion of a play trace.
   - `POST /dd/play` — the **running DD trace**: each played card's double-dummy
     **cost** (tricks its side gave away). Powers the error badges. Cheap.
   - `POST /dd/play/node` — **on-demand alternatives** for a single node: the DD
     cost of every legal card there. Powers the tap modal; any card is clickable.
2. **`Bridge-Classroom` — the post-hand overlay + a Table-settings toggle.**
   Nearly free of new plumbing: the play trace, the per-card position
   reconstruction, and a per-card badge/fill render path all already exist.

Ship the endpoints first — the frontend overlay can't be exercised end-to-end
until they exist (DD stays best-effort: null → no overlay, never load-bearing).

---

## Backend (see ticket #4 for the full contract)

### Two tiers, because detecting errors ≠ enumerating alternatives

The naive approach — score every legal card at every one of ~52 nodes
(≈52×13 solves) — is mostly wasted, because you only need the alternatives when
the user taps a card. Split it:

**Tier 1 — running trace (`/dd/play`, powers badges).** Let `V_k` = declaring-side
DD tricks of the position **before** the k-th card (tricks already won + optimal
remaining, both sides DD). Solve `V_0..V_M`. With optimal play `V` is flat; the
move `V_k → V_{k+1}`, attributed to the seat that just played, **is** that card's
cost:
- declarer/dummy plays → `cost = max(0, V_k − V_{k+1})`
- defender plays → `cost = max(0, V_{k+1} − V_k)`

So every played card's cost falls out of one solve per node — **no alternatives
needed for the badge**. Skip forced-follow nodes (one legal card → cost 0, no
solve). `V_0` = the contract's DD result.

**Tier 2 — alternatives (`/dd/play/node`, powers the modal).** For one node,
enumerate legal cards (collapse touching-rank equivalents), solve the position
after each → declaring-side total `W_c`, `cost(c) = |W_c − V_node|`. Only ever run
on a click; the played card's `W` is already `V_{node+1}`, so reuse it.

`tricks` in an alternative = declaring-side tricks for the whole deal if that card
is played and both sides play DD thereafter. `cost` = "tricks this player's side
gave away" (≥0), so declarer and defender errors are comparable.

### Core primitives (no new search algorithm)

`Solver::new_mid_trick` + `solve_mid_trick`, `get_playable_cards(hands, seat,
lead_suit)`, mutable `Hands`/`Cards` (`add`/`remove`), reusable
`CutoffCache`/`PatternCache`. **Never share a `PatternCache` across trumps** (it
isn't keyed on trump) — but the trump is fixed across a deal, so one cache pair
per request is safe and hot (see `dd.rs::solve_ddtricks`).

### Caching keyed on the play PREFIX (this is what makes strategy free)

Cache **per position**, not per full trace: key each `V_k` / node result on
`hash(dealstr + trump + plays[0..k])`. Then:
- a batch `/dd/play` with the full trace solves each position once, each cached by
  its prefix;
- an **incremental** caller (below) that hits `/dd/play` with growing prefixes
  only solves the newly reached position each time — the rest are cache hits, and
  the final full-trace call returns all-hits (instant);
- `/dd/play/node` shares the same prefix cache for `V_node`.

Leave `dd_cache` untouched; add per-endpoint metrics; reuse the `solve_semaphore`
+ `spawn_blocking` + `catch_unwind` pattern from `routes/dd.rs`.

### Optional later optimisation

A `solve_all_plays(hands, trump, leader)` in the core (all child values from one
alpha-beta pass, à la DDS `SolveBoard` solutions=3) would collapse a node's
alternative loop into one search. Ship the straightforward loop first.

---

## Frontend: the overlay (Bridge-Classroom)

The data model already supports this end-to-end (see the terrain map below); the
overlay is mostly wiring.

### Terrain that already exists

- **Play trace** — `useCardPlay.js` `played` ref: flat chronological
  `[{seat,suit,rank}]`, 52 entries at completion; the single source of truth.
- **Position reconstruction** — `computeRemaining(originalHands, played.slice(0,k))`
  in `src/utils/cardplayRules.js` returns the exact 4-hand position **before**
  card `k`. The partial trick is `played[trickStart..k]`; the leader is
  recoverable from `completedTricks[floor(k/4)].leader` (or the opening leader).
  This is precisely the endpoint's input.
- **Per-card badge render path** — `HandDisplay.vue` already accepts a
  `marks.cards[code]` map (`code` = upper suit+rank, e.g. `"H3"`) with
  `played` / `badge` / `fill` / `current` fields. `badge` renders as
  `.cell-badge`; `fill` sets a per-cell background. A red cost number needs **no
  new leaf plumbing**.
- **Marks are fed** by `marksFor(seat)` in `BridgeTable.vue` (currently only sets
  `played` / `current`).
- **Existing DD fetch** — `useHandAnalysis.js::loadDoubleDummy` → `ddsClient.js`,
  called at deal-load from `engines/localEngine.js`. The per-card call is
  different: it fires at hand **completion**.

### Fresh reveal (bug-artifacts#21) — the substrate

Before badges make sense, the end-of-play reveal must read like the **original
deal**, not a page of struck-through cards. At `cardplayPhase === 'complete'`,
`BiddingPracticeView.vue` now passes `revealPlayedCards` (= `null` at complete,
else `cardplay.playedBySeat`) as `:played-cards`, so no card carries the `played`
mark and nothing is struck through. Live play is unchanged (the "Show played
cards" teaching toggle still strikes during `playing`). The DD overlay then
re-annotates **only** the error cards on top of this fresh reveal via `badge` /
`fill` — never `played`. Keep these two concerns separate: `played` = "spent
during live play" (strike); DD badge = "double-dummy cost" (post-hand overlay).

### Wiring

1. **`ddsClient.js`** — add two best-effort helpers (null on any failure),
   siblings to `fetchDoubleDummy`:
   - `fetchDdPlay({ dealstr, trump, declarer, leader, plays })` → `POST /dd/play`
     (the trace + per-card costs).
   - `fetchDdPlayNode({ dealstr, trump, declarer, leader, plays, node })` →
     `POST /dd/play/node` (one node's alternatives, on click).
2. **New composable `useCardPlayAnalysis.js`** (sibling of `useHandAnalysis.js`)
   — owns a latest-wins token + a snapshot of `dealCtx.hands` + `played` +
   contract taken at `playComplete` (⚠️ `dealCtx` is a singleton reset on the next
   deal — snapshot before a new deal loads). Exposes `costByCard`
   (`{ "H3": cost, ... }`, keyed by the played card) from the trace, plus
   `alternativesForNode(k)` which lazily calls `fetchDdPlayNode` and memoises the
   result (a re-click is instant; the server also caches).
3. **`marksFor(seat)`** (grid path: `GridArrangement.vue`; legacy:
   `BridgeTable.vue`) — when `cardplayShowDdErrors` is on and the trace is ready,
   merge `badge` (the cost) + `fill` (severity tint) onto the played card's mark,
   only for `cost > 0`.
4. **Tap-to-inspect** — clicking **any** played card (not only errors — the
   node endpoint answers for good plays too) opens a modal: the four hands from
   `computeRemaining(snapshot.hands, played.slice(0, k))` + the partial trick, and
   the node's `alternatives` (each remaining card → DD tricks / cost), fetched on
   demand with a spinner. Reuse `HandDisplay` for the four-hand render.
5. **Gate** the whole overlay behind the `cardplayShowDdErrors` setting (below).

### Fetching strategy: batch first, incremental later (no backend change)

Because `/dd/play` accepts **partial** traces and the backend caches per play
**prefix**, the frontend can choose when Tier 1 runs without any API change:

- **Batch (F1, ship this first):** one `fetchDdPlay` at `playComplete`. Simplest;
  likely already sub-second (most positions are cheap, late tricks trivial).
- **Incremental (F1.5, only if the reveal feels slow):** fire `fetchDdPlay` with
  the growing prefix after each trick during live play (fire-and-forget, gated on
  the setting). Each call solves just the newly reached positions server-side
  (rest are prefix-cache hits), spreading the work across natural think-time
  (BEN's ~0.5–20s per card), so the end-of-hand report is already assembled —
  no 52-solve burst. Must be latest-wins and cancel on new-deal/abandon.

Either way, tap alternatives are always on-demand (`alternativesForNode`).

### Slices

- **F0 (shipped with this doc):** (a) the two Table-settings toggles +
  persistence (`cardplayShowDdErrors`, `cardplayShowBbaCompare`), both default-on
  — BBA toggle fully live now, DD toggle state-only until F2 consumes it; (b) the
  **fresh reveal** fix (#21) via `revealPlayedCards`.
- **F1 (built):** `fetchDdPlay`/`fetchDdPlayNode` in `ddsClient.js` +
  `useCardPlayAnalysis.js`; the view fires the **batch** trace on entering
  `complete` (watch below `cardplayPhase`; snapshots deal + trace).
- **F2 (built):** `cardBadges` prop threaded BridgeTable → GridArrangement →
  SeatPanel → HandDisplay, merged in `marksFor` without `played`; view computes
  `ddCardBadges` gated on `cardplayShowDdErrors`. On the overview reveal each
  error card is badged with the **trick number** it went wrong at (red fill).
- **F3 (built, later reworked — PR #276):** replaced the modal with an in-place
  **recolor of the main table**. Clicking a card rewinds the table to that trick
  (`visibleHands` ← `computeRemaining`, center `TrickArea` shows cards led so
  far), tints the acting seat's legal cards green (DD-best) / pink (gave a trick
  away), badges each **negative card with its cost**, and rings the played card
  (`chosen`). Any card click reverts to the fresh reveal.
- **F1.5 (optional, not built):** incremental prefetch during play, if the batch
  reveal is slow. Frontend-only.

### Verification status

Verified: endpoints correct (trace detection agrees with node alternatives;
validation); request/response wiring incl. `handsToPbnString`→dealstr and badge
grouping (Node, live service); app mounts with 0 console errors; F0 toggles
render and default-on. A TDZ bug (the analysis `watch` read `cardplayPhase`
before its `const` init) was caught in-browser and fixed by moving the watch
below the computed. **Not yet confirmed in-browser:** badges painting + the tap
modal on a real completed hand — reaching cardplay needs a full auction, and the
BBA opponent-bidding service stalled in local dev, so no hand could be played
out. The badge/modal path is plain Vue bindings over the verified data and builds
clean, but should be eyeballed once on a hand where South declares.

---

## Table-settings toggles (both default enabled)

Added to the existing **Table settings** modal in `BiddingPracticeView.vue`
(the `⚙ Table settings` popup), following the established
`ref(localStorage) + watch` persistence pattern — but **default-on** via
`localStorage.getItem(KEY) !== '0'` (existing toggles are `=== '1'`, default-off).

- **`cardplayShowDdErrors`** (`bp.cardplayShowDdErrors`) — "Show double-dummy
  cardplay errors". Gates the F2/F3 overlay. State + persistence land now; the
  overlay reads it once built.
- **`cardplayShowBbaCompare`** (`bp.cardplayShowBbaCompare`) — "Show BBA auction
  comparison". Gates whether `divergedBids` is passed to `AuctionTable` (pass
  `{}` when off → the comparison rows don't render; `AuctionTable`'s
  `divergedBids` prop already defaults to `{}` and no-ops). Fully live now.

Both live under the existing **Cardplay display** section (the BBA one is
auction-scoped but the settings modal is the single "table setup" surface, so
it's the natural home).

---

## Frontend terrain reference (file : symbol)

| Concern | Location |
|---|---|
| Play trace (source of truth) | `useCardPlay.js` → `played` `[{seat,suit,rank}]` |
| Per-trick log / leaders | `useCardPlay.js` → `completedTricks`, `rebuildFromPlayed` |
| Position-before-card-k | `cardplayRules.js` → `computeRemaining(hands, played.slice(0,k))` |
| Per-card badge render | `HandDisplay.vue` → `marks.cards[code]` (`badge`/`fill`) |
| Marks feed | `BridgeTable.vue` → `marksFor(seat)` |
| Existing DD fetch | `useHandAnalysis.js::loadDoubleDummy` → `ddsClient.js::fetchDoubleDummy` |
| DD fetch trigger | `engines/localEngine.js` (deal-load) |
| Top-level view / route | `views/BiddingPracticeView.vue`, `router/index.js` `/bidding-practice` |
| Table-settings modal | `BiddingPracticeView.vue` (`showTableSettings`) |
| BBA compare render | `AuctionTable.vue` `divergedBids` prop; fed at `BiddingPracticeView.vue` |
