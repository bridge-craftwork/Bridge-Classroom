<template>
  <!-- The drag/drop-enabled table variant. Same base BridgeTable as A1, but it
       injects a grabbable/droppable label component. A1 uses the base directly
       and passes no label component, so it renders the plain SeatChip and carries
       none of this. Non-seat-control props/slots pass through via $attrs. -->
  <BridgeTable v-bind="$attrs" :label-component="labelComponent" :label-props="labelProps">
    <template v-if="$slots.center" #center><slot name="center" /></template>
    <template v-if="$slots.corner" #corner><slot name="corner" /></template>
    <!-- Named grid regions (arrangement="grid"): status / auction / bidding box. -->
    <template v-if="$slots.nw" #nw><slot name="nw" /></template>
    <template v-if="$slots.ne" #ne><slot name="ne" /></template>
    <template v-if="$slots.se" #se><slot name="se" /></template>
    <template v-if="$slots.sw" #sw><slot name="sw" /></template>
  </BridgeTable>
</template>

<script setup>
import { computed, markRaw } from 'vue'
import BridgeTable from '../BridgeTable.vue'
import ManageableSeatLabel from './ManageableSeatLabel.vue'

const props = defineProps({
  // Seat occupancy (kind): { N:{kind:'human',name,connected}|{kind:'bot'}|{kind:'empty'} }
  seats: { type: Object, default: () => ({}) },
  yourSeats: { type: Array, default: () => [] },
  myToken: { type: String, default: null },
  canManage: { type: Boolean, default: false },
  // Roster (token→seats) so a label can resolve an occupant's token for Kick.
  roster: { type: Array, default: () => [] },
})
const emit = defineEmits(['assign', 'kick'])

const labelComponent = markRaw(ManageableSeatLabel)
// Shared context + onAssign/onKick callbacks handed to every seat label (no
// event bubbling through the base table). Each label derives its own seat.
const labelProps = computed(() => ({
  seats: props.seats,
  yourSeats: props.yourSeats,
  myToken: props.myToken,
  canManage: props.canManage,
  roster: props.roster,
  onAssign: (p) => emit('assign', p),
  onKick: (token) => emit('kick', token),
}))
</script>

<script>
// $attrs are forwarded explicitly to BridgeTable (hands, occupants, active-seat,
// clickable-seat, hidden-seats, show-hcp, hide-played-cards, @card-click, …).
export default { inheritAttrs: false }
</script>
