# Convention card export formats — reference & gap analysis

Captured samples and notes for the external convention-card formats we want
to import from / export to. Files here are read-only reference; live
importer/exporter code lives in [src/utils/](../../src/utils/).

## Files in this directory

| File | Format | Source | State |
|------|--------|--------|-------|
| [bbo-card-example.xml](bbo-card-example.xml) | BBO XML | Rick + Art card exported from BBO | Fully filled card |
| [swan-bridge-card-schema.json](swan-bridge-card-schema.json) | Swan Bridge JSON | BridgeWinners export | Empty schema (all leaves blank) |

A bridgeodex JSON sample lives implicitly in the test cards we've been
importing — no need to duplicate it here while
[src/utils/bridgeodexImport.js](../../src/utils/bridgeodexImport.js) is
already exhaustively keyed against that schema.

## Format comparison

### Internal `card_data` (current)

Nested object tree keyed by section. Example paths:

```
notrump.one_nt.range_min               = 15
notrump.one_nt.sys_on_vs               = "X, 2♣"
major_openings.jacoby_2nt.play         = true
major_openings.drury.reverse           = true
minor_openings.one_club.single_raise.inv = true
two_level.two_clubs.meaning            = 'very_strong'
two_level.two_clubs.2d_response        = 'waiting'
competitive.vs_1nt_strong.system       = "Meckwell"
competitive.vs_1nt_strong.dbl          = "♣ + ♥"
direct_cuebids.art_michaels            = true
leads.vs_suits.length.fourth_best      = true
notes.notrump_notes                    = "…"
_bridgeodex_raw                        = { … original payload … }
```

### Bridgeodex (current importer)

Flat-ish object grouped by section under `settings`. Section keys are
shorthand: `"1_no_trump"`, `"majors"`, `"two_level"`, `"vs_1nt_opening"`,
`"vs_to_double"`, etc. Each section has flat key/value pairs:

```
settings.overview.general_approach     = "2/1 Game forcing"
settings["1_no_trump"].a_range_min     = "15"
settings["1_no_trump"]["2c_stayman"]   = "on"
settings.majors.jump_raise_mixed       = "on"
settings.minors["1c_min_len_5"]        = "on"
settings.two_level["2c_very_str"]      = "on"
settings.two_level["2c_2d_waiting"]    = "on"
settings.vs_1nt_opening.vs_a           = "Meckwell"
settings.vs_1nt_opening.vs_a_dbl       = "!c + !h"
settings.direct_cuebids.art_michaels   = "on"
```

Quirks: boolean fields stored as the literal string `"on"`; ranges as
strings (`"14+"`, `"17 Vul"`) that need parsing; suit shortcodes `!C/!D/!H/!S`
embedded in free text.

### BBO XML

Single `<cc>` element packed with self-closing tags. Three tag prefixes:

```
<E_xxx t="..."/>   — Entry/text field (descriptions, ranges, partner names)
<C_xxx c="y"/>     — Checkbox (always c="y" when checked; tag absent when not)
<L_xxx l="y"/>     — Lead-card choice
```

Example fragment from the sample card:

```xml
<E_1NTMin1 t="15"/>
<E_1NTMax1 t="17"/>
<E_1NSysOn t="Dbl, 2C"/>
<E_1N2S t="bal inv or clubs"/>
<E_2CMin t="22"/>
<E_2COther1 t="Or 9&#43; tricks"/>      <!-- HTML entities -->
<E_dblOther2 t="4!H"/>                    <!-- !H suit shortcode -->
<E_vs1NT2C1 t="!c &#43; major"/>
<C_2over1GF c="y"/>
<C_druryRev c="y"/>
<C_1430 c="y"/>
<C_dopi c="y"/>
<C_systemOn c="y"/>
<L_ls-akx-a l="y"/>                       <!-- leads vs suits, AKx, lead the ace -->
```

The naming uses BBO/ACBL-card mnemonics — sometimes terse:

