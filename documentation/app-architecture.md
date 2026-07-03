# App architecture — model, issues, questions, decisions

**Status:** living design doc, started 2026-07-03. Companion to
[table-console-roadmap.md](table-console-roadmap.md). Purpose: agree on how
the several "apps" relate *before* reorganizing them. Items are numbered
(I#/Q#/D#) so we can reference them. "Proposed" = not yet committed.

---

## 1. Current landscape (facts)

### 1.1 The apps

| # | Name | Engine | Identity | Deal source | Guidance |
|---|------|--------|----------|-------------|----------|
| 1 | Solo practice (lobby / `#/`) | local scripted renderer | tracked (login + E2E + mastery) | static (Baker PBN) | **authored** (tag scripts) |
| 2 | Bidding practice (`#/bidding-practice`) | local scripted renderer | untracked | dynamic (PBS live, dealer scripts, random) | computed (BBA delta); **no** authored yet |
| 3 | Player table (`#/play`, `#/table`, `#/tables/new`) | **table server** | guest or tracked | any (PBS, Baker, dealer scripts, local PBN, deal library, club-analysis) | computed (BBA delta) |
| 4 | Teacher console (`#/tables/console/:id`) | **table server** | tracked (teacher) | deal library / playlists | n/a (management) |
| — | Club Game Analysis | vanilla-JS app, **separate origin** | none (no login) | uploaded club games | n/a |

### 1.2 Two engines

- **Engine A — local scripted renderer** (apps 1 & 2): single human, in-browser
  state machine, PBN-tag-driven, deterministic. No table server. This is the
  "dumb renderer" — the PBN carries the behavior.
- **Engine B — table server** (apps 3 & 4): `bridge-table-service` on the
  droplet, real-time, multi-human, bots-as-services (BBA bidding, BEN/Rules
  cardplay), seat policies, join tickets. Apps 3 and 4 are two *views* of this
  one system (player view / teacher console), not two apps.

### 1.3 Origins and storage (answers "how many origins?")

**Four** page-origins, i.e. four separate `localStorage` buckets:

1. `https://bridge-classroom.com` — landing pages + SPA at `/solo-practice-app/`.
2. `https://bridge-classroom.org` — **byte-identical** code (dual-deploy), but a
   **separate** localStorage bucket. A user identity on `.com` ≠ `.org`.
3. `https://game-analysis.bridge-classroom.com` — club-analysis app (own repo).
4. `https://game-analysis.bridge-classroom.org` — its `.org` twin.

Plus network-only origins that hold no app storage (CORS / socket boundaries):

- `https://api.bridge-classroom.{com,org}` — REST API (Cloudflare Tunnel → Mac:3000).
- `wss://tables.bridge-craftwork.com/ws` — table service.
- `wss://livekit.bridge-classroom.com` — LiveKit (table audio/video).

**Why game-analysis is a separate origin:** it caches *lots* of club-game
results in localStorage, and the origin was split to isolate that. **That
decision predates the idea of sharing club games with the SPA**, and the SPA's
own localStorage footprint is small — so the rationale is now weak (see I10).

**Origin is a separate axis from "which app."** Today it's 1:1 (SPA on its
origins, game-analysis on its own), but that's a deployment choice, not a
requirement — see Q2/Q7.

### 1.4 Folders vs apps (answers "different /folders per app?")

- The `/folders` served at `bridge-classroom.com` are **marketing/landing
  pages**, one `.html` per tool (`solo-practice.html`, `game-analysis.html`,
  `deal-library.html`, …), assembled from `docs/` by `scripts/build-site.sh`.
- **Apps 1–4 are NOT folders.** They are hash-routes inside a single Vue SPA
  bundle at `/solo-practice-app/` (`#/` lobby, `#/bidding-practice`, `#/play`,
  `#/table`, `#/tables/new`, `#/tables/console/:id`, `#/convention-card`,
  `#/join/:code`). One origin, one localStorage, one identity.
- `/curator/` and `/bidding-practice/` are thin redirect stubs into SPA routes.
- **Only game-analysis is a physically separate app/origin.**

**Consequence:** "which apps can access the user's credentials / E2E keys"
reduces to a single boundary — *everything in the SPA can; game-analysis
can't.* The internal apps are already unified for identity.

---

## 2. The proposed model

### 2.1 Two kinds of "guidance" (the key distinction)

- **Authored guidance** — David's `[BID]`/`[PLAY]`/`[show]`/`[NEXT]` tag scripts
  with pre-written explanations + correctness. It is *content baked into the
  PBN*, interpreted by the local renderer. **Requires a fixed board** (can't
  pre-author an explanation for a deal that changes) and **the local engine**
  (the table server is a live engine, not a tag interpreter).
