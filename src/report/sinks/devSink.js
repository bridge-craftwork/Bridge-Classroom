// Dev sink (spec §10, Slice 0). Writes the standard bundle layout to a local
// directory the developer picks once (File System Access API, handle persisted
// in IndexedDB so it survives reloads), and copies a ready-to-paste CC prompt to
// the clipboard on save. No sanitization, no consent, no network — this is the
// tight local iteration loop, not the user-facing pipeline.
//
// Fallback where the File System Access API is unavailable: a single-file JSON
// bundle download (screenshot inlined as a data URL). Degraded but functional.

import { buildCcPrompt } from '../ccPrompt.js'
import { blobToDataUrl } from '../screenshot.js'
import { writeClipboard } from '../clipboard.js'

// Adjudication scaffold — the mutable verdict that gives a LOCAL bundle the
// lifecycle a GitHub report gets from its issue state. `context.json` is the
// immutable evidence (never edited); `adjudication.md` is written after triage.
// Scaffolded at capture with `status: open` so every bundle dir has one, making
// "list unresolved local reports" a frontmatter scan (no query tool needed).
// Status vocabulary: open → triaged → resolved | wontfix | duplicate | rolled-into.
const ADJUDICATION_SCAFFOLD = `---
status: open
resolution:
refs: []
adjudicated_by:
adjudicated_at:
---

## Narrative

_Untriaged._
`

const IDB_NAME = 'bug-report-devsink'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'dir'

// ── tiny IndexedDB handle store ──────────────────────────────────────────────
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet(key) {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
    tx.onsuccess = () => resolve(tx.result)
    tx.onerror = () => reject(tx.error)
  })
}
async function idbSet(key, val) {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── directory handle lifecycle ───────────────────────────────────────────────
export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function ensurePermission(handle) {
  if (!handle?.queryPermission) return true
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

/**
 * Return a usable directory handle, reusing the persisted one when possible.
 * MUST be called from a user gesture on first run (it may show the picker).
 * Returns null if the API is unavailable (caller falls back to file download).
 */
export async function ensureDirHandle() {
  if (!supportsDirectoryPicker()) return null

  const saved = await idbGet(HANDLE_KEY).catch(() => null)
  if (saved && (await ensurePermission(saved).catch(() => false))) {
    return saved
  }

  // First run (or permission lost): let the developer pick their gitignored
  // `dev-reports/` directory. Persist the handle so this is a one-time step.
  const handle = await window.showDirectoryPicker({ id: 'bug-report-devsink', mode: 'readwrite' })
  await idbSet(HANDLE_KEY, handle).catch(() => {})
  return handle
}

// ── path helpers ─────────────────────────────────────────────────────────────
function pad2(n) {
  return String(n).padStart(2, '0')
}
function stampParts(now = new Date()) {
  const yyyy = String(now.getFullYear())
  const mm = pad2(now.getMonth() + 1)
  const stamp =
    `${yyyy}${mm}${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return { yyyy, mm, stamp }
}
function slugify(note) {
  const s = String(note || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'report'
}

async function writeFile(dirHandle, name, contents) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(contents)
  await writable.close()
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── save ─────────────────────────────────────────────────────────────────────
/**
 * Persist a collected bundle to the dev sink. Copies the CC prompt to the
 * clipboard FIRST (on the freshest possible activation from the Submit click),
 * THEN writes the files — so a single Submit both saves and copies with no
 * follow-up click.
 *
 * @param {{context: object, fixture: object, screenshot: Blob|null}} bundle
 * @param {object} [opts]
 * @param {FileSystemDirectoryHandle|null} [opts.dirHandle]  Pre-resolved handle
 *   (resolve it under the click gesture and pass it in). If omitted, tries to
 *   resolve one; falls back to download if unavailable.
 * @param {boolean} [opts.copyClipboard=true]  Set false to skip the copy.
 * @returns {Promise<{ok: boolean, path: string, singleFile: boolean, ccPrompt: string, copied: boolean}>}
 */
export async function saveToDevSink(bundle, opts = {}) {
  const { context, fixture, screenshot, screenshotBoxes } = bundle
  const now = new Date()
  const { yyyy, mm, stamp } = stampParts(now)
  const slug = slugify(context?.note)
  const dirName = `${slug}-${stamp}`

  const dirHandle = opts.dirHandle !== undefined ? opts.dirHandle : await ensureDirHandle().catch(() => null)
  const singleFile = !dirHandle

  // The path is deterministic from the resolved handle + timestamp, so we can
  // build the prompt and copy BEFORE the (slower) file writes.
  const path = singleFile
    ? `${dirName}.bundle.json`
    : `${dirHandle.name}/${yyyy}/${mm}/${dirName}/`
  const ccPrompt = buildCcPrompt({ bundlePath: path, context, singleFile, hasBoxes: !!screenshotBoxes })

  let copied = false
  if (opts.copyClipboard !== false) {
    copied = await writeClipboard(ccPrompt)
  }

  if (singleFile) {
    // Fallback: one JSON file, screenshot inlined as a data URL. No separate
    // mutable file here, so inline the scaffold as a field (dir-bundles get the
    // real adjudication.md; the lifecycle lives with the standard layout).
    const dataUrl = await blobToDataUrl(screenshot).catch(() => null)
    const boxesUrl = await blobToDataUrl(screenshotBoxes).catch(() => null)
    const single = { context, fixture, screenshot: dataUrl, screenshotBoxes: boxesUrl, adjudication: ADJUDICATION_SCAFFOLD }
    triggerDownload(path, new Blob([JSON.stringify(single, null, 2)], { type: 'application/json' }))
  } else {
    // Standard layout: <picked>/YYYY/MM/<slug>-<stamp>/{context,fixture}.json + screenshot.jpg
    const yearDir = await dirHandle.getDirectoryHandle(yyyy, { create: true })
    const monthDir = await yearDir.getDirectoryHandle(mm, { create: true })
    const bundleDir = await monthDir.getDirectoryHandle(dirName, { create: true })
    await writeFile(bundleDir, 'context.json', JSON.stringify(context, null, 2))
    await writeFile(bundleDir, 'fixture.json', JSON.stringify(fixture, null, 2))
    if (screenshot) await writeFile(bundleDir, 'screenshot.jpg', screenshot)
    // Second screenshot with the arranger's bounding-box overlay (grid layouts) — the
    // bundle's own layout X-ray beside the plain shot.
    if (screenshotBoxes) await writeFile(bundleDir, 'screenshot-boxes.jpg', screenshotBoxes)
    // Adjudication scaffold last + guarded: the evidence is already saved, so a
    // scaffold-write hiccup must never fail the report (robustness contract).
    try {
      await writeFile(bundleDir, 'adjudication.md', ADJUDICATION_SCAFFOLD)
    } catch (err) {
      console.warn('[report] adjudication scaffold write failed (bundle still saved):', err)
    }
  }

  return { ok: true, path, singleFile, ccPrompt, copied }
}
