// Entry-point screenshots for the live /dev gallery (Tab 2). Drives the REAL
// app with Playwright, a signed-in user seeded into localStorage, and captures
// each headline surface to docs/dev/shots/<id>.png.
//
// URL-parametrized so a CI job runs it unchanged:
//   BASE_URL   app origin (default http://localhost:4173 — a local preview)
//   ONLY       comma list of surface ids to capture (default the LOCAL set)
//   BC_SESSION value for a `bc_session` cookie (server-backed surfaces, live .org)
//
// First cut captures the LOCAL surfaces (A1, B1) — no table-service needed. The
// server-backed B2/B3/C1 stay as committed placeholders until their seeded-
// session automation lands (see the plan's follow-up). Structure mirrors
// scripts/a1-gallery.mjs (the existing harness walk).
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = path.join(ROOT, 'docs/dev/shots')
const BASE = process.env.BASE_URL || 'http://localhost:4173'
const APP = `${BASE.replace(/\/$/, '')}/solo-practice-app`

// A signed-in student, seeded before the app boots so the lobby renders `.app`
// instead of the WelcomeScreen. Shape per src/composables/useUserStore.js.
const SEED_USER = {
  id: 'dev-shots-student',
  firstName: 'Alex',
  lastName: 'Rivera',
  email: 'alex.rivera@example.com',
  classrooms: [],
  dataConsent: true,
  role: 'student',
  serverRegistered: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const SEED = JSON.stringify({ users: { [SEED_USER.id]: SEED_USER }, currentUserId: SEED_USER.id })

// LOCAL = capturable without table-service. SERVER = needs a live session; left
// to the follow-up (placeholder committed instead).
const SURFACES = [
  { id: 'A1', tier: 'local',  route: '#/',              wait: '.app' },
  { id: 'B1', tier: 'local',  route: '#/table',         wait: '.bp-app' },
  { id: 'B2', tier: 'server', route: '#/table?host=1',  wait: '.th-page, .bp-app' },
  { id: 'B3', tier: 'server', route: '#/table/demo',    wait: '.bp-app, .tv-title' },
  { id: 'C1', tier: 'server', route: '#/tables/console', wait: '.console, .tc-page, .app' },
]

const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)
const targets = only.length
  ? SURFACES.filter((s) => only.includes(s.id))
  : SURFACES.filter((s) => s.tier === 'local')

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })

// Seed identity in localStorage for the app origin before any page navigates.
await context.addInitScript((seed) => {
  try { localStorage.setItem('bridgePractice', seed) } catch { /* ignore */ }
}, SEED)

// Optional bc_session cookie for the server-backed surfaces against live .org.
if (process.env.BC_SESSION) {
  const host = new URL(BASE).hostname
  await context.addCookies([{ name: 'bc_session', value: process.env.BC_SESSION, domain: host, path: '/', httpOnly: false, secure: BASE.startsWith('https') }])
}

let ok = 0
for (const s of targets) {
  const page = await context.newPage()
  const url = `${APP}/${s.route}`
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    if (s.wait) {
      await page.waitForSelector(s.wait, { state: 'visible', timeout: 12000 }).catch(() => {
        console.warn(`  ${s.id}: wait selector "${s.wait}" not seen — capturing current state`)
      })
    }
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {})
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const out = path.join(OUT, `${s.id}.png`)
    await page.screenshot({ path: out })
    console.log(`  ${s.id} → ${path.relative(ROOT, out)}`)
    ok++
  } catch (err) {
    console.error(`  ${s.id}: FAILED (${err.message})`)
  } finally {
    await page.close()
  }
}
await browser.close()
console.log(`dev-shots: captured ${ok}/${targets.length} (${targets.map((t) => t.id).join(', ') || 'none'}) from ${APP}`)
if (ok < targets.length) process.exitCode = 1