- **Computed guidance** — "you bid 3♠, BBA bids 4♠." Generated on the fly, **no
  authoring, no fixed board**, works on any source and on a live table.

### 2.2 Two engines × surfaces, one identity

- **A1 — tracked guided practice** (today's app 1): source = *snapshots* +
  Baker; tracks mastery.
- **A2 — untracked guided/free play** (today's app 2, upgraded): source = *live*
  PBS files incl. David's in-progress guided scenarios; no tracking.
- **B1 — player table** (today's app 3): any source incl. deal library /
  club-analysis; computed (BBA-delta) feedback.
- **B2 — teacher console** (today's app 4): Shark-style multi-table setup +
  management, fed by the deal library / playlists.

**Evidence (2026-07-03, commit `88e5d28`):** David's "declarer-play coaching"
landed in app 1 (MainLayout) — a board ships a recorded `[Play]` table +
`[ROLE][STAGE]` prose; the parser builds per-seat queues; a new
`makeReplayBot` drives the defenders down the scripted line (no solver, no
network); the student declares S+dummy. Confirms authored guidance now spans
cardplay, is fully tag/PBN-driven, lives in the A1 (local) engine, and rides on
the shared pluggable bot interface (`cardplayBots.js`: Random / BEN / Replay).

### 2.3 Source → release (the snapshot workflow)

The snapshot is a *publish* step, and it's **required, not just convenient**:

- **A2 (untracked) is the home for David's evolving guided scenarios** —
  *because* it's untracked there's no mastery identity to corrupt, so he edits
  the live PBS file and users immediately play the latest guided version. This
  is the "author + play, no lock-down, no AI at play time" app David wants.
- **A1 (tracked) consumes snapshots** — *because* it tracks, the board must be
  frozen with a stable id. Snapshot = promote a blessed version into PBS as an
  immutable release; A1 reads the release. David never edits the release; he
  edits the source and re-publishes.

---

## 3. Design constraints

- **C1 — Identity/E2E keys are localStorage-bound to the page origin.** Anything
  tracked/identified must be same-origin as the SPA (or use real federated
  identity). Cross-origin apps can't see it.
- **C2 — Authored guidance needs a fixed board.** So "guided + dealer-script/
  random" is impossible; authored guidance rides only on fixed-deal PBN.
- **C3 — Tracking couples to stable board identity** (`deal_subfolder`+board).
  Editing a tracked board in place corrupts mastery history — the same reason
  the deal library *materializes* rather than referencing.
- **C4 — The table server is real-time multi-human.** Wrong model (and overkill)
  for a solo scripted walkthrough; correct for multiplayer. Don't route
  authored guidance through it.
- **C5 — Deploy fragmentation.** SPA (Pages/Worker, two TLDs), table service
  (droplet), game-analysis (Pages, separate origin), API (Mac→droplet). Each
  extra origin is identity/CORS friction.

---

## 4. Issues

- **I1 — Split identity across `.com`/`.org`.** Identical code, separate
  localStorage; a user's identity/history differs by TLD. (Dual-deploy exists
  because Norton sometimes blocks `.com`; `.org` is the fallback.)
- **I2 — game-analysis is a separate origin** → no shared identity/E2E keys →
  every integration needs a hand-off hack (`?bc_owner`, shared API key). This is
  the real source of the "localStorage complication."
- **I3 — Authored guidance is locked to app 1** (tracked + static). David can't
  author-and-play without either locking scenarios down or being forced through
  tracking.
- **I4 — Tracking vs evolving content.** Re-publishing a tracked board silently
  muddies mastery (C3). Snapshots need versioned identity.
- **I5 — Two ways to store board-sets in the DB today** (different by design):
  - **`exercises` + `exercise_boards`** — **reference-based**. A board is a
    *pointer* (`deal_subfolder`, `deal_number`, `sort_order`, `collection_id`)
    into the static lesson taxonomy (Baker PBN files); no deal text is stored.
    Feeds tracked assignments — observations key off `exercise_id`, and mastery
    relies on those stable taxonomy ids. This is app 1's tracked path.
  - **`deal_library`** — **materialized (or link)**. `kind=file` stores the PBN
    text as a frozen copy; `kind=link` stores a JSON descriptor to an evolving
    source. Deliberately materialized to avoid the "exercise mutated after it was
    assigned" problem — table sessions have no history to protect, so a frozen
    snapshot is what you want. This is the table apps' path (Phase 2.5).
  - The split is *intentional*: references suit tracked lessons (stable ids +
    live content), materialization suits tables (no history, want a frozen deal).
    Club games (D7) have nothing in the taxonomy to reference, so they land on the
    **materialized** side — either reused as a `deal_library` file-per-game or a
    dedicated `club_games` store (Q10). The open risk is *drift/duplication*
    between the two if we're not deliberate about which owns what.
- **I6 — app 2 vs app 3 overlap.** "Single human plays with feedback" exists in
  both the light local engine (A2) and the table server (B1). Roles must be crisp
  or they blur.
- **I7 — No coherent top-level information architecture.** Four apps mix the four
  axes inconsistently; users have no clear "pick your experience" entry point.
- **I8 — "Guidance" is conflated** (authored vs computed), driving design
  confusion (see 2.1).
- **I9 — game-analysis is also dual-origin** (`.com`/`.org`), so there are
  **four** page-origin localStorage buckets, not three.
- **I10 — The separate-origin rationale is likely obsolete.** It was split to
  isolate a big localStorage game-results cache, *before* we wanted to share
  club games with the SPA. But the SPA's storage is small (headroom exists), and
  a large cache belongs in **IndexedDB** (hundreds of MB quota) rather than
  localStorage — so "capacity" no longer forces a separate origin. See Q7/Q8.
- **I11 — The ACBL extension hard-pins the game-analysis URL, and it ships via
  the Mac App Store (Safari).** `acbl-live-fetch` is built for four browsers
  (chrome/firefox/edge/**safari**); its manifest `matches` +
  `host_permissions` are pinned to `game-analysis.bridge-classroom.{com,org}/analyze*`,
  and it injects a content script on that origin (`analyzerContent.js`) to hand
  data to the app. **It isn't deployed yet.** Consequence: the origin/URL for
  club-analysis must be **final before the Safari build ships**, because Safari
  Web Extensions update through **App Store review** (slow) — re-pointing the URL
  later is expensive. This *raises* the cost of a later origin move and is the
  real forcing function on Q7/D6. (Side note: the manifest targets `/analyze*`,
  but the live Pages site serves the app at `/` — the content script matches by
  URL, so it injects on `/analyze` even though that path 404-status-falls-back to
  the SPA; fragile, worth tidying when the URL is finalized.)
- **I12 — The table deal-source picker can't list cached club games today.**
  They live in game-analysis's origin localStorage; the SPA (both table faces)
  can't read a different origin's storage. The desired "table lists my cached
  club games as a deal source" (a natural *pull*) requires same-origin (Q7), a
  server round-trip, or cross-origin `postMessage`/iframe. This is why the only
  flow that works *today* is the *push* (start in analysis → send out).
- **I13 — Anonymous use is a current value prop.** Club-game analysis works with
  no account today — a club player pastes a game and analyzes it, zero friction.
  Coupling it tightly to the SPA (same origin, DB-backed) must **not** force
  registration, or we lose that reach. The resolution (see Q7/Q10): same-origin
  enables replay + DB persistence *as opt-in enhancements for registered users*,
  while anonymous users keep a local-only path.
- **I14 — Bot implementations diverge across engines.** The frontend
  (`cardplayBots.js`) has Random / BEN / **Replay**; the table server
  (`bots.rs`) has BBA (bidding) + BEN + Rules + Random. Different codebases for
  overlapping behavior. "Same bots everywhere" (Rick) wants convergence — and
  it's a **prerequisite** for the seamless local↔server switch (D9): if the bots
  and deal source match, switching engines is invisible to the user. See D10.
- **I15 — BEN latency.** Cold-start ~20s, ~500ms warm ([[project_ben_latency]]).
  Thorvald has provided information on speeding BEN up — pending write-up. This
  matters for any path that puts BEN in the live loop (both the local free-play
  bot and the server).

---

## 5. Open questions

- **Q1 — Where does solo live-play-with-feedback live?** Table server (B1, richer
  bots, one engine) or the light local engine (A2, snappier, no infra)? BEN's
  ~20s cold start argues for keeping a light local path. **Resolved — see D9:**
  default to the local engine for one human at a table, upgrade to the server
  when a second human joins (seam TBD).
- **Q2 — game-analysis future.** Three options for the identity boundary (I2):
  (a) **fold the code into the SPA** (best identity, biggest effort);
  (b) **serve it same-origin at `bridge-classroom.com/game-analysis/`** — shared
  localStorage *without* merging codebases (cheap, likely the sweet spot);
  (c) **keep separate, formalize a signed hand-off token** (the RSA-signed-
  request upgrade already noted in CLAUDE.md) instead of the raw `?bc_owner`.
- **Q3 — One TLD or two?** Canonicalize to a single origin (kills I1's split
  identity) vs keep dual-deploy for the Norton fallback (and accept split
  storage, or add identity federation).
- **Q4 — Snapshot versioning.** How do snapshots get stable ids so A1's tracking
  survives a re-publish? (New subfolder per version? version suffix on
  `deal_subfolder`? explicit `subfolder` field on the taxonomy?)
- **Q5 — Unify the two deal-organization systems** (Q from I5) or keep the lesson
  taxonomy and the deal library separate by engine?
- **Q6 — Share the authored-guidance renderer.** Extract app 1's guided
  state-machine so app 2 can render authored guidance too — where does that
  shared module live, and what's the smallest extraction?
- **Q7 — Move club-analysis to the SPA origin?** (Refines Q2.) Same-origin is the
  *enabler* for the natural pull (I12) and replay, regardless of where data
  lives. Two ways: (b) serve the existing vanilla-JS app at
  `bridge-classroom.com/game-analysis/` — shared storage, no rewrite; or (a)
  fold it into the SPA over time. **Decide before the ACBL extensions ship
  (I11).** Note: game-analysis is itself dual-origin, so this is really "collapse
  four page-origins toward two."
- **Q8 — Move the game-results cache to IndexedDB?** Decouples "capacity" from
  "origin" (I10): a big cache stops being a reason for a separate origin, and it
  survives even if same-origin localStorage is tight.
- **Q9 — Which table face does club-game replay land on?** Cached club games are
  a deal *source*, orthogonal to face. In the **pull** direction (open a table →
  pick a source) the face is *already chosen* — single-table B1 for a student
  reviewing their own boards, multi-table B2 for a teacher building a class set —
  so pull sidesteps the ambiguity. Only the **push** direction (from analysis,
  "send to a table") has to choose a target, which is an argument for pull.
  **Resolved — see D8:** push → single table; pull is the teacher/registered path.
- **Q10 — Where do club games persist: local, DB, or both?** Same-origin lets
  registered users save games to the **database** (cross-device, durable, feeds
  the deal library / tables everywhere) while anonymous users keep a **local**
  (IndexedDB) path (I13). Open sub-question: does DB-backed club-game storage
  *reuse the deal library* (a materialized file per game) or a dedicated
  `club_games` store? (Relates to I5 — two deal-organization systems.)
  **Resolved in part — see D7:** registered → DB, anonymous → local. Still open:
  the DB *schema* (reuse a deal-library file per game vs a dedicated
  `club_games` store).

---

## 6. Decisions

Marked **Proposed** (pending Rick's confirmation) or **Settled**.

- **D1 — Proposed:** Adopt the two-engine model (§2.2). Stop treating these as
  four peer apps; they're two engines with surfaces.
- **D2 — Proposed:** Split guidance into authored vs computed (§2.1). Keep
  authored guidance on the local engine + fixed boards; the table server gets
  computed feedback only.
- **D3 — Proposed:** A2 (untracked, live PBS) is David's author+play surface; A1
  (tracked) is snapshot-fed. Build the snapshot/publish tool as the bridge —
  highest-leverage missing piece for David.
- **D4 — Proposed:** The deal library is the universal source hub for the table
  platform (already materialized/built — roadmap Phase 2.5).
- **D5 — Settled (already true):** Apps 1–4 share one SPA origin/bundle/identity;
  game-analysis is the separate one (and itself dual-origin). The
  credential-access question is a single boundary, not a per-app matter.
- **D6 — Decided (Rick, 2026-07-03): Option A.** Bring club-analysis to the SPA
  origin at `bridge-classroom.com/game-analysis/` (cheap same-origin subpath,
  Q7b), and **finalize that URL + update the extension manifest before the Safari
  extension ships** (I11) — doing it now costs zero re-release; doing it later
  costs an App Store review. This is the *enabler*: table can *pull* cached club
  games (I12), registered users persist to the DB while anonymous stay local
  (I13), and the `?bc_owner` handshake goes away. Cached club games surface as a
  **deal source in the shared picker**, orthogonal to which table face consumes
  them (Q9).
  Nuance from D7: once registered games live in the DB, the table can *read* them
  via the API even cross-origin — so same-origin isn't strictly required for the
  registered *pull*; it's still wanted for (a) attributing *writes* without a
  handshake, (b) anonymous local replay, and (c) UX unification (I7).
- **D11 — Decided (Rick, 2026-07-03):** The club-game cache goes to **IndexedDB**,
  not localStorage (M2 rides with M1, not optional). Rationale: co-locating
  (D6) merges storage buckets, and the game cache must **not** bloat the SPA's
  localStorage — which holds **critical E2E encryption-key material**. IndexedDB
  keeps the large, churny cache in its own store. (Durability caveat stands: on
  Safari, ITP can still evict IndexedDB after ~7 days idle — durability is the
  server DB, D7.)
- **D7 — Decided (Rick, 2026-07-03):** Club-game persistence is **tiered by
  registration**. *Registered* users' games save to the **database** — durable,
  cross-device, no localStorage roll-off (Rick's long-standing gripe), and small
  even at ~10K users; it also feeds the deal library / tables. *Anonymous* users
  keep the **local** (IndexedDB) path — zero friction, no account. The longer
  durable storage is deliberately a **carrot to register**. (DB *schema* still
  open — Q10.)
- **D8 — Decided (Rick, 2026-07-03):** The **push** direction (from analysis,
  "send to a table") targets the **single table (B1)**. The **pull** direction
  (open a table → pick "my club games") is the teacher/registered path — teachers
  are normally registered and prefer pull. So: push → B1; pull → B1 or B2 by
  whichever face you opened.
- **D9 — Decided (Rick, 2026-07-03):** A **single-user single table defaults to
  the local engine** (snappy, no infra, works with the same authored guidance
  path), and **upgrades to the table server when a second human is added**. The
  **seam is a board boundary** — mid-hand continuity is *not* required (Rick:
  "going to the next hand would be expected"). So "invite a person" spins up a
  server table from the *same deal source*, resuming at the next board. Made
  invisible by D10 (same bots) + a shared deal source, so who-you-play and
  what-you're-dealt don't change across the switch. This keeps the switch a
  *small* feature, not a big one.
- **D10 — Proposed (Rick's direction, 2026-07-03):** **One bot behavior across
  all engines** (I14). Keep the pluggable interface (`cardplayBots.js` /
  `bots.rs`); converge the *implementations*: share the **Rules** bot via the
  planned `bridge-rulebot-wasm` (frontend) ↔ native `bridge-rulebot` (server),
  call the **BEN** service from both, and mirror the trivial **Random**/**Replay**
  bots. Prerequisite for D9's seamless switch. BEN speedup (I15, Thorvald) feeds
  this.

---

## 7. Migration sketches

### 7.1 Club-analysis → SPA origin + tiered storage (D6 / D7)

Incremental; each phase ships on its own, no big-bang rewrite. The vanilla-JS
analysis app is **not** rewritten — it just changes where it's served and where
it saves.

- **M1 — Co-locate (unblocks everything, zero behavior change).** Serve the
  existing `index.html` under the SPA origin at `bridge-classroom.com/game-analysis/`
  (have `scripts/build-site.sh` drop the built file into `dist/game-analysis/`, or
  add a route). Now it shares localStorage + identity with the SPA → the
  `?bc_owner` handshake and the API CORS entry become unnecessary. **Decide this
  canonical URL before the ACBL extensions ship (I11)** and point them at it;
  301 the old `game-analysis.bridge-classroom.{com,org}` → the new path.
- **M2 — Cache → IndexedDB (Q8, D11) — rides with M1.** Move the game-results
  cache off localStorage (one-time copy-on-load migration). Two reasons, now that
  M1 co-locates: (1) fixes the **5 MB cap** / roll-off; (2) **keeps the large,
  churny cache out of the SPA localStorage that holds the E2E keys** (D11).
  **Caveat:** IndexedDB is universal (incl. Safari since ~2016), but **Safari ITP
  evicts local storage — both APIs — after ~7 days idle**, so it fixes *size*,
  not *durability*. Durability = the server DB (D7).
- **M3 — Tiered persistence (D7).** Same-origin lets the app read the SPA user
  store. *Registered* → also POST games to the DB (schema per Q10); *anonymous* →
  IndexedDB only, with a "register to keep these across devices" nudge (the carrot).
- **M4 — Wire into the deal-source picker (the payoff, I12).** Add a "My club
  games" source: registered → list from the DB (works regardless of origin,
  since it's server-side); anonymous → list from IndexedDB (needs M1's
  same-origin). Push from analysis → single table (D8).

Note the ordering flexibility from D7: M3's DB path makes the *registered* pull
work even without M1, so if the origin move slips, registered users still get
pull via the API — M1 is what buys anonymous local replay + dropping the
handshake + UX unification.

### 7.2 Shared bots (D10) — later, tracked separately

Not blocking 7.1. Sequenced with the `bridge-rulebot-wasm` work already in the
roadmap; needed before D9's seamless local↔server switch is worth building.
