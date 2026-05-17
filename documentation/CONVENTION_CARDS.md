# Convention Card System

## Overview

A comprehensive convention card management system integrated with Bridge Classroom for tracking student proficiency relative to their actual partnership agreements.

## Goals

1. **Create & Edit** — Web-based convention card editor with multiple view modes
2. **Save & Share** — Store cards, share with partners and teachers
3. **PDF Export** — Generate printable convention cards (full and simplified)
4. **Taxonomy Integration** — Map card elements to Baker Bridge skills for proficiency tracking
5. **Interoperability** — Import/export with BBO, BML, Bridgodex, and other formats

## Applications

### Convention Card Editor (Standalone Webapp)
```
cards.bridge-classroom.com
```
- Create and edit convention cards
- Multiple view modes (full, simplified, form-based)
- PDF generation (ACBL format and simplified)
- Share cards with partners/teachers
- Compare cards (partnership matrix)

### Bridge Classroom Integration
```
bridge-classroom.com
```
- Link convention cards to student profile
- Filter proficiency view by "conventions I play"
- Teacher sees student performance vs their card
- Suggest practice areas based on card gaps

---

## Data Format

### Design Principles

1. **Native JSON** — Our format optimized for taxonomy mapping
2. **Hierarchical Structure** — Organized by card sections
3. **Skill Path Integration** — Each convention maps to Baker Bridge taxonomy
4. **Extensible** — Support for custom conventions and notes
5. **Interoperable** — Import/export to other formats

### Existing Formats (Reference)

| Format | Source | Notes |
|--------|--------|-------|
| **BSS** | BBO Full Disclosure | ASCII text, position-encoded, deprecated |
| **BML** | Community | Bridge Markup Language, human-readable |
| **Bridge Hackathon YAML** | Open source | Proposed standard, multi-NBO support |
| **Bridgodex** | Brenda Egeland | New ACBL format, potential partnership |

We use our own JSON format optimized for taxonomy integration, with import/export support for other formats.

### Convention Card Schema