| BBO tag | Meaning |
|---|---|
| `C_F2C` | Forcing 2♣ opening |
| `C_1N5M` | 1NT may contain 5-card major |
| `C_2over1GF` | 2/1 game forcing |
| `C_1430` | RKCB 1430 (vs 0314) |
| `C_dopi`/`C_depo`/`C_ropi` | DOPI / DEPO / ROPI over Blackwood interference |
| `C_druryRev` | Reverse Drury |
| `C_2NJacoby` | Jacoby on the 2NT raise |
| `C_FSFG` | 4th-Suit Forcing → Game |
| `C_NMF2` | 2-way New Minor Forcing |
| `C_majorO2RaiseW` | Major jump raise after overcall = weak |
| `C_majorO2NTRaise` | Major 2NT raise (Jacoby 2NT) |
| `C_vsTONSF1` | Vs takeout dbl: new suit forcing at 1-level |
| `C_vsTOMajorsLP` | Vs takeout dbl: 2NT raise majors = limit+ |
| `C_UDCSuits`/`C_UDCNT` | UDCA suits / UDCA NT (upside-down count and attitude) |
| `C_smithNT` | Smith echo in NT |
| `C_trumpSP` | Trump suit-preference signal |
| `C_systemOn` | 1NT systems-on over interference |
| `C_4thSuits` | Length leads vs suit contracts = 4th best (vs 3rd/5th, which more advanced players prefer) |
| `C_4thNT` | Length leads vs NT contracts = 4th best |
| `L_ls-akx-a` | Leads vs suits: from AKx, lead the ace |

Tags without a corresponding flag are simply absent. There's a wrapper
`<cc_card>` element whose `cc=` attribute holds an HTML-escaped copy of
the inner `<cc>` block; the second copy (already decoded) sits below it
in our sample. Parser should target the inner block.

### Swan Bridge JSON (BridgeWinners)

Deeply nested object tree under `Convention_Card.*`. Sections match the
ACBL card 1-for-1:

```
Convention_Card.Overview.{names, general_approach, opening_hcp, …}
Convention_Card.Notrump.one_notrump_opening.{range, two_clubs, …}
Convention_Card.Notrump.two_notrump_opening.{twont_open_min, …, puppet, transfer}
Convention_Card.Notrump.three_notrump_opening.{one_suit, threent_open_min, …}
Convention_Card.Majors.{first_second, third_fourth, drury, art_raises, jump, after_overcall, one_notrump}
Convention_Card.Minors.one_club.{length, raises, responses}
Convention_Card.Minors.one_diamond.{length, raises, responses}
Convention_Card.Two_level.{two_clubs, two_diamonds, two_hearts, two_spades}
Convention_Card.Doubles.{negative_doubles, responsive_doubles, support_doubles, …}
Convention_Card.Overcalls.{Jump_overcall, responses, …}
Convention_Card.Notrump_overcalls.{direct, balance, jump_two_notrump_overcalls}
Convention_Card.Vs_notrump.{versus, double, two_clubs, two_diamonds, …}
Convention_Card.Direct_cuebids.{vs_art_minors, vs_quasi_minors, vs_nat_minors, vs_nat_majors}
Convention_Card.Vs_takeout_double.{new_suit_forcing, jump_shift, two_notrump_over, …}
Convention_Card.Vs_preempts.{twoNT_overcall, takeout_through, …}
Convention_Card.Other_conventional_calls.{xyz, two_way, new_minor_forcing, …}
Convention_Card.Slams.{fourNT, gerber, control_bids, …}
Convention_Card.Preempts.{three_level_style1, four_level_style, …}
Convention_Card.Carding.{suits, notrump, smith, …}
Convention_Card.Signals.{declarer_lead, partner_lead, first_discard, …}
Convention_Card.Leads_vs_suits.{length_leads, honor_leads, interior_seq, …}
Convention_Card.Leads_vs_notrump.{…same structure…}
```

Booleans are real booleans; text fields are strings. Lead-card choice
is encoded per pattern, e.g.:

```json
"length_leads": {
  "Hxxx":     { "first": false, "second": false, "third": false, "fourth": false },
  "Hxxxx":    { "first": false, "second": false, "third": false, "fourth": false, "fifth": false },
  "five_small": { ... 5 positions ... },
  "fourth": false, "third_fifth": false, "third_low": false
}
```

