// Double-dummy solver client (bridgewebs BSOL). Returns the raw `ddtricks`
// string (20 seat×strain trick counts) for a deal, or null on any failure —
// double-dummy is a best-effort post-hand overlay, never load-bearing.
// Parse cells with ddTrickAt / buildDdRows in handAnalysis.js.

import { handsToPbnString } from './handAnalysis.js'

export async function fetchDoubleDummy(deal) {
  const pbn = ('N:' + handsToPbnString(deal.hands)).replace(/ /g, 'x')
  const vul = deal.vulnerable === 'Both' ? 'All' : deal.vulnerable
  const url = `https://dds.bridgewebs.com/cgi-bin/bsol2/ddummy?request=m&dealstr=${encodeURIComponent(pbn)}&vul=${vul}&club=bridgeclassroom`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const text = await resp.text()
  const json = JSON.parse(text.trim())
  if (!json.sess || !json.sess.ddtricks || json.sess.ddtricks.length < 20) return null
  return json.sess.ddtricks
}