```javascript
{
  "schema_version": "1.0",
  "card_id": "uuid",
  "format": "bridge_classroom",
  
  // ═══════════════════════════════════════════════════════════════
  // METADATA (Bridge Classroom specific - not in Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "metadata": {
    "name": "Margaret & Robert - 2/1",
    "description": "Our main partnership card for club games",
    "created_at": "2026-02-01T10:00:00Z",
    "updated_at": "2026-02-15T14:30:00Z",
    "owner_id": "user-uuid",
    "visibility": "shared",           // private, shared, public
    "shared_with": ["partner-uuid", "teacher-uuid"],
    "tags": ["2/1", "club", "primary"],
    "source": null                    // "bridgodex", "bbo", etc. if imported
  },
  
  // ═══════════════════════════════════════════════════════════════
  // PLAYERS (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "players": {
    "player1": {
      "name": "Margaret Thompson",
      "acbl_number": "K123456",
      "email": "margaret@example.com"
    },
    "player2": {
      "name": "Robert Thompson",
      "acbl_number": "K654321",
      "email": "robert@example.com"
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // GENERAL APPROACH
  // ═══════════════════════════════════════════════════════════════
  "general": {
    "system": "2/1 Game Force",
    "system_category": "two_over_one",  // standard, two_over_one, precision, acol, other
    "min_hcp_open": 12,                 // From Bridgodex: min_exp_hcp_bal_opening
    "min_hcp_respond": 6,               // From Bridgodex: min_exp_hcp_bal_responding
    "opened_light": {
      "frequently": false,
      "rarely": true,
      "never": false
    },
    "third_fourth_light": true,
    "forcing_opening": "2C"
  },
  
  // ═══════════════════════════════════════════════════════════════
  // NOTRUMP OPENINGS (expanded with variable ranges from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "notrump": {
    "one_nt": {
      "range_min": 15,
      "range_max": 17,
      // Variable ranges by seat/vulnerability (from Bridgodex)
      "variable_range": {
        "use_variable": false,
        "range_a": { "min": 15, "max": 17, "when": "vulnerable" },
        "range_b": { "min": 11, "max": 14, "when": "not_vulnerable" }
      },
      "five_card_major": "sometimes",   // always, sometimes, never
      "may_have_singleton": false,
      "skill_path": "basic_bidding/notrump_openings"
    },
    "two_nt": {
      "range_min": 20,
      "range_max": 21,
      "puppet_stayman": true,           // From Bridgodex
      "skill_path": "basic_bidding/notrump_openings"
    },
    "three_nt": {
      "meaning": "gambling",            // gambling, 25-27_balanced, other
      "solid_suit": true,
      "description": "Long minor: 7 with AKQ, or 8 with AK, no outside A or K"
    },
    "system_on_over": {
      "double": true,
      "two_clubs": true,
      "two_diamonds": false,
      "all_interference": false
    },
    "stayman": {
      "play": true,
      "forcing": true,
      "puppet": false,
      "garbage": true,
      "baze": false,                    // From Bridgodex: 2c_other
      "skill_path": "bidding_conventions/stayman"
    },
    "transfers": {
      "jacoby": true,
      "texas": true,
      "two_under_texas": false,         // From Bridgodex
      "minor_suit": false,
      "four_way": false,
      "smolen": true,                   // From Bridgodex
      "skill_path": "bidding_conventions/jacoby_transfers"
    },
    "lebensohl": {
      "over_interference": true,
      "over_weak_twos": false,
      "over_reverse": false,
      "fast_denies": true,              // From Bridgodex: lebensohl_desc
      "skill_path": "competitive_bidding/lebensohl"
    },
    "other_responses": {
      "2s_range_ask": false,            // From Bridgodex: 2s rebid shows min/max
      "3c_puppet": false,
      "3d_minors_gf": false,            // From Bridgodex
      "3h_splinter": false,             // From Bridgodex
      "3s_splinter": false              // From Bridgodex
    },
    "other_nt_conventions": []
  },
  
  // ═══════════════════════════════════════════════════════════════
  // MAJOR OPENINGS (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "major_openings": {
    "five_card_majors": true,
    "min_length_1st_2nd": 5,
    "min_length_3rd_4th": 5,
    "one_nt_response": {
      "forcing": false,
      "semi_forcing": true,             // From Bridgodex
      "range_min": 6,
      "range_max": 12
    },
    "two_over_one": {
      "game_force": true,
      "promises_rebid": false,
      "skill_path": "bidding_conventions/two_over_one"
    },
    "raises": {
      "single": { "min_hcp": 6, "max_hcp": 10, "min_support": 3 },
      "limit": { "min_hcp": 10, "max_hcp": 12, "min_support": 3 },
      "preemptive": true,
      "jump_raise_weak": true,
      "bergen": {
        "play": false,
        "3c_range": "7-9",              // From Bridgodex
        "3d_range": "10-12"
      },
      "mixed_raises": false             // From Bridgodex overcalls.other
    },
    "jacoby_2nt": {
      "play": true,
      "modified": true,                 // From Bridgodex: art_raises_other
      "responses": {
        "new_suit": "singleton_void",
        "four_of_major": "minimum",
        "three_nt": "18_19_balanced",
        "three_of_major": "strong_no_shortness"
      },
      "skill_path": "bidding_conventions/jacoby_2nt_splinters"
    },
    "splinters": {
      "play": true,
      "by_responder": true,
      "by_opener": true,
      "skill_path": "bidding_conventions/jacoby_2nt_splinters"
    },
    "drury": {
      "play": true,
      "reverse": true,
      "two_way": true,                  // From Bridgodex: both 2c and 2d
      "on_over_double": true,           // From Bridgodex: drury_in_comp
      "skill_path": "bidding_conventions/reverse_drury"
    },
    "3nt_response": {
      "play": true,                     // From Bridgodex
      "meaning": "4333_with_3_support", // 13-15 HCP
      "min_hcp": 13,
      "max_hcp": 15
    },
    "jump_shift_response": "weak",      // weak, strong, invitational (from Bridgodex)
    "schuler_shift": false,             // From Bridgodex
    "other_major_conventions": []
  },
  
  // ═══════════════════════════════════════════════════════════════
  // MINOR OPENINGS (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "minor_openings": {
    "one_club": {
      "min_length": 3,
      "could_be_short": true,
      "response_1d_min_points": 6,      // From Bridgodex
      "bypass_4_card_diamond": true     // From Bridgodex: 1c_1d_bypass_5
    },
    "one_diamond": {
      "min_length": 3,
      "could_be_short": false,
      "same_as_1c": true                // From Bridgodex: 1d_same_as_1c
    },
    "one_nt_response": { 
      "min": 6, 
      "max": 10 
    },
    "two_nt_response": {
      "min": 11,                        // From Bridgodex
      "max": 12
    },
    "inverted_minors": {
      "play": true,
      "single_raise_inv": true,         // From Bridgodex
      "jump_raise_weak": true,          // From Bridgodex
      "on_over_interference": false
    },
    "criss_cross": false,
    "reverse_flannery": false,          // From Bridgodex: 1c_response 2M
    "skill_path": "basic_bidding/minor_suit_openings"
  },
  
  // ═══════════════════════════════════════════════════════════════
  // TWO-LEVEL OPENINGS (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "two_level": {
    "two_clubs": {
      "meaning": "strong",              // strong, precision, natural
      "min_hcp": 22,
      "waiting_response": "2D",
      "negative_response": "2H",        // From Bridgodex: 2c_2h_neg
      "second_negative": "3C",
      "kokish": true,                   // From Bridgodex: 2c_other
      "parrish_bust": true,             // From Bridgodex: 2H bust, 2S relay
      "skill_path": "bidding_conventions/strong_2c"
    },
    "two_diamonds": {
      "meaning": "mini_roman",          // weak, mini_roman, flannery, multi, precision
      "description": "3-suited",        // From Bridgodex
      "min_hcp": 11,
      "max_hcp": 15,
      "new_suit_nf": true,              // From Bridgodex
      "rebid_2nt_shows": "singleton_void",
      "skill_path": null                // No Baker Bridge content for mini-roman
    },
    "two_hearts": {
      "meaning": "weak",
      "min_hcp": 5,
      "max_hcp": 10,
      "min_length": 6,
      "max_length": 6,
      "suit_quality": "two_of_top_three",
      "rebid_2nt": "ogust",             // ogust, feature, natural
      "mccabe_over_double": true,       // From Bridgodex
      "skill_path": "bidding_conventions/weak_2s"
    },
    "two_spades": {
      "meaning": "weak",
      "min_hcp": 5,
      "max_hcp": 10,
      "min_length": 6,
      "rebid_2nt": "ogust",
      "mccabe_over_double": true,
      "skill_path": "bidding_conventions/weak_2s"
    },
    "ogust": {
      "play": true,
      "responses": {
        "three_clubs": "bad_hand_bad_suit",
        "three_diamonds": "bad_hand_good_suit",
        "three_hearts": "good_hand_bad_suit",
        "three_spades": "good_hand_good_suit",
        "three_nt": "solid_suit"
      },
      "skill_path": "bidding_conventions/ogust"
    },
    "feature_asking": false
  },
  
  // ═══════════════════════════════════════════════════════════════
  // OTHER CONVENTIONS (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "other_conventions": {
    "new_minor_forcing": {
      "play": true,
      "two_way": false,
      "skill_path": "bidding_conventions/new_minor_forcing"
    },
    "xyz": {
      "play": true,                     // From Bridgodex
      "skill_path": null
    },
    "fourth_suit_forcing": {
      "play": true,
      "game_forcing": true,
      "one_round": false,
      "skill_path": "bidding_conventions/fourth_suit_forcing"
    },
    "help_suit_game_tries": {
      "play": true,
      "short_suit_tries": false,
      "skill_path": "bidding_conventions/help_suit_game_try"
    },
    "reverse_bids": {
      "forcing": true,
      "skill_path": "bidding_conventions/reverse_bids"
    },
    "ingberman_2nt": {
      "play": true,                     // From Bridgodex
      "skill_path": null
    },
    "spiral": {
      "play": true,                     // From Bridgodex
      "skill_path": null
    },
    "non_serious_3nt": {
      "play": true,                     // From Bridgodex
      "skill_path": null
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // PREEMPTS (new section from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "preempts": {
    "style": "sound",                   // light, sound, aggressive
    "three_level": {
      "style": "light",                 // From Bridgodex
      "min_length": 7
    },
    "four_level": {
      "style": "light",                 // From Bridgodex
      "min_length": 8
    },
    "skill_path": "bidding_conventions/preemptive_bids"
  },
  
  // ═══════════════════════════════════════════════════════════════
  // SLAM BIDDING (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "slam": {
    "blackwood": {
      "standard": false,
      "rkcb_1430": true,
      "rkcb_0314": false,
      "rkcb_0314_for_minors": true,     // From Bridgodex: 4nt_more
      "queen_ask": true,
      "specific_king_ask": true,
      "skill_path": "bidding_conventions/roman_keycard"
    },
    "gerber": {
      "play": true,
      "over": "1nt_2nt_only",
      "skill_path": "bidding_conventions/blackwood"
    },
    "minorwood": {
      "play": true,                     // From Bridgodex
      "skill_path": null
    },
    "kickback": {
      "play": false,
      "skill_path": null
    },
    "exclusion": {
      "play": true,                     // From Bridgodex
      "response": "0314",
      "skill_path": null
    },
    "control_bids": {
      "style": "first_second_round",    // From Bridgodex
      "first_round_after_game": true,   // From Bridgodex
      "skip_allowed": false
    },
    "quantitative": {
      "4nt_over_1nt": "invitational",
      "4nt_over_2nt": "invitational",
      "5nt_pick_a_slam": true           // From Bridgodex
    },
    "vs_interference": "western_cue"    // From Bridgodex
  },
  
  // ═══════════════════════════════════════════════════════════════
  // COMPETITIVE BIDDING (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "competitive": {
    "overcalls": {
      "one_level": { "min_hcp": 8, "max_hcp": 16, "min_length": 5 },
      "two_level": { "min_hcp": 12, "max_hcp": 16, "min_length": 5 },
      "jump_overcall": "weak",
      "new_suit_nf_constructive": true, // From Bridgodex
      "cuebid_support": true,           // From Bridgodex
      "mixed_raises": true,             // From Bridgodex
      "skill_path": "competitive_bidding/overcalls"
    },
    "one_nt_overcall": {
      "direct": { "min": 15, "max": 18 },
      "balancing": { "min": 11, "max": 14 },
      "systems_on": true
    },
    "takeout_doubles": {
      "style": "moderate",              // light, moderate, sound (from Bridgodex)
      "reopening_lighter": true,
      "skill_path": "competitive_bidding/takeout_doubles"
    },
    "negative_doubles": {
      "through": "4H",                  // From Bridgodex
      "skill_path": "competitive_bidding/negative_doubles"
    },
    "responsive_doubles": {
      "play": true,
      "through": "4H"                   // From Bridgodex
    },
    "maximal_doubles": {
      "play": true                      // From Bridgodex
    },
    "support_doubles": {
      "play": true,
      "redoubles": true,
      "through": "2H",                  // From Bridgodex
      "skill_path": "competitive_bidding/support_cuebids"
    },
    "michaels": {
      "play": true,
      "strength": "weak_or_strong",
      "skill_path": "competitive_bidding/michaels_unusual"
    },
    "unusual_2nt": {
      "play": true,
      "shows": "two_lower_unbid",
      "skill_path": "competitive_bidding/michaels_unusual"
    },
    // Defense vs NT - separate for strong and weak (from Bridgodex)
    "defense_vs_strong_nt": {
      "convention": "suction",          // dont, cappelletti, meckwell, suction, penalty
      "details": {
        "double": "clubs_and_hearts",
        "2c": "diamonds_or_majors",
        "2d": "hearts_or_black_suits",
        "2h": "spades_or_minors",
        "2s": "clubs_or_red_suits",
        "2nt": "diamonds_and_spades"
      },
      "skill_path": null
    },
    "defense_vs_weak_nt": {
      "convention": "suction",
      "details": {
        "double": "penalty",
        "2c": "diamonds_or_majors",
        "2d": "hearts_or_black_suits",
        "2h": "spades_or_minors",
        "2s": "clubs_or_red_suits",
        "2nt": "diamonds_and_spades"
      },
      "skill_path": null
    },
    "vs_takeout_double": {
      "redouble": "10_plus",
      "redouble_denies_fit": true,      // From Bridgodex
      "2nt_raise": true,                // From Bridgodex
      "2nt_min_hcp": 10,
      "jump_shift_weak": true,          // From Bridgodex
      "new_suit_forcing_2_level": true  // From Bridgodex
    },
    "vs_preempts": {
      "takeout_double_through": "4H",   // From Bridgodex
      "lebensohl_response": true        // From Bridgodex
    },
    "direct_cuebids": {
      "natural_or_artificial": "artificial",
      "michaels_over_majors": true,
      "michaels_over_minors": true
    },
    "sandwich_nt": {
      "play": true                      // From Bridgodex: more2
    },
    "fit_jumps": false,
    "sos_redouble": true                // From Bridgodex
  },
  
  // ═══════════════════════════════════════════════════════════════
  // DEFENSIVE CARDING (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "defensive": {
    "opening_leads": {
      "vs_suits": {
        "style": "fourth_best",         // fourth_best, third_fifth, attitude
        "ace_from_ak": false,
        "king_asks_count": true,
        "rusinow": false,
        // Specific lead preferences (from Bridgodex)
        "from_AKx": "A",                // A or K
        "from_AKxx": "A",
        "from_Hxx": "x",                // H (honor) or x (low)
        "from_xxx": "x",                // top, middle, low
        "from_xxxx": "4th",
        "from_Hxxx": "4th",
        "from_xxxxx": "4th",
        "from_Hxxxx": "4th"
      },
      "vs_nt": {
        "style": "fourth_best",
        "ace_asks_attitude": false,
        // Specific lead preferences (from Bridgodex)
        "from_AKxx": "A",
        "from_Hxx": "x",
        "from_xxx": "x",
        "from_xxxx": "2nd",
        "from_Hxxx": "4th",
        "from_xxxxx": "4th",
        "from_Hxxxx": "4th"
      },
      "skill_path": "defense/opening_leads"
    },
    "signals": {
      "attitude": {
        "standard": false,
        "upside_down": true             // From Bridgodex
      },
      "count": {
        "standard": false,
        "upside_down": true             // From Bridgodex
      },
      "suit_preference": {
        "play": true,
        "obvious_situations": true
      },
      "trump_suit_preference": true,    // From Bridgodex
      "smith_echo": true,               // From Bridgodex (vs NT)
      "foster_echo": false,
      "partner_lead": "attitude",       // From Bridgodex
      "declarer_lead": "count",         // From Bridgodex
      "skill_path": "defense/defensive_signals"
    },
    "discards": {
      "style": "standard",
      "upside_down": true,              // From Bridgodex
      "first_discard": "attitude",      // attitude, count, suit_preference
      "lavinthal": false,
      "odd_even": false
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // CUSTOM CONVENTIONS (user-defined)
  // ═══════════════════════════════════════════════════════════════
  "custom_conventions": [
    {
      "name": "UVU",                    // From Bridgodex: more2
      "category": "other",
      "description": "Unspecified convention",
      "alertable": true,
      "skill_path": null
    }
  ],
  
  // ═══════════════════════════════════════════════════════════════
  // NOTES (expanded from Bridgodex)
  // ═══════════════════════════════════════════════════════════════
  "notes": {
    "general": "We tend to open light in 3rd/4th seat.",
    "partnership_understandings": "After 1NT-2C-2D, 2H is to play.",
    "special_agreements": "",
    // Free-form sections to capture Bridgodex "more" and "other" fields
    "notrump_notes": "",
    "major_notes": "",
    "minor_notes": "",
    "competitive_notes": "",
    "slam_notes": "",
    "carding_notes": ""
  },
  
  // ═══════════════════════════════════════════════════════════════
  // IMPORT METADATA (preserved from source)
  // ═══════════════════════════════════════════════════════════════
  "_import": {
    "source": null,                     // "bridgodex", "bbo_bss", "bml", etc.
    "imported_at": null,
    "original_data": null,              // Preserve original for reference
    "unmapped_fields": []               // Fields we couldn't map
  }
}
```

