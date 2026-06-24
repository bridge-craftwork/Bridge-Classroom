import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build-time app provenance, surfaced to the client as compile-time constants.
// Used by the "Report a Problem" payload so filed issues record which app build
// the learner was running. Both are best-effort — never let them break a build.
function appCommit() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

function appVersion() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export default defineConfig({
  plugins: [vue()],
  base: '/',
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit()),
    __APP_VERSION__: JSON.stringify(appVersion())
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
