# Deal Source — implementation plan

**Status:** implementation plan, 2026-07-03 (Rick). Code-grounded companion to
[deal-source-spec.md](deal-source-spec.md) (the *what*). This is the *how*: the
concrete resolver API, the functions it absorbs, the `dealerClient.js` contract,
the per-consumer retrofit, and the test list. Grounded in a full read of the
current code (survey 2026-07-03).

---

## 0. Current-state map (what exists today)

| File | Role | Key symbols |
|---|---|---|
| [src/composables/useDealSource.js](../src/composables/useDealSource.js) (117 ln) | server-table deal driver | `source`/`mode` refs (localStorage `bridgeTableDealSource`/`bridgeTableBoardMode`), `nextDeal(rotate)` switch, `setSource`/`setMode`/`label` |
| [src/utils/normalizedDeal.js](../src/utils/normalizedDeal.js) (56 ln) | club-board → PBN | `clubGameBoards(normalized) → board[]`, `boardToMinimalPbn(board) → string\|null` |
| [src/utils/pbsScenarios.js](../src/utils/pbsScenarios.js) (116 ln) | PBS fetch/parse | `fetchScenarioMenu()`, `fetchScenarioDeals(file)` (bba-filtered→pbn fallback), `fetchScenarioScript(file)` (`.dlr`), `dealToMinimalPbn(deal)`, `randomItem`, `prettifyLabel` |
| [src/composables/useDealLibrary.js](../src/composables/useDealLibrary.js) | teacher library | `fetchEntry(id) → {kind:'file'\|'folder'\|'link', payload, ...}`, `fetchLibrary`, CRUD |
| [src/composables/useClubGames.js](../src/composables/useClubGames.js) | club games (DB) | `fetchGames(owner)`, `fetchGame(id) → {payload: normalizedJSON}` |
| [src/utils/bakerBridgeTaxonomy.js](../src/utils/bakerBridgeTaxonomy.js) | Baker skills | `BAKER_BRIDGE_TAXONOMY[]`, `getTaxonomyEntry(path) → {pbn,dealCount,level,...}`, `getSubfolderForSkill` |
| [src/composables/useAppConfig.js](../src/composables/useAppConfig.js) | collections | `COLLECTIONS[]` (Baker + PBS `tocUrl`/`baseUrl`), URL param helpers |
| [src/utils/benClient.js](../src/utils/benClient.js) | BEN HTTP client | **template for dealerClient** — `getBenUrl()`, `benFetch()`, `{json,elapsedMs}`, throw-on-error |

**Today's `nextDeal(rotate)` switch** (the logic the resolver absorbs) handles:
`scenario+useScript` → `fetchScenarioScript` → `{source:'script',script}`;
`scenario` → `randomItem(fetchScenarioDeals)` → `dealToMinimalPbn` → `{source:'pbn'}`;
`library` → `fetchEntry` → `parsePbn` → `randomItem` → `dealToMinimalPbn`;
`clubgame` → `fetchGame` → `clubGameBoards` → `randomItem` → `boardToMinimalPbn`;
`pbn` → passthrough; else `{source:'random'}`. **No pool, no cache, single random pick.**

**The three consumers** (all to be re-hosted on one `DealSourcePicker`):

| Consumer | Container | Selection model today | Produces |
|---|---|---|---|
| [DealSourceModal.vue](../src/components/table/DealSourceModal.vue) | modal `min(560px,92vw)` × `84vh` | 5 tabs, one pick → `setSource` + `nextDeal` | stream (server frame) |
| [BiddingPracticeView.vue](../src/views/BiddingPracticeView.vue) | 320px sidebar + full-screen | **multi-select** `selectedScenarios:Set` + `dealsByScenario` cache + `pickRandomFromSet` | stream (local engine) |
| [TableSessionNewView.vue](../src/views/TableSessionNewView.vue) | 640px centered form | paste/upload/library → `pbn` string | static `boards_pbn` |

`BiddingPracticeView`'s pool is the model to generalize; the modal is the hardest fit.

---

## 1. `SourceRef` union (reconciled with real kinds)

Spec §2.1, reconciled with today's `useDealSource` kinds. Each ref names the
**existing** function that resolves it to boards.

```
SourceRef =
  | { kind:'scenario', repo:'pbs'|'baker', file, label, curated?:bool }
  | { kind:'clubboard', origin:'db'|'local', gameId, boardNumber, label }
  | { kind:'library',  entryId, label }
  | { kind:'userColl', collectionUrl, file, label }
  | { kind:'pbn',      text, label }
  | { kind:'random',   label }
  | { kind:'script',   repo:'pbs', file, label }   // fresh-generated variant of a scenario
```

