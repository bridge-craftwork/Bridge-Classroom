// Rusty's rules, as published: the convention pack's snapshot from
// bridge-common-conventions (its `published` branch, served by GitHub Pages).
// The practice table bids with the newest published rules, so a rule change
// needs no new build of this app; the engine carries a copy for when this
// fetch fails or the snapshot is in a rule language the engine does not read.
//
// manifest.json says which rules these are (the rules number, the commit they
// were built from, the rule language) and the hash of pack.json, which is
// checked: the two files are published together, but a cache may serve one
// from before the other.

export const PACK_BASE = 'https://bridge-craftwork.github.io/bridge-common-conventions/'

async function sha256Hex(text, subtle) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function get(fetchFn, url, init) {
  const resp = await fetchFn(url, init)
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`)
  return resp
}

/**
 * Fetch the published snapshot.
 * Resolves { text, rules_number, source_commit, language }: pack.json as its
 * text (what the engine's `pack` field takes) and what the manifest says of
 * it. Rejects when either file can't be had or the snapshot's hash is not the
 * manifest's after one fresh try.
 */
export async function fetchPublishedPack({ fetchFn = globalThis.fetch, base = PACK_BASE, subtle = globalThis.crypto?.subtle } = {}) {
  let last = null
  for (const cache of ['no-cache', 'reload']) {
    const manifest = await (await get(fetchFn, `${base}manifest.json`, { cache })).json()
    const text = await (await get(fetchFn, `${base}pack.json?n=${manifest.rules_number}`, { cache })).text()
    if (manifest.pack_sha256 && subtle && (await sha256Hex(text, subtle)) !== manifest.pack_sha256) {
      last = new Error(`pack.json is not the snapshot manifest.json names (rules number ${manifest.rules_number})`)
      continue
    }
    return {
      text,
      rules_number: manifest.rules_number ?? null,
      source_commit: manifest.source_commit ?? null,
      language: manifest.rule_language_version ?? null,
    }
  }
  throw last
}
