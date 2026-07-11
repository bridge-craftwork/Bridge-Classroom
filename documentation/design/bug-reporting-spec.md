# Bug Reporting System — Specification

**Location:** `documentation/design/bug-reporting-spec.md`
**Status:** Proposed
**Companions:** `rendering-harness-plan.md` (fixture formats, sanitization, harness loading),
`integration-roadmap.md` (engine contract, invariants), David's existing
"Report a Problem" lesson-content pipeline (reused, not replaced)
**Last updated:** 2026-07-10

## Purpose

A single in-app problem-reporting mechanism ("beetle button") shared by every app
built on the common component library and engine contract:

| App | Shell | Engine |
|---|---|---|
| A1 (coached lessons) | MainLayout | localEngine (step machine) |
| Local practice table | UnifiedTable | localEngine |
| Multi-user table (host + student views) | UnifiedTable via TableHostView | serverEngine |
| Teacher console | TeacherConsoleView (ConsoleTiles + drill-in) | serverEngine ×N tables |

A report captures, in one atomic artifact bundle: the user's narrative, the
environment, a semantic action log, a frozen engine fixture, and a screenshot —
enough that "cannot reproduce" is structurally rare. Reports file as GitHub
issues; bulky artifacts commit to a dedicated artifacts repository.

**Distinct from the existing lesson-content "Report a Problem"** (which reports
bad *hands/lessons* and stays as-is). The beetle reports *app* problems. Both
pipelines share the GitHub issue tooling where convenient.

---

## 1. Architecture overview

```
┌────────────── any app shell ──────────────┐
│  BeetleButton (top bar, common component)  │
│        │ opens                             │
│  ReportDialog: narrative + privacy preview │
└────────┬───────────────────────────────────┘
         │ gathers from
   ┌─────┴──────────────────────────────┐
   │ ReportCollector (lib, app-blind)   │
   │  • env block (harness coordinates) │
   │  • ActionTape ring buffer          │
   │  • engine.captureFixture()         │
   │  • screenshot (DOM rasterize)      │
   └─────┬──────────────────────────────┘
         │ submits to ONE of (pluggable sinks)
   ┌─────┴──────────────┐  ┌──────────────────────────┐
   │ GitHub sink        │  │ Dev sink (dev flag /      │
   │ (user reports):    │  │ shift-click):             │
   │ sanitize → commit  │  │ raw bundle → local        │
   │ bundle → private   │  │ dev-reports/ dir handle   │
   │ artifacts repo →   │  │ (or zip download) — for   │
   │ create issue →     │  │ handing directly to CC    │
   │ back-reference     │  │ in the iteration loop     │
   └────────────────────┘  └──────────────────────────┘
```

Sanitization and consent belong to the GitHub sink; the dev sink writes raw.
All capture logic lives in the shared library, keyed off the engine contract —
no per-app capture code beyond declaring capabilities.

---

## 2. Semantic action log (ActionTape)

A rolling ring buffer of **engine-boundary events**, not DOM events.

- **What is logged:** calls crossing the engine contract (`bid`, `playCard`,
  `undo`, `nextDeal`, `claim`, seat changes, deal-source changes), engine phase
  transitions, slot swaps, thrown errors/rejected promises, and report-relevant
  UI events (dialog opens, arrangement/scale changes). Each entry:
  `{t: relative_ms, kind, payload}` with payloads in domain vocabulary
  (`{kind:'playCard', card:'♠4', seat:'S'}`).
- **What is never logged:** chat text (log `{kind:'chatSent'}` only), player
  names other than the reporter's seat (sanitizer replaces with stage names,
  same convention as fixture capture), pointer coordinates, scroll/hover
  events, keystrokes.
- **Size:** last 100 entries or 15 minutes, whichever is smaller. Survives
  within a session only; never persisted outside a report.
- **Implementation:** one tap installed where the shell binds the engine —
  since all apps route through the contract, this is one wrapper, not N.