---

## Simplified Convention Card

### Purpose

A one-page quick-reference card for intermediate players that covers:
- Basic system type
- Key conventions by name (checkboxes)
- Carding agreements
- Special notes

This is NOT a full ACBL card — it's a partnership cheat sheet for casual games.

### Use Cases

1. **Club Games** — Quick reference when sitting down with a partner
2. **Pickup Partnerships** — Rapidly establish common ground
3. **Teaching** — Students can see at a glance what they're learning
4. **Memory Aid** — "Do we play DONT or Cappelletti with this partner?"

### Simplified Card Schema

```javascript
{
  "simplified_version": "1.0",
  "card_id": "uuid",
  
  "players": {
    "player1": "Margaret Thompson",
    "player2": "Robert Thompson"
  },
  
  "system": {
    "type": "2/1 Game Force",
    "category": "two_over_one"  // standard, two_over_one, precision, acol
  },
  
  "basics": {
    "1nt_range": "15-17",
    "2nt_range": "20-21",
    "five_card_majors": true,
    "forcing_1nt": true,
    "strong_2c": true,
    "weak_twos": true
  },
  
  "conventions_played": [
    // Simple list of convention names
    "Stayman",
    "Jacoby Transfers",
    "Texas Transfers",
    "Jacoby 2NT",
    "Splinters",
    "Reverse Drury",
    "New Minor Forcing",
    "Fourth Suit Forcing",
    "RKCB 1430",
    "Gerber",
    "Negative Doubles (thru 3S)",
    "Michaels Cue Bid",
    "Unusual 2NT",
    "DONT",
    "Support Doubles",
    "Ogust"
  ],
  
  "carding": {
    "leads": "4th Best",
    "attitude": "Standard",
    "count": "Standard",
    "discards": "Standard"
  },
  
  "special_notes": [
    "1NT may contain 5-card major",
    "Puppet Stayman over 2NT"
  ]
}
```

### Simplified Card Output (Print Layout)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  PARTNERSHIP CARD                                                               │
│  Margaret Thompson — Robert Thompson                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  SYSTEM: 2/1 Game Force                                                         │
│                                                                                 │
│  ┌────────────────────────────────┐  ┌────────────────────────────────────────┐│
│  │ BASICS                         │  │ CARDING                                ││
│  │                                │  │                                        ││
│  │ 1NT: 15-17    2NT: 20-21      │  │ Leads:     4th Best                    ││
│  │ ☑ 5-Card Majors               │  │ Attitude:  Standard (hi = encourage)  ││
│  │ ☑ Forcing 1NT                 │  │ Count:     Standard (hi = even)       ││
│  │ ☑ Strong 2♣                   │  │ Discards:  Standard                    ││
│  │ ☑ Weak 2s                     │  │                                        ││
│  └────────────────────────────────┘  └────────────────────────────────────────┘│
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ CONVENTIONS WE PLAY                                                       │  │
│  │                                                                           │  │
│  │ NOTRUMP            MAJOR RAISES       SLAM           COMPETITIVE          │  │
│  │ ☑ Stayman          ☑ Jacoby 2NT       ☑ RKCB 1430    ☑ Negative Dbls     │  │
│  │ ☑ Jacoby Transfers ☑ Splinters        ☑ Gerber       ☑ Michaels          │  │
│  │ ☑ Texas Transfers  ☑ Reverse Drury                   ☑ Unusual 2NT       │  │
│  │ ☐ Lebensohl        ☐ Bergen Raises                   ☑ DONT              │  │
│  │                                                       ☑ Support Dbls      │  │
│  │ AFTER OPENER       TWO-LEVEL          OTHER                               │  │
│  │ ☑ NMF              ☑ Ogust            ☑ Help Suit GT                      │  │
│  │ ☑ FSF              ☐ Feature          ☐ Short Suit GT                     │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ SPECIAL NOTES                                                             │  │
│  │ • 1NT may contain 5-card major                                            │  │
│  │ • Puppet Stayman over 2NT                                                 │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Generate Simplified from Full Card

