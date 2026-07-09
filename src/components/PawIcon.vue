<template>
  <svg class="paw-icon" :class="tierClass" viewBox="0 0 512 512" aria-label="wild mastery">
    <path d="M226.5 92.9c14.3 42.9-.3 86.2-32.6 96.8s-70.1-15.6-84.4-58.5.3-86.2 32.6-96.8 70.1 15.6 84.4 58.5zM100.4 198.6c18.9 32.4 14.3 70.1-10.2 84.1s-59.7-.9-78.5-33.3S-2.7 179.3 21.8 165.3s59.7 .9 78.5 33.3zM69.2 401.2C121.6 259.9 214.7 224 256 224s134.4 35.9 186.8 177.2c3.6 9.7 5.2 20.1 5.2 30.5v1.6c0 25.8-20.9 46.7-46.7 46.7-11.5 0-22.9-1.4-34-4.2l-88-22c-15.3-3.8-31.3-3.8-46.6 0l-88 22c-11.1 2.8-22.5 4.2-34 4.2C40.9 480 20 459.1 20 433.3v-1.6c0-10.4 1.6-20.8 5.2-30.5zM421.8 282.7c-24.5-14-29.1-51.7-10.2-84.1s54-47.3 78.5-33.3 29.1 51.7 10.2 84.1-54 47.3-78.5 33.3zM310.1 189.7c-32.3-10.6-46.9-53.9-32.6-96.8s52.1-69.1 84.4-58.5 46.9 53.9 32.6 96.8-52.1 69.1-84.4 58.5z"/>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

// A tintable paw glyph for the wild-mastery milestone. Gold = Fresh (clean on a
// cold wild board — the pinnacle, matching the gold star), green = Recent. Spots
// without a tier (a clean-on-wild marker, an aggregate count) get green. Layout
// (size/position) is left to the parent's class; this only owns the shape, fill,
// and white outline.
const props = defineProps({
  tier: { type: String, default: null }, // 'Fresh' | 'Recent' | null
})

const tierClass = computed(() => (props.tier === 'Fresh' ? 'gold' : 'green'))
</script>

<style scoped>
.paw-icon {
  display: inline-block;
  vertical-align: middle;
  width: 1em;
  height: 1em;
  fill: #16a34a; /* green — Fresh / default */
  stroke: #fff;
  stroke-width: 34;
  paint-order: stroke fill;
  overflow: visible;
}
.paw-icon.gold {
  fill: #eab308; /* gold — Recent */
}
</style>