- **Server-table apps additionally:** if the socket-message capture (Phase 0
  fixture driver, capture half) is enabled, the tape MAY include inbound
  message sequence numbers so the report correlates with a server-side replay
  log. Message *contents* are not duplicated into the tape.

## 3. Fixture capture

`engine.captureFixture()` — required by the engine contract, per-engine
implementation:

- **localEngine:** serialize current deal, auction, play state, step-machine
  position (A1), capabilities. Must round-trip: loading the fixture into the
  harness fixture engine reproduces the rendered state.
- **serverEngine:** serialize the engine-contract state as currently held
  client-side (post-mapping, not raw socket state), plus session context
  (table id, seat, board number). If the message capture is active, reference
  its log id.
- **Teacher console:** captures the fixture of the table the teacher indicates
  (drill-in context: that table; console overview: prompt "which table?" with
  an "all tables" option that bundles N fixtures).
- **Sanitization:** shared sanitizer from the fixture-capture work — player
  names → stage names, account ids stripped. Runs before anything leaves the
  device.
- **Schema:** identical to harness fixture files. `fixture.json` from any
  report must load in `/harness/...` unmodified. This is a contract test:
  every engine's `captureFixture` output is validated against the fixture
  schema in CI.

## 4. Screenshot

- DOM rasterization (html2canvas or equivalent). Captured at report time,
  **before** the report dialog covers the screen (capture on beetle tap, then
  open dialog).
- Client-side downscale/compress: JPEG/WebP ~0.8 quality, max 1600px wide.
  Target ≤300KB.
- Labeled "approximate rendering" in the issue (rasterizers lie about some
  CSS; the fixture is ground truth for state, the screenshot for what the
  user saw).
- Shown full-size in the privacy preview.

## 5. Environment block

The harness coordinates plus runtime facts — every field is a filterable
triage axis:

`app` (a1 | practice-table | table-lobby | table-host | console |
convention-card | harness — route-derived per `detectApp`; solo vs server on the
practice table is the `engine` axis, not a separate app id) ·
`version/commit` · `engine` (local | server) · `phase` · `arrangement` ·
`--table-scale` (preference and effective per-region if fill-scaling active) ·
`density` context · `viewport` (w×h, dpr) · `platform/UA` · `board/deal id
and deal-source ref` (links app bugs to lesson content when relevant) ·
`connection state` (server apps) · `timestamp (UTC)`.

## 5a. Reporter identity & consent

Adopts the **existing hand-report identity pattern verbatim** — one UI, one
wording, one remembered preference across both pipelines:

