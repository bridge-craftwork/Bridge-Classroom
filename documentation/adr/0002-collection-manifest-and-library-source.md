# ADR-0002 — Build-Generated Collection Manifest + Pluggable Library Source

**Status:** Accepted 2026-07-08 (Rick + David, as co-developers of PBS). Amends the
[Collection Producer Contract](./collection-producer-contract.md) with a new **R5**
(now folded into that document).

**Supersedes/extends:** builds directly on [ADR-0001 — Positional board
identity](./0001-positional-board-identity.md) and its
[companion spec](./board-identity-and-history-integrity.md). Nothing here changes
the identity model; it changes *how the backend learns a collection's shape*.

---

## 0. The one-paragraph version

Every collection publishes one **build-generated manifest** — Baker Bridge adopts
the same manifest format David's Practice-Bidding-Scenarios already emits. The
manifest becomes the **authoritative roster** of a collection: for each lesson
(keyed by PBN basename = `deal_subfolder`), the list of boards with their number,
`stable` flag, `[BoardVersionToken]`, and skill path. The backend consumes it
through a **`LibrarySource` abstraction** — GitHub-raw polling is the first
implementation, but the interface admits future stores (Google Docs, object
storage, local files) without touching the routes that use the data. Change
detection uses the manifest's own version stamp (`generatedAtCommit`) plus HTTP
conditional GETs; no GitHub "watch" subscription is required. The backend gains a
small **collection registry** (Rust config) describing *where* each collection is
served from — consolidating the location knowledge that today is hardcoded in one
spot (`reports.rs`) and duplicated in the frontend's `COLLECTIONS[]`.

---

## Scope — persistence is the dividing line

The manifest / `LibrarySource` mechanism in this ADR governs **only collections
whose results are persisted** to the Bridge Classroom database. The invariant:

> **The backend knows about a collection if and only if results from it are
> persisted.**