The position keys (`first`/`second`/…) map directly to the "circle which
card to lead" axis on the ACBL card.

## Field-coverage comparison

| Area | Bridgeodex | BBO XML | Swan JSON | Our `card_data` |
|---|---|---|---|---|
| 1NT range + alt | ✓ | ✓ | ✓ (`range.nt_open_rmin1/2`) | ✓ |
| 1NT sys-on-vs | ✓ | ✓ (`E_1NSysOn`) | partial (`misc.systems_on`) | ✓ |
| 2NT openings | ✓ | ✓ | ✓ (`two_notrump_opening.*`) | ✓ |
| 3NT openings | ✓ | ✓ | ✓ (`three_notrump_opening.*`) | ✓ (just added) |
| 2♣ meaning radio (very-str/str/nat/conv) | partial (lossy) | ✓ | ✓ (`two_clubs.very_strong/strong/natural`) | ✓ (just added) |
| Drury (2♣ vs 2♦ vs in-comp) | flat boolean | ✓ | ✓ (`drury.two_clubs/two_diamonds/in_comp`) | ✓ (just added) |
| Major jump-raise radio | ✓ | ✓ (`C_major2RaiseW`) | ✓ (`jump.weak/mixed/invitational`) | ✓ (just added) |
| Major bypass 1♠ | ✓ | — | ✓ (`one_notrump.bypass_spades`) | ✓ (just added) |
| Minor length flags (NF0/NF1/NF2/Art F) | ✓ | partial | ✓ (`length.nf0/nf1/nf2/artf`) | ✓ (just added) |
| Minor 1NT/2NT Bergen ranges | ✓ | ✓ (`E_minor1NTMin` etc.) | ✓ (`responses.onent_range_min/max`) | ✓ (just added) |
| Minor single-raise NF/Inv+/GF | ✓ | partial | ✓ (`raises.single.non_forcing/inv_plus/game_forcing`) | ✓ (just added) |
| Vs 1NT defense (per-bid meanings) | ✓ | ✓ (per `E_vs1NTHead1/2`, `E_vs1NT2C1/2`) | ✓ (`Vs_notrump.versus.vs1/vs2`, per-bid `twoC1/twoC2`) | ✓ |
| Direct cuebids 3×4 matrix | ✓ | partial | ✓ (`vs_{art,quasi,nat}_minors/majors.{michaels,natural,other}`) | ✓ |
| Vs takeout dbl widget | ✓ | partial (`E_vsTOOther`, `C_vsTORdbl`, `C_vsTOMajorsLP`) | ✓ (`Vs_takeout_double.*`) | ✓ (just added) |
| Vs preempts widget | ✓ | partial (`E_vsPreTOThru`, `C_vsPreLeb`) | ✓ (`Vs_preempts.*`) | ✓ (just added) |
| Carding (UDCA suits/NT) | ✓ | ✓ (`C_UDCSuits` etc.) | ✓ (`Carding.suits.upside_down_count` etc.) | ✓ |
| Smith echo (suits/NT/reverse) | ✓ | ✓ (`C_smithNT` only) | ✓ (`Carding.smith.smith_NT/suits/reverse_smith`) | ✓ |
| Opening leads, "circle which card" | ✓ | ✓ (`L_ls-akx-a` etc.) | ✓ (per-pattern position flags) | ✓ |
| Lead-card honor variants (KQT9, QT9x…) | ✓ | partial | ✓ (`interior_seq.king_jack_ten` etc.) | ✓ |
| Slam: RKCB 1430 / 0314 | ✓ | ✓ (`C_1430`) | ✓ (`fourNT.rkc_1430/rkc_0314`) | ✓ |
| Slam: Minorwood / Kickback / Exclusion | partial | partial (in `E_slamOther1`) | partial | ✓ (catalog rows) |
| Vs Blackwood interference: DOPI/DEPO/ROPI | — | ✓ (`C_dopi`/`C_depo`/`C_ropi`) | — | — |
| Negative-dbl through, Responsive through, Support through | ✓ | ✓ | ✓ | ✓ |
| Preempts 3-/4-level style + responses | ✓ | partial | ✓ | ✓ |

