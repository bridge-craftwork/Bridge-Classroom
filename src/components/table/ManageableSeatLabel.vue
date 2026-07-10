<template>
  <div
    class="msl"
    :class="{ 'drop-over': dropOver }"
    :draggable="canManage && isHuman"
    @dragstart="onDragStart"
    @dragover="canManage ? onDragOver($event) : null"
    @dragleave="dropOver = false"
    @drop="canManage ? onDrop($event) : null"
  >
    <SeatChip :seat="seat" :name="name" :presence="presence" :card-count="cardCount" :compact="compact" />
    <button v-if="canManage" class="msl-menu-btn" title="Seat options" @click.stop="menuOpen = !menuOpen">⌄</button>
    <div v-if="menuOpen" class="msl-menu" @click.stop>
      <button v-if="isYou" class="msl-item" @click="act({ from: seat, seat: null })">Stand</button>
      <template v-else-if="isHuman">
        <button class="msl-item" @click="act({ seat, token: myToken })">Sit here</button>
        <button class="msl-item" @click="act({ from: seat, seat: null })">Remove &rarr; kibitz</button>
      </template>
      <button v-else class="msl-item" @click="act({ seat, token: myToken })">Sit here</button>
    </div>
  </div>
</template>

<script setup>
// The grabbable/droppable seat label for the SeatControlTable variant. Reuses
// SeatChip for the visual; adds host drag (grab a human label), drop (another
// label or a kibitzer chip lands here), and a small pulldown (Sit / Remove /
// Stand). Emits seat-addressed `assign` — the base BridgeTable stays drag-free.
import { ref, computed } from 'vue'
import SeatChip from '../SeatChip.vue'

// seat/name/presence/cardCount/compact come from SeatPanel; the rest ride in via
// `labelProps` (shared table context + an onAssign callback — no event bubbling
// through the base table). isHuman/isYou are derived from the seat maps.
const props = defineProps({
  seat: { type: String, required: true },
  name: { type: String, default: null },
  presence: { type: String, default: null },
  cardCount: { type: Number, default: null },
  compact: { type: Boolean, default: false },
  seats: { type: Object, default: () => ({}) },
  yourSeats: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
  myToken: { type: String, default: null },
  onAssign: { type: Function, default: null },
})

const isHuman = computed(() => props.seats[props.seat] && props.seats[props.seat].kind === 'human')
const isYou = computed(() => props.yourSeats.includes(props.seat))

const menuOpen = ref(false)
const dropOver = ref(false)

function act(payload) { menuOpen.value = false; props.onAssign && props.onAssign(payload) }

function onDragStart(e) {
  if (!props.canManage || !isHuman.value) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'seat', seat: props.seat }))
}
function onDragOver(e) { e.preventDefault(); dropOver.value = true }
function onDrop(e) {
  e.preventDefault()
  dropOver.value = false
  let p
  try { p = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
  if (!p || !props.onAssign) return
  if (p.kind === 'seat' && p.seat !== props.seat) props.onAssign({ from: p.seat, seat: props.seat })
  else if (p.kind === 'kibitzer') props.onAssign({ token: p.token, seat: props.seat })
}
</script>

<style scoped>
.msl { position: relative; display: inline-block; }
.msl[draggable="true"] { cursor: grab; }
.msl.drop-over { outline: 2px dashed #1d9e75; outline-offset: 2px; border-radius: 6px; }
.msl-menu-btn {
  position: absolute; top: -2px; right: -14px;
  border: none; background: none; font-size: 13px; color: #888; cursor: pointer; line-height: 1;
}
.msl-menu-btn:hover { color: #222; }
.msl-menu {
  position: absolute; top: 100%; left: 0; z-index: 20;
  background: #fff; border: 1px solid #ddd; border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); padding: 4px; min-width: 130px;
}
.msl-item {
  display: block; width: 100%; text-align: left;
  padding: 5px 10px; border: none; background: none; font-size: 13px; cursor: pointer; border-radius: 6px; white-space: nowrap;
}
.msl-item:hover { background: #f0f2f5; }
</style>