| ref kind | resolves via (existing) | notes |
|---|---|---|
| `scenario` repo=pbs | `fetchScenarioDeals(file)` → `dealToMinimalPbn` | bba-filtered→pbn fallback already built in |
| `scenario` repo=baker | `getTaxonomyEntry(path).pbn` → fetch Baker `.pbn` → `parsePbn` → `dealToMinimalPbn` | Baker fetch path is new glue (small) |
| `scenario` curated=true | `fetchScenarioDeals(file)` **forcing** `/bba-filtered` (no fallback) | **decision D-A** below |
| `clubboard` origin=db | `fetchGame(gameId)` → `clubGameBoards` → pick `boardNumber` → `boardToMinimalPbn` | **specific board**, not random (spec §4.3) |
| `clubboard` origin=local | browser store → same `clubGameBoards`/`boardToMinimalPbn` | local store wiring is M2-era; stub until then |
| `library` | `fetchEntry(id)` → `parsePbn(payload)` → `dealToMinimalPbn` | file entries only |
| `userColl` | fetch `collectionUrl`/`file` → sniff (toc.json / raw pbn) → `parsePbn` | §7; later phase |
| `pbn` | `parsePbn(text)` | passthrough |
| `random` | client shuffle (local) / `{source:'random'}` frame (table) | generator |
| `script` | `fetchScenarioScript(file)` → `dealerClient.generateBoardPbn(script)` | **browser-direct**, §2.3 below |

---

## 2. `useDealSourceResolver.js` — the new composable

Absorbs `useDealSource.nextDeal`'s switch + the per-kind fetch/convert, adds the
**pool** and the **two resolvers**. Singleton module-scope state (project pattern).

### 2.1 State
```js
const boardCache = ref({})   // cacheKey(ref) -> board[] (parsed deals / normalized boards)
const cursor     = ref({})   // pool signature -> next sequential index
```
`boardCache` generalizes `BiddingPracticeView.dealsByScenario` to all set-refs.
Generators (`random`,`script`) are never cached.

### 2.2 API
```js
// Resolve ONE ref to its ordered board list (cached). Set-refs → many; single-refs → one.
async function refBoards(ref) -> Promise<{ pbn: string, label: string }[]>

// STREAM: draw one board from the whole pool.
async function nextBoard(selection) -> Promise<{ pbn, label }>
//   drawOrder:'sequential' (default) walks the ordered concatenation of every
//   item's boards, advancing `cursor` per pool signature; 'random' picks uniformly.
//   Generators (script/random) yield a fresh board each call, no position.

// STATIC: resolve the whole pool NOW into an ordered multi-board PBN.
async function materialize(selection) -> Promise<{ boardsPbn: string, count: number }>
//   concatenates refBoards() across items in tray order; generators resolved once each.
```
`selection` is the spec §2.2 `DealSourceSelection` (`items[]` + `options`).

### 2.3 `script` / `random` inside the resolver
- `script`: `refBoards`/`nextBoard` calls `dealerClient.generateBoardPbn(script)` (§3).
  One fresh board per draw. For `materialize`, generate `count` boards (loop).
- `random`: local consumers → client shuffle to a PBN; **table** consumer keeps
  emitting `{source:'random'}` (server shuffles) — that stays consumer-side, not resolver.

### 2.4 What `useDealSource` keeps
Trim it to **sticky-source + mode/rotate persistence only** (localStorage). The
board-resolution switch moves to the resolver. The table consumer wraps
`nextBoard` output into its `{t:'deal',source:'pbn',pbn,rotate,mode}` frame
(and passes `script`/`random` through as those sources).

---

## 3. `dealerClient.js` — browser-direct dealer (NEW, unblocked)

Sibling of `benClient.js`. **Service is live + verified (2026-07-03).**

```js
// URL: getDealerUrl() = import.meta.env.VITE_DEALER_URL || 'https://dealer.bridge-craftwork.com'
// endpoint: POST {url}/deal   body: { script, seed? }   (NO auth header needed)
// response: { seed, produced, generated, elapsed_ms, output }

export async function generateBoardPbn(script, { seed, timeoutMs = 15000, signal } = {})
  -> Promise<{ pbn, seed, elapsedMs, raw }>
```

Mirror benClient's structure; differences: **POST not GET**, **15s timeout** (dealer
wall-clock cap is 5s), no auth. Port the two shaping steps verbatim from
table-service `dealer.rs` so behavior is identical:
- **input:** `prepared = "produce 1\n" + script.replace("action printoneline", "action printpbn")`
- **output:** keep `output` lines whose `trimStart()` starts with `[`, join with `\n`;
  throw if the result lacks `[Deal ` ("script filtered everything out").

Errors: throw `Error('dealer: <detail>')` (benClient convention). Add an optional
`warmDealer()` fire-and-forget mirroring `warmBen()` only if we see cold-start lag
(unlikely — dealer3 is a fast subprocess, not a TF model).

---

## 4. `DealSourcePicker.vue` — layout-agnostic control (NEW)

Spec §9 is the hard part. Component owns **content**; host owns the **frame**.

```
props:
  allow:       { tabs: string[], options: string[] }   // §6 context gating
  layout:      'compact' | 'full'                        // compact hides tree, leans on filter+tray
  mode:        'stream' | 'materialize'
  owner:       string | null
  actionLabel: string                                    // 'Deal' | 'Add to session' | 'Save as playlist'
  modelValue:  DealSourceSelection                       // v-model of the selection
emits:
  update:modelValue(selection)
  submit(selection)                                      // host wires to nextBoard | materialize
```

