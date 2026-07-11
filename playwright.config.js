// Playwright e2e harness for the durable-session feature (ADR-0004).
//
// Self-contained: spins up a fresh local API (COOKIE_SECURE=false so the cookie
// works over http on localhost) against a throwaway SQLite DB, plus a Vite dev
// server pointed at that API. Run with `npm run test:e2e`.
//
// Prereq: the debug API binary must be built —
//   (cd bridge-classroom-api && cargo build)

import { defineConfig, devices } from '@playwright/test'

const API_PORT = 3989
const WEB_PORT = 5199
const DB_PATH = '/tmp/bc-e2e.db'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Fresh DB each run; the binary must already be built.
      command: `rm -f ${DB_PATH} ${DB_PATH}-* && ./bridge-classroom-api/target/debug/bridge-classroom-api`,
      env: {
        API_KEY: 'e2ekey',
        DATABASE_URL: `sqlite:${DB_PATH}?mode=rwc`,
        COOKIE_SECURE: 'false',
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        RECOVERY_SECRET: 'e2e-escrow-secret',
        ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}/api`,
        VITE_API_KEY: 'e2ekey',
      },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
