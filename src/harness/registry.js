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
import SeatControlTable from '../components/table/SeatControlTable.vue'
import CardSelectorPopup from '../components/CardSelectorPopup.vue'
import BoardIndicator from '../components/BoardIndicator.vue'
// Shell parts — the chrome AROUND the table (bar, rail card, control clusters), as
// opposed to the table components above. Listed separately in SHELL_COMPONENTS so
// the dev gallery can give them their own tab: they answer "what is this thing
// called and what does it look like", which is a different question from the
// table components' "how does this render at every width".
import ScenarioBar from '../components/table/ScenarioBar.vue'
import RailCard from '../components/table/RailCard.vue'
import DealControls from '../components/table/DealControls.vue'
import DealSourceButton from '../components/table/DealSourceButton.vue'
import ActionCluster from '../components/table/ActionCluster.vue'

export const COMPONENTS = { ScenarioBar, RailCard, DealControls, DealSourceButton, ActionCluster, HandDisplay, SeatChip, SeatPanel, BridgeTable, AuctionTable, BiddingBox, StatusStrip, ContextPanel, SeatIndicator, SeatControlTable, CardSelectorPopup, BoardIndicator }

/** Which COMPONENTS are shell chrome rather than table components (gallery tabs). */
export const SHELL_COMPONENTS = ['ScenarioBar', 'RailCard', 'DealControls', 'DealSourceButton', 'ActionCluster']

const modules = import.meta.glob('./specimens/**/*.js', { eager: true })

// SPECIMENS[component][name] = { label, props }
export const SPECIMENS = {}
for (const [pathKey, mod] of Object.entries(modules)) {
  const m = pathKey.match(/\.\/specimens\/([^/]+)\/([^/]+)\.js$/)
  if (!m) continue
  const [, comp, name] = m
  ;(SPECIMENS[comp] ||= {})[name] = mod.default
}
