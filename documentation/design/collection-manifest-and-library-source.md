# Design — Collection Manifest & Pluggable Library Source

**Status:** Draft 2026-07-08. Implementation detail for
[ADR-0002](../adr/0002-collection-manifest-and-library-source.md); read that first
for the decision and rationale. This doc specifies the manifest schema, the Rust
abstraction, the change-detection loop, and a staged rollout.

---

## 1. Goal

Give the backend an **authoritative, storage-agnostic view of every collection's
shape** — board rosters, sizing, and release status — sourced from a
build-generated manifest that both Baker Bridge and Practice-Bidding-Scenarios
publish in one shared format. Eliminate the three parallel, non-authoritative
sizing sources (static `dealCount` table, runtime PBN parsing, backend
`COUNT(DISTINCT)`), and stop trusting the client for board count / prerelease
status.

## 2. The unified manifest schema

Superset of what PBS emits today. New in **bold**. PBS's existing `layout` /
`scenarios` blocks are retained as **optional presentation metadata** (UI button
tree); Baker Bridge MAY omit them or emit an equivalent from its `toc.json`
categories. The **`lessons` roster is the required, consumer-critical addition**.

```jsonc
{
  "schemaVersion": 2,                     // bump from PBS's current 1
  "generatedAtCommit": "52c5168…",        // change-detection stamp (already present in PBS)
  "generatedAt": "2026-07-08T…",          // human-readable; not load-bearing
  // NOTE: no `collection` id — that is BC-owned (producer-contract §7), the producer
  //       never emits it. `tier` is a PBS-only field (its release/beta/test split);
  //       not part of the shared schema, so Baker Bridge omits it.

  // ── REQUIRED: authoritative board roster, keyed by PBN basename = deal_subfolder ──
  "lessons": {
    "Stayman": {
      "skillPath": "bidding_conventions/stayman",   // lesson-level default; per board may override
      "boardCount": 25,                              // derived convenience = boards.length
      "stableBoardCount": 25,                        // derived convenience
      "boards": [
        {
          "number": 1,                               // positional identity (ADR-0001)
          "stable": true,                            // AUTHORITATIVE release status (producer's flag)
          "boardVersionToken": "a1b2c3…",            // rotation-canonical stamp (contract R3)
          "skillPath": "bidding_conventions/stayman" // optional per-board override
        }
        // …one entry per board, in positional order
      ]
    }
    // …one entry per lesson/subfolder
  },

  // ── OPTIONAL: presentation metadata (PBS today). Consumer ignores for sizing. ──
  "layout":    [ /* section/row/button tree — UI only */ ],
  "scenarios": { /* per-scenario buttonText/bbaWorks/chat — UI only */ }
}
```

Notes:
- **Two profiles, one schema.** A `profile` discriminator distinguishes a **tracked**
  manifest (this section — carries the authoritative `boards` roster with tokens,
  `stable`, skill paths) from a **menu** manifest for non-persisting sources
  (`layout` + `lessons` names + display counts only; no roster). The menu profile is
  a strict subset, so a source can be promoted tracked → additively. See the
  [Non-Persisting Deal Source Contract](../adr/non-persisting-deal-source-contract.md).
  Only tracked manifests are ever fetched by the backend.
- **Key = PBN basename = `deal_subfolder`.** This is the join the whole platform
  already uses (`getSubfolderForSkill` strips `.pbn`; observations store the
  basename). If a lesson ever uses a subfolder that diverges from its PBN basename,
  add an explicit `subfolder` field to the lesson entry (the frontend taxonomy
  docstring already flags this same risk).
- **`stable` is the producer's flag**, carried straight from the PBN. BC derives
  `prerelease = !stable`. Per producer-contract §7, the manifest does **not** carry
  the `collection` id, the `report` flag, or a `prerelease` column — those are all
  BC-owned. The producer never emits a collection id (BC knows which collection a
  manifest belongs to from its own registry, i.e. *which* manifest it fetched).
- `boardCount`/`stableBoardCount` are conveniences; the `boards` array is truth.
- **Baker Bridge** must produce this from `CSVtoPBN` — the manifest emitter is the
  companion to the R3 token-stamping step it's already gaining.

## 3. Backend abstraction

### 3.1 The `LibrarySource` trait

```rust
/// A place a collection's manifest can be fetched from.
/// GitHub-raw is the first impl; the trait exists so future stores
/// (Google Docs, object storage, local files) drop in without touching routes.
#[async_trait]
pub trait LibrarySource: Send + Sync {
    /// Cheap change probe — return an opaque version token WITHOUT downloading
    /// the full manifest (HTTP conditional GET / HEAD; commit sha; ETag).
    async fn current_version(&self, loc: &CollectionLocation) -> Result<VersionToken>;

    /// Download + parse the full manifest.
    async fn fetch_manifest(&self, loc: &CollectionLocation) -> Result<Manifest>;
}

pub struct GitHubRawSource { http: reqwest::Client }   // v1
// future: struct GoogleDocsSource; struct ObjectStoreSource; struct LocalFileSource;
```

`CollectionLocation` is source-specific config (for GitHub: `repo`, `branch`,
`manifest_path`; for Google Docs: a doc id; etc.), resolved from the registry.