### Notable BBO-only fields
- **DOPI / DEPO / ROPI** explicit checkboxes — every other format buries
  these in free text. We could surface as a structured Slam field.
- **`E_slamLevel`** — text describing the trump level cutover. Equivalent
  to our slam notes blob; no structured equivalent elsewhere.
- **`C_4thSuits` / `C_4thNT`** — length-lead style toggles. `C_4thSuits`
  means 4th-best leads vs suit contracts (vs. 3rd/5th, which more
  advanced players play); `C_4thNT` is the same for NT contracts. Map
  to our existing `leads.vs_suits.length.fourth_best` and
  `leads.vs_nt.length.fourth_best` paths.

### Notable Swan-only granularity
- Lead-card position flags per pattern (matches ACBL "circle which one"
  visual) — currently we store as `lead_choice_<pattern> = N`. Compatible
  conceptually, just different encoding.
- Explicit `Direct_cuebids.vs_quasi_minors.other` — we have the same
  shape now under `direct_cuebids.{col}_{row}`.
- `responses.same_one_club` on 1♦ — matches our `same_as_1c`.

## Should we adopt Swan's shape as canonical?

**Short answer: not now.** Build a thin path-translation layer instead.

Reasoning:
1. Our internal shape is already ~80% structurally aligned with Swan
   (Minors/Majors/Notrump/Two_level top-level sections, sub-objects for
   drury/art_raises/jump/single/etc.). Migrating would be 100+ field
   renames + seed-data rewrite + bridgeodex importer rewrite — multiple
   days of work to gain a Swan-export that's already a 200-line file
   with a translation table.
2. We have working data (seed cards, the bridgeodex sample card, the
   filled BMW card) under the current shape. Schema churn invalidates
   all of it.
3. Swan's lead-encoding is more granular than ours (per-position flags
   vs. our single "which-position" index). The translation is bijective
   either direction; no need to pick a winner.
4. The Phase 2 CRUD work needs a stable schema for the API layer.
   Migrating now compounds the work.

**Path forward**: implement Swan import/export as a translation table —
read the Swan tree, walk it, write into our `card_data` paths (and the
reverse). Same approach as bridgeodex but with cleaner key mapping (no
"on"/string normalization, no range-suffix parsing). Same for BBO XML.

Re-evaluate the canonical-shape question after:
- Both Swan and BBO importers exist and we can see where translation
  friction concentrates;
- The next time we have a hard reason to change schema (e.g. Phase 3a
  ACBL-card-completeness pass forces field renames anyway).

## Roadmap entries

These belong in [CONVENTION_CARDS.md](../CONVENTION_CARDS.md) under
**Interoperability**:

- [ ] **BBO XML importer** — `src/utils/bboXmlImport.js`. Parse inner
      `<cc>` block, walk `<E_*>` / `<C_*>` / `<L_*>` tags, write into our
      `card_data`. ~150 simple lookups; trickiest bits are HTML-entity
      decoding (`&#43;` → `+`, `&gt;` → `>`) and the suit shortcode
      pass we already have. **Reference sample**:
      [bbo-card-example.xml](bbo-card-example.xml).
- [ ] **BBO XML exporter** — round-trip from `card_data` → `<cc>` block.
      Translation table is the same as the importer, reversed.
- [ ] **Swan Bridge JSON importer** — `src/utils/swanImport.js`. Walk the
      nested tree, write into our `card_data`. Mostly renames; no value
      parsing. **Reference schema**:
      [swan-bridge-card-schema.json](swan-bridge-card-schema.json).
- [ ] **Swan Bridge JSON exporter** — reverse of the importer; gives us
      BridgeWinners round-trip.
- [ ] **Importer test harness** — once two formats are in, factor the
      shared path-translation pattern into a small util, plus a
      round-trip test (`our → format → our`) per format.
- [ ] **DOPI / DEPO / ROPI checkboxes** in our Slam section — present in
      BBO XML but missing from our structured fields. Adding these means
      another structured-field set on `slam.dopi`, `slam.depo`, `slam.ropi`.
