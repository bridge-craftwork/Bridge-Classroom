<template>
  <div class="kb" :class="{ 'drop-over': dropOver, manage: canManage }"
    @dragover="canManage ? onOver($event) : null"
    @dragleave="dropOver = false"
    @drop="canManage ? onDrop($event) : null"
  >
    <span class="kb-label">Kibitz</span>
    <div
      v-for="k in kibitzers"
      :key="k.token"
      class="kb-chip"
      :draggable="canManage"
      @dragstart="onChipDrag($event, k.token)"
    >
      <span class="kb-dot" :class="{ off: !k.connected }"></span>{{ k.name }}
    </div>
    <span v-if="!kibitzers.length" class="kb-empty">
      {{ canManage ? 'Drag a player here to unseat them.' : 'No one kibitzing.' }}
    </span>
  </div>
</template>

<script setup>
// The kibitz drop-box (below the bidding box). Host drags a seat label here to
// unseat someone (→ kibitz); drags a kibitzer chip onto a seat to seat them.
// Emits seat-addressed `assign`.
import { ref } from 'vue'

const props = defineProps({
  // [{ token, name, connected }] — humans with no seat.
  kibitzers: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['assign'])

const dropOver = ref(false)
function onChipDrag(e, token) {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'kibitzer', token }))
}
function onOver(e) { e.preventDefault(); dropOver.value = true }
function onDrop(e) {
  e.preventDefault()
  dropOver.value = false
  let p
  try { p = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
  if (p && p.kind === 'seat') emit('assign', { from: p.seat, seat: null })
}
</script>

<style scoped>
.kb {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; border-radius: 8px; background: #f5f5f7; min-height: 36px;
}
.kb.manage { border: 1.5px dashed #ccc; background: transparent; }
.kb.drop-over { border-color: #1d9e75; background: #e8f7f0; }
.kb-label { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
.kb-empty { font-size: 12px; color: #999; }
.kb-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: #fff; border: 1px solid #ddd; border-radius: 999px; font-size: 13px;
}
.kb.manage .kb-chip { cursor: grab; }
.kb-dot { width: 8px; height: 8px; border-radius: 50%; background: #1d9e75; }
.kb-dot.off { background: #c0c4c0; }
</style>
