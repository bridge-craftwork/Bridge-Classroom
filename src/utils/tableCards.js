// The solo table's convention cards, chosen per partnership ("play my card"):
// the scenario's own card (the default), a BBA card from PBS `bbsa/`, or one of
// the signed-in user's saved cards. Remembered in localStorage like the other
// `bp.*` table settings.
//
// A side's choice is a key string, which is also the <select> value:
//   ''              the scenario's card (SCENARIO_DEFAULT)
//   'bba:<name>'    a BBA card by name, e.g. 'bba:21GF-GIB'
//   'mine:<cardId>' a card saved in Bridge Classroom (convention_cards.id)
//
// Both bots can play any of them: Rusty takes a user's card as `{ json }`, and
// BBA as `.bbsa` text (`conventionContent`, bba-server 2.2+). Neither plays
// every setting of a user's card; cardCoverage() says how much each reads.

// Submodules, not the package index, which also carries the PDF code.
import { BBSA_MAP, field } from '@bridge-craftwork/convention-card/js/spec.js'
import { exportBbsa } from '@bridge-craftwork/convention-card/js/bbsa.js'
import { botReport } from '@bridge-craftwork/convention-card/js/botReport.js'
import { getRbbClient } from './rbbClient.js'

export const TABLE_CARDS_KEY = 'bp.tableCards'
export const SCENARIO_DEFAULT = ''

const PBS_BBSA_LISTING = 'https://api.github.com/repos/bridge-craftwork/Practice-Bidding-Scenarios/contents/bbsa'
// What PBS `bbsa/` held on 2026-10-28: the list when GitHub's listing can't be
// had (its unauthenticated rate limit is 60 an hour per address).
const BBA_CARDS_FALLBACK = [
  '21GF-DEFAULT', '21GF-Flannery', '21GF-GIB', '21GF-GIB-Bergen', '21GF-Gazzilli', '21GF-MSS',
  '21GF-MSTandMSS', '21GF-Multi', '21GF-NoInvertedMinor', '21GF-Ogust', '21GF-PolishTwoSuiters',
  '21GF-Puppet', '21GF-SPECIALS', '21GF-SPECIALS2', '21GF-WJS-MSS', 'Basic-Bridge', 'Precision',
  'Precision-14-16',
]

function defaultStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

/** A choice key as { kind: 'scenario' } | { kind: 'bba', name } | { kind: 'mine', id }. */
export function parseCardKey(key) {
  const k = String(key || '')
  if (k.startsWith('bba:') && k.length > 4) return { kind: 'bba', name: k.slice(4) }
  if (k.startsWith('mine:') && k.length > 5) return { kind: 'mine', id: k.slice(5) }
  return { kind: 'scenario' }
}

const validKey = (k) => (parseCardKey(k).kind === 'scenario' ? SCENARIO_DEFAULT : String(k))

/** The saved choice, `{ ns, ew }` keys; the scenario's cards when nothing is saved. */
export function loadTableCards(storage = defaultStorage()) {
  let saved = null
  try { saved = JSON.parse(storage?.getItem(TABLE_CARDS_KEY) || 'null') } catch { /* bad JSON, private mode */ }
  return { ns: validKey(saved?.ns), ew: validKey(saved?.ew) }
}

export function saveTableCards(choice, storage = defaultStorage()) {
  try { storage?.setItem(TABLE_CARDS_KEY, JSON.stringify({ ns: validKey(choice?.ns), ew: validKey(choice?.ew) })) } catch { /* ignore */ }
}

/** True when both sides play the scenario's cards. */
export function isScenarioDefault(choice) {
  return !validKey(choice?.ns) && !validKey(choice?.ew)
}

let bbaCardsPromise = null
/** The BBA card names in PBS `bbsa/`, fetched once per page. */
export function listBbaCards(fetchFn = globalThis.fetch) {
  bbaCardsPromise ??= (async () => {
    try {
      const resp = await fetchFn(PBS_BBSA_LISTING)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const names = (await resp.json())
        .map((f) => f?.name)
        .filter((n) => typeof n === 'string' && n.endsWith('.bbsa'))
        .map((n) => n.slice(0, -5))
        .sort()
      return names.length ? names : BBA_CARDS_FALLBACK
    } catch {
      return BBA_CARDS_FALLBACK
    }
  })()
  return bbaCardsPromise
}

/**
 * Resolve one side's choice for a board.
 *   base     the scenario's card name for this side (used for SCENARIO_DEFAULT)
 *   loadCard (cardId) → { name, card_data }, a saved card
 * Returns { name, rusty, bba: { name, content? } }: the label, Rusty's card spec
 * (a name, or { json }) and what BBA is sent (a name, plus .bbsa text for a
 * card of the user's).
 */
export async function resolveSide(key, base, loadCard) {
  const c = parseCardKey(key)
  if (c.kind === 'bba') return { name: c.name, rusty: c.name, bba: { name: c.name } }
  if (c.kind === 'mine') {
    const card = await loadCard(c.id)
    const name = card?.name || 'My card'
    const data = card?.card_data || {}
    return { name, rusty: { json: data }, bba: { name, content: exportBbsa(data).text } }
  }
  return { name: base, rusty: base, bba: { name: base } }
}

// Every card setting BBA plays from a .bbsa file: what it can be told of a card.
// The map's keys are .bbsa lines; each names a toggle path, a {set} of paths,
// or an {index} path. `implied` is what BBA always plays (Stayman, Jacoby), and
// `derived` what follows from other lines (2/1 game force from the system type).
const BBA_PATHS = (() => {
  const { implied = {}, derived = [], ...keys } = BBSA_MAP
  const out = new Set()
  const add = (p) => { const f = field(p); if (f) out.add(f.path) }
  for (const spec of Object.values(keys)) {
    if (typeof spec === 'string') add(spec)
    else if (spec?.set) Object.keys(spec.set).forEach(add)
    else if (spec?.index) add(spec.index)
  }
  Object.keys(implied).forEach(add)
  for (const d of derived) Object.keys({ ...d.set, ...d.default }).forEach(add)
  return out
})()

/**
 * How much of a user's card each bot plays, as fractions 0..1: `{ rusty, bba }`.
 * The card's bidding settings are the ones Rusty's `coverage` lists (read or
 * ignored); Rusty's share is what its rules read, BBA's what a .bbsa file can
 * carry. Same denominator, so the two compare. `report` is botReport's per-
 * convention breakdown for each, for a fuller view.
 */
export async function cardCoverage(cardData, client = getRbbClient()) {
  const json = JSON.parse(JSON.stringify(cardData || {}))
  const rusty = (await client.coverage({ cards: { ns: { json } } })).ns
  const settings = [...(rusty.read || []), ...(rusty.ignored || [])]
  const bba = {
    read: settings.filter((p) => BBA_PATHS.has(p)),
    ignored: settings.filter((p) => !BBA_PATHS.has(p)),
  }
  const report = { rusty: botReport(json, rusty), bba: botReport(json, bba) }
  return { rusty: report.rusty.score, bba: report.bba.score, report }
}
