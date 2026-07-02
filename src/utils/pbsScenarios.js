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
  // Prefer the auction-filtered set when present (deals vetted against BBA).
  BBA_FILTERED_DIR: '/bba-filtered',
  DLR_DIR: '/dlr',
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

// Deals for a scenario: bba-filtered set first, plain pbn as fallback.
// Returns parsePbn() deal objects (dealer, vulnerable, dealString, …).
export async function fetchScenarioDeals(file) {
  for (const dir of [PBS.BBA_FILTERED_DIR, PBS.PBN_DIR]) {
    const resp = await fetch(`${PBS.RAW_BASE}${dir}/${file}.pbn`)
    if (!resp.ok) continue
    const deals = parsePbn(await resp.text()).filter((d) => d.dealString)
    if (deals.length > 0) return deals
  }
  throw new Error(`no PBN deals for ${file}`)
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
