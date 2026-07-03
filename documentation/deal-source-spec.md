# Deal Source — unified picker spec

**Status:** spec / design, 2026-07-03 (Rick). Goal: one Deal Source control used
everywhere a deal source is chosen, with options shown/hidden by context. Replaces
three separate implementations. Companion to
[app-architecture.md](app-architecture.md) and
[table-console-roadmap.md](table-console-roadmap.md) §Phase 2.

---

## 1. Why

"Pick where boards come from" is currently reimplemented three times, each with a
different model:

| Consumer | Today | Multi-select? |
|---|---|---|
| Local Practice Table (`#/bidding-practice`, `BiddingPracticeView`) | inline scenario menu, `Set` of files → random-draw pool | **yes** |
| Server table deal popup (`DealSourceModal` + `useDealSource`) | tabbed picker → `{kind}` descriptor → `{t:'deal',source}` frame | no (one pick per open) |
| Session creation (`TableSessionNewView`) | paste/upload PBN or load one library file → static `boards_pbn` | no |

Same logic (parse the PBS menu, fetch a scenario's deals, convert a board to PBN,
draw a random board) is duplicated and drifts. The multi-select **pool** already
works well in `BiddingPracticeView`; it should be the model everywhere.

## 2. Core model

### 2.1 A "source ref" (one selectable thing)

The atom the picker deals in. Multi-select = a set of these.

```
SourceRef =
  | { kind:'scenario',  repo:'pbs'|'baker', file, label, curated?:bool }
  | { kind:'clubboard', origin:'db'|'local', gameId, boardNumber, label }  // a specific board (drill-down, §4.3)
  | { kind:'library',   entryId, label }              // teacher deal_library file
  | { kind:'userColl',  collectionUrl, file, label }  // user-added collection
  | { kind:'pbn',       text, label }                 // pasted / uploaded
  | { kind:'random',    label:'Random' }              // generator, no fixed set
  | { kind:'script',    repo:'pbs', file, label }     // dealer-script generator (see 4.7)
```

`curated:true` on a scenario = pull from PBS `/bba-filtered` instead of `/pbn`
(auction-predictable subset). `script` and `random` are **generators** (fresh deal
each draw); the rest are **fixed board sets**.

### 2.2 A "selection" (what the control emits)

```
DealSourceSelection = {
  items: SourceRef[],                 // the multi-selected pool (>=1)
  options: {
    drawOrder:  'sequential' | 'random',   // pool consumption; DEFAULT sequential (Rick)
    rotate:     0..3 | 'auto',             // deal rotation (see app-arch settings)
    mode:       'bid-and-play'|'bid-only'|'play-only',
    fresh:      bool,                      // scenarios → use dealer script (2.1 script)
  }
}
```

The control's job is to produce this. It does **not** itself know whether the
consumer wants a stream or a static set — that's the resolvers.

### 2.3 Two resolvers (bridge to every consumer)

Both live in one composable (`useDealSourceResolver`, replacing today's per-kind
switch in `useDealSource.nextDeal`):

- **`nextBoard(selection)` → `{ pbn, label }`** — draw ONE board. `drawOrder`
  random/sequential picks an item from the pool, then a board from it (or generates
  a fresh one for `script`/`random`). This is the **stream** path — the sticky
  "Next deal" for tables. Per-item caches (like `dealsByScenario`) live here.
- **`materialize(selection)` → `{ boardsPbn, count }`** — resolve the whole pool
  NOW into an ordered multi-board PBN. This is the **static** path — a class set at
  session creation, or a materialized playlist in the deal library.

The pool is an **ordered concatenation** of each item's boards (a set-ref like a
scenario file contributes its boards; a single-board ref like a club board
contributes one). `drawOrder:sequential` (default) walks that concatenation in
order; `random` draws uniformly. Generators (`random`, `script`) yield a fresh
board each draw and have no fixed position.

Consumers then adapt:

| Consumer | Uses | Adapter |
|---|---|---|
| Local Practice Table | `nextBoard` | play the PBN locally (local engine) |
| Server table popup | `nextBoard` | wrap as `{t:'deal',source:'pbn',pbn,rotate,mode}` (dealer-script/random pass through as `source:'script'/'random'`) |
| Session creation | `materialize` | `boards_pbn` for `POST /table-sessions` |
| Deal library "playlist" | `materialize` | store as a `kind=file` entry (D13 materialize-at-creation) |

## 3. UI shape

