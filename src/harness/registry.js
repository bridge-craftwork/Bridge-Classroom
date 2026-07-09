// Harness registry (Tier 1 — component specimens). Maps component names to the
// renderable leaf, and loads every specimen prop-file via a Vite glob so they
// are bundled (no fetch, no async loading states). Imported only by the harness
// view, which is itself behind VITE_HARNESS — so none of this reaches prod.

import HandDisplay from '../components/HandDisplay.vue'
import BridgeTable from '../components/BridgeTable.vue'
import SeatChip from '../components/SeatChip.vue'
import SeatPanel from '../components/SeatPanel.vue'
import AuctionTable from '../components/AuctionTable.vue'
import BiddingBox from '../components/BiddingBox.vue'
import StatusStrip from '../components/StatusStrip.vue'
import ContextPanel from '../components/ContextPanel.vue'
import SeatIndicator from '../components/SeatIndicator.vue'

export const COMPONENTS = { HandDisplay, SeatChip, SeatPanel, BridgeTable, AuctionTable, BiddingBox, StatusStrip, ContextPanel, SeatIndicator }

const modules = import.meta.glob('./specimens/**/*.js', { eager: true })

// SPECIMENS[component][name] = { label, props }
export const SPECIMENS = {}
for (const [pathKey, mod] of Object.entries(modules)) {
  const m = pathKey.match(/\.\/specimens\/([^/]+)\/([^/]+)\.js$/)
  if (!m) continue
  const [, comp, name] = m
  ;(SPECIMENS[comp] ||= {})[name] = mod.default
}
