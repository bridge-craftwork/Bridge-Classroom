# Report a Problem — Design

The "Report a Problem" feature lets a learner flag a content mistake on the board
they're looking at (a wrong recommended bid, a bad hand, confusing coaching text).
A report becomes a GitHub issue filed **into the repo that owns that content**, so
the maintainer who can fix it sees it — with zero GitHub plumbing exposed to the
learner.

This document describes the system as shipped. The one piece **not** built yet —
app-level reporting — is called out at the end.

---

## Flow at a glance

```
[Report a Problem button]         MainLayout.vue      (which board? is it reportable?)
        │  openReport(e)
        ▼
[Draggable popover]               ReportProblemModal.vue   (note + anonymity/name)
        │  submitReport(payload)
        ▼
[POST ${API_URL}/report]          useReportProblem.js      (x-api-key)
        │
        ▼
[Rust route]                      reports.rs               (route by collection → repo)
        │  create GitHub issue (Bearer <org PAT>)
        ▼
[GitHub issue]                    <owning content repo>    (label: classroom-feedback)
```

**Key files**
- Button + context snapshot: [`src/views/MainLayout.vue`](../src/views/MainLayout.vue) (`openReport`, `reportEnabled`)
- Popover UI + identity: [`src/components/ReportProblemModal.vue`](../src/components/ReportProblemModal.vue)
- HTTP call: [`src/composables/useReportProblem.js`](../src/composables/useReportProblem.js)
- Collection config: [`src/composables/useAppConfig.js`](../src/composables/useAppConfig.js) (`COLLECTIONS`)
- Backend endpoint + routing: [`bridge-classroom-api/src/routes/reports.rs`](../bridge-classroom-api/src/routes/reports.rs)

---

## When the button appears — the reportability gate

The button is **content-scoped**: it only shows while a deal is loaded, and only
when the board is deemed reportable. The gate (in `MainLayout.vue::reportEnabled`):

1. The board's **collection must have a `reportRepo`** — otherwise there's nowhere
   to file, so the button is hidden. Presence of `reportRepo` is what makes a
   collection reportable at all.
2. Given that, the collection's **`report` property is a three-state override**:
   | `report` | Behavior |
   |----------|----------|
   | `true`   | Force reporting **on** for every board in the collection, regardless of release state. |
   | `false`  | Force it **off** — a kill switch. |
   | *absent* | Defer to the board's **released** flag (`deal.stable`). |
3. The **released** flag is `deal.stable`, set from the PBN's file-level
   `%bridge-classroom-stable: true` (applies to every board in the file) or a
   per-board `[Stable]` override. This is the **same flag that lets a board count
   toward mastery** — so "vetted enough to track mastery" implies "vetted enough
   to accept reports on."

### Why it's shaped this way
- **Baker Bridge** ships released content with the file-level stable flag, so its
  boards are reportable automatically — no per-collection opt-in, no per-board
  tagging. To disable it wholesale, add `report: false` to its collection entry.
- **David's coaching** (`pbs-coaching`) is curated as a set and not all of it
  carries the stable flag yet, so it opts in wholesale with `report: true`.

---

## Where a report goes — per-collection routing

A report is about a specific collection's content, so it must land in that
collection's repo. All target repos live in the **same GitHub org**
(`bridge-craftwork`), which is what lets a **single org-scoped fine-grained PAT**
write to any of them.

Routing authority is **server-side** — `reports.rs::repo_for_collection`:

| Collection id  | Repo |
|----------------|------|
| `pbs-coaching` | `bridge-craftwork/Practice-Bidding-Scenarios` |
| `baker-bridge` | `bridge-craftwork/Baker-Bridge` |
| *(fallback)*   | `GITHUB_ISSUES_REPO` (default `bridge-craftwork/Practice-Bidding-Scenarios`) |

The client sends only an **opaque collection id**, never a repo slug, so a caller
cannot redirect issues to an arbitrary repo. The frontend `reportRepo` value
mirrors this map but is used **only** as the local "is this reportable" signal;
the server map is the source of truth for the destination. **Keep the two in sync.**