A tab sheet (like today's `DealSourceModal`) with a **global filter** on top:

```
┌─ Deal source ───────────────────────────────────────────────┐
│  [ 🔎 filter across everything… "Transfer" ]                 │  ← §5
│  Scenarios | Curated | Club games | My library | User        │  ← tabs (§4), context-gated
│  collections | Paste PBN | Random                            │
│  ┌──────────────── active tab: browsable list ────────────┐  │
│  │  ▸ Beginners Bidding                                    │  │
│  │     ☑ Stayman        ☑ Transfers      ☐ …              │  │  ← multi-select (§4.1)
│  └────────────────────────────────────────────────────────┘  │
│  Selected (pool): Stayman · Transfers · [my club: Tue] ✕ each │  ← the tray (§4.1)
│  Options:  Mode [bid+play] · Rotate [none] · ☐ Fresh deals   │  ← §2.2
│  [ Deal ]  (or [Add to session] / [Save as playlist])        │  ← action varies by consumer
└──────────────────────────────────────────────────────────────┘
```

- **Tabs** are the source categories (§4); each is context-gated (§6).
- **Selection tray** shows the current pool across ALL tabs (you can pick Transfers
  from Scenarios *and* a club game and a library file into one pool).
- **Action button** label/behavior is set by the host: `Deal` (stream) vs
  `Add to session` / `Save as playlist` (materialize).

## 4. Source tabs

### 4.1 Scenario Collections (Baker Bridge + PBS) — multi-select
- Two repos, one menu: **Baker Bridge** (`bakerBridgeTaxonomy` — categorized skills
  with `level` + `dealCount`) and **PBS** (`pbsScenarios.fetchScenarioMenu`, the
  `-button-layout` tree). Show them as two top-level groups in one tree.
- **Multi-select** = the `BiddingPracticeView` model: a `Set` of `SourceRef`s;
  checkbox per leaf; a "Selected (N)" tray with per-item remove + Clear. First pick
  can auto-load (stream consumers).
- Boards fetched via `pbsScenarios.fetchScenarioDeals(file)` (PBS) / Baker `.pbn`
  fetch; cached per file. **De-duplicate** the menu-parse + fetch that
  `BiddingPracticeView` currently inlines against `pbsScenarios` — one path.

### 4.2 Curated Collections (PBS curated) — multi-select
- Same tree, but resolves from PBS **`/bba-filtered`** (the auction-predictable
  subset) instead of `/pbn`. Modeled as `SourceRef{kind:'scenario', curated:true}`.
- Open question (Q1): separate tab, or a **"curated only" toggle** on the Scenarios
  tab? A toggle is less duplication; a tab is more discoverable. Lean: toggle.

### 4.3 Club games (DB or browser) — drill to boards, multi-select boards
- **No collection-level multi-select** (Rick): you don't pool whole games. You
  pick ONE game, drill into its boards, and **multi-select individual boards**
  (each a `clubboard` ref). This matters because a club game is *your* real
  boards — you want specific hands (the one you misdefended), not a random draw.
- Registered users: `useClubGames.fetchGames(owner)` → `club_games` (server, M3);
  `fetchGame(id)` → boards via `normalizedDeal.clubGameBoards` + `boardToMinimalPbn`.
- Anonymous / same-origin: the browser store (IndexedDB once M2 lands — today
  localStorage `bc-game`/event cache). Same board shape, different backend.

### 4.4 My library (teacher deal_library) — multi-select, teacher-gated
- `useDealLibrary` folders/files. A `kind=file` entry = a materialized board set;
  multi-select files into the pool. (Playlists are just files — D13.)
- This is also where **materialize → save as playlist** writes back.

### 4.5 User Collections (URL-provided) — multi-select — §7

### 4.6 Paste PBN / upload — single
- Textarea + file input → `SourceRef{kind:'pbn', text}`. Not really multi-select
  (it's one blob), but it can be *added to the pool* alongside collections.

### 4.7 Random / Dealer script — generators
- **Random** = `{kind:'random'}` — server shuffle (table) or client shuffle (local).
- **Dealer script**: mechanically **not a separate collection** — every PBS scenario
  has a paired `/dlr` script, so "dealer script" = the *fresh-generated* variant of a
  chosen scenario (`options.fresh` → `SourceRef{kind:'script'}`). Present it as the
  **"☐ Fresh deals (generate)"** option on Scenarios/Curated (matches today's toggle),
  not a standalone tab.
- **Dealer service is browser-direct, like BEN** (D-fresh, Rick 2026-07-03 —
  supersedes the earlier "Mac-API proxy" resolution). dealer-service becomes the
  third peer of BEN/BBA: a stateless droplet service the client calls straight from
  the browser (`fetch(dealerUrl)`), exactly as `benClient.js` calls
  `ben.bridge-craftwork.com`. **No proxy** — not on Mac-API, not a new table-service
  HTTP route — so `fresh` works everywhere with zero server glue.
  - **Why the proxy plan was dropped:** a proxy forwards the *same* user-supplied
    script unchanged, so it adds no script safety; and we're *deliberately offering
    user-defined scripts as a deal source*, so there's nothing to allowlist against.
    The only real risk is attacker-controlled CPU (the script writes `produce`/
    `condition`), and a **wall-clock + generation cap neutralizes that at the
    service**. With `DEAL_TIMEOUT_SECONDS=5` + a concurrency limit, an open dealer is
    *cheaper* to abuse than the already-open BEN (up to 50s/call, browser-direct, no
    token). If BEN clears the bar, dealer clears it easily.
  - **Punch-list to go direct:**
    1. **Relax dealer-service auth** — its `API_TOKEN` is currently *required* (401
       without). Drop the requirement or swap to the same coarse shared key the rest
       of the frontend uses (CLAUDE.md: "not secret — filters casual misuse").
    2. **CORS on dealer-service/Caddy** for the app origins — copy BEN's edge config.
    3. **New `dealerClient.js`** (mirrors `benClient.js`) holds the ~8 lines that used
       to live in table-service `dealer.rs`: input-shaping (`produce 1`,
       `printoneline`→`printpbn`) + output-shaping (keep `[` lines, require `[Deal `).
       Presentation glue that belongs client-side anyway.
    4. **table-service keeps its internal `dealer.rs` as-is** for the server-table WS
       path (fast internal hop, holds the token internally) — no duplication, the
       browser paths just don't route through it.
    5. **Harden dealer-service itself** with an explicit **generation/output-size cap**
       alongside the wall-clock cap, so a script can't `produce` a huge payload inside
       the 5s window. Cap time *and* volume, once, at the service, for all callers.

## 5. Global text filter

A search box above the tabs that filters **across every source**, not just the
active tab (Rick: search "Transfer" and find it wherever it lives).

- Matches on `label` (scenario names, club-game event names, library file names,
  user-collection file names). Case/space-insensitive substring; later maybe fuzzy.
- Behavior: while the filter is non-empty, show a **flat "Results" view** that pulls
  matching `SourceRef`s from all loaded tabs, grouped by source with a small origin
  tag ("PBS · Beginners", "Baker · 2/1", "My club games"). Clearing the filter
  returns to the tab view. (Alternative: filter in-place per tab and auto-expand —
  but a flat results list is the point of "search the whole sheet".)
- Only searches **loaded** menus; lazy-load the scenario/curated menus on first
  filter keystroke so results are complete.

## 6. Context gating

One control; the **host declares which tabs/options are allowed**. Rough matrix
(✓ = shown; blank = hidden):

| Source tab | Local Practice Table | Server table (demo) | Session creation (teacher) | Guided A2 (future) |
|---|:--:|:--:|:--:|:--:|
| Scenario Collections | ✓ | ✓ | ✓ | ✓ (guidance-tagged files only) |
| Curated | ✓ | ✓ | ✓ | ✓ |
| Club games (DB) | ✓ registered | ✓ registered | ✓ | |
| Club games (local) | ✓ same-origin | ✓ | ✓ | |
| My library | ✓ teacher | ✓ teacher | ✓ teacher | |
| User Collections | ✓ | ✓ | ✓ | |
| Paste PBN | ✓ | ✓ | ✓ | |
| Random | ✓ | ✓ | ✓ (fresh per board) | |
| Fresh deals (script) | ✓ (browser-direct) | ✓ (table-service WS path) | ✓ (browser-direct) | |
| **Action** | Deal (stream) | Deal (stream) | Add to session (materialize) | Deal (stream) |

`replay` (re-run the same board) stays a table-only action, orthogonal to source.

## 7. User Collections (URL-provided)

Let users point at their own board sets.

- **Input:** a URL to either (a) a `toc.json` manifest (Baker-style — the format
  `useAppConfig.COLLECTIONS` already consumes), or (b) a raw multi-board `.pbn`, or
  (c) a PBS-style `-button-layout` + `/pbn` dir. Detect by fetching + sniffing.
- **Validate on add:** fetch, parse, show name + board/file count; reject
  unparseable or huge. CORS: must be a CORS-enabled host (GitHub raw works).
- **Storage tiers** (consistent with the login=durable theme, app-arch D7):
  - Anonymous → localStorage list (device-bound).
  - Registered → a `deal_library` **`kind=link`** entry (the descriptor is exactly a
    "reference to an evolving external source" — that's what `link` was for). So
    "User Collections" for a signed-in user *is* their library's link entries;
    no new table.
- **Tab:** lists the user's added collections; each expands to its files/boards for
  multi-select like any other collection. "+ Add collection URL" affordance.

## 8. What to build

- **`useDealSourceResolver.js`** — the `SourceRef` union + `nextBoard` /
  `materialize` (absorbs `useDealSource.nextDeal`'s switch, `normalizedDeal`,
  library/clubgame fetch, scenario fetch/cache). Single source of truth for
  "ref → board(s)".
- **`DealSourcePicker.vue`** — the tab sheet + global filter + multi-select tray +
  options + host-provided action. Props: `allow` (tab/option allow-list, §6),
  `mode` ('stream' | 'materialize'), `owner`. Emits `deal(selection)` /
  `resolved(boardsPbn)`.
- **Retire/adapt:** `DealSourceModal` becomes a thin host of `DealSourcePicker`
  (stream). `BiddingPracticeView`'s inline picker → `DealSourcePicker` (stream,
  local). `TableSessionNewView`'s board box → `DealSourcePicker` (materialize).
  `useDealSource` keeps only the sticky-source + mode/rotate persistence.
- **Reuse:** `pbsScenarios`, `bakerBridgeTaxonomy`, `useAppConfig.COLLECTIONS`,
  `useDealLibrary`, `useClubGames`, `normalizedDeal` unchanged underneath.

## 9. Fitting the different hosts — THE hard part (Rick)

The real risk isn't the sources — it's that the same control must sit in very
different containers:

| Host | Container | Constraints |
|---|---|---|
| Server table deal popup | compact **modal** (~560px, ~84vh) | tight; tabs + tray + options must fit; one primary action ("Deal") |
| Local Practice Table (`#/bidding-practice`) | **full-screen** region | room to breathe; the tree + filter can be generous |
| Session creation (`#/tables/new`) | **inline form section** | embedded among other fields; action is "Add to session", not "Deal"; materialize mode |
| (future) Guided A2 | full-screen | authored-tagged files only |

Design implications (bake into `DealSourcePicker` from day one, don't retrofit):
- **Layout-agnostic:** the component owns *content* (tabs, filter, tree, tray,
  options), the **host owns the frame** (modal vs inline vs full) and passes a
  `layout` hint (`'compact' | 'full'`) that collapses/expands chrome (e.g. compact
  hides the tree and leans on the filter + tray; full shows the tree).
- **Host-provided action:** `actionLabel` + emits `submit(selection)`; the host wires
  it to `nextBoard` (Deal) or `materialize` (Add to session / Save playlist).
- **Allow-list drives visible tabs/options** (§6) so each host shows only what fits
  and what's permitted — a small modal can even show *only* the filter + a couple of
  tabs.
- **Selection tray is the shared spine** — it's the one piece that reads the same in
  every host; make it compact and always visible.

Prototype the **compact modal** first (hardest fit); if it works there, the roomy
hosts are easy.

## 10. Open questions (remaining)

- **Q1 — Curated: tab or toggle?** Lean toggle ("curated only") on Scenarios.
- **Q6 — Rotation "auto"/semantic labels** (app-arch deferred) — resolver honors a
  numeric `rotate` now; semantic ("students defend E/W") later.

Resolved (Rick 2026-07-03): Q2 club games = **drill to boards, multi-select boards**
(no whole-game pooling); Q3 dealer scripts = **browser-direct, like BEN — no proxy**
(supersedes the earlier "Mac-API proxy"; see §4.7 D-fresh); Q4 draw order = **default
sequential**; Q5 = **one Scenario Collections tab** (Baker + PBS as two groups).

## 11. Build order (when we pick this up)

1. **`useDealSourceResolver.js`** — the `SourceRef` union + `nextBoard`/`materialize`
   (absorbs `useDealSource.nextDeal`, `normalizedDeal`, scenario/library/clubgame
   fetch). Pure logic, unit-testable without UI.
2. **Dealer browser-direct** (§4.7 D-fresh) — relax dealer-service auth + CORS + a
   generation cap, add `dealerClient.js` (mirrors `benClient.js`). Unblocks `fresh`
   everywhere with no proxy.
3. **`DealSourcePicker.vue`** — tab sheet + global filter + multi-select tray +
   options + `layout`/`allow`/`actionLabel` props. Prototype the **compact** layout
   first (§9).
4. Retrofit consumers one at a time: `DealSourceModal` (compact stream) →
   `BiddingPracticeView` (full stream) → `TableSessionNewView` (inline materialize).