Non-persisting surfaces — the teaching console, casual play tables, random/paste
deal entry, and **private repos** (e.g. an instructor's unreleased ABS set) — are
**frontend deal sources**. They require no backend source information: no
`LibrarySource` entry, no server-fetched manifest, no `collection_id`, no roster.
The backend never reads them.

The invariant is enforced in the **"no accidental writes"** direction: those
surfaces emit **no observations**, and the backend rejects any observation whose
`collection_id` is not a known persisted collection (defense in depth). Because
nothing persists, unreleased or licensed content (ABS) never reaches our database
*by construction* — the IP guarantee falls out of the architecture; it is not a
policy anyone has to remember to apply.

A non-persisting deal source MAY still ship a **manifest** — but a lighter one, for
frontend menu presentation only (layout + lesson names + display counts), with
**no board-version tokens, no `stable`/prerelease, and no positional-freeze
obligation**. Those exist solely to protect persisted history, so they do not bind
a source whose results are never saved. See the
[Non-Persisting Deal Source Contract](./non-persisting-deal-source-contract.md).

---

## 1. Context — what the backend knows today, and why it's thin

Today the backend has **no authoritative board count and no server-side view of a
board's release status.** Two facts drive this ADR:

1. **Sizing is inferred, never declared.** A lesson's board count is computed as
   `COUNT(DISTINCT deal_number)` across *all* users
   (`lesson_mastery.rs`), so a lesson's "size" is only as large as the union of
   boards anyone has happened to play. Mastery denominators understate until
   coverage fills in. Wilderness (`derive_wilderness`) counts only the boards a
   teacher put in a specific exercise, never the true PBN size. The lesson catalog
   "grows lazily as boards are encountered" — by design, but the design is weak.

2. **Release status is *client-asserted*.** The producer declares `stable` in the
   PBN, but **nothing on the backend reads the PBN.** The browser computes
   `prerelease = deal.stable !== true` and sends it per observation
   (`observationSchema.js`). The backend stores and trusts that flag
   (`observations.prerelease`, mirrored onto `board_status`). A modified or
   malicious client could mislabel prerelease boards as stable and pollute
   platform mastery stats. ADR-0001's default-deny mitigates the *forgot-the-flag*
   case, but the trust boundary is still the client.

Meanwhile the frontend already fetches a **whole-collection manifest** for PBS
(`fetchScenarioManifest`, one fetch, carries `schemaVersion` + `generatedAtCommit`
+ layout + per-scenario metadata) — but it carries **no sizing** and Baker Bridge
has **no equivalent** (it uses a differently-shaped `toc.json` plus a hand-
maintained static `dealCount` table that can drift). So there are two collections,
two metadata contracts, and three parallel sizing sources (static table, runtime
PBN parsing, backend `COUNT(DISTINCT)`), none authoritative.

## 2. Decision

### D1 — One manifest format, produced by every collection's build

Baker Bridge's build gains a manifest generator emitting the **same schema** PBS
uses. The manifest is a build artifact (not a PBN), regenerated every build, and is
the single authoritative description of a collection's shape. This unifies the two
collections onto one contract and lets consumer code be written once.

### D2 — The manifest carries the authoritative board roster

Extend the manifest schema with a per-lesson roster. For each lesson (keyed by PBN
basename, which is exactly the `deal_subfolder` BC stores on observations), the
manifest lists every board with:

| Field | Purpose |
|---|---|
| `number` | positional identity (ADR-0001); denominators use the real roster, not `COUNT(DISTINCT)` |
| `stable` | **authoritative** release status — replaces the client-asserted `prerelease` flag as the source of truth |
| `boardVersionToken` | the producer's rotation-canonical stamp (contract R3); lets BC detect content change passively |
| `skillPath` | classification (contract R4) — already required before `stable=true` |

Derived roll-ups (`boardCount`, `stableBoardCount`) MAY be precomputed in the
manifest for convenience but are not load-bearing — the roster is ground truth.

This makes **board count** and **release status** server-authoritative. Mastery
denominators become correct immediately (before coverage fills in), and prerelease
exclusion no longer depends on trusting the client. The per-observation
`prerelease`/`board_version_token` columns still flow (they're cheap and keep
observations self-contained per ADR-0001), but the backend now has an authoritative
roster to reconcile them against rather than treating the client as the origin.

### D3 — The backend consumes manifests through a `LibrarySource` abstraction

Mirror the existing pluggable-bot pattern (`cardplayBots.js` / `bots.rs`): the
routes never talk to GitHub directly. They talk to a trait:

```rust
#[async_trait]
trait LibrarySource {
    /// Cheap change-detection: return an opaque version token
    /// (e.g. commit sha / ETag) without downloading the whole manifest.
    async fn current_version(&self, collection: &CollectionId) -> Result<VersionToken>;

    /// Fetch and parse the full manifest for a collection.
    async fn fetch_manifest(&self, collection: &CollectionId) -> Result<Manifest>;
}
```

First implementation: `GitHubRawSource` (raw.githubusercontent + conditional GET).
Future implementations named in this ADR so the seam is designed for them, not
retrofitted: `GoogleDocsSource`, `ObjectStoreSource`, `LocalFileSource` (tests /
offline). A `CollectionRegistry` maps each `collection_id` to a source instance +
its location. This keeps GitHub knowledge in exactly one module.

### D4 — Change detection: poll the version stamp, no "watch" needed

There is no need for a GitHub subscription. The manifest already carries
`generatedAtCommit`; combined with HTTP `ETag`/`If-None-Match`, a "has it changed?"
check is one conditional GET that returns `304` when nothing moved. Strategy:

- **Lazy-on-read with a short TTL** (check `current_version` at most once per N
  minutes per collection; refetch only on change), plus
- **an optional background refresh** on an interval.
- **Webhook (optional, later):** the content repo can POST BC on push to
  invalidate immediately. Designed-for but not required for v1.

The cache is keyed by `(collection_id, version_token)`, so a `304` is free and a
changed commit swaps the roster atomically.

### D5 — Collection identity/location is backend-owned config

The open question — *does the frontend identify the collection, or do we need a
Rust-side property file?* — resolves in favor of **both, with the backend
authoritative for location.** Rationale:

- The producer contract §7 already assigns the **collection id** and *"where BC
  serves a file from"* to Bridge Classroom, not the producer. The backend must know
  the source + location to fetch a manifest at all, so it needs this config
  regardless of what the client sends.
- Today that location knowledge is **hardcoded in one place** (`reports.rs::
  repo_for_collection`) and **duplicated** in the frontend's `COLLECTIONS[]`
  (`useAppConfig.js`). We consolidate it into a single backend
  `CollectionRegistry` (checked-in config — TOML/JSON), and fold `repo_for_collection`
  into it.
- The **client keeps stamping `collection_id` on each observation** (cheap, already
  wired, keeps observations self-contained). The backend simply stops *trusting the
  client for sizing/release status* — those now come from the manifest the backend
  fetched itself.
- Frontend `COLLECTIONS[]` remains for UI concerns (icons, display names, TOC
  URLs). Where it overlaps the backend registry (repo, base URL), the two should be
  reconciled to one declaration in a follow-up (e.g. backend serves the registry;
  out of scope for v1).

## 3. Amendment to the Producer Contract

This ADR adds a producer obligation, folded into
[collection-producer-contract.md](./collection-producer-contract.md) (R5) on
acceptance:

> **R5 — Publish a build-generated manifest.** Your build emits a manifest in the
> shared schema (§ this ADR / design doc) describing every lesson and its board
> roster: per board, `number`, `stable`, `[BoardVersionToken]`, and `skillPath`.
> The manifest is regenerated every build and is the authoritative shape of your
> collection. It carries your `stable` flag (BC derives `prerelease` from it); it
> does **not** carry BC's `collection` id, `report` flag, or `prerelease` column
> (§7 still holds — those stay BC's).

Baker Bridge's `CSVtoPBN` pipeline already gains a token-stamping step under R3;
manifest emission is the natural companion to it.

## 4. Consequences

**Positive**
- Correct mastery denominators immediately, independent of coverage.
- Release status becomes server-authoritative — closes the client-trust gap for
  prerelease exclusion from platform stats.
- One consumer code path for both collections; deletes the static `dealCount` table
  and the runtime PBN-parsing in `useBoardMastery.js`.
- Storage backend is swappable (Google Docs et al.) behind one trait.
- Location config lives in one place instead of a hardcode + a frontend duplicate.

**Negative / costs**
- New backend coupling: BC now knows collections live *somewhere fetchable*. Scoped
  to one module + config; deliberate.
- Baker Bridge build work (manifest generator) — a producer task, gated on David.
- A reconciliation step between what the client asserts and the manifest roster
  (e.g. an observation for a board not in the roster: accept + flag, don't reject —
  observations stay self-contained per ADR-0001).
- Cache staleness window equal to the poll TTL (bounded; acceptable for content
  that changes on human timescales).

**Neutral**
- Per-observation `prerelease`/`board_version_token` columns stay — cheaper to keep
  the self-contained record than to remove them, and they remain useful evidence.

## 5. Alternatives considered

- **Frontend pushes the manifest to the backend.** Rejected: re-sends the whole
  manifest per session and, worse, makes sizing/release status client-supplied —
  the exact trust problem we're trying to close.
- **Keep lazy `COUNT(DISTINCT)` inference.** Rejected: denominators stay wrong until
  coverage fills in; no fix for client-asserted prerelease.
- **GitHub webhook as the primary mechanism.** Deferred: adds a public ingress
  endpoint + secret management for a change cadence that a cheap conditional-GET
  poll already covers. Kept as an optional accelerator (D4).
- **Content hash as identity.** Already rejected by ADR-0001 (§ "why position, not
  content"); unchanged here.

## 6. References
- [ADR-0001 — Positional board identity](./0001-positional-board-identity.md)
- [Collection Producer Contract](./collection-producer-contract.md) (gets R5)
- [Board Identity, Readiness, and History Integrity](./board-identity-and-history-integrity.md)
- Design doc: [Collection Manifest & Library Source](../design/collection-manifest-and-library-source.md)
