// The bots a table can use, for Table settings: name, version, date.
//
// Rusty's comes from the installed WASM package (scripts/rbb-wasm.release.json,
// through build-info.json). BBA and BEN are services with no version endpoint,
// so theirs are written down here: update this when either is deployed.
//   BBA: BBA-tools release, installed at bba.harmonicsystems.com
//   BEN: the ben-play image in bridge-craftwork-platform/droplet/docker-compose.yml,
//        dated by the image's build
import { RBB_WASM_INFO } from './rbbClient.js'

export const SERVICE_BOTS = [
  { id: 'bba', name: 'BBA', version: 'v2.5.0', date: '2026-10-28' },
  { id: 'ben', name: 'BEN', version: '0.8.8.7', date: '2026-09-16' },
]

function rustyRow(info) {
  if (!info) return { id: 'rusty', name: 'Rusty', version: 'not installed', date: '' }
  if (info.source === 'local') return { id: 'rusty', name: 'Rusty', version: `v${info.version}`, date: 'local build' }
  return { id: 'rusty', name: 'Rusty', version: info.tag || `v${info.version}`, date: info.date || '' }
}

export function botVersions(info = RBB_WASM_INFO) {
  return [rustyRow(info), ...SERVICE_BOTS]
}
