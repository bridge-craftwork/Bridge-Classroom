# Bug Reporting System — Implementation Plan

**Location:** `documentation/design/bug-reporting-implementation-plan.md`
**Status:** Proposed
**Companion to:** `bug-reporting-spec.md` (the what). This is the how, grounded in
the repo as it stands on 2026-07-10.
**Also reads on:** `rendering-harness-plan.md`, `integration-roadmap.md`,
`report-a-problem.md` (the existing content-report pipeline we reuse).

> This plan translates the spec's Slice 0–5 into concrete repo work: what already
> exists and is reused, what is genuinely new, and — because this is being built
> in a **parallel worktree while the GUI/engine refactor churns on `main`** — the
> ordering that keeps the two efforts from colliding.

---

## Current-state audit (what the spec can lean on vs. what's missing)

| Spec need | Status in repo | Reuse / gap |
|---|---|---|
| GitHub-issue creation from Rust | **Exists** — `reports.rs` (`ReportRequest`, `route_for_collection`, org PAT via `GITHUB_ISSUES_TOKEN*`) | Reuse the reqwest client + token plumbing; **new** module for the bundle+issue sink (keep pipelines distinct per spec). |
| Reporter identity / consent UI + memory | **Exists** — `ReportProblemModal.vue` + `localStorage` keys `bridgeReportAnonymous` / `bridgeReportName`; identity pattern documented in `report-a-problem.md` | Adopt "verbatim" per spec §5a. Extract the identity fields into a shared piece both modals use, OR clone the pattern. **Add** the contact-email/contactable state (today's pipeline has *no* email path). |
| Engine contract (local/server/fixture) | **Exists** — `src/composables/engines/{localEngine,serverEngine,tableEngine}.js`; `capabilities`, `phase`, `wantsCall` present | Contract has **no `captureFixture()`** yet. Adding it is the one collision-prone change (see Coordination). |
| Fixture engine + harness | **Exists** — `VITE_HARNESS` routes `/harness/scene/:scene`, `TableScene.vue`, `ServerTableScene.vue`, `fixtureDriver.test.js`, fixtures in `src/harness/fixtures/*.js` | **Fixtures are JS module literals today, not schema-validated JSON.** Spec wants `fixture.json` + a schema. Resolve in Slice 3 (below). **No `/harness/report/` loader route** yet — new. |
| Screenshot / DOM rasterize | **Missing** — no `html2canvas`/`modern-screenshot` in `package.json` | New dependency (Slice 0). |
| Shared top-bar to host the beetle | **Missing** — no single shell across all four apps; MainLayout, TableHostView, TeacherConsoleView each own their chrome; the shared shell is still converging (`integration-roadmap.md`) | Mount the beetle **per-shell as a fixed-position element**, not blocked on top-bar convergence (see Slice 1). |
| Private artifacts repo `bridge-craftwork/bug-artifacts` | **Missing** — must be created; needs a PAT with Contents:write + Issues:write | Ops step before Slice 1's GitHub sink goes live. |

---

## Coordination with the parallel refactor (read first)

The other session is actively churning the engine surface (`tableEngine.js`,
`serverEngine.js`, `BiddingPracticeView`, `useTableSlots`, `TableView`) — the
apps-integration work (memory: *parallel-apps-effort* — don't flag or revert it).
Two consequences for this plan:

1. **Front-load everything that touches zero engine files.** Slices 0 and 1 (the
   collector, dev sink, screenshot, beetle button, GitHub sink, identity) are
   almost entirely **new files** plus one **new backend module** — they do not
   edit the engines and can proceed in this worktree immediately, in parallel,
   with no rebase pain.
2. **`captureFixture()` is the seam that collides.** It's a new method on the
   engine contract — exactly the file being refactored. Per Rule of Engagement #3
   (no engine-contract + component change in one PR) and to avoid fighting the
   refactor: land Slices 3/4 **after** the engine churn settles, or on a branch
   that rebases cleanly, and treat it as an explicit hand-off point with the
   other session. Until then, the dev sink runs with a **fixture stub** (spec
   §10 permits this) and still delivers value.

Net: the sequence below is **0 → 1 → 2 → (coordinate) → 3 → 4 → 5**, matching the
spec's slice numbering but with the collision boundary called out between 2 and 3.

---

## Slice 0 — Collector + local dev sink (start here; zero backend, zero engine edits)

**Highest value/lowest risk, and it directly upgrades the loop you're in right now.**

New files (all app-blind, live in a new `src/report/` lib dir):
- `src/report/ReportCollector.js` — gathers `{ env, screenshot, tape?, fixture? }`.
  Env block from §5 (app id, `version/commit` from the existing build-time vars
  used by `report-a-problem` provenance, `viewport`, `dpr`, UA, `arrangement`/
  `--table-scale`/`phase` read from the active shell). Tape and fixture are
  **stubs** this slice.
- `src/report/sinks/devSink.js` — writes the `YYYY/MM/<slug>-<ts>/` bundle
  (`context.json`, `fixture.json`, `screenshot.jpg`) via the **File System Access
  API** to a gitignored `dev-reports/` handle (picked once, permission
  remembered); **zip-download fallback** where the API is unavailable.
- `src/report/ccPrompt.js` — the ready-to-paste CC prompt **template** (spec §10):
  bundle path + quick note + env coordinates inline + "workflow per CLAUDE.md" +
  "diagnose before changing anything." Copied to clipboard on save (same
  user-gesture chain), toast confirms.
- `src/report/screenshot.js` — wraps the new rasterizer dependency.

Other:
- Add screenshot dep. **Recommend `modern-screenshot`** (actively maintained,
  smaller/faster than `html2canvas`); it's dev-loop-only until Slice 1 anyway.
- `dev-reports/` added to `.gitignore`.
- **CLAUDE.md section** (spec §10): "on receiving a bundle path, read
  `context.json`, load `fixture.json` via `/harness/report/`, render at the env
  coordinates, compare to `screenshot.jpg`."
- Gate: dev flag or **shift-click** on the beetle (the beetle element itself
  arrives in Slice 1; for Slice 0 a temporary dev-only trigger is fine).

**Done when:** a shift-click produces a bundle on disk in the standard layout and
a CC prompt on the clipboard. No sanitization, no consent, no network.

## Slice 1 — BeetleButton + GitHub sink + identity (first user-visible change)

**Frontend**
- `src/report/BeetleButton.vue` — fixed-position element (bottom-corner), mounted
  **once per shell** (MainLayout, TableHostView, TeacherConsoleView, and the
  practice-table view). *Not* blocked on top-bar convergence; when a shared shell
  lands it moves into it as a one-line relocation.
- `src/report/ReportDialog.vue` — narrative textarea + **privacy preview pane**
  (screenshot + plain-language manifest, §8) + expandable raw `context.json`.
  Capture screenshot **on beetle tap, before the dialog opens** (§4).
- `src/report/sinks/githubSink.js` — POSTs the bundle to the new backend endpoint.
- **Identity:** reuse the `ReportProblemModal` pattern verbatim (§5a). Extract the
  three-state identity control (**named / contactable / anonymous**) into
  `src/report/ReporterIdentity.vue` and have **both** modals consume it, so
  wording/memory are literally one component. **New** vs. today: the
  *contactable* state (email in the issue **body** only, never commits).

**Backend** (new module — keep distinct from `reports.rs` per spec)
- `bridge-classroom-api/src/routes/bug_reports.rs`:
  1. Sanitize (server-side is fine for the GitHub sink; the dev sink never hits
     this path).
  2. Commit bundle to `bridge-craftwork/bug-artifacts` via the Contents API
     (screenshot as base64) — **before** issue creation so the body embeds final
     raw URLs (§6).
  3. Create the issue **in `bug-artifacts`** (inline screenshot renders only
     because issue + image share the private repo — §6), body per §7, labels
     `bug-report` / `app:<name>` / `engine:<type>` / `phase:<phase>`.
  4. Second micro-commit writing the issue number into `context.json`.
- Reuse the reqwest client + token loading from `reports.rs`. **New secret**
  `BUG_ARTIFACTS_TOKEN` (fine-grained PAT: `bug-artifacts` Contents:write +
  Issues:write). Fails **closed → 503** when unset (mirror `reports.rs`), so the
  UI degrades to "reporting isn't set up." Adding the env var needs a full
  launchd `bootout`/`bootstrap` (per CLAUDE.md, `kickstart` won't pick it up).

**Ops (before this ships):** create the private `bug-artifacts` repo; mint and
install `BUG_ARTIFACTS_TOKEN`.

**Done when:** filing from any app creates an issue in the private repo with the
screenshot inline and the bundle committed both-ways-referenced; a1 gets the
button with no other rendering change.

## Slice 2 — ActionTape (semantic log)

- `src/report/ActionTape.js` — ring buffer (last 100 entries / 15 min, §2),
  entries `{t, kind, payload}` in domain vocabulary.
- **One tap** installed where the shell binds the engine (the `useTableSlots` /
  engine-binding seam) — additive, not per-app. Logs engine-boundary calls
  (`bid`, `playCard`, `undo`, `nextDeal`, seat/deal-source changes), phase
  transitions, thrown errors, and report-relevant UI events.
- **Sanitizer** (`src/report/sanitize.js`) — real names → stage names, chat text
  → `{kind:'chatSent'}` only, no coords/keystrokes. **Applied in the GitHub sink
  only**; the dev sink stays raw.
- **Contract tests:** GitHub-bound tape never contains chat text or real names.

*Light touch on the engine seam — coordinate but low collision risk (a wrapper,
not a contract change).*

## — Coordination boundary — (engine-contract changes below)

## Slice 3 — Fixture capture, localEngine (A1 + practice table)

- Add `captureFixture()` to the **engine contract**, implemented on `localEngine`:
  serialize deal + auction + play state + step-machine position + capabilities.
- **Resolve the fixture-format divergence:** fixtures are JS literals today
  (`src/harness/fixtures/*.js`), the spec wants schema-validated `fixture.json`.
  **Recommendation:** define the JSON schema *from the existing fixture shape the
  `fixtureDriver` already consumes*, so `captureFixture` emits that shape as JSON
  and the existing driver loads it unchanged — no second format. Add the schema +
  a CI **contract test**: every engine's `captureFixture` output validates
  against it, and round-trips (load reproduces rendered state).
- **New harness route** `/harness/report/:bundle` (behind `VITE_HARNESS`, next to
  the existing scene routes in `src/router/index.js`): fetch `fixture.json`
  (local path or raw URL w/ maintainer token), load into the fixture engine,
  render at the env block's viewport/scale/arrangement.
- Dev sink immediately stops stubbing the fixture.

## Slice 4 — Fixture capture, serverEngine (tables + console)

- `captureFixture()` on `serverEngine` — serialize the **client-side contract
  state** (post-mapping), plus session context (table id, seat, board). Reference
  the socket-capture log id if the Phase-0 **capture-half fixture driver** is
  active (this is the same apparatus `integration-roadmap` Phase 0.2 builds — the
  natural place to source server fixtures honestly).
- Teacher console: capture the drilled-in table; console overview prompts "which
  table?" with an "all tables" option bundling N fixtures (`fixtures/` dir).
- **Full-deal capture + redaction inputs** (§8): the server sends all four hands;
  the fixture holds the full deal, and `context.json` records the redaction
  *inputs* (seat, capabilities, show-all-hands flags) so the harness re-runs the
  GUI's redaction from the same premises. Property test per §11.
- Depends on the Phase-0 server-fixture schema — the true long pole; sequence
  after that lands.

## Slice 5 — Stepped replay + curated promotion (deferred/optional)

Feed ActionTape to the fixture engine's stepped mode where event kinds permit;
promote fixtures that exposed real bugs into `fixtures/from-reports/issue-NNN.js`
once fixed. **Replay is a tool, not a contract** (spec §9): `schemaVersion` lets
the loader refuse stale bundles legibly; no migration shims.

---

## Cross-cutting decisions to confirm (recommendations inline)

1. **Screenshot library** — recommend `modern-screenshot` over `html2canvas`
   (maintained, faster). Low stakes; dev-loop-only until Slice 1.
2. **Backend shape** — recommend a **new `bug_reports.rs` module** over extending
   `reports.rs`, keeping the app-bug pipeline cleanly distinct from content
   reports (spec is emphatic they're separate) while sharing the GitHub client.
3. **Fixture format** — recommend emitting the **existing fixture-driver shape as
   JSON** rather than inventing a parallel format, so `/harness/report/` reuses
   the driver. Formalize that shape as the schema in Slice 3.
4. **Beetle mount** — recommend **per-shell fixed-position mount** now, relocating
   into the shared top-bar if/when the integration-roadmap converges one; do not
   block bug reporting on that convergence.
5. **Hand-report migration** (spec §5a) — moving the existing content-report
   destination to `bug-artifacts` + pseudonymizing old public issues is
   **independent of all beetle slices** and can run whenever; not on this
   worktree's critical path.

## Suggested first PR from this worktree

Slice 0 in full (new `src/report/` lib + dev sink + screenshot dep + CLAUDE.md
section). It ships releasable, touches no engine or shared-component file, cannot
collide with the parallel refactor, and turns the CC bug-fix loop from
prose-and-screenshots into failing-state-as-data on day one.