---

## Reporter identity — privacy-first

Reports are anonymous by default and **never** carry an email address. Content
repos are public, so exposing a learner's email would be a privacy leak.

- A **"Report anonymously" checkbox**, defaulting to **on** for the first report.
- While anonymous, a hint invites the reporter to uncheck so a maintainer can
  follow up — surfaced *before* they uncheck, so the tradeoff is visible.
- Unchecking reveals an **editable name field**, pre-filled with the user's
  registration first name; they may replace it with an alias (max 40 chars). The
  field note reminds them it appears in the public tracking issue — so a first
  name or alias, never an email.
- The anonymity choice **and** the chosen name persist to `localStorage`
  (`bridgeReportAnonymous`, `bridgeReportName`) and become the next-time defaults.
- When a name is attached, it appears in the issue **title** (`… (from <name>)`)
  and body (`Reported by: <name>`). Only shown when a signed-in user exists
  (`context.reporterDefaultName`); anonymous/unauthenticated reports carry no name.

There is **no email path today**. A future "let an admin follow up by email"
capability would encrypt contact info with the admin's existing RSA public key
(the same E2E scheme used for observations) so it never appears in the public
repo — designed but intentionally deferred.

---

## Payload

`ReportProblemModal` merges the free-text `note` and the identity choice into the
context `MainLayout::openReport` snapshotted from the live board. Notable fields
(all optional except `note`; see `reports.rs::ReportRequest` for the full list):

- **Identity / routing:** `collection`, `reporter_tier` (learner|reviewer),
  `reporter_name` (only when opted in).
- **Lesson/board:** `lesson_id`, `lesson_name`, `scenario`, `deal_pbn`,
  `display_number`, `board_tag`, `original_board`, `board_version_token`.
- **Auction/play context:** `student_seat`, `auction`, `contract`, `step_index`,
  `prompt`.
- **Provenance:** `source_url`, `app_version`, `app_commit`.

The backend renders these into a readable Markdown issue body, with the deal PBN
in a code block, under the `classroom-feedback` label.

---

## Configuration & failure modes

- **`GITHUB_ISSUES_TOKEN`** — org-scoped fine-grained PAT, **Issues: Read/Write**
  across `bridge-craftwork`. Lives in the launchd plist `EnvironmentVariables`
  (canonical) and `.env` (dev only). Reloading requires a full
  `launchctl bootout` + `bootstrap` — `kickstart` keeps the cached value (see
  `CLAUDE.md`).
- **`GITHUB_ISSUES_REPO`** — default/fallback repo for unmapped collections.
- **`VITE_REPORT_URL`** (frontend, optional) — override the report endpoint for
  local dev; defaults to `${API_URL}/report`.
- **Not configured:** if no token is set, the endpoint returns **503**, and the
  UI degrades gracefully to "reporting isn't set up yet" — nothing breaks.
- The GitHub token is never logged or returned to the client.

---

## Not built yet — app-level reporting

Everything above is **content** reporting: it reports a problem with a *lesson
board* into a *content* repo. Problems with the **apps themselves** (a bug in the
curator, game-analysis, the lobby, etc.) have no button yet. That is a separate
surface, because:

- **Trigger/placement:** no deal is loaded, so it can't ride `openReport()`. It
  needs a global button (header/footer, or per standalone app).
- **Destination:** app bugs are about the software, so they should file into
  **`bridge-craftwork/Bridge-Classroom`** — the app repo. This needs a new
  routing entry (e.g. an `app` collection id) in `repo_for_collection`; today an
  unmapped report falls back to the *default* content repo, which would be wrong
  for an app bug.
- **Payload:** no board context; instead route/URL, app version+commit, user
  agent, and what the user was doing.

It reuses the same `/report` endpoint and the same org PAT (which already spans
all three repos) — it just needs its own button, an app-shaped payload, and that
one routing entry. **TODO.**