### 3.2 The collection registry (D5)

One backend-owned map, replacing the `reports.rs::repo_for_collection` hardcode and
the frontend `COLLECTIONS[]` location duplication. Checked-in config
(`config/collections.toml` or embedded), e.g.:

```toml
[[collection]]
id           = "baker-bridge"
source       = "github-raw"
repo         = "bridge-craftwork/Baker-Bridge"
branch       = "main"
manifest_path = "Package/manifest.json"
report_repo  = "bridge-craftwork/Baker-Bridge"   # folds in repo_for_collection

[[collection]]
id           = "pbs-coaching"
source       = "github-raw"
repo         = "bridge-craftwork/Practice-Bidding-Scenarios"
branch       = "main"
manifest_path = "manifest/manifest-release.json"   # tier-aware; see §5
report_repo  = "bridge-craftwork/Practice-Bidding-Scenarios"
```

### 3.3 In-memory cache

```rust
struct ManifestCache {
    // collection_id -> (version, parsed manifest, fetched_at)
    entries: RwLock<HashMap<CollectionId, CachedManifest>>,
}
```

- `get(collection)` returns the cached manifest, refreshing per §4.
- Keyed by `(collection_id, version_token)`; a `304`/unchanged version is a no-op.
- Roster lookups the routes need: `board_count(collection, subfolder)`,
  `is_stable(collection, subfolder, number)`, `stable_board_count(collection,
  subfolder)`.

## 4. Change detection loop (D4)

No GitHub subscription. Per collection:

1. **Lazy-on-read TTL.** On a roster lookup, if `now - fetched_at > TTL`
   (e.g. 5–10 min), call `current_version`; refetch only if it changed. A `304`
   costs one round-trip and refreshes `fetched_at`.
2. **Background refresh** (optional): a Tokio interval task calling `current_version`
   for each collection every N minutes, so the first reader after a change doesn't
   eat the refetch latency.
3. **Webhook (later, optional):** `POST /internal/collections/:id/invalidate` from
   the content repo's push webhook drops the cache entry → next read refetches.
   Designed-for; not v1.

`generatedAtCommit` is the natural version token; `ETag`/`If-None-Match` on the raw
URL is the transport-level equivalent when the commit isn't cheaply available.

## 5. Consumers to migrate

| Site | Today | After |
|---|---|---|
| `lesson_mastery.rs` denominator | `COUNT(DISTINCT deal_number)` across all users | `boardCount` / `stableBoardCount` from roster |
| `derive_wilderness` (board_status.rs) | count of exercise's boards only | can reference true lesson size from roster |
| `student_summary.rs` prerelease filters | trusts `observations.prerelease` (client) | reconcile against roster `stable` |
| Frontend `useBoardMastery.js` PBN parsing | fetch+regex every PBN, cache in localStorage | drop — read counts from backend/manifest |
| Frontend `bakerBridgeTaxonomy.js` `dealCount` | hand-maintained static table | drop — derive from manifest |

**Reconciliation rule** (keeps ADR-0001's self-contained observations intact): an
observation whose `(subfolder, number)` isn't in the roster is **accepted and
flagged**, never rejected. The roster corrects denominators going forward; it never
mutates or deletes recorded history.

**Tier handling (PBS):** PBS ships four tiers (`release`/`beta`/`release-test`/
`test`). The backend's authoritative roster is the **`release`** manifest (what
counts for mastery). Non-release tiers are a client preview concern and stay
client-side; the registry points the backend at the release manifest only.

## 6. Rollout

1. **Schema v2 spec agreed** (this doc) with David; freeze field names.
2. **PBS manifest v2**: add the `lessons` roster to David's generator. Baker Bridge:
   new manifest generator in `CSVtoPBN`, alongside R3 token stamping.
3. **Backend read path**: `LibrarySource` + `GitHubRawSource` + registry + cache +
   change loop. Land behind the existing config, no behavior change yet.
4. **Cut `lesson_mastery` denominators over** to the roster; verify against current
   values on real data before removing the `COUNT(DISTINCT)` fallback.
5. **Make prerelease server-authoritative**: reconcile `observations.prerelease`
   against the roster in the stats queries.
6. **Delete frontend sizing sources** (`useBoardMastery.js` PBN parse, static
   `dealCount`) once the backend is authoritative and exposed.
7. **Fold `repo_for_collection`** into the registry; delete the hardcode.
8. *(Optional, later)* webhook invalidation; reconcile frontend `COLLECTIONS[]`
   against the backend registry (single source).

## 7. Open questions

- **Registry format & serving.** TOML/JSON checked-in vs. backend serving it to the
  frontend too (removes the `COLLECTIONS[]` duplication). Lean: start checked-in,
  serve later.
- **Baker `toc.json` vs manifest.** Keep both (manifest for sizing/identity, toc for
  the lesson browser), or have the manifest generator also subsume the toc? Prefer
  one artifact long-term.
- **Poll TTL / background interval values.** Pick from real edit cadence (content
  changes on human timescales — minutes-to-hours TTL is fine).
- **Skill-path source of truth.** Manifest `skillPath` vs the frontend taxonomy's
  `path` — the manifest should win once it exists; taxonomy becomes presentation
  (level/display) only.
