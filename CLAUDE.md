# Claude Code Notes

## Git Configuration

- Use SSH for all git operations (not HTTPS)
- Remote: git@github.com:Rick-Wilson/Bridge-Classroom.git

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
- **Local PBN files**: `/Users/rick/Development/GitHub/Baker-Bridge/Package/` (all practice lessons live here)

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
- **Discord**: https://discord.gg/e7MZ3Z5A
- **Patreon**: https://patreon.com/BridgeCraftwork
- **Email support**: bridge-craftwork@gmail.com
- **GitHub**: https://github.com/Rick-Wilson/Bridge-Classroom
- **Game Analysis webapp**: https://game-analysis.bridge-classroom.com
- **Frontend (dual deploy from same source)**: every push to `main` rebuilds both domains identically.
  - `bridge-classroom.com` → `.github/workflows/deploy.yml` → GitHub Pages.
  - `bridge-classroom.org` → Cloudflare Worker `bridge-classroom` (Workers Static Assets, dashboard-configured to track `main`).
  - Both run `npm ci && npm run build && bash scripts/build-site.sh`, publish `dist/`.
  - Worker config: `wrangler.jsonc` at repo root, `assets.directory: "./dist"`, `name: "bridge-classroom"`, `compatibility_flags: ["nodejs_compat"]`.
- **Backend API**: Rust server running locally on Mac at port 3000
- **Tunnel**: Cloudflare Tunnel routes https://api.bridge-classroom.com → localhost:3000
- **LiveKit**: `wss://livekit.bridge-classroom.com` on DigitalOcean droplet (Caddy + Docker at `/opt/livekit/`)
- **Recovery emails**: Sent from `noreply@mail.bridge-craftwork.com` via Resend (migrated from .com 2026-04-30 due to deliverability issues)
- **DNS security**: bridge-craftwork.com has SPF, DKIM (via Resend), DMARC (`p=none`) configured in Cloudflare. bridge-classroom.com SPF/DKIM/DMARC retained but no longer used for sending.
- **Database**: SQLite at `bridge-classroom-api/data/bridge_classroom.db`
- **Database backups**: Nightly at 2AM Pacific via `com.bridgeclassroom.backup` launchd job
  - Script: `bridge-classroom-api/scripts/backup-db.sh`
  - Uses `sqlite3 .backup` for safe snapshots (handles WAL correctly)
  - Local backups: `bridge-classroom-api/data/bridge_classroom_backup_YYYYMMDD.db`
  - Google Drive backups: `My Drive/Bridge Classroom/Backups/`
  - Retention: 14 most recent in each location
  - Logs: `~/Library/Logs/bridge-classroom-backup.log`
- **API logs**: `~/Library/Logs/bridge-classroom-api.log`
- **Tunnel logs**: `~/Library/Logs/cloudflared-tunnel.log`
- **Service management**: `launchctl list | grep -E "bridge|cloudflare"`
- **Restart backend**: `launchctl kickstart -k gui/$(id -u)/com.bridgeclassroom.api`
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
  4. Publish `dist/`. GitHub Actions uploads via `actions/upload-pages-artifact`;
     Cloudflare invokes `npx wrangler deploy` which reads the root
     `wrangler.jsonc` and uploads `./dist` as static assets.
- **Cloudflare Worker dashboard config** (Workers & Pages → bridge-classroom → Settings → Build):
  - Path: *(blank — repo root)*
  - Build command: `npm ci && npm run build && bash scripts/build-site.sh`
  - Deploy command: `npx wrangler deploy`
  - Production branch: `main`
- See `documentation/cloudflare-setup.md` for the broader Cloudflare/DNS picture (largely focused on `.com`/GitHub Pages).

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
- Exercises is the only tab that still renders a shared `ComingSoon` placeholder.
- The tab strip lives **only on the lobby view**, not on practice/collection screens. The header's "Lessons" and "Lobby" buttons handle returning from practice.

**Tab content components** (in `src/components/lobby/tabs/`):
- `LessonsTab.vue` — `AssignmentPanel` + `RecentLessons` (students only) + `CollectionGrid`.
- `StudentsTab.vue` — wraps `TeacherStudentList` ↔ `TeacherStudentDetail` with internal `selectedStudentId` state. Emits `navigate-to-lesson` up to `MainLayout` which then leaves the lobby and enters practice.
- `AssignmentsTab.vue` — "+ New Assignment" button + flat list of all teacher assignments (clicking opens `AssignmentDetailModal`). The backend has no archived/closed state for assignments — every classroom assignment is "open" (see [teacher_dashboard.rs](bridge-classroom-api/src/routes/teacher_dashboard.rs) `open_assignment_count: assignments.len()`).
- `ComingSoon.vue` — shared placeholder for not-yet-built tabs.
- Classrooms tab content is `TeacherLobby.vue` directly (welcome stats row + classroom cards + Needs Attention + Recent Activity).
- Admin tab content is `AdminLobby.vue` directly.

### Header Greeting

`MainLayout.vue` shows a centered "Welcome back, &lt;FirstName&gt;" greeting in the header for every authenticated user. It uses `var(--font-heading)` at 24px/700 to match the app title visually. `showWelcome` resets to `true` in `handleUserReady` (so Switch User → re-login re-triggers it) and clears on the first click anywhere inside `.app` via a `@click.capture` listener.

### SyncStatus Visibility

`SyncStatus.vue` only renders when `isOffline` or `hasError` is true. The healthy/synced/pending/syncing states are intentionally invisible — users shouldn't need to think about sync unless it's actively failing.

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
- Frontend env vars: `VITE_API_URL`, `VITE_API_KEY`
