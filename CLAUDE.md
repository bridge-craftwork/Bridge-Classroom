# Claude Code Notes

## Git Configuration

- Use SSH for all git operations (not HTTPS)
- Remote: git@github.com:bridge-craftwork/Bridge-Classroom.git
  - Repo was transferred from the personal `Rick-Wilson` account into the
    `bridge-craftwork` org on 2026-06-29 (all bridge repos were consolidated
    there). Old `Rick-Wilson/Bridge-Classroom` URLs still redirect.
- **Collaborators work directly in this org repo — no forks.** David (`ADavidBailey`)
  is an org **admin** with direct push; `main` has no branch protection. He
  retired his `ADavidBailey/Bridge-Classroom` fork on 2026-06-30 (it only ever
  drifted behind and caused "I only have pull access" confusion — a fork buys
  nothing here since no dev/staging deploy builds off it). Branch → test locally
  → push branch → PR/merge to `main` keeps both sides in sync.

## Project Context

Bridge Classroom is a bridge (card game) teaching platform with role-based dashboards, classroom management, lesson assignments, and student progress tracking.

**Tech Stack:**
- **Frontend**: Vue 3 (Composition API, `<script setup>`), Vite, plain CSS
- **Backend**: Rust (Axum 0.7), SQLite (sqlx), single-binary server
- **Deployment**: dual frontend pipeline (GitHub Pages → `.com`, Cloudflare Worker static-assets → `.org`), Cloudflare Tunnel to localhost:3000 for the API
- **DigitalOcean Droplet**: `146.190.135.172` (SSH as root with Mac's ed25519 key), runs LiveKit via Docker

---

## Division of Labor: Baker-Bridge vs Bridge-Classroom

### Baker-Bridge (Content Generation)
- Produces PBN files with ALL instructions for display and interaction
- Generates `[show ...]`, `[PLAY ...]`, `[BID ...]`, `[NEXT]` etc. directives
- Determines hand visibility from actual HTML content
- Single source of truth for lesson behavior
- **Local PBN files**: `/Users/rick/Development/GitHub/Baker-Bridge/bridge-classroom/` — the
  build's contracted export for this app, and what the Baker Bridge collection fetches
  (`useAppConfig.js`). The sibling `Package/` is a **frozen orphan** from before
  Baker-Bridge#21 Phase B; it drifted 47% of its boards out of sync before we repointed
  (issue #399). Never read or write it.

### Bridge-Classroom (Dumb Renderer)
- Reads PBN files and follows instructions exactly
- Does NOT make decisions based on presence/absence of tags
- Does NOT infer visibility from lesson type or mode
- If PBN says `[show S]`, app shows only South - no fallbacks, no defaults

### Key Principle
**The PBN provides explicit instructions; the app follows them.**

If something needs to be shown or hidden, the PBN says so explicitly. The app doesn't try to be smart about what "should" be visible based on lesson type.

---

## Deployment Architecture

- **Website**: https://bridge-classroom.com
- **Discord**: https://discord.gg/GqyyU3sVS4
- **Patreon**: https://patreon.com/BridgeCraftwork
- **Email support**: bridge-craftwork@gmail.com
- **GitHub**: https://github.com/bridge-craftwork/Bridge-Classroom (org-owned since 2026-06-29; old `Rick-Wilson/...` redirects)
- **Game Analysis webapp**: https://game-analysis.bridge-classroom.com
- **Frontend (dual deploy from same source)**: every push to `main` rebuilds both domains identically **from one GitHub Actions run** (`.github/workflows/deploy.yml`):
  - `bridge-classroom.com` → GitHub Pages (`actions/deploy-pages`).
  - `bridge-classroom.org` → Cloudflare Worker `bridge-classroom` (Workers Static Assets) via the `Deploy Worker (.org)` step (`cloudflare/wrangler-action` → `wrangler deploy`).
  - **Why one workflow, not two builders:** previously `.org` used Cloudflare's own Git build integration, which has no "latest-wins" concurrency — when two pushes landed close together it could build the first and silently skip the second, drifting `.org` behind `.com` (happened 2026-07-01). GitHub Actions' `concurrency: cancel-in-progress` guarantees the newest commit wins for both domains. **Keep the Cloudflare dashboard Git auto-build DISABLED** so this is the only Worker deploy path.
  - Requires repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Read+Write, account-scoped) and `CLOUDFLARE_ACCOUNT_ID`. The Worker deploy step self-gates on the token being present, so the `.com` deploy still works if it's ever missing.
  - Both build `npm ci && npm run build && bash scripts/build-site.sh`, publish `dist/`.
  - Worker config: `wrangler.jsonc` at repo root, `assets.directory: "./dist"`, `name: "bridge-classroom"`, `compatibility_flags: ["nodejs_compat"]`.
- **Backend API**: Rust server running locally on Mac at port 3000
- **Tunnel**: Cloudflare Tunnel routes https://api.bridge-classroom.com → localhost:3000
- **LiveKit**: `wss://livekit.bridge-classroom.com` on DigitalOcean droplet (Caddy + Docker at `/opt/livekit/`)

### Our services — all of them are ours

Every backing service this app calls is **owned by us** and runs on the same
DigitalOcean droplet behind one shared Caddy reverse proxy. None of them is a
third-party dependency, so when one misbehaves the fix is ours to make — don't
assume a vendor is in the way (that mistake cost real time on 2026-07-30).

| host | what | upstream | repo |
|---|---|---|---|
| `bba.harmonicsystems.com` | BBA bidding engine (auctions, scenarios) | `localhost:5000` | `BBA-tools/bba-server` |
| `solver.bridge-craftwork.com` | double-dummy solver (`/dd`, `/dd/play`) | `localhost:8005` | `bridge-solver-service` |
| `ben.bridge-craftwork.com` | BEN cardplay bot | `localhost:8003` | (BEN upstream + wrapper) |
| `dealer.bridge-craftwork.com` | deal generator (`/deal`) | `localhost:8001` | `bridge-dealer-service` |
| `tables.bridge-craftwork.com` | multiplayer table service (WS) | `localhost:8004` | `bridge-table-service` |
| `game-parser.bridge-craftwork.com` | club-game result parsing | `localhost:8002` | `bridge-event-parser-service` |
| `livekit.bridge-classroom.com` | LiveKit (audio) | `localhost:7880` | — |

**`bridge-craftwork-platform` is the reference repo for all of it** (private):

- `edge/Caddyfile` — the shared reverse proxy fronting every hostname above,
  including the **CORS allow lists**. This is the single place to look when a
  browser call to one of these services fails.
- `docs/runbooks/` — per-service runbooks (`new-service.md`, `deploy.md`,
  `rollback.md`, `migrate-systemd-to-container.md`, plus per-service ones).
- `docs/decisions/` — ADRs. `droplet/` — stack config. `mac/` — dev-Mac setup.
  `templates/` — copied (not referenced) when starting a new service.

⚠️ **CORS is per-service, in two different places.** dealer / solver / BEN get
their headers from the Caddyfile; **BBA emits its own** (its Caddy stanza is a
bare `reverse_proxy`), so its allow list lives in `bba-server/src/main.rs`. A
change to one does not cover the other.

**If local dev "can't finish an auction", check the port before anything else.**
The allow lists cover localhost on the vite ranges 5173-5199 / 4173-4199. Vite
takes 5173 and silently INCREMENTS when it's busy — and there are seven Vite
repos in the workspace, none pinning a port — so a second dev server lands
outside the range and every call is CORS-rejected in ~20ms. An instant rejection
with no bid coming back looks exactly like a hung service. One-shot diagnostic:

```sh
curl -s -o /dev/null -D - -X OPTIONS https://bba.harmonicsystems.com/api/auction/generate \
  -H "Origin: http://localhost:$PORT" -H "Access-Control-Request-Method: POST" \
  | grep -i access-control-allow-origin
```

No header back → that port isn't allow-listed.
- **Recovery emails**: Sent from `noreply@mail.bridge-classroom.org` via Resend (this is the live `FROM_EMAIL` in the plist / `config.rs` default — an earlier note said `mail.bridge-craftwork.com`, which is stale; verify against `config.rs`/plist before quoting). As of 2026-07-28 (PRs #335/#336) the email is **6-digit code only — the magic link was removed** (Yahoo/AOL silently filtered the button-link phishing shape post-acceptance, and the link/code shared one single-use token row so clicking the link on a phone consumed the code on the laptop). The token + token-claim endpoint + break-glass console dump are retained, and a **1h reuse grace** (`recovery_tokens.used_at` + `CLAIM_REUSE_GRACE_SECS`) now lets the same code claim on a second device within an hour.
- **DNS security**: bridge-craftwork.com has SPF, DKIM (via Resend), DMARC (`p=none`) configured in Cloudflare. bridge-classroom.com SPF/DKIM/DMARC retained but no longer used for sending.
- **Database**: SQLite at `bridge-classroom-api/data/bridge_classroom.db`
- **Database backups**: Nightly at 2AM Pacific via `com.bridgeclassroom.backup` launchd job
  - Script: `bridge-classroom-api/scripts/backup-db.sh`
  - Uses `sqlite3 .backup` for safe snapshots (handles WAL correctly)
  - Local backups: `bridge-classroom-api/data/bridge_classroom_backup_YYYYMMDD.db`
  - Google Drive backups: `My Drive/Bridge Classroom/Backups/`
  - **Tiered retention (grandfather-father-son)** — each nightly snapshot is a
    full copy; the daily is additionally *promoted* into longer-lived tiers on
    the first run of each period (so a missed night never skips a tier):
    - **daily** — 14 kept, flat in the backup root (`bridge_classroom_backup_YYYYMMDD.db`)
    - **monthly** — 3 kept, `backups/monthly/bridge_classroom_backup_YYYYMM.db`
    - **quarterly** — 4 kept (a rolling year), `backups/quarterly/bridge_classroom_backup_YYYYQn.db`
    - **annual** — kept **forever**, `backups/annual/bridge_classroom_backup_YYYY.db`
    - Same tier layout under both the local root and the Google Drive `Backups/`.
      All of `data/` (incl. `data/backups/`) is gitignored.
  - Logs: `~/Library/Logs/bridge-classroom-backup.log`
- **API logs**: `~/Library/Logs/bridge-classroom-api.log`
- **Tunnel logs**: `~/Library/Logs/cloudflared-tunnel.log`
- **Log rotation**: nightly at 3:15AM via `com.bridgeclassroom.logrotate`
  (`bridge-classroom-api/scripts/rotate-logs.sh`). Rotates the API + tunnel logs to
  `<log>.YYYYMMDD.gz`, keeps **14 days**, skips files under 1MB.
  - Added 2026-07-29 because **nothing pruned these files**: the API log had reached
    **322MB spanning Feb 5 → Jul 29** — six months of per-request lines carrying full
    User-Agents and ~130 distinct email addresses (the `/api/diagnostics` **GET** path
    puts the email in the query string, so it lands in the URI). A retention problem,
    not just a disk one.
  - **It copies and truncates rather than renaming, deliberately.** launchd opens
    `StandardOutPath` itself and holds that descriptor for the life of the process, so
    renaming the file would leave the API writing into the *moved* inode — rotation
    would look fine while the live log silently stopped growing. Truncating in place
    keeps the descriptor valid (launchd opens `O_APPEND`, so the next write lands at
    offset 0 — verified, the file does not go sparse). The tradeoff is a narrow race:
    lines written between the copy and the truncate are lost. Fine for a debug log.
  - Same change dropped the **default log level from `debug` to `info`** (`main.rs`),
    which is what actually stops the growth: at `debug`, `tower_http` emitted a line
    per request with the full URI and User-Agent. At `info` those vanish, but a
    WARN/ERROR still prints **inside its request span** — so the URI and UA are there
    exactly when something failed. `RUST_LOG=bridge_classroom_api=debug,tower_http=debug`
    restores the firehose locally.
- **Service management**: `launchctl list | grep -E "bridge|cloudflare"`
- **Deploying API changes** — ⚠️ **merging Rust code does NOT deploy it.** Unlike the
  frontend (which both domains rebuild from `main` on every push), the API is a
  **release binary** that launchd runs from
  `bridge-classroom-api/target/release/bridge-classroom-api`, and nothing rebuilds it
  automatically. A merged-but-unbuilt route 404s in production while looking perfectly
  fine in the repo and in CI. (This bit on 2026-07-23: `/api/friends` shipped to the
  frontend, but the running binary was two days old, so the Friends tab showed
  "request failed (404)".) The deploy is two steps, in this order:
  ```sh
  cd bridge-classroom-api && cargo build --release   # 1. rebuild — the step that's easy to forget
  launchctl kickstart -k gui/$(id -u)/com.bridgeclassroom.api   # 2. restart
  ```
  Verify with a route that only exists in the new build — a 404 means step 1 didn't
  happen or didn't finish. Allow a few seconds after the restart: the tunnel returns
  502 briefly while the process comes up.
- **Restart backend** (code-only changes, after rebuilding): `launchctl kickstart -k gui/$(id -u)/com.bridgeclassroom.api`
  - ⚠️ **`kickstart -k` reuses the *cached* plist** — it restarts the process but does **not** re-read `EnvironmentVariables` from disk, and dotenvy's `.env` load does **not** apply under launchd. So after changing any secret/env var (in the plist *or* `.env`), a `kickstart` will silently keep the old/empty value. To pick up env changes you must fully reload the job:
    ```sh
    launchctl bootout   gui/$(id -u)/com.bridgeclassroom.api
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
    ```
  - The plist's `EnvironmentVariables` dict is the **canonical** source of every live secret (API_KEY, RECOVERY_SECRET, RESEND_API_KEY, GITHUB_ISSUES_TOKEN, ADMIN_SECRET, …). `.env` is for `cargo run` dev only and is **not** reliably read by the launchd-run binary. Keep the two in sync, but treat the plist as authoritative.
  - **`ADMIN_SECRET`** gates the dangerous **ops-only** admin endpoints — `POST /api/admin/decrypt-observations` and `POST /api/admin/backfill-active-time` (both mass-decrypt every E2E observation via `RECOVERY_SECRET`). Unlike the shared `API_KEY` (which is baked into the frontend bundle and **not secret**), `ADMIN_SECRET` lives **only** in the plist and is sent as an `x-admin-secret` header. The `require_admin` guard (`routes/admin.rs`) fails **closed** (503) when it's unset and returns 401 on a bad/missing header — so those endpoints are locked unless the secret is configured. There is deliberately **no frontend UI** for these (the old in-app "Decrypt Observations" button was removed); run them via `curl` with both `x-api-key` and `x-admin-secret`. Adding/rotating `ADMIN_SECRET` needs a full `bootout`/`bootstrap` (a `kickstart` won't pick up a new env var).
- **Report a Problem endpoint** (`POST /api/report`, issue #30): a learner's "Report a Problem" button (coached lessons) POSTs here; the Rust route ([reports.rs](bridge-classroom-api/src/routes/reports.rs)) files a `classroom-feedback` GitHub issue in the **content repo**.
  - **Per-collection (repo, token) routing** (`route_for_collection` in reports.rs): each report is filed into the content repo that owns it **under a PAT owned by that repo's maintainer**, so the *maintainer is the GitHub issue author*. This matters for notifications — GitHub doesn't email you about your own actions, so authoring reports under the maintainer's PAT keeps them from being spammed by watcher-emails for reports on their own content. (Regression that prompted this: after multi-repo routing briefly used one shared org token, every report was authored by Rick, so David started getting a GitHub email for every PBS report — because he watches the repo but was no longer the author. Not us sending mail; pure GitHub notification.)
    - `pbs-coaching` → `bridge-craftwork/Practice-Bidding-Scenarios`, signed by **`GITHUB_ISSUES_TOKEN_PBS`** (David's PAT; no expiration).
    - `baker-bridge` → `bridge-craftwork/Baker-Bridge`, signed by **`GITHUB_ISSUES_TOKEN`** (Rick's default PAT).
    - unknown/absent collection → **`GITHUB_ISSUES_REPO`** (defaults to `bridge-craftwork/Bridge-Classroom`, Rick's — a mis-tagged report shouldn't land on David), signed by the default token.
  - Each collection's token **falls back to `GITHUB_ISSUES_TOKEN`** when its own is unset (so PBS reporting still works, just authored by Rick, if David's PAT is missing). The **503** "reporting isn't set up" gate is on the *selected* token being absent (and no default) — graceful, not broken.
  - PATs are fine-grained, Issues:read+write, each scoped to the repos its collection targets. All secrets live in the launchd plist `EnvironmentVariables` (canonical). **Adding `GITHUB_ISSUES_TOKEN_PBS` requires a full `bootout`/`bootstrap`** of the job — a `kickstart -k` won't pick up a new env var.
  - Frontend path: `${API_URL}/report` → resolves to `/api/report` (`API_URL` already includes `/api`). 503→`not_configured` message handled in [useReportProblem.js](src/composables/useReportProblem.js).
- **Build & deploy frontend**: just `git push origin main`. Both domains
  rebuild themselves from source. Do **not** run
  `npx vite build && cp -r dist/* docs/` — that legacy flow is what
  caused `.org` to silently drift behind `.com` for weeks before it was
  caught. `docs/assets/` and `docs/solo-practice-app/` are gitignored
  for the same reason.
- **Local preview** of the published site:
  `npm run build && bash scripts/build-site.sh && npx serve dist`.
  This produces the exact tree both domains serve.
- **Build pipeline** (identical on GitHub Actions and Cloudflare):
  1. `npm ci`
  2. `npm run build` — Vite builds the SPA into `dist/`, with
     `dist/index.html` as the SPA entry and chunks under `dist/assets/`.
  3. `bash scripts/build-site.sh` — moves `dist/index.html` →
     `dist/solo-practice-app/index.html`, then copies the static landing
     pages and assets from `docs/` into `dist/`. Idempotent. Logs
     `==== build-site.sh: START / DONE ====` markers so failures are
     obvious in deploy logs.
  4. Publish `dist/`. The **one** GitHub Actions run uploads to Pages (`.com`) via
     `actions/upload-pages-artifact` **and** deploys the Worker (`.org`) via the
     `Deploy Worker (.org)` step (`wrangler deploy`, reading root `wrangler.jsonc`,
     uploading `./dist` as static assets).
- **Cloudflare Worker dashboard config** — **superseded 2026-07-01.** The Worker
  is now deployed from GitHub Actions (above), and the dashboard Git build should
  stay **disabled**. (Historical, if you ever re-enable it: Workers & Pages →
  bridge-classroom → Settings → Build — Path *(blank)*, Build
  `npm ci && npm run build && bash scripts/build-site.sh`, Deploy
  `npx wrangler deploy`, Production branch `main`. But don't — two builders is
  exactly what caused the `.org` drift.)
- See `documentation/cloudflare-setup.md` for the broader Cloudflare/DNS picture (largely focused on `.com`/GitHub Pages).

### Frontend deploy notes & gotchas (org transfer, 2026-06-29)

The repo moved from `Rick-Wilson` to the `bridge-craftwork` org. The two deploy
pipelines survived, but several things bit and are worth remembering:

- **`.com` GitHub Pages is owned by `bridge-craftwork/Bridge-Classroom`.** Pages
  source is **GitHub Actions** (`build_type: workflow`), not branch-based.
  Custom domain is `bridge-classroom.com`.
- **Org-level domain verification strips the custom domain from other accounts.**
  Verifying `bridge-classroom.com` under the `bridge-craftwork` org immediately
  detached it from the (then personal-account-owned) repo's Pages, 404-ing `.com`.
  A verified org domain cannot be used by a Pages site in any other account. The
  fix was to serve `.com` from an org-owned repo (i.e. complete the transfer).
- **The committed CNAME file does NOT re-attach the domain for Actions-based
  Pages.** `public/CNAME` only sets the domain for *branch*-based Pages. For the
  Actions deploy the custom domain must be set in repo settings / via
  `PUT /repos/bridge-craftwork/Bridge-Classroom/pages -f cname=bridge-classroom.com`.
- **"Enforce HTTPS" is unavailable on GitHub — and that's expected/fine.** The
  domain is Cloudflare-proxied (orange cloud), so GitHub can't run its cert
  challenge. Cloudflare terminates TLS with its own valid cert and already
  301-redirects http→https. Leave GitHub's box unchecked; HTTPS is handled at the
  Cloudflare edge. Keep Cloudflare SSL/TLS mode on **Full** (not Flexible, not
  Full-strict — strict breaks because GitHub's origin cert won't match the
  custom domain).
- **DNS CNAME target does not need to change on transfer.** `bridge-classroom.com`
  is a proxied CNAME → `rick-wilson.github.io`; it still serves because GitHub
  Pages routes by `Host` header and `rick-wilson.github.io` resolves to the same
  shared Pages IPs as `bridge-craftwork.github.io`. Updating it to
  `bridge-craftwork.github.io` is optional hygiene.
- **`.org` Cloudflare Worker GitHub App must be (re)installed on the org.** After
  transfer the Worker's Git build connection broke ("internal issue with your
  Git installation"). Fix: disconnect, then reconnect, authorizing the
  "Cloudflare Workers and Pages" GitHub App for the `bridge-craftwork` org with
  access to `Bridge-Classroom`. The live `.org` Worker keeps serving its edge
  build throughout — only auto-builds pause until relinked. Manual deploy
  fallback: `npm run build && bash scripts/build-site.sh && npx wrangler deploy`.

### Directory Conventions

- **`docs/`** — Source for the static landing pages (`index.html` hub, plus per-tool detail pages) and the per-app subdirectories like `docs/curator/` and `docs/bidding-practice/` (the tiny redirect into the SPA route). **Not** served directly to either domain — `scripts/build-site.sh` copies the relevant files into `dist/` alongside the Vite-built SPA at deploy time. `docs/assets/` and `docs/solo-practice-app/` are gitignored; if they show up here they're stale relics from the legacy `cp -r dist/* docs/` flow.
- **`dist/`** — Build output. Gitignored. Produced fresh per deploy by `npm run build && bash scripts/build-site.sh`. This is what both `.com` and `.org` publish.
- **`scripts/build-site.sh`** — The shared post-build restructure step. Single source of truth for the published layout — both `.github/workflows/deploy.yml` and the Cloudflare Worker call it.
- **`wrangler.jsonc`** (repo root) — Cloudflare Worker config for the `.org` deploy. `assets.directory: "./dist"`. Do not move into `docs/`.
- **`documentation/`** — Project documentation, design specs, mockups, and reference material. Not published to either domain.
- **`tools/`** — Local-only admin utilities (gitignored). May contain secrets — never commit.

### Preview Site (Static Landing Pages)

The `docs/` directory contains the static landing-page sources that `scripts/build-site.sh` copies into `dist/` at deploy time. These pages share `docs/styles.css` for design tokens and `docs/favicon.svg` (green spade) for the tab icon.

- **`docs/index.html`** — Hub page with tile grid organized by audience: "For students", "Teacher resources", "Author tools". Each tile links to a detail page or directly into the SPA.
- **Detail pages**: `solo-practice.html`, `bbo-scenarios.html`, `game-analysis.html`, `classrooms.html`, `hand-curator.html`, `deal-library.html`, `lesson-materials.html`, `teacher-utilities.html`, `bidding-practice.html`, `about.html`. Add new ones here AND extend the `cp` list in `scripts/build-site.sh`.
- **`docs/screenshots/`** — Real app screenshots used on detail pages (no fake browser chrome — displayed as clean panels with captions).
- **Design notes**: Tiles are 260px wide with 14-16px body text for senior/super-senior readability. All detail pages use a consistent two-column layout (description left, screenshots right) with a shared `.screenshot` style.
- **Footer links**: GitHub, Discord, Email support, Patreon, About.
- **Cross-domain branding**: `docs/site.js` rewrites visible `bridge-classroom.com` strings to `bridge-classroom.org` on the fly when served from the `.org` host, so the same HTML serves both domains without a duplicate build.

### API Security Notes

- The shared API key (`VITE_API_KEY`) is baked into the frontend JS bundle and is **not secret**. It only filters casual misuse.
- Observation data is protected by E2E encryption regardless of API key exposure.
- `GET /api/users` currently returns all users to any caller with the API key — a privacy concern.
- **Planned improvement**: Replace shared API key auth with RSA-signed requests for teacher/viewer endpoints. Teachers sign requests with their existing RSA private key; backend verifies against stored public key. This provides per-user auth with no new infrastructure, and scopes data access to only users the viewer has grants for.

---

## Reading a bug-report bundle (dev sink)

The dev-only **beetle** (🐞, bottom-right, dev builds only) captures the app's
failing state as a **bundle** and copies a ready-to-paste prompt to the clipboard
pointing here. Design: [documentation/design/bug-reporting-spec.md](documentation/design/bug-reporting-spec.md)
+ [implementation plan](documentation/design/bug-reporting-implementation-plan.md).
Library: [src/report/](src/report/). This is Slice 0 — local only, no GitHub yet.

When handed a bundle path (`dev-reports/YYYY/MM/<slug>-<ts>/`, gitignored):

1. **Read `context.json` first** — the env block (`app`, `commit`, `viewport`,
   `route`, and later `arrangement`/`scale`/`phase`), the reporter's `note`, and
   (once Slice 2 lands) the action `tape`. This is the forensic record.
2. **`fixture.json`** is the engine state. **Stubbed until Slice 3/4** — until
   then it just says so; don't expect loadable state yet.
3. **`screenshot.jpg`** is what the reporter saw (approximate rendering — the
   rasterizer is not pixel-exact; the fixture is ground truth once it exists).
4. Once the harness `/harness/report/` loader exists (Slice 3), load
   `fixture.json` there at the env block's coordinates and compare to the
   screenshot. Until then, reason from `context.json` + the screenshot.
5. **Record your verdict in `adjudication.md`** (scaffolded beside the evidence
   with `status: open`): set `status` (`resolved`/`wontfix`/`duplicate`/
   `rolled-into`/…), a one-line `resolution`, `refs` (PRs/issues/commits), and
   append the diagnosis + decision to the **Narrative**. **Never edit
   `context.json`** — it's the immutable evidence.

**Diagnose before changing anything.** The single-file fallback (`*.bundle.json`,
used when the File System Access API is unavailable) inlines all three as one JSON
with the screenshot as a data URL.

---

## Application Architecture

### Role-Based Lobby Tabs

Users have one of three roles: `student`, `teacher`, `admin`. The lobby (`src/views/LobbyView.vue`) renders a tab strip under the header and switches the tab content based on the active tab. Tabs visible per role:

| Tab | Student | Teacher | Admin |
|-----|:-:|:-:|:-:|
| Lessons | ✓ | ✓ | ✓ |
| Students |   | ✓ | ✓ |
| Classrooms |   | ✓ | ✓ |
| Assignments |   | ✓ | ✓ |
| Exercises |   | ✓ | ✓ |
| Convention Card | ✓ | ✓ | ✓ |
| Admin |   |   | ✓ |

- Default tab: **Classrooms** for teacher/admin, **Lessons** for student.
- When a role only has a single visible tab, the tab strip itself is hidden (`LobbyView` only renders `<LobbyTabs>` when `visibleTabs.length > 1`).
- `ComingSoon.vue` exists as a shared placeholder but no tab currently uses it — it's kept for future tabs. The Exercises tab now renders `TeacherExercisesTab.vue` (issue #15).
- The tab strip lives **only on the lobby view**, not on practice/collection screens. The header's "Lessons" and "Lobby" buttons handle returning from practice.

**Tab content components** (in `src/components/lobby/tabs/`):
- `LessonsTab.vue` — `AssignmentPanel` + `RecentLessons` (students only) + `CollectionGrid`.
- `StudentsTab.vue` — wraps `TeacherStudentList` ↔ `TeacherStudentDetail` with internal `selectedStudentId` state. Emits `navigate-to-lesson` up to `MainLayout` which then leaves the lobby and enters practice.
- `AssignmentsTab.vue` — "+ New Assignment" button + flat list of all teacher assignments (clicking opens `AssignmentDetailModal`). The backend has no archived/closed state for assignments — every classroom assignment is "open" (see [teacher_dashboard.rs](bridge-classroom-api/src/routes/teacher_dashboard.rs) `open_assignment_count: assignments.len()`).
- `TeacherExercisesTab.vue` — issue #15. Lists exercises filtered to `created_by = currentUser`, supports create/edit/delete via `ExerciseEditorModal.vue`. The modal pickers source boards from the `bakerBridgeTaxonomy` `dealCount`, so the lobby never has to ask the backend "what boards exist in lesson X." Wilderness preview uses `src/utils/wilderness.js`, a JS mirror of `derive_wilderness()` in `board_status.rs`. Backend enforces soft-delete (`exercises.deleted_at`), per-creator ownership on PUT/DELETE, and per-creator creation quotas (100/30-days, 1000 lifetime).
- `ComingSoon.vue` — shared placeholder for not-yet-built tabs.
- Classrooms tab content is `TeacherLobby.vue` directly (welcome stats row + classroom cards + Needs Attention + Recent Activity).
- Admin tab content is `AdminLobby.vue` directly.

### Header Greeting

`MainLayout.vue` shows a centered "Welcome back, &lt;FirstName&gt;" greeting in the header for every authenticated user. It uses `var(--font-heading)` at 24px/700 to match the app title visually. `showWelcome` resets to `true` in `handleUserReady` (so Switch User → re-login re-triggers it) and clears on the first click anywhere inside `.app` via a `@click.capture` listener.

### SyncStatus Visibility

`SyncStatus.vue` only renders when `isOffline` or `hasError` is true. The healthy/synced/pending/syncing states are intentionally invisible — users shouldn't need to think about sync unless it's actively failing.

### Cardplay Bots

The frontend's pluggable bot interface lives in [src/utils/cardplayBots.js](src/utils/cardplayBots.js): every bot implements async `chooseOpeningLead(ctx)` / `chooseCard(ctx)` and must return a member of `ctx.legalCards`. Current adapters:

- **RandomLegalBot** — instant, uniform over legal cards; the dev/fallback bot.
- **BenBot** — wraps `benClient.js` HTTP calls to the BEN service (~20s cold start, ~500ms warm).

The server-side twin is `bridge-table-service/src/bots.rs` (BBA bidding + BEN cardplay + RandomLegal fallback) for bot seats at multiplayer tables.

**`bridge-rulebot`** (sibling Rust repo, github.com/bridge-craftwork/bridge-rulebot) is the in-between bot: deterministic rule-based cardplay — opening leads, second-hand-low/third-hand-high, and defensive signals (attitude/count, standard or upside-down) — where every decision returns a reason code + student-facing explanation, plus `legal_count` and `duration_micros`. It's stateless (full play history passed each call). The table service consumes it natively (dependency wired 2026-07-02; bots.rs integration pending); this frontend will consume it via a planned `bridge-rulebot-wasm` wrapper adapted to the `cardplayBots.js` interface. Requirements + architecture live in that repo's `docs/`.

### Convention Card

Issue #8 Phase 1. A single Vue view ([src/views/ConventionCardView.vue](src/views/ConventionCardView.vue)) mounts at two places: standalone route `/convention-card` (no auth required — falls back to the public "2/1 Intermediate" system card) and inline as the Convention Card lobby tab via `<ConventionCardView embedded />`. The view is read-only in Phase 1; Phase 2 makes it editable.

**Data flow**:
1. [src/utils/conventionCatalog.js](src/utils/conventionCatalog.js) is the presentation catalog of conventions — each entry maps a dotted `card_data` path to a display name, description, section, and underlying `skillPath`.
2. [src/utils/bakerBridgeTaxonomy.js](src/utils/bakerBridgeTaxonomy.js) maps every skill path to its lesson, deal count, and **skill level** (`basic` / `intermediate` / `advanced` / `expert`). `level` is a first-class property of the skill, intended to spread across the site (lesson browser filters, progress views, etc.) — not specific to the convention editor.
3. [src/composables/useConventionCard.js](src/composables/useConventionCard.js) loads the user's primary card (or the public system card for unauthed visitors) and the lesson-mastery map, then computes per-entry status (covered? checked? user's tier?).
4. Tier → proficiency mapping: `Mastering`/`Retaining` → "Proficient" (green), `Learning` → "Practicing" (amber), `Exploring` → "Learning" (peach), no observations → "Not started" (grey).

**Subfolder/PBN basename join**: the lesson-mastery endpoint keys by `deal_subfolder`; the taxonomy keys by skill_path with a `pbn` filename. We bridge them via `getSubfolderForSkill(skillPath)` in `bakerBridgeTaxonomy.js`, which strips `.pbn`. If any lesson ever stores a subfolder that diverges from its PBN basename, promote `subfolder` to an explicit field on the taxonomy entry.

**Visual structure** (matches the user's prototype at `/Users/rick/Desktop/bridge_convention_card_editor_v3.html`):
- Header with card title + subtitle + Save/Export buttons (disabled in Phase 1).
- Control bar with `SHOW` skill-level pills (multi-select; default `{basic}`) and `OVERLAYS` toggles for "Solo practice coverage" and "My proficiency".
- Two-column grid: left section tree with `selected/total` counts, right detail panel (structured fields + conventions list).
- Footer with `N conventions selected` + last-saved timestamp.

### User Role Sync

- User data (including role) is cached in localStorage (`bridgePractice` key)
- On app startup, `syncRole()` in `useUserStore.js` fetches the server-side role via `GET /api/users/:user_id` and updates localStorage if it changed
- `checkTeacherStatus()` in `useTeacherRole.js` only upgrades `student` → `teacher`, never downgrades `admin`

### Classroom & Assignment System

- **Classrooms**: Teachers create classrooms with auto-generated join codes (format: `BRG-XXXX`). Students join via `/join/:code` URL.
- **Exercises**: Teachers create exercises from lesson collections. Each exercise has boards from `exercise_boards` table.
- **Assignments**: Link an exercise to a classroom with an optional due date. Progress is computed server-side from observations.

### Dashboard Architecture

**Teacher Dashboard** (`GET /api/teacher/dashboard?teacher_id=X`):
- Single aggregated endpoint returning all dashboard data in one round-trip
- Classrooms with per-assignment completion stats
- "Needs Attention" items: `due_soon`, `low_score`
- "Recent Activity" events: `assignment_completed`, `student_joined`
- Two-column layout (classrooms left 3fr + attention/activity right 2fr) — rendered inside the Classrooms tab
- A summary row above the grid shows `N classrooms · N students · N open assignments` (sourced from `useTeacherDashboard.summaryStats`)

**Admin Dashboard** (`GET /api/admin/stats`, `GET /api/admin/health`):
- Stats: total users, 7-day active, observation counts, popular lessons, DB table sizes
- Health: uptime (from `AppState.started_at`), disk space, DB writable, API version

---

## Key Files

### Frontend Structure
```
src/
├── views/
│   ├── MainLayout.vue          # Top-level app shell, route orchestration, header greeting
│   ├── LobbyView.vue           # Tab orchestrator (visible tabs by role, active tab content)
│   ├── ConventionCardView.vue  # Convention Card editor / viewer (Phase 1 read-only)
│   └── JoinClassroomView.vue   # /join/:code handler
├── components/
│   ├── conventionCard/
│   │   ├── CardTree.vue        # Left-pane section list with selected/total
│   │   ├── CardDetail.vue      # Right-pane structured fields + conventions list
│   │   ├── ConventionRow.vue   # Single convention row with overlays
│   │   ├── SkillPills.vue      # Multi-select skill-level filter
│   │   └── OverlayLegend.vue   # Legend strip for coverage/proficiency overlays
│   ├── lobby/
│   │   ├── LobbyTabs.vue       # Tab strip — emits update:active
│   │   ├── TeacherLobby.vue    # Classrooms-tab content (summary row + dashboard grid)
│   │   ├── AdminLobby.vue      # Admin-tab content (stats, health, popular lessons)
│   │   ├── ClassroomCard.vue   # Expandable classroom card with completion bars
│   │   ├── NeedsAttention.vue  # Teacher attention alerts
│   │   ├── RecentActivity.vue  # Teacher activity feed
│   │   ├── AdminStatsRow.vue   # Admin metric cards
│   │   ├── PopularLessons.vue  # Admin lesson table
│   │   ├── DatabasePanel.vue   # Admin DB stats
│   │   ├── SystemHealth.vue    # Admin health indicators
│   │   ├── CollectionGrid.vue  # Lesson collection browser
│   │   ├── ClassroomCreateModal.vue / AssignmentCreateModal.vue
│   │   └── tabs/
│   │       ├── LessonsTab.vue       # AssignmentPanel + RecentLessons + CollectionGrid
│   │       ├── StudentsTab.vue      # TeacherStudentList ↔ TeacherStudentDetail
│   │       ├── AssignmentsTab.vue   # + New Assignment + open assignments list
│   │       └── ComingSoon.vue       # Placeholder for not-yet-built tabs
│   ├── BridgeTable.vue         # Main card table rendering
│   ├── BiddingBox.vue          # Bidding input
│   └── ...                     # Other game components
├── composables/
│   ├── useUserStore.js         # User management (localStorage + server sync)
│   ├── useTeacherDashboard.js  # Teacher lobby data (classrooms, attention, activity)
│   ├── useAdminDashboard.js    # Admin stats and health
│   ├── useTeacherRole.js       # Legacy teacher/student grant-based role check
│   ├── useClassrooms.js        # Classroom CRUD
│   ├── useExercises.js         # Exercise CRUD
│   ├── useAssignments.js       # Assignment CRUD + student progress
│   ├── useDataSync.js          # Observation sync to server
│   ├── useObservationStore.js  # Local observation storage
│   ├── useDealPractice.js      # Core practice state machine
│   └── useBoardMastery.js      # Board mastery computation
└── utils/
    ├── pbnParser.js            # PBN file parsing
    ├── crypto.js               # E2E encryption for sharing grants
    └── cardFormatting.js       # Card display utilities
```

### Backend Structure
```
bridge-classroom-api/src/
├── main.rs                     # Axum server setup, routes, AppState
├── routes/
│   ├── users.rs                # User CRUD + single-user lookup
│   ├── classrooms.rs           # Classroom CRUD, join, members
│   ├── exercises.rs            # Exercise + board management
│   ├── assignments.rs          # Assignment CRUD + progress
│   ├── teacher_dashboard.rs    # Aggregated teacher dashboard
│   ├── admin.rs                # Admin stats + health
│   ├── observations.rs         # Observation ingestion + query
│   ├── recovery.rs             # Account recovery flow
│   └── ...                     # grants, viewers, keys, auth, cards
├── models/
│   ├── user.rs                 # User, UserInfo, CreateUserRequest
│   └── ...                     # Other model definitions
└── config.rs                   # Environment configuration
```

### Database Tables
Core tables: `users`, `observations`, `classrooms`, `classroom_members`, `exercises`, `exercise_boards`, `assignments`

---

## Composable Pattern

All composables use the **singleton pattern** — state is declared at module scope (outside the exported function) so it's shared across all component instances:

```javascript
const myState = ref([])  // Module-level singleton

export function useMyComposable() {
  return { myState, /* methods */ }
}
```

---

## Key Implementation Details

- Classrooms are dynamic via URL parameters, not hardcoded
- Users can belong to multiple classrooms
- Assignments/homework are tracked with server-side completion progress
- URL params silently merge with existing config on revisit
- Hand visibility driven by `[show ...]` tags from PBN, not inferred
- API key header: `x-api-key` on all authenticated endpoints
- Frontend env vars: `VITE_API_URL`, `VITE_API_KEY`, `VITE_SOLVER_URL`,
  `VITE_BBA_URL` — each defaulting to the matching host in the services table
  above (see §Our services for the full list + the platform repo).
- Double-dummy: `src/utils/ddsClient.js::fetchDoubleDummy` POSTs the deal to our
  self-hosted `bridge-solver-service` (`VITE_SOLVER_URL`, default
  `https://solver.bridge-craftwork.com`) and returns the raw 20-char `ddtricks`
  string. It replaced the third-party bridgewebs BSOL call and is a verified
  byte-for-byte drop-in — strain order is **NT-first** `[NT,S,H,D,C]`, parsed by
  `ddTrickAt`/`buildDdRows`. DD is best-effort: `null` on any failure, never
  load-bearing.
