<template>
  <router-view />
  <component :is="BeetleButton" v-if="BeetleButton" />
</template>

<script setup>
import { defineAsyncComponent } from 'vue'

// Dev-only bug-report beetle (Slice 0). Gated on a build-time flag so a
// production build statically drops the component and its transitive deps
// (the screenshot rasterizer) — same dead-code-elimination pattern as the
// VITE_HARNESS routes. Force it on in a preview build with VITE_BUG_BEETLE=1.
const showBeetle = import.meta.env.DEV || import.meta.env.VITE_BUG_BEETLE === '1'
const BeetleButton = showBeetle
  ? defineAsyncComponent(() => import('./report/BeetleButton.vue'))
  : null
</script>