```javascript
function generateSimplifiedCard(fullCard) {
  return {
    simplified_version: "1.0",
    card_id: fullCard.card_id,
    
    players: {
      player1: fullCard.players.player1.name,
      player2: fullCard.players.player2.name
    },
    
    system: {
      type: fullCard.general.system,
      category: fullCard.general.system_category
    },
    
    basics: {
      "1nt_range": `${fullCard.notrump.one_nt.range_min}-${fullCard.notrump.one_nt.range_max}`,
      "2nt_range": `${fullCard.notrump.two_nt.range_min}-${fullCard.notrump.two_nt.range_max}`,
      five_card_majors: fullCard.major_openings.five_card_majors,
      forcing_1nt: fullCard.major_openings.one_nt_response.forcing,
      strong_2c: fullCard.two_level.two_clubs.meaning === "strong",
      weak_twos: fullCard.two_level.two_hearts.meaning === "weak"
    },
    
    conventions_played: extractConventionList(fullCard),
    
    carding: {
      leads: formatLeadStyle(fullCard.defensive.opening_leads.vs_suits.style),
      attitude: fullCard.defensive.signals.attitude.standard ? "Standard" : "Upside-Down",
      count: fullCard.defensive.signals.count.standard ? "Standard" : "Upside-Down",
      discards: capitalize(fullCard.defensive.discards.style)
    },
    
    special_notes: extractSpecialNotes(fullCard)
  };
}

function extractConventionList(card) {
  const conventions = [];
  
  // Notrump
  if (card.notrump.stayman?.play) conventions.push("Stayman");
  if (card.notrump.transfers?.jacoby) conventions.push("Jacoby Transfers");
  if (card.notrump.transfers?.texas) conventions.push("Texas Transfers");
  if (card.notrump.lebensohl?.over_interference) conventions.push("Lebensohl");
  
  // Major Raises
  if (card.major_openings.jacoby_2nt?.play) conventions.push("Jacoby 2NT");
  if (card.major_openings.splinters?.play) conventions.push("Splinters");
  if (card.major_openings.drury?.play) {
    conventions.push(card.major_openings.drury.reverse ? "Reverse Drury" : "Drury");
  }
  if (card.major_openings.raises?.bergen) conventions.push("Bergen Raises");
  
  // Two-Level
  if (card.two_level.ogust?.play) conventions.push("Ogust");
  
  // Slam
  if (card.slam.blackwood?.standard) conventions.push("Blackwood");
  if (card.slam.blackwood?.rkcb_1430) conventions.push("RKCB 1430");
  if (card.slam.blackwood?.rkcb_0314) conventions.push("RKCB 0314");
  if (card.slam.gerber?.play) conventions.push("Gerber");
  
  // Other
  if (card.other_conventions.new_minor_forcing?.play) conventions.push("New Minor Forcing");
  if (card.other_conventions.fourth_suit_forcing?.play) conventions.push("Fourth Suit Forcing");
  if (card.other_conventions.help_suit_game_tries?.play) conventions.push("Help Suit Game Tries");
  
  // Competitive
  if (card.competitive.negative_doubles?.through) {
    conventions.push(`Negative Doubles (thru ${card.competitive.negative_doubles.through})`);
  }
  if (card.competitive.michaels?.play) conventions.push("Michaels Cue Bid");
  if (card.competitive.unusual_2nt?.play) conventions.push("Unusual 2NT");
  if (card.competitive.defense_vs_nt?.convention === "dont") conventions.push("DONT");
  if (card.competitive.defense_vs_nt?.convention === "cappelletti") conventions.push("Cappelletti");
  if (card.competitive.defense_vs_nt?.convention === "meckwell") conventions.push("Meckwell");
  if (card.competitive.support_doubles?.play) conventions.push("Support Doubles");
  
  // Custom
  card.custom_conventions?.forEach(c => conventions.push(c.name));
  
  return conventions;
}

function extractSpecialNotes(card) {
  const notes = [];
  
  if (card.notrump.one_nt.five_card_major === "sometimes" || 
      card.notrump.one_nt.five_card_major === "always") {
    notes.push("1NT may contain 5-card major");
  }
  
  if (card.notrump.one_nt.may_have_singleton) {
    notes.push("1NT may contain singleton");
  }
  
  // Add custom conventions as notes
  card.custom_conventions?.forEach(c => {
    notes.push(c.name);
  });
  
  // Add general notes
  if (card.notes?.general) {
    notes.push(card.notes.general);
  }
  
  return notes;
}
```

### Standard Convention Checklist

For the simplified card UI, offer a checklist of common conventions:

```javascript
const STANDARD_CONVENTIONS = {
  notrump: [
    { id: "stayman", name: "Stayman" },
    { id: "jacoby_transfers", name: "Jacoby Transfers" },
    { id: "texas_transfers", name: "Texas Transfers" },
    { id: "lebensohl", name: "Lebensohl" },
    { id: "smolen", name: "Smolen" },
    { id: "puppet_stayman", name: "Puppet Stayman" }
  ],
  major_raises: [
    { id: "jacoby_2nt", name: "Jacoby 2NT" },
    { id: "splinters", name: "Splinters" },
    { id: "drury", name: "Drury" },
    { id: "reverse_drury", name: "Reverse Drury" },
    { id: "bergen", name: "Bergen Raises" }
  ],
  slam: [
    { id: "blackwood", name: "Blackwood" },
    { id: "rkcb_1430", name: "RKCB 1430" },
    { id: "rkcb_0314", name: "RKCB 0314" },
    { id: "gerber", name: "Gerber" },
    { id: "kickback", name: "Kickback" }
  ],
  competitive: [
    { id: "negative_doubles", name: "Negative Doubles" },
    { id: "michaels", name: "Michaels Cue Bid" },
    { id: "unusual_2nt", name: "Unusual 2NT" },
    { id: "dont", name: "DONT" },
    { id: "cappelletti", name: "Cappelletti" },
    { id: "meckwell", name: "Meckwell" },
    { id: "support_doubles", name: "Support Doubles" }
  ],
  other: [
    { id: "nmf", name: "New Minor Forcing" },
    { id: "fsf", name: "Fourth Suit Forcing" },
    { id: "help_suit", name: "Help Suit Game Tries" },
    { id: "ogust", name: "Ogust" },
    { id: "inverted_minors", name: "Inverted Minors" }
  ]
};
```

---

## Taxonomy Mapping

### Core Skills (Always Included)

These skills are relevant regardless of convention card:

```javascript
const ALWAYS_INCLUDED_SKILLS = [
  "basic_bidding/major_suit_openings",
  "basic_bidding/minor_suit_openings",
  "basic_bidding/notrump_openings",
  "competitive_bidding/overcalls",
  "competitive_bidding/takeout_doubles",
  "declarer_play/finessing",
  "declarer_play/entry_management",
  "declarer_play/holdup_plays",
  "declarer_play/suit_establishment",
  "declarer_play/trump_management",
  "declarer_play/elimination_plays",
  "declarer_play/squeeze_plays",
  "defense/opening_leads",
  "defense/defensive_signals",
  "defense/second_hand_play",
  "defense/third_hand_play"
];
```

### Convention to Skill Mapping

