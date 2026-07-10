<template>
  <!-- The drag/drop-enabled table variant. Same base BridgeTable as A1, but it
       injects a grabbable/droppable label component. A1 uses the base directly
       and passes no label component, so it renders the plain SeatChip and carries
       none of this. Non-seat-control props/slots pass through via $attrs. -->
  <BridgeTable v-bind="$attrs" :label-component="labelComponent" :label-props="labelProps">
    <template v-if="$slots.center" #center><slot name="center" /></template>
    <template v-if="$slots.corner" #corner><slot name="corner" /></template>
  </BridgeTable>
</template>

<script setup>
import { computed, markRaw } from 'vue'
import BridgeTable from '../BridgeTable.vue'
import ManageableSeatLabel from './ManageableSeatLabel.vue'

const props = defineProps({
  // Seat occupancy (kind) for classifying human vs bot: { N:{kind,name,connected}|{kind:'empty'} }
  seats: { type: Object, default: () => ({}) },
  yourSeats: { type: Array, default: () => [] },
  myToken: { type: String, default: null },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['assign'])

const labelComponent = markRaw(ManageableSeatLabel)
// Shared context + an onAssign callback handed to every seat label (no event
// bubbling through the base table). Each label derives its own seat from the base.
const labelProps = computed(() => ({
  seats: props.seats,
  yourSeats: props.yourSeats,
  myToken: props.myToken,
  canManage: props.canManage,
  onAssign: (p) => emit('assign', p),
}))
</script>

<script>
// $attrs are forwarded explicitly to BridgeTable (hands, occupants, active-seat,
// clickable-seat, hidden-seats, show-hcp, hide-played-cards, @card-click, …).
export default { inheritAttrs: false }
</script>