Internal pieces: tab strip (gated by `allow.tabs`), global filter (§5, flat Results
view over loaded menus), source tree per tab, **selection tray** (the shared spine —
always visible, compact), options row (drawOrder/rotate/mode/fresh gated by
`allow.options`). **Prototype the compact modal first** (§9); roomy hosts follow.

---

## 5. Retrofit order (one consumer at a time)

1. **`DealSourceModal`** → thin host of `<DealSourcePicker layout="compact" mode="stream" actionLabel="Deal">`; `submit` → resolver `nextBoard` → existing frame wrap. Delete its inline tab code; collapse the rotation two-sources-of-truth into the resolver's `drawOrder`/options.
2. **`BiddingPracticeView`** → replace inline picker with `<DealSourcePicker layout="full" mode="stream">`; `submit`/next → `nextBoard` → local engine. Its `dealsByScenario` cache is now the resolver's `boardCache` (delete the local copy).
3. **`TableSessionNewView`** → `<DealSourcePicker layout="full" mode="materialize" actionLabel="Add to session">`; `submit` → `materialize` → `boards_pbn`. Keep paste/upload as a `pbn` ref in the tray.

`useDealSource` shrinks to persistence-only after step 1.

---

## 6. Decisions to confirm (small, most already resolved in spec)

- **D-A — `curated` semantics.** Today `fetchScenarioDeals` *prefers* bba-filtered
  then falls back to `/pbn`. Proposal: `curated:true` = **force** bba-filtered (no
  fallback, error if absent); `curated:false`/absent = today's fallback behavior.
  Ties into Q1 (curated tab vs toggle). **Recommend: force-bba for curated.**
- **D-B — sequential default is a behavior change** for `BiddingPracticeView`
  (draws random today). Spec Q4 resolved = sequential default. **Recommend: honor
  the spec** (sequential), keep random as the `drawOrder:'random'` option.
- **D-C — `clubboard` drill-down** replaces today's whole-game random pick. New
  capability (pick specific board). **Recommend: build the ref now; the local-origin
  store wiring can stub until M2's IndexedDB lands.**

None block build-order item 1.

---

## 7. Build sequence (revised — both item 1 & dealerClient now unblocked)

1. ✅ **`useDealSourceResolver.js`** — `refBoards`/`nextBoard`/`materialize` + pool +
   cache. **DONE + tested (2026-07-03)**: 16 unit tests green (offline pbn/random +
   mocked network arms). D-A/B/C baked in. Baker scenario / local clubboard / userColl
   are explicit throwing stubs for later phases.
2. ✅ **`dealerClient.js`** — POST /deal + shaping. **DONE + verified** against the
   live service (2026-07-03). Exports `generateBoardPbn`/`prepareScript`/`extractPbn`/
   `getDealerUrl`. The resolver's `script` arm wires to `generateBoardPbn`.
3. 🚧 **`DealSourcePicker.vue`** — compact-modal **skeleton DONE (2026-07-03)**:
   filter, gated tabs, live PBS scenario tree (multi-select), Curated, Paste PBN,
   Random, selection tray, options, action. Preview harness at
   `deal-source-demo.html` (`npm run dev` → `/deal-source-demo.html`).
   - **Reviewed by Rick 2026-07-03:** options are inline segmented pills (no native
     `<select>` popup); panel is top-anchored so the tab row stays put and the body
     expands downward (no jump).
   - **D-E — NO collapsible sections** (Rick): people were confused by hidden
     elements behind click-to-open headers. Rely on the **scroll region + live
     filter** instead — flat and always-visible. (Follow-up: strip the now-false
     "(CLICK HEADERS TO OPEN/CLOSE)" text from the PBS major label on render.)
   - Remaining: wire Club games / My library tabs (currently "coming soon"), a
     `full` layout variant, and a component test.
4. **Retrofit** the three consumers (§5), in that order — this changes production
   views (incl. the D-B random→sequential default in Practice), so it wants review
   before/after, not an unattended rewrite.

## 8. Unit-test list (item 1, no UI)
- `refBoards` for each set-ref kind returns ordered boards; cached on 2nd call.
- `nextBoard` sequential walks the pool concatenation in tray order, wraps at end.
- `nextBoard` random stays within the pool; `script` yields fresh each call.
- `materialize` concatenates multi-item pool in order; `count` matches board total.
- `clubboard` resolves the **specific** `boardNumber`, not a random board.
- `curated:true` forces bba-filtered (D-A); missing file errors, no silent /pbn.
- board→PBN parity: `dealToMinimalPbn` vs `boardToMinimalPbn` produce identical
  PBN for the same logical deal (guards the known duplication).
- `dealerClient.generateBoardPbn`: input shaping (`produce 1` + printpbn swap),
  output extraction (`[` lines, `[Deal ` guard), throws on empty/filtered output.