```javascript
const CONVENTION_TO_SKILL = {
  // Notrump
  "notrump.stayman.play": ["bidding_conventions/stayman"],
  "notrump.transfers.jacoby": ["bidding_conventions/jacoby_transfers"],
  "notrump.transfers.smolen": ["bidding_conventions/jacoby_transfers"],
  "notrump.lebensohl.over_interference": ["competitive_bidding/lebensohl"],
  
  // Major Openings
  "major_openings.two_over_one.game_force": ["bidding_conventions/two_over_one"],
  "major_openings.jacoby_2nt.play": ["bidding_conventions/jacoby_2nt_splinters"],
  "major_openings.splinters.play": ["bidding_conventions/jacoby_2nt_splinters"],
  "major_openings.drury.play": ["bidding_conventions/reverse_drury"],
  "major_openings.raises.bergen.play": ["bidding_conventions/bergen_raises"],
  
  // Two-Level
  "two_level.two_clubs.meaning=strong": ["bidding_conventions/strong_2c"],
  "two_level.two_diamonds.meaning=weak": ["bidding_conventions/weak_2s"],
  "two_level.two_hearts.meaning=weak": ["bidding_conventions/weak_2s"],
  "two_level.two_spades.meaning=weak": ["bidding_conventions/weak_2s"],
  "two_level.ogust.play": ["bidding_conventions/ogust"],
  
  // Other Conventions
  "other_conventions.new_minor_forcing.play": ["bidding_conventions/new_minor_forcing"],
  "other_conventions.xyz.play": [],  // No Baker Bridge content yet
  "other_conventions.fourth_suit_forcing.play": ["bidding_conventions/fourth_suit_forcing"],
  "other_conventions.help_suit_game_tries.play": ["bidding_conventions/help_suit_game_try"],
  
  // Slam
  "slam.blackwood.standard": ["bidding_conventions/blackwood"],
  "slam.blackwood.rkcb_1430": ["bidding_conventions/roman_keycard"],
  "slam.blackwood.rkcb_0314": ["bidding_conventions/roman_keycard"],
  "slam.gerber.play": ["bidding_conventions/blackwood"],
  "slam.minorwood.play": [],  // No Baker Bridge content yet
  "slam.exclusion.play": [],  // No Baker Bridge content yet
  
  // Competitive
  "competitive.negative_doubles.through": ["competitive_bidding/negative_doubles"],
  "competitive.responsive_doubles.play": ["competitive_bidding/negative_doubles"],
  "competitive.michaels.play": ["competitive_bidding/michaels_unusual"],
  "competitive.unusual_2nt.play": ["competitive_bidding/michaels_unusual"],
  "competitive.defense_vs_strong_nt.convention=dont": ["competitive_bidding/dont"],
  "competitive.defense_vs_weak_nt.convention=dont": ["competitive_bidding/dont"],
  "competitive.support_doubles.play": ["competitive_bidding/support_cuebids"],
  
  // Preempts
  "preempts.three_level": ["bidding_conventions/preemptive_bids"],
  "preempts.four_level": ["bidding_conventions/preemptive_bids"]
};
```

### Get Skills from Card

```javascript
function getSkillsFromCard(card) {
  const skills = new Set(ALWAYS_INCLUDED_SKILLS);
  
  for (const [path, skillPaths] of Object.entries(CONVENTION_TO_SKILL)) {
    if (evaluateCardPath(card, path)) {
      skillPaths.forEach(s => skills.add(s));
    }
  }
  
  return Array.from(skills).sort();
}

function evaluateCardPath(card, path) {
  // Handle "path=value" format
  if (path.includes("=")) {
    const [cardPath, expectedValue] = path.split("=");
    const actualValue = getNestedValue(card, cardPath);
    return actualValue === expectedValue;
  }
  
  // Handle boolean paths
  const value = getNestedValue(card, path);
  return value === true;
}
```

### Conventions Without Practice Content

Some conventions from Bridgodex and advanced partnerships don't have Baker Bridge practice material yet:

```javascript
const CONVENTIONS_WITHOUT_CONTENT = [
  // Two-Level meanings
  { path: "two_level.two_diamonds.meaning", value: "mini_roman", name: "Mini-Roman 2♦" },
  { path: "two_level.two_diamonds.meaning", value: "flannery", name: "Flannery 2♦" },
  { path: "two_level.two_diamonds.meaning", value: "multi", name: "Multi 2♦" },
  { path: "two_level.two_clubs.kokish", value: true, name: "Kokish Relay" },
  { path: "two_level.two_clubs.parrish_bust", value: true, name: "Parrish 2♥ Bust" },
  
  // Defense vs NT
  { path: "competitive.defense_vs_strong_nt.convention", value: "cappelletti", name: "Cappelletti" },
  { path: "competitive.defense_vs_strong_nt.convention", value: "meckwell", name: "Meckwell" },
  { path: "competitive.defense_vs_strong_nt.convention", value: "suction", name: "Suction" },
  
  // Other conventions
  { path: "other_conventions.xyz.play", value: true, name: "XYZ" },
  { path: "other_conventions.ingberman_2nt.play", value: true, name: "Ingberman 2NT" },
  { path: "other_conventions.spiral.play", value: true, name: "Spiral" },
  { path: "other_conventions.non_serious_3nt.play", value: true, name: "Non-Serious 3NT" },
  { path: "slam.minorwood.play", value: true, name: "Minorwood" },
  { path: "slam.exclusion.play", value: true, name: "Exclusion Blackwood" },
  { path: "notrump.lebensohl.over_reverse", value: true, name: "Lebensohl over Reverses" },
  
  // Weak two variations
  { path: "two_level.two_hearts.mccabe_over_double", value: true, name: "McCabe" },
  
  // Other
  { path: "competitive.sandwich_nt.play", value: true, name: "Sandwich NT" },
  { path: "minor_openings.reverse_flannery", value: true, name: "Reverse Flannery" }
];
```

When a user's card includes these conventions, the UI should indicate:
```
⚠️ Practice content not yet available for:
• Mini-Roman 2♦
• Suction  
• XYZ
• Kokish Relay

These won't appear in your proficiency tracking.
```

---

## Partnership Matrix

A comparison table showing convention differences across partnerships.

### Matrix Output

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  MARGARET'S PARTNERSHIP DIFFERENCES                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                           │ Robert      │ Susan       │ James       │           │
│  DIFFERS IN:              │ (2/1 GF)    │ (SAYC)      │ (Precision) │           │
├───────────────────────────┼─────────────┼─────────────┼─────────────┼───────────┤
│  System                   │ 2/1 GF      │ ░░SAYC░░    │ ░░Precision░│           │
│  1NT Range                │ 15-17       │ 15-17       │ ░░14-16░░   │           │
│  1NT Forcing              │ ✓ Yes       │ ░░✗ No░░    │ ✓ Yes       │           │
│  2/1 Game Force           │ ✓ Yes       │ ░░✗ No░░    │ ✓ Yes       │           │
│  2♣ Opening               │ Strong      │ Strong      │ ░░Natural░░ │           │
│  Over Opp's 1NT           │ ░░DONT░░    │ ░░Capp.░░   │ ░░Meckwell░░│           │
│  Blackwood                │ ░░1430░░    │ ░░Std░░     │ ░░0314░░    │           │
│  Leads                    │ 4th Best    │ 4th Best    │ ░░3rd/5th░░ │           │
│  Attitude                 │ Standard    │ Standard    │ ░░UDCA░░    │           │
└───────────────────────────┴─────────────┴─────────────┴─────────────┴───────────┘

