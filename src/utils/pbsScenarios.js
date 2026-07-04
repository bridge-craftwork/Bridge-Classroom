// Practice-Bidding-Scenarios (PBS) repo access: the scenario button-layout
// menu and per-scenario PBN deals. Extracted from BiddingPracticeView's
// inline logic so the table's deal-source picker can share the same menu
// and files (the view still has its own copy — consolidating it onto this
// module is a welcome cleanup, not yet done).

import { parsePbn } from './pbnParser.js'

export const PBS = {
  RAW_BASE: 'https://raw.githubusercontent.com/ADavidBailey/Practice-Bidding-Scenarios/main',
  BUTTON_LAYOUT: '/btn/-button-layout-release.txt',
  PBN_DIR: '/pbn',
  // Scenarios draw from the auction-filtered set: a tighter subset of /pbn where
  // BBA's generated auction matches the scenario's intent. For conventions BBA
  // doesn't know it equals /pbn (no filtering) — see `bba-works` in fetchScenarioMeta.
  BBA_FILTERED_DIR: '/bba-filtered',
  // Curated draws from a distinct, hand-curated set (provisional location).
  COACHING_CURATED_DIR: '/coaching-curated',
  DLR_DIR: '/dlr',
  BTN_DIR: '/btn',
}

export function prettifyLabel(file) {
  return file.replace(/_/g, ' ').replace(/-/g, ' ').trim()
}

function parseCell(cell) {
  if (cell.startsWith('(') && cell.endsWith(')')) {
    cell = cell.slice(1, -1).split(',')[0].trim()
  }
  if (cell === '---' || !cell) return null
  const file = cell.replace(/:[a-zA-Z]+/g, '').replace(/:\d+%/g, '').trim()
  if (!file) return null
  return { file, label: prettifyLabel(file) }
}

function parseRow(line) {
  const cells = []
  let depth = 0
  let buf = ''
  for (const ch of line) {
    if (ch === '(') { depth++; buf += ch }
    else if (ch === ')') { depth--; buf += ch }
    else if (ch === ',' && depth === 0) { cells.push(buf.trim()); buf = '' }
    else { buf += ch }
  }
  if (buf.trim()) cells.push(buf.trim())
  return cells.map(parseCell)
}

// The button-layout text → [{type:'major',label} | {type:'section',label,items:[{file,label}]}]
export function parseButtonLayout(text) {
  const tree = []
  let currentSection = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[Major]')) {
      tree.push({ type: 'major', label: line.substring('[Major]'.length).trim() })
      currentSection = null
      continue
    }
    if (line.startsWith('[Section]')) {
      currentSection = {
        type: 'section',
        label: line.substring('[Section]'.length).trim(),
        items: [],
      }
      tree.push(currentSection)
      continue
    }
    if (line.startsWith('[Action]')) continue
    if (!currentSection) continue
    for (const cell of parseRow(line)) {
      if (cell) currentSection.items.push(cell)
    }
  }
  return tree
}

export async function fetchScenarioMenu() {
  const resp = await fetch(PBS.RAW_BASE + PBS.BUTTON_LAYOUT)
  if (!resp.ok) throw new Error(`menu fetch failed (${resp.status})`)
  return parseButtonLayout(await resp.text())
}

// Deals for a scenario. `curated:true` draws from the distinct coaching-curated
// set; otherwise from bba-filtered (auction-vetted) with plain /pbn as fallback.
// Returns parsePbn() deal objects (dealer, vulnerable, dealString, …).
export async function fetchScenarioDeals(file, { curated = false } = {}) {
  const dirs = curated ? [PBS.COACHING_CURATED_DIR] : [PBS.BBA_FILTERED_DIR, PBS.PBN_DIR]
  for (const dir of dirs) {
    const resp = await fetch(`${PBS.RAW_BASE}${dir}/${file}.pbn`)
    if (!resp.ok) continue
    const deals = parsePbn(await resp.text()).filter((d) => d.dealString)
    if (deals.length > 0) return deals
  }
  throw new Error(curated ? `no curated deals for ${file}` : `no deals for ${file}`)
}

// Per-scenario metadata from /btn/<file>.btn — the authoritative display name
// (`# button-text:`) and the BBA-support flag (`# bba-works: true|false`).
// Scenarios BBA doesn't fully support play better with a human partner than a
// BBA bot, so the picker flags them. Optimistic default (bbaWorks:true,
// buttonText:null) on any miss/error. Mirrors BiddingPracticeView's fetchBtnMetadata.
export async function fetchScenarioMeta(file) {
  try {
    const resp = await fetch(`${PBS.RAW_BASE}${PBS.BTN_DIR}/${file}.btn`)
    if (!resp.ok) return { bbaWorks: true, buttonText: null }
    const text = await resp.text()
    const meta = { bbaWorks: true, buttonText: null }
    for (const raw of text.split('\n').slice(0, 40)) {
      if (!raw.startsWith('#')) continue
      const bba = raw.match(/^#\s*bba-works:\s*(\w+)/i)
      if (bba) meta.bbaWorks = bba[1].toLowerCase() === 'true'
      const btn = raw.match(/^#\s*button-text:\s*(.+?)\s*$/i)
      if (btn) meta.buttonText = btn[1]
    }
    return meta
  } catch {
    return { bbaWorks: true, buttonText: null }
  }
}

// Raw dealer-script text for a scenario (the /dlr twin of the PBN file).
export async function fetchScenarioScript(file) {
  const resp = await fetch(`${PBS.RAW_BASE}${PBS.DLR_DIR}/${file}.dlr`)
  if (!resp.ok) throw new Error(`no dealer script for ${file} (${resp.status})`)
  return resp.text()
}

// Minimal single-board PBN from a parsePbn() deal object — the canonical
// payload the table service's {"t":"deal","source":"pbn"} accepts.
export function dealToMinimalPbn(deal, boardNumber = 1) {
  return [
    `[Board "${deal.boardNumber || boardNumber}"]`,
    `[Dealer "${deal.dealer || 'N'}"]`,
    `[Vulnerable "${deal.vulnerable || 'None'}"]`,
    `[Deal "${deal.dealString}"]`,
    '',
  ].join('\n')
}

export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}
