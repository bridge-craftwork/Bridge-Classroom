<template>
  <!-- The server path rendered from a FROZEN snapshot: loads the fixture through
       the real useRemoteTable.loadFixture (the Phase-0.2 driver), then maps the
       resulting reactive `srv` state into the shape TableScene renders. This is
       the on-screen referee — the same snapshot the fixtureDriver unit tests
       assert on. When Phase 3 refactors the server path, drive it from this same
       fixture and pixel-diff. Harness-only. -->
  <TableScene :fixture="derived" />
</template>

<script setup>
import { computed } from 'vue'
import TableScene from './TableScene.vue'
import { useRemoteTable } from '../composables/useRemoteTable.js'

const props = defineProps({ fixture: { type: Object, required: true } })

const srv = useRemoteTable()
// Synchronous state restore in setup — no socket, no await.
srv.loadFixture(props.fixture.snapshot)

// Map the reactive server state onto TableScene's fixture shape. The engine
// contract calls the service's terminal 'complete' state 'review' (derivePhase).
const derived = computed(() => {
  const b = srv.board.value || {}
  const c = srv.contract.value
  return {
    label: props.fixture.label,
    board: b.number,
    seat: srv.yourSeat.value,
    dealer: b.dealer || 'N',
    vulnerable: b.vulnerable || 'None',
    phase: srv.phase.value === 'complete' ? 'review' : (srv.phase.value || 'bidding'),
    clickableSeat: srv.clickableSeat.value,
    hands: srv.hands.value,
    hiddenSeats: srv.hiddenSeats.value,
    bids: srv.auction.value,
    lastBid: srv.lastSuitBid.value,
    currentTrick: srv.currentTrick.plays,
    lastFinishedTrick: srv.lastFinishedTrick.value,
    tricksTaken: srv.tricksTaken.value,
    nextSeat: srv.nextToAct.value,
    contract: c?.text || null,
    declarer: c?.declarer || null,
    canDouble: srv.canDouble.value,
    canRedouble: srv.canRedouble.value,
    context: { title: 'Table', text: contextText.value },
  }
})

const contextText = computed(() =>
  Object.entries(srv.seats.value || {})
    .map(([seat, occ]) => `${seat}: ${occ?.kind === 'human' ? occ.name : 'Bot'}`)
    .join('\n')
)
</script>