░░Shaded░░ = Differs from your most common agreement
```

See `PARTNERSHIP_MATRIX_PDF_IMPORT.md` for full matrix specification.

---

## Interoperability

Reference samples + a detailed schema-by-schema comparison live in
[convention-card-formats/](convention-card-formats/README.md). That doc
is the source of truth for current status and roadmap; the table below
is a quick-glance summary.

### Import/Export Formats

| Format | Import | Export | Reference sample | Notes |
|--------|--------|--------|------|-------|
| **Bridge Classroom JSON** | Native | Native | (in-tree) | Internal `card_data` shape — see [src/utils/conventionCatalog.js](../src/utils/conventionCatalog.js) |
| **Bridgeodex JSON** | ✅ shipped | planned | seed cards | [src/utils/bridgeodexImport.js](../src/utils/bridgeodexImport.js) |
| **BBO XML** | planned | planned | [bbo-card-example.xml](convention-card-formats/bbo-card-example.xml) | Flat key/value tag soup (`<E_*>` / `<C_*>` / `<L_*>`); has DOPI/DEPO/ROPI which other formats lack |
| **Swan Bridge JSON (BridgeWinners)** | planned | planned | [swan-bridge-card-schema.json](convention-card-formats/swan-bridge-card-schema.json) | Nested tree, structurally close to our internal shape |
| **BBO BSS** | researched | — | — | Legacy Full Disclosure, deprecated by BBO; superseded by the BBO XML format above |
| **BML** | planned | planned | — | Bridge Markup Language, human-readable |
| **ACBL PDF (fillable)** | planned | planned | — | Form field extraction |
| **Bridge Hackathon YAML** | planned | planned | — | Open standard proposal |
| **Simplified JSON** | n/a | planned | — | Generated from full card; quick partner reference |

### Canonical-shape decision

We do **not** plan to migrate our internal `card_data` to match any
external format's shape. Each importer/exporter is a thin
path-translation table on top of our schema. Rationale lives in
[convention-card-formats/README.md § Should we adopt Swan's shape as
canonical?](convention-card-formats/README.md#should-we-adopt-swans-shape-as-canonical).
Re-evaluate after BBO + Swan importers ship and we can see where
translation friction actually concentrates.

### Bridgodex Import

Bridgodex (bridgodex.com) exports convention cards as JSON. Our format was expanded to capture all Bridgodex fields while adding taxonomy mapping and sharing features.

**Key Differences:**
| Feature | Bridgodex | Bridge Classroom |
|---------|-----------|------------------|
| Convention flags | `"on"` strings | Boolean `true`/`false` |
| Free-form notes | `more`, `other` fields everywhere | Structured `notes` section |
| Taxonomy mapping | None | `skill_path` on every convention |
| Sharing model | None | `owner_id`, `visibility`, `shared_with` |
| Variable NT | By seat/vul | Supported (expanded from Bridgodex) |
| Lead encoding | Numeric spot cards | Named preferences |

**Import Mapping:**

```javascript
function importBridgodex(bd) {
  const card = {
    schema_version: "1.0",
    format: "bridge_classroom",
    
    metadata: {
      name: bd.settings.names?.names || "Imported Card",
      source: "bridgodex"
    },
    
    general: {
      system: bd.settings.overview?.general_approach || "Standard",
      system_category: mapSystemCategory(bd.settings.overview?.general_approach),
      min_hcp_open: parseInt(bd.settings.overview?.min_exp_hcp_bal_opening) || 12,
      min_hcp_respond: parseInt(bd.settings.overview?.min_exp_hcp_bal_responding) || 6
    },
    
    notrump: {
      one_nt: {
        range_min: parseInt(bd.settings["1_no_trump"]?.a_range_min) || 15,
        range_max: parseInt(bd.settings["1_no_trump"]?.a_range_max) || 17,
        variable_range: {
          use_variable: !!bd.settings["1_no_trump"]?.b_range_min,
          range_a: {
            min: parseInt(bd.settings["1_no_trump"]?.a_range_min) || 15,
            max: parseInt(bd.settings["1_no_trump"]?.a_range_max) || 17,
            when: bd.settings["1_no_trump"]?.a_range_seat_vul || "all"
          },
          range_b: {
            min: parseInt(bd.settings["1_no_trump"]?.b_range_min) || 11,
            max: parseInt(bd.settings["1_no_trump"]?.b_range_max) || 14,
            when: "other"
          }
        },
        five_card_major: bd.settings["1_no_trump"]?.["5_card_major"] === "on" ? "sometimes" : "never"
      },
      two_nt: {
        range_min: parseInt(bd.settings["2_no_trump"]?.range_min) || 20,
        range_max: parseInt(bd.settings["2_no_trump"]?.range_max) || 21,
        puppet_stayman: bd.settings["2_no_trump"]?.puppet === "on"
      },
      stayman: {
        play: bd.settings["1_no_trump"]?.["2c_stayman"] === "on",
        baze: bd.settings["1_no_trump"]?.["2c_other"]?.includes("Baze") || false
      },
      transfers: {
        jacoby: bd.settings["1_no_trump"]?.["2d_tfr"] === "on",
        texas: bd.settings["1_no_trump"]?.["tfr_4h"] === "on",
        two_under_texas: bd.settings["1_no_trump"]?.more?.includes("2-under") || false,
        smolen: bd.settings["1_no_trump"]?.smolen === "on"
      },
      lebensohl: {
        over_interference: bd.settings["1_no_trump"]?.lebensohl === "on",
        fast_denies: bd.settings["1_no_trump"]?.lebensohl_desc === "fast denies"
      }
    },
    
    major_openings: {
      five_card_majors: true,
      min_length_1st_2nd: bd.settings.majors?.min_len_1st_2nd_5 === "on" ? 5 : 4,
      one_nt_response: {
        forcing: false,
        semi_forcing: bd.settings.majors?.["1nt_semi_forcing"] === "on"
      },
      jacoby_2nt: {
        play: bd.settings.majors?.art_raises_2nt === "on",
        modified: bd.settings.majors?.art_raises_other?.includes("Modified") || false
      },
      splinters: {
        play: bd.settings.majors?.art_raises_splinter === "on"
      },
      drury: {
        play: bd.settings.majors?.drury_2c === "on" || bd.settings.majors?.drury_2d === "on",
        reverse: bd.settings.majors?.drury_2d === "on",
        two_way: bd.settings.majors?.drury_2c === "on" && bd.settings.majors?.drury_2d === "on",
        on_over_double: bd.settings.majors?.drury_in_comp === "on"
      },
      raises: {
        bergen: {
          play: !!bd.settings.majors?.other?.includes("Bergen"),
          "3c_range": extractBergenRange(bd.settings.majors?.other, "3!C") || "7-9",
          "3d_range": extractBergenRange(bd.settings.majors?.other, "3!d") || "10-12"
        },
        jump_raise_weak: bd.settings.majors?.jump_raise_weak === "on"
      },
      jump_shift_response: bd.settings.other?.jump_shift_resp || "weak"
    },
    
    two_level: {
      two_clubs: {
        meaning: bd.settings.two_level?.["2c_very_str"] === "on" ? "strong" : "other",
        min_hcp: parseInt(bd.settings.two_level?.["2c_min"]) || 22,
        kokish: bd.settings.two_level?.["2c_other"]?.includes("Kokish") || false,
        parrish_bust: bd.settings.two_level?.["2c_other"]?.includes("Parrish") || false
      },
      two_diamonds: {
        meaning: mapTwoLevelMeaning(bd.settings.two_level?.["2d_desc"]),
        min_hcp: parseInt(bd.settings.two_level?.["2d_min"]) || 5,
        max_hcp: parseInt(bd.settings.two_level?.["2d_max"]) || 11
      },
      two_hearts: {
        meaning: bd.settings.two_level?.["2h_weak"] === "on" ? "weak" : "other",
        min_hcp: parseInt(bd.settings.two_level?.["2h_min"]) || 5,
        max_hcp: parseInt(bd.settings.two_level?.["2h_max"]) || 10,
        rebid_2nt: bd.settings.two_level?.["2h_rebids_2nt"]?.toLowerCase() || "ogust",
        mccabe_over_double: bd.settings.two_level?.["2h_other"]?.includes("McCabe") || false
      },
      two_spades: {
        meaning: bd.settings.two_level?.["2s_weak"] === "on" ? "weak" : "other",
        min_hcp: parseInt(bd.settings.two_level?.["2s_min"]) || 5,
        max_hcp: parseInt(bd.settings.two_level?.["2s_max"]) || 10,
        rebid_2nt: bd.settings.two_level?.["2s_rebids_2nt"]?.toLowerCase() || "ogust",
        mccabe_over_double: bd.settings.two_level?.["2s_other"]?.includes("McCabe") || false
      },
      ogust: {
        play: bd.settings.two_level?.["2h_rebids_2nt"] === "Ogust"
      }
    },
    
    other_conventions: {
      new_minor_forcing: { play: bd.settings.other?.nmf === "on" },
      xyz: { play: bd.settings.other?.xyz === "on" },
      fourth_suit_forcing: { 
        play: bd.settings.other?.fsf_gf === "on",
        game_forcing: true
      },
      ingberman_2nt: { play: bd.settings.other?.more2?.includes("Ingberman") || false },
      spiral: { play: bd.settings.other?.more1?.includes("Spiral") || false },
      non_serious_3nt: { play: bd.settings.other?.more1?.includes("Non-serious") || false }
    },
    
    preempts: {
      three_level: { style: bd.settings.preempts?.["3_lvl_style"]?.toLowerCase() || "sound" },
      four_level: { style: bd.settings.preempts?.["4_lvl_style"]?.toLowerCase() || "sound" }
    },
    
    slam: {
      blackwood: {
        rkcb_1430: bd.settings.slams?.["4nt_rkc_1430"] === "on",
        rkcb_0314_for_minors: bd.settings.slams?.["4nt_more"]?.includes("0314") || false
      },
      gerber: { play: bd.settings.slams?.gerber_directly_over_nt === "on" },
      minorwood: { play: bd.settings.slams?.other?.includes("Minorwood") || false },
      exclusion: { 
        play: bd.settings.slams?.other?.includes("Exclusion") || false,
        response: bd.settings.slams?.other?.includes("0314") ? "0314" : "1430"
      },
      quantitative: {
        "5nt_pick_a_slam": bd.settings.slams?.other?.includes("Pick-A-Slam") || false
      },
      control_bids: {
        style: bd.settings.slams?.control_bids?.includes("First/second") ? "first_second_round" : "first_round"
      },
      vs_interference: bd.settings.slams?.vs_interference?.toLowerCase()?.replace(" ", "_") || null
    },
    
    competitive: {
      overcalls: {
        one_level: {
          min_hcp: parseInt(bd.settings.overcalls?.["1_lvl_min"]) || 8,
          max_hcp: parseInt(bd.settings.overcalls?.["1_lvl_max"]) || 16
        },
        two_level: {
          min_hcp: parseInt(bd.settings.overcalls?.["2_lvl_min"]) || 10,
          max_hcp: parseInt(bd.settings.overcalls?.["2_lvl_max"]) || 16
        },
        jump_overcall: bd.settings.overcalls?.jump_weak === "on" ? "weak" : "intermediate",
        new_suit_nf_constructive: bd.settings.overcalls?.new_suit_nf_const === "on",
        cuebid_support: bd.settings.overcalls?.cue_support === "on",
        mixed_raises: bd.settings.overcalls?.other?.includes("Mixed") || false
      },
      takeout_doubles: {
        style: bd.settings.doubles?.to_style?.toLowerCase() || "moderate"
      },
      negative_doubles: {
        through: bd.settings.doubles?.negative_thru?.replace("!h", "H").replace("!s", "S") || "3S"
      },
      responsive_doubles: {
        play: bd.settings.doubles?.responsive === "on",
        through: bd.settings.doubles?.responsive_thru?.replace("!h", "H").replace("!s", "S") || "3S"
      },
      maximal_doubles: { play: bd.settings.doubles?.maximal === "on" },
      support_doubles: {
        play: bd.settings.doubles?.support === "on",
        redoubles: bd.settings.doubles?.support_rdbl === "on",
        through: bd.settings.doubles?.support_thru?.replace("!h", "H").replace("!s", "S") || "2H"
      },
      michaels: { play: bd.settings.direct_cuebids?.nat_majors_michaels === "on" },
      unusual_2nt: { play: bd.settings.nt_overcalls?.jump_2nt_2_lowest_unbid === "on" },
      // Defense vs NT - map Suction and other conventions
      defense_vs_strong_nt: mapDefenseVsNT(bd.settings.vs_1nt_opening, "a"),
      defense_vs_weak_nt: mapDefenseVsNT(bd.settings.vs_1nt_opening, "b"),
      vs_takeout_double: {
        redouble: "10_plus",
        redouble_denies_fit: bd.settings.vs_to_double?.redouble_conv_desc?.includes("Denies") || false,
        "2nt_raise": bd.settings.vs_to_double?.["2nt_over_majors_raise"] === "on",
        "2nt_min_hcp": parseInt(bd.settings.vs_to_double?.["2nt_over_majors_min"]) || 10,
        jump_shift_weak: bd.settings.vs_to_double?.jump_shift_weak === "on"
      },
      vs_preempts: {
        takeout_double_through: bd.settings.vs_preempts?.to_dbl_thru?.replace("!h", "H").replace("!s", "S") || "4H",
        lebensohl_response: bd.settings.vs_preempts?.["2nt_lebensohl_resp"] === "on"
      },
      sandwich_nt: { play: bd.settings.other?.more2?.includes("Sandwich") || false },
      sos_redouble: bd.settings.other?.more2?.includes("SOS") || false
    },
    
    defensive: {
      opening_leads: {
        vs_suits: mapLeads(bd.settings.leads_vs_suits),
        vs_nt: mapLeads(bd.settings.leads_vs_nt)
      },
      signals: {
        attitude: { 
          standard: bd.settings.carding?.suits_ud_att !== "on",
          upside_down: bd.settings.carding?.suits_ud_att === "on"
        },
        count: {
          standard: bd.settings.carding?.suits_ud_count !== "on",
          upside_down: bd.settings.carding?.suits_ud_count === "on"
        },
        trump_suit_preference: bd.settings.carding?.trump_signals?.includes("preference") || false,
        smith_echo: bd.settings.carding?.smith_echo_nt === "on",
        partner_lead: bd.settings.signals?.partner_lead_att === "on" ? "attitude" : "count",
        declarer_lead: bd.settings.signals?.declarer_lead_count === "on" ? "count" : "attitude"
      },
      discards: {
        upside_down: bd.settings.signals?.first_discard_ud === "on"
      }
    },
    
    _import: {
      source: "bridgodex",
      imported_at: new Date().toISOString(),
      original_data: bd,
      unmapped_fields: extractUnmappedFields(bd)
    }
  };
  
  // Add taxonomy skill paths
  addSkillPaths(card);
  
  return card;
}

