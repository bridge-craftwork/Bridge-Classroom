// ADR-0004 §3a acceptance test: the device-session roster survives an ITP-style
// localStorage purge.
//
// Two users are admitted on ONE browser (device) — here via the registration
// admission gate, driven through the browser context so the server's device
// cookie lands in the context's jar exactly as it would in Safari. We then wipe
// localStorage (simulating ITP's ~7-day purge) while keeping the cookie, reload,
// and assert the app silently reconstructs BOTH users' local state and resumes as
// the active member — with no WelcomeScreen and no recovery email.

import { test, expect } from '@playwright/test'

const API = 'http://localhost:3989/api'
const KEY = 'e2ekey'
const HEADERS = { 'x-api-key': KEY, 'Content-Type': 'application/json' }

async function register(context, user) {
  const res = await context.request.post(`${API}/users`, { headers: HEADERS, data: user })
  expect(res.ok(), `register ${user.user_id}`).toBeTruthy()
  return res
}

function readStore(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('bridgePractice') || '{}')
    } catch {
      return {}
    }
  })
}

test('device roster restores silently after a localStorage purge', async ({ page, context }) => {
  // --- Admit two users on this device (Set-Cookie → context cookie jar) --------
  await register(context, {
    user_id: 'e2e-u1',
    first_name: 'Ada',
    last_name: 'One',
    email: 'e2e-u1@example.com',
    secret_key: 'AES-E2E-1',
  })
  await register(context, {
    user_id: 'e2e-u2',
    first_name: 'Bo',
    last_name: 'Two',
    email: 'e2e-u2@example.com',
    secret_key: 'AES-E2E-2',
  })

  // The device session cookie must exist (server-set, HttpOnly).
  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === 'bc_session'), 'device cookie set').toBeTruthy()

  // --- Simulate the ITP purge: empty localStorage, KEEP the cookie -----------
  await page.addInitScript(() => {
    try {
      localStorage.clear()
    } catch {}
  })

  // --- Load the app fresh — restore should run on startup --------------------
  await page.goto('/')

  // localStorage should be rebuilt with BOTH roster members.
  await expect
    .poll(async () => Object.keys((await readStore(page)).users || {}).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)

  const store = await readStore(page)
  expect(Object.keys(store.users)).toEqual(expect.arrayContaining(['e2e-u1', 'e2e-u2']))

  // Resumed as one of the roster members (the active/newest), not logged out.
  expect(['e2e-u1', 'e2e-u2']).toContain(store.currentUserId)

  // Both reconstructed with their escrowed key material (batch redelivery).
  expect(store.users['e2e-u1'].secretKey).toBe('AES-E2E-1')
  expect(store.users['e2e-u2'].secretKey).toBe('AES-E2E-2')

  // The WelcomeScreen (unauthenticated entry) must NOT be showing.
  const welcome = page.locator('text=/create your account|get started|welcome to bridge/i')
  expect(await welcome.count()).toBe(0)
})
