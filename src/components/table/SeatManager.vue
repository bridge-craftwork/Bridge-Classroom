<template>
  <div class="sm">
    <div class="sm-head">
      <h3 class="sm-title">Seats</h3>
      <span class="sm-hint">Drag a player between seats, or onto the bench to unseat them.</span>
    </div>

    <!-- Compass: N top, W/E middle, S bottom -->
    <div class="sm-compass">
      <div
        v-for="seat in SEAT_ORDER"
        :key="seat"
        class="sm-seat"
        :class="['pos-' + seat, { 'is-empty': !humanAt(seat), 'is-you': yourSeats.includes(seat), 'drop-over': dropOver === seat }]"
        :draggable="!!humanAt(seat)"
        @dragstart="onDragStart($event, { kind: 'seat', seat })"
        @dragover.prevent="dropOver = seat"
        @dragleave="dropOver === seat && (dropOver = null)"
        @drop.prevent="onDrop($event, seat)"
      >
        <SeatIndicator
          :seat="seat"
          :name="humanAt(seat) ? humanAt(seat).name : null"
          :connected="humanAt(seat) ? humanAt(seat).connected : null"
          empty-label="empty"
          :you="yourSeats.includes(seat)"
        />
        <div class="sm-actions">
          <template v-if="humanAt(seat)">
            <button v-if="yourSeats.includes(seat)" class="sm-btn" @click="stand(seat)">Stand</button>
            <button class="sm-btn" @click="bench(seat)">Bench</button>
          </template>
          <template v-else>
            <button class="sm-btn" @click="sit(seat)">Sit</button>
            <button v-if="shareUrl" class="sm-btn" @click="invite(seat)">
              {{ invitedSeat === seat ? 'Copied!' : 'Invite' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Waiting bench -->
    <div
      class="sm-bench"
      :class="{ 'drop-over': dropOver === 'bench' }"
      @dragover.prevent="dropOver = 'bench'"
      @dragleave="dropOver === 'bench' && (dropOver = null)"
      @drop.prevent="onDrop($event, null)"
    >
      <span class="sm-bench-label">Waiting</span>
      <div
        v-for="w in waiters"
        :key="w.token"
        class="sm-chip"
        draggable="true"
        @dragstart="onDragStart($event, { kind: 'waiter', token: w.token })"
      >
        <span class="sm-chip-dot" :class="{ off: !w.connected }"></span>{{ w.name }}
      </div>
      <span v-if="!waiters.length" class="sm-bench-empty">No one waiting. Share an invite link to fill seats.</span>
    </div>
  </div>
</template>

<script setup>
// Host seat-management (seat-addressed): drag a player between seats (move/swap),
// onto the bench to unseat them (→ waiting), or a waiter into a seat (place). Sit
// puts YOU in an empty seat (multi-seat play); Stand vacates one you hold; Invite
// copies a per-seat join link (?seat=). All ops go out as assign_seat, which the
// server (host-only) applies and broadcasts. See project_table_seat_management.
import { ref, computed } from 'vue'
import SeatIndicator from '../SeatIndicator.vue'

const SEAT_ORDER = ['N', 'E', 'S', 'W']

const props = defineProps({
  // { N: {kind:'human',name,connected} | {kind:'empty'}, ... }
  seats: { type: Object, default: () => ({}) },
  // [{ token, name, connected, seats:[...] }] — seated + waiting.
  roster: { type: Array, default: () => [] },
  yourSeats: { type: Array, default: () => [] },
  myToken: { type: String, default: null },
  // #/play/:code invite base; per-seat links append ?seat=.
  shareUrl: { type: String, default: '' },
})

const emit = defineEmits(['assign'])

function humanAt(seat) {
  const o = props.seats[seat]
  return o && o.kind === 'human' ? o : null
}
const waiters = computed(() => props.roster.filter(r => !r.seats || r.seats.length === 0))

const dropOver = ref(null)

function onDragStart(e, payload) {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/json', JSON.stringify(payload))
}
function onDrop(e, targetSeat) {
  dropOver.value = null
  let payload
  try { payload = JSON.parse(e.dataTransfer.getData('application/json')) } catch { return }
  if (!payload) return
  if (payload.kind === 'seat') {
    if (payload.seat === targetSeat) return
    // move/swap into targetSeat, or vacate to the bench (targetSeat null)
    emit('assign', { from: payload.seat, seat: targetSeat })
  } else if (payload.kind === 'waiter' && targetSeat) {
    emit('assign', { seat: targetSeat, token: payload.token })
  }
}

function sit(seat) { if (props.myToken) emit('assign', { seat, token: props.myToken }) }
function stand(seat) { emit('assign', { from: seat, seat: null }) }
function bench(seat) { emit('assign', { from: seat, seat: null }) }

const invitedSeat = ref(null)
async function invite(seat) {
  if (!props.shareUrl) return
  const url = `${props.shareUrl}?seat=${seat}`
  try { await navigator.clipboard.writeText(url) } catch { /* clipboard unavailable */ }
  invitedSeat.value = seat
  setTimeout(() => { if (invitedSeat.value === seat) invitedSeat.value = null }, 2000)
}
</script>

<style scoped>
.sm {
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 14px 16px;
}
.sm-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.sm-title { margin: 0; font-size: 15px; }
.sm-hint { font-size: 12px; color: #888; }

/* Compass grid */
.sm-compass {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 8px;
  max-width: 560px;
}
.sm-seat {
  background: #f5f5f7;
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
}
.sm-seat.pos-N { grid-column: 2; grid-row: 1; }
.sm-seat.pos-W { grid-column: 1; grid-row: 2; }
.sm-seat.pos-E { grid-column: 3; grid-row: 2; }
.sm-seat.pos-S { grid-column: 2; grid-row: 3; }
.sm-seat[draggable="true"] { cursor: grab; }
.sm-seat.is-you { background: #e3f2fd; }
.sm-seat.drop-over { border-color: #1d9e75; background: #e8f7f0; }

.sm-actions { display: flex; gap: 6px; margin-top: 8px; }
.sm-btn {
  padding: 3px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
.sm-btn:hover { border-color: #888; }

/* Bench */
.sm-bench {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1.5px dashed #ccc;
  border-radius: 8px;
  min-height: 40px;
}
.sm-bench.drop-over { border-color: #1d9e75; background: #e8f7f0; }
.sm-bench-label { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
.sm-bench-empty { font-size: 12px; color: #999; }
.sm-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 999px;
  font-size: 13px;
  cursor: grab;
}
.sm-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: #1d9e75; }
.sm-chip-dot.off { background: #c0c4c0; }
</style>