// Helper functions
function mapSystemCategory(approach) {
  const map = {
    "2/1": "two_over_one",
    "SAYC": "standard",
    "Standard": "standard",
    "Precision": "precision",
    "Acol": "acol"
  };
  return map[approach] || "other";
}

function mapTwoLevelMeaning(desc) {
  if (!desc) return "weak";
  if (desc.includes("3-suited") || desc.includes("Mini-Roman")) return "mini_roman";
  if (desc.includes("Flannery")) return "flannery";
  if (desc.includes("Multi")) return "multi";
  return "weak";
}

function mapDefenseVsNT(settings, range) {
  if (!settings) return { convention: "natural" };
  
  const prefix = `vs_${range}_`;
  const convention = settings[prefix.slice(0, -1)]?.toLowerCase() || "natural";
  
  return {
    convention: convention.includes("suction") ? "suction" : 
                convention.includes("dont") ? "dont" :
                convention.includes("cappelletti") ? "cappelletti" : "natural",
    details: {
      double: settings[`${prefix}dbl`] || null,
      "2c": settings[`${prefix}2c`] || null,
      "2d": settings[`${prefix}2d`] || null,
      "2h": settings[`${prefix}2h`] || null,
      "2s": settings[`${prefix}2s`] || null,
      "2nt": settings[`${prefix}2nt`] || null
    }
  };
}

