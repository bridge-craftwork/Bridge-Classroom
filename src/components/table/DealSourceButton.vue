<template>
  <!-- "Deal source…" — the one control that opens the deal-source picker. It exists
       on every table surface (solo scenario bar, host header) and is the SECOND
       relocation candidate after the VCR row (Rick, 2026-07-29: "we may also move
       Deal Source there eventually"), so it lives in one file for the same reason
       DealControls.vue does — the eventual move is a one-line change everywhere.

       `attention` is the solo table's no-deal-yet state, where this is the only
       thing worth clicking, so it renders primary + nudged rather than as one
       button among four. Owner-only by construction: the surfaces that can't deal
       (B3, the invited player) simply don't render it. -->
  <button
    class="dsb"
    :class="{ 'dsb-attn': attention }"
    type="button"
    :disabled="disabled"
    title="Choose where deals come from: random, a bidding scenario, or pasted PBN"
    @click="emit('open')"
  >Deal source&hellip;</button>
</template>

<script setup>
defineProps({
  disabled: { type: Boolean, default: false },
  attention: { type: Boolean, default: false },
})
const emit = defineEmits(['open'])
</script>

<style scoped>
.dsb {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.dsb:hover:not(:disabled) { border-color: #888; }
.dsb:disabled { opacity: 0.45; cursor: default; }
/* Priming state — spotlighted Deal source button (moved verbatim from
   BiddingPracticeView's .bp-btn-attn, pulse and reduced-motion guard included). */
.dsb-attn {
  background: #1D9E75;
  color: #fff;
  border-color: #1D9E75;
  animation: dsb-attn-pulse 1.8s ease-out infinite;
}
.dsb-attn:hover:not(:disabled) { background: #167a5a; border-color: #167a5a; }
@keyframes dsb-attn-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(29, 158, 117, 0.45); }
  70%  { box-shadow: 0 0 0 10px rgba(29, 158, 117, 0); }
  100% { box-shadow: 0 0 0 0 rgba(29, 158, 117, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsb-attn { animation: none; }
}
</style>
