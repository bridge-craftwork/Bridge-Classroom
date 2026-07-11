// useTableSlots — the mutually-exclusive table slots decided in ONE place, so
// every shell (solo LocalEngine, server, future fixture/console tile) makes the
// same swap from the same engine state instead of re-deriving it per branch.
//
// Two slots, both time-exclusive by the nature of the game:
//   • center — WHAT THE STAGE IS, per phase: 'auction' (bidding) | 'trick-area'
//     (play) | 'review' (post-play reveal) | null. The derivation reports the
//     content; the ARRANGEMENT decides WHERE it renders (grid-arranger-spec §1,
//     Reconciliation 2): the `grid` arrangement puts 'auction' in the center
//     region, while `legacy` keeps the auction in the rail and treats 'auction'
//     as "no center content" (its center only ever paints the cardplay stage).
//     'trick-area' and 'review' are both the cardplay stage — a `legacy` shell
//     renders TrickArea for either; a later review slice can make 'review' a
//     distinct annotated reveal. This split is inert under `legacy` today (see
//     the consumer updates) and is what the grid flip consumes.
//   • action — the right-rail input: the bidding box, driven by `wantsCall`
//     ("the experience wants a bid from you now"), NEVER a literal turn flag —
//     that distinction (Slice 5) is what lets the coached track later feed
//     `hasBidPrompt → wantsCall` without touching this contract.
//
// Returns discriminant STRINGS ('auction' | 'trick-area' | 'review' |
// 'bidding-box' | null), not Vue component references — each shell owns the
// string→component map, so a console tile can map 'trick-area' to a compact
// TrickArea while this module stays Vue-free and unit-testable.

import { computed } from 'vue'

/**
 * Pure slot decision.
 * @param {'bidding'|'play'|'review'} phase  canonical engine phase (Slice 5)
 * @param {boolean} wantsCall  the experience wants a bid from you now
 * @param {boolean} hasCardplay  is cardplay ENGAGED for this board? — a
 *   PER-SOURCE signal, true from the moment a board is set to play through its
 *   review (LocalEngine: the "Play the hand" toggle is on AND this deal supports
 *   it — `playCardplay && cardplayPossible`; ServerEngine: always, a served board
 *   always plays out). It is NOT "is a card on the table yet": the trick area
 *   shows through the pre-first-card moment and stays hidden on a bidding-only /
 *   unsupported / toggled-off deck. This is the note-2 per-source reveal.
 *
 * The cardplay stage therefore owns the center for the whole post-auction life
 * of an engaged board — 'trick-area' in play, 'review' post-play — and never for
 * a non-playing deck. Bidding always reports 'auction' (the live auction is the
 * stage); a `legacy` shell ignores that for its center (auction is in the rail),
 * so bidding paints no center exactly as before.
 */
export function deriveSlots({ phase, wantsCall, hasCardplay, hasContext }) {
  const center =
    phase === 'bidding' ? 'auction'
    : phase === 'play' && hasCardplay ? 'trick-area'
    : phase === 'review' && hasCardplay ? 'review'
    : null
  const action = wantsCall ? 'bidding-box' : null
  // Two more first-class slots (roadmap Phase 0.4):
  //   • status  — the phase-aware reference strip (dealer+vul → contract+tricks
  //     → result). Present whenever a board is loaded; StatusStrip decides what
  //     to show from the phase.
  //   • context — the docked commentary / chat / teacher region. A per-source
  //     signal (hasContext): the engine has something to dock. Undefined → null,
  //     so callers that don't pass it are unaffected.
  const status = phase ? 'status-strip' : null
  const context = hasContext ? 'context-panel' : null
  return { center, action, status, context }
}

/**
 * Reactive wrapper. `src` is an object of refs/computeds { phase, wantsCall,
 * hasCardplay } — both the live engines and a fixture engine satisfy this shape.
 * Returns top-level computeds so a `<script setup>` shell can destructure them
 * and let template auto-unwrapping do the rest.
 */
export function useTableSlots(src) {
  const slots = computed(() =>
    deriveSlots({
      phase: src.phase.value,
      wantsCall: !!src.wantsCall.value,
      hasCardplay: !!src.hasCardplay.value,
      hasContext: !!src.hasContext?.value,
    }),
  )
  return {
    center: computed(() => slots.value.center),
    action: computed(() => slots.value.action),
    status: computed(() => slots.value.status),
    context: computed(() => slots.value.context),
  }
}