- **Display-name field**, prefilled "First name + last initial" (e.g. "Vickie
  R"), freely editable to anything including a pseudonym. The prefill
  convention stays even though the repo is now private: issue text gets quoted
  (promoted public issues, fix commits, conversation), and a minimized label
  makes quoting safe by default while still allowing cross-report correlation.
- **Contact checkbox** — "May we contact you about this report?" When checked,
  the session email is included alongside the display name (shown in the
  dialog so the reporter sees exactly what's sent). Email appears in the
  **issue body** (and optionally `context.json`), never in commit messages —
  bodies are editable/deletable on request; commits are permanent and repo
  visibility is not guaranteed forever.
- **Anonymous checkbox** — clears and disables both of the above. Anonymous
  means anonymous *in the record*: no identity is attached from the session
  even though auth knows who is logged in. Do not quietly enrich.
- **Memory:** the reporter's last choice (edited name, contact consent, anon)
  is remembered per account and prefilled next time, visible and changeable at
  every submission.
- Three resulting states: **named** (label only — current hand-report
  behavior), **contactable** (label + email), **anonymous**.
- **Hand-report migration:** the lesson-content "Report a Problem" pipeline
  moves its issue destination to the private artifacts repo (same labels, same
  provenance fields; only the target changes). One-time cleanup: pseudonymize
  or strip names from existing public hand-report issues. This is independent
  of all beetle slices and can proceed immediately.

## 5b. Layout block

The env block's geometric twin: a **bounded, computed-geometry snapshot** of the
shared table components, so a sizing/compression bug (a hand box that
shrink-wraps, an auction that overflows, a region that clamps wrong) is
diagnosable from the report alone — no live session, no DevTools element-picker.
Motivating incident: bug-artifacts #6 took several rounds because the report
couldn't show a hand box shrink-wrapped to ~119px under a *silently dead*
`min-width:240px` (an unscoped `<style>` killed a `:deep()` rule); the box's
computed width + its ancestry (which container carried no `data-v-*` scope) would
have pinned it in one glance.

App-blind, like the rest of the collector — the breaking components are the SAME
across every app, so it reads a **fixed anchor set**, never a pointer target:
`.holding` · `.seat-panel` · `.suit-row` · `.auction-table` · `.bidding-box` ·
`.trick-area` · `.grid-table` · `.bridge-table` (ordered most-diagnostic first).

- **Per anchor** — `sel` (`tag.class.class`) · `w`/`h` (rounded px) · `minW`
  (computed `min-width` — a set floor with a smaller `w` is the shrink-wrap tell)
  · `disp` (only when not `block`) · `vars` (the scale CSS custom props present:
  `ts`=`--table-scale`, `ss`=`--suit-scale`, `rs`=`--region-scale`).
- **Ancestry** — the primary hand box's chain (`.holding`→…), each level with
  `w` · `minW` · **`scoped`** (carries a `data-v-*` attr). An unscoped container
  in the chain is the dead-`:deep()` tell — a cheap boolean, no values leaked.
- **Caps/budget** — 60 elements · 64-char class · depth 8; `truncated` flag.
  ≈1–2 KB a bidding view, ≈3 KB a full table. `null` when there's no DOM or no
  table on screen (spread-safe).
- **Captured on the beetle tap**, against the real DOM, frozen alongside the
  screenshot — before the dialog opens or a bot/timer mutates the table — so
  outputs and screenshot agree. Gathering it can never fail the report (guarded;
  degrades to `null`).

**Config inputs — the `tableConfig` seam.** Layout records *outputs* (rendered
widths, effective `--region-scale`); the *inputs* (caps, tracks, current-phase
density, the shell mode this viewport matched) flow through the `enrich.context`
hook, never imported into the collector — the same pattern env uses for
`arrangement`/`tableScale`/`density`. The shell mounting the grid arranger sets
`enrich.context.tableConfig = { ...resolveTableConfig(cfg, phase, viewport),
reserves: { auction: auctionReservePx(), seat: rowReservePx(7) } }`, so a
config-driven bug reads input→output at a glance. Legacy a1 has no config, so
`tableConfig` is simply absent (like the other not-yet-wired shell fields).

Adding the layout block is **additive** to the bundle schema — no loader
validates the shape today (spec §9), so no `schemaVersion` bump.

## 6. Artifact bundle & repository

Dedicated **private** repo: **`bridge-craftwork/bridge-classroom-bug-artifacts`** (separate from
code repos; visible to maintainers only; lifecycle = delete-and-restart if ever
needed; scale analysis says it never will be). Privacy boundary rationale:
screenshots may contain player names and full deals; a single private repo wall
covers all artifact classes at once.

**Beetle-generated issues are created in this private repo as well** — issues
and artifacts colocated. This is forced by GitHub mechanics, not just tidiness:
inline markdown images in a *public* repo's issues cannot render from a private
repo's raw URLs (raw.githubusercontent.com does not authenticate off the
browser session), so the inline-screenshot triage experience only works with
issues and images in the same private repo.

Public-repo relationship:
- Cross-repo mentions are permission-aware: when a private bug issue references
  `bridge-classroom#123`, the backlink on the public issue is visible only to
  users with private-repo access.
- **Promotion by choice:** a bug worth public tracking gets a manually created
  public issue with sanitized title/description, linking the private issue by
  URL. Default is private; exposure is a decision, not a side effect.
- Triage across both queues: saved search
  `is:issue is:open org:bridge-craftwork label:bug-report`.

```
YYYY/MM/<issue-slug>-<timestamp>/
  context.json     # env block + ActionTape + console errors + issue back-ref
  fixture.json     # engine state, sanitized, harness-schema (or fixtures/ dir
                   #   for multi-table console reports)
  screenshot.jpg
```

- One commit **before** issue creation (so the issue body embeds final raw
  URLs); after issue creation, a second micro-commit (or Contents-API update)
  writes the issue number into `context.json`. Commit messages reference the
  issue both ways (`artifacts for #231`).
- `context.json` and `fixture.json` stay **separate files**: the fixture is
  load-bearing for the harness loader and schema-stable; context is free-form
  forensics and may grow fields. Do not merge them.
- Both files carry a top-level `schemaVersion`. No backward-compatibility
  obligation attaches to it (see §9) — it exists so future loaders can decline
  old bundles legibly instead of mis-rendering them.

## 7. GitHub issue format

Created **in the private artifacts repo** via the existing issue-creation
tooling. Body contains, in order:

1. **User narrative** (verbatim, from the dialog textarea).
2. **Environment table** — the §5 block rendered as a markdown table
   (searchable: `is:issue "arrangement: grid"` must work).
3. **Screenshot inline** (markdown image → raw URL, same repo).
4. **Layout** (§5b) — a collapsed `<details>` surfacing the highest-signal bits:
   the hand-box ancestry (width · min-width · scoped) and a **capped** anchor
   table (sel · w · minW · vars). The full block stays in `context.json`; the
   issue shows the shrink-wrap/scope story without a download.
5. **Bundle link** — one link to the bundle directory; individual links to
   `fixture.json` and `context.json`.
6. Labels: `bug-report`, `app:<name>`, `engine:<type>`, plus `phase:<phase>`.

## 8. Report dialog & privacy

- Beetle icon in the shared top-bar component, all apps. Tap → screenshot
  captured → dialog opens.
- Dialog: narrative textarea ("What went wrong?"), then a **preview pane**
  showing exactly what will be sent: the screenshot, and a plain-language
  manifest ("Your last N actions this session · the current deal state ·
  your screen size and app version · **no chat messages, no other players'
  names**"). Expandable raw view of `context.json`/`fixture.json` for the
  curious.
- Nothing transmits until the user taps Send. Cancel discards everything
  including the screenshot.
- **Full-deal capture (deliberate):** the table server no longer redacts hidden
  hands — all four hands reach the client and the GUI performs redaction. The
  fixture therefore contains the **full deal**, including cards the reporter
  could not see. This is a feature, not a leak: the primary bug class it serves
  ("I can see partner's cards") is a *redaction* bug, undiagnosable from
  pre-redacted data. The fixture holds the truth; the GUI's visibility logic is
  code under test; the harness re-runs it on load. The **context** must capture
  the redaction *inputs* — reporter's seat, capabilities, show-all-hands flags
  — so the harness renders from the same premises as the user's session.
- Privacy consequence: the preview manifest states it plainly — "the full deal,
  including cards you couldn't see, sent privately to the maintainers." The
  private artifacts repo (§6) is the boundary that makes this acceptable.
- (Adjacent, for an ADR, not this spec: server-sends-all-hands means a
  devtools-literate player can peek independent of bug reporting — an accepted
  trade for a teacher-trust classroom product; record it as chosen.)

## 9. Harness integration (the payoff)

- `/harness/report/<bundle-url-or-path>` route: fetches `fixture.json` from
  raw.githubusercontent.com (with a maintainer token — private repo) or a local
  path, loads it into the fixture engine, renders in the appropriate surface at
  the env block's viewport, scale, and arrangement. One command or URL from
  issue → looking at what the reporter saw.
- **Replay is a tool, not a contract.** Tapes and fixtures are diagnostic
  evidence captured in the schema of their day. App development carries NO
  obligation to keep old bundles loadable; a schema change that orphans past
  bundles costs one debugging avenue on (mostly closed) issues, and that cost
  is accepted in advance. The `schemaVersion` field exists solely so the loader
  can refuse stale bundles legibly ("bundle predates schema v4") rather than
  mis-render them. Do not build migration shims.
- Stepped replay (later, same non-contract status): feed the ActionTape to the
  fixture engine's stepped mode where event kinds permit — bounded goal:
  reproduce state transitions, not a full session simulator.
- Curated promotion: a reported fixture that exposes a real bug gets copied
  into the harness fixture set as a named regression scenario
  (`fixtures/from-reports/issue-231.js`) once fixed — at which point it is
  maintained like any other fixture (promotion is what confers longevity, not
  capture).

## 10. Slices

0. **Collector + local dev sink.** ReportCollector (env block + screenshot;
   tape and fixture stubs acceptable initially) with a pluggable sink
   interface. Dev sink writes the standard bundle layout to a local directory:
   primary = File System Access directory handle pointed at a gitignored
   `dev-reports/` inside the repo (picked once, permission remembered);
   fallback = single-zip download in the same layout. Gated by the dev flag,
   or shift-click on the beetle. No sanitization, no consent UI, optional
   one-line note. **On save, copy a ready-to-paste CC prompt to the clipboard**
   (same user-gesture chain; toast confirms "bundle saved + prompt copied"):
   bundle path (repo-relative, or zip path + unzip clause for the fallback),
   the quick-note inline, the env coordinates inline (viewport · arrangement ·
   scale · phase), workflow by reference to CLAUDE.md, ending "diagnose before
   changing anything." Template lives in the repo next to the sink, not inline
   in the component. Add a CLAUDE.md section: on receiving a bundle path, read
   `context.json`, load `fixture.json` via `/harness/report/`, render at the
   env block's coordinates, compare against `screenshot.jpg`. *This slice has
   zero backend and immediately upgrades the CC iteration loop from
   screenshots-and-prose to failing-state-as-data.*
1. **BeetleButton + GitHub sink** (no tape, no fixture). Same collector,
   second sink: bundle → private artifacts repo, issue creation, §5a identity
   UI. All apps get the button via the shared top bar. *Visible change, all
   apps; a1 gets the button but zero rendering changes elsewhere.*
2. **ActionTape.** Engine-boundary wrapper + ring buffer + sanitizer (GitHub
   sink only — dev sink stays unsanitized) + dialog manifest line. Contract
   tests: GitHub-bound tape never contains chat text or real names.
3. **Fixture capture, localEngine** (A1 + practice table). `captureFixture` +
   schema validation test + harness `/harness/report/` loader. Dev sink
   benefits immediately.
4. **Fixture capture, serverEngine** (tables + console, incl. multi-table
   prompt). Depends on Phase 0 server-fixture schema; coordinates with the
   capture-half of the fixture driver.
5. **Stepped-replay + curated promotion flow.** Optional/deferred.

Each slice independently shippable; a1 pixel-diff obligations apply only to
slice 1's top-bar addition (the button itself is the named visible change).
Sanitization and consent are properties of the **GitHub sink**, not the
collector — the dev sink deliberately omits both.

## 11. Acceptance (system-level)

- File a report from each app; verify: issue created in the private repo,
  searchable by env fields, screenshot renders inline, bundle committed with
  cross-references both directions; a private-issue mention of a public issue
  produces no publicly visible backlink.
- Load a filed `fixture.json` in the harness; rendered state matches the
  report screenshot (state-wise; rasterizer deltas excepted) — including the
  GUI re-running redaction from the context's visibility inputs, showing only
  what the reporter saw.
- Property tests: tape/name sanitization (no real names, no chat text);
  fixture contains the full deal on server-table reports and the context
  contains the redaction inputs; `captureFixture` output validates against
  the harness schema (current version) for every engine; loader refuses a
  bundle with an older `schemaVersion` with a legible message.
- Bundle for a console "all tables" report loads each table fixture
  individually in the harness.