function mapLeads(leadSettings) {
  if (!leadSettings) return { style: "fourth_best" };
  
  return {
    style: leadSettings.length_4th === "on" ? "fourth_best" : 
           leadSettings.length_3rd5th === "on" ? "third_fifth" : "fourth_best",
    from_AKx: leadSettings.honor_leads_AKx === 1 ? "A" : "K",
    from_AKxx: leadSettings.honor_leads_AKxx === 1 ? "A" : "K",
    from_Hxx: leadSettings.length_leads_Hxx === 3 ? "x" : "H",
    from_xxx: leadSettings.length_leads_xxx === 1 ? "x" : 
              leadSettings.length_leads_xxx === 3 ? "middle" : "top",
    from_xxxx: leadSettings.length_leads_xxxx === 2 ? "2nd" : "4th",
    from_Hxxx: leadSettings.length_leads_Hxxx === 4 ? "4th" : "H",
    from_xxxxx: leadSettings.length_leads_xxxxx === 4 ? "4th" : "5th",
    from_Hxxxx: leadSettings.length_leads_Hxxxx === 4 ? "4th" : "H"
  };
}

function extractBergenRange(text, suit) {
  if (!text) return null;
  const match = text.match(new RegExp(`${suit}\\s*(\\d+-\\d+)`));
  return match ? match[1] : null;
}

function extractUnmappedFields(bd) {
  // Return fields we couldn't map for user review
  const unmapped = [];
  
  // Check for "more" and "other" fields with content
  const checkSection = (section, name) => {
    if (section?.more) unmapped.push({ section: name, field: "more", value: section.more });
    if (section?.other) unmapped.push({ section: name, field: "other", value: section.other });
  };
  
  checkSection(bd.settings?.majors, "majors");
  checkSection(bd.settings?.minors, "minors");
  checkSection(bd.settings?.["1_no_trump"], "1_no_trump");
  checkSection(bd.settings?.two_level, "two_level");
  checkSection(bd.settings?.slams, "slams");
  
  return unmapped;
}

function addSkillPaths(card) {
  // Add skill_path to each convention based on our taxonomy mapping
  // (Implementation in CARD_TAXONOMY_MAPPING.md)
}
```

**Export to Bridgodex:**

```javascript
function exportToBridgodex(card) {
  return {
    settings: {
      names: {
        names: `${card.players.player1.name} and ${card.players.player2.name}`
      },
      overview: {
        general_approach: card.general.system,
        min_exp_hcp_bal_opening: String(card.general.min_hcp_open || 12),
        min_exp_hcp_bal_responding: String(card.general.min_hcp_respond || 6),
        forcing_2c: card.two_level.two_clubs.meaning === "strong" ? "on" : null,
        "1nt_open_variable": card.notrump.one_nt.variable_range?.use_variable ? "on" : null
      },
      "1_no_trump": {
        a_range_min: String(card.notrump.one_nt.range_min),
        a_range_max: String(card.notrump.one_nt.range_max),
        "2c_stayman": card.notrump.stayman?.play ? "on" : null,
        "2d_tfr": card.notrump.transfers?.jacoby ? "on" : null,
        "2h_tfr": card.notrump.transfers?.jacoby ? "on" : null,
        smolen: card.notrump.transfers?.smolen ? "on" : null,
        lebensohl: card.notrump.lebensohl?.over_interference ? "on" : null,
        "5_card_major": card.notrump.one_nt.five_card_major !== "never" ? "on" : null
        // ... continue mapping
      },
      // ... other sections
    },
    notes: card.notes?.general || ""
  };
}
```

### BBO BSS Format

BSS files are ASCII text with position-encoded fields:

```
*00SAYC|Standard American Yellow Card
%ABABABABABABABABABABABAA|...
01C=NNNNNNN33813+|3+!C|Usually 1!C with 3-3 minors
...
```

Key records:
- `*` — System definition
- `%` — Carding agreements
- Numeric prefix — Bidding sequences with seat position

### BML (Bridge Markup Language)

Human-readable format with indentation for bidding trees:

```
SAYC
A natural system with 5 card majors

1N; 15-17 bal
  2C ARTIFICIAL. Stayman
    2D; No 4 card major
    2H; 4+!h
  2D TRANSFER. 5+!h
  2H TRANSFER. 5+!s
```

### Import Pipeline

```javascript
async function importCard(file, format) {
  switch (format) {
    case 'bss':
      return importBSS(await file.text());
    case 'bml':
      return importBML(await file.text());
    case 'pdf':
      return importPDF(await file.arrayBuffer());
    case 'yaml':
      return importYAML(await file.text());
    case 'json':
      return JSON.parse(await file.text());
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}
```

---

## PDF Output Formats

### 1. Full ACBL Convention Card
Standard tournament-legal format matching official ACBL layout.

### 2. Simplified Partnership Card
One-page quick reference (see Simplified Card section).

### 3. Partnership Matrix
Comparison table across multiple partnerships.

---

## Database Schema

```sql
-- Convention cards
CREATE TABLE convention_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  format TEXT NOT NULL DEFAULT 'bridge_classroom',
  owner_id TEXT REFERENCES users(id),
  card_data JSON NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Card sharing
CREATE TABLE card_shares (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES convention_cards(id),
  shared_with_id TEXT NOT NULL,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  shared_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(card_id, shared_with_id)
);

-- User-card links (Bridge Classroom)
CREATE TABLE user_convention_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT NOT NULL REFERENCES convention_cards(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  label TEXT,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, card_id)
);

-- Partnership matrices
CREATE TABLE partnership_matrices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  config JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_cards_owner ON convention_cards(owner_id);
CREATE INDEX idx_cards_visibility ON convention_cards(visibility);
CREATE INDEX idx_user_cards_user ON user_convention_cards(user_id);
```

---

## API Endpoints

### Cards
```
POST   /api/cards                    Create card
GET    /api/cards/:id                Get card
PUT    /api/cards/:id                Update card
DELETE /api/cards/:id                Delete card
GET    /api/cards?owner_id=<uuid>    List user's cards
GET    /api/cards?visibility=public  List public cards
```

### Taxonomy
```
GET    /api/cards/:id/skills                    Get skills for card
GET    /api/cards/:id/skills-without-content    Conventions without practice material
```

### Sharing
```
POST   /api/cards/:id/share               Share card
DELETE /api/cards/:id/share/:user_id      Unshare
GET    /api/cards/shared-with-me          Cards shared with me
```

### Export
```
GET    /api/cards/:id/pdf?format=acbl       Full ACBL PDF
GET    /api/cards/:id/pdf?format=simplified Simplified PDF
GET    /api/cards/:id/export?format=bss     Export as BSS
GET    /api/cards/:id/export?format=bml     Export as BML
GET    /api/cards/:id/export?format=json    Export as JSON
GET    /api/cards/:id/simplified            Get simplified version
```

### Import
```
POST   /api/cards/import/pdf    Import from PDF
POST   /api/cards/import/bss    Import from BSS
POST   /api/cards/import/bml    Import from BML
POST   /api/cards/import/json   Import from JSON
```

### Bridge Classroom Integration
```
POST   /api/users/:id/cards                Link card to profile
DELETE /api/users/:id/cards/:card_id       Unlink card
GET    /api/users/:id/cards                Get linked cards
GET    /api/users/:id/proficiency?card_id= Filtered proficiency
```

---

## Chrome Extension

See `BBO_CHROME_EXTENSION.md` for BBO import/export integration.

---

## Future Enhancements

1. **Bridgodex Partnership** — API integration pending discussion with Brenda
2. **AI Convention Suggestions** — Recommend conventions based on skill level
3. **Alert Generator** — Auto-generate alert list from card
4. **Tournament Submission** — Electronic card submission
5. **Partnership Interview** — Wizard to build card through Q&A
6. **Version History** — Track changes over time
7. **Community Templates** — Share and discover popular system cards
8. **Print at Table** — QR code linking to digital card
