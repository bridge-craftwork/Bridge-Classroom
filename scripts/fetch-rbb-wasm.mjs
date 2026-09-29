#!/usr/bin/env node
// Fetch Rusty, the rule-based bidding engine (rusty-bidding-bot's WASM
// package), into public/rbb-wasm/ where Vite serves it as /rbb-wasm/.
//
// The package is NOT vendored (rusty-bidding-bot integration plan, Q7): it is
// downloaded from a pinned GitHub release of bridge-craftwork/rusty-bidding-bot
// and checked against the SHA-256 committed beside the tag in
// scripts/rbb-wasm.release.json. Upgrading is a change of `tag` and `sha256`
// there. public/rbb-wasm/ is gitignored.
//
//   node scripts/fetch-rbb-wasm.mjs           # prebuild: any failure fails the build
//   node scripts/fetch-rbb-wasm.mjs --soft    # predev: a network failure only warns
//
// Local development against an unreleased engine: build it in the sibling
// checkout (`crates/wasm/build.sh` in rusty-bidding-bot) and point this script
// at the package directory instead of the release:
//
//   RBB_WASM_LOCAL=../rusty-bidding-bot/crates/wasm/pkg npm run dev
//
// (relative paths are from this repo's root). The local package is copied on
// every run, so a rebuilt engine is picked up by restarting `npm run dev`.
//
// The script also writes public/rbb-wasm/build-info.json: where the package
// came from (release tag + hash, or local), and the engine's own `info()`
// (api, version, rules_id) plus whether it has the `auction` entry point the
// practice table needs (added after v0.1.0-rc1). vite.config.js reads it into
// the app's build info (__RBB_WASM__).
//
// TODO(R4, rusty-bidding-bot#7): once releases carry SHA256SUMS, take the
// value from there when bumping the tag (the committed hash stays the check).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PIN_FILE = join(ROOT, 'scripts', 'rbb-wasm.release.json')
const DEST = join(ROOT, 'public', 'rbb-wasm')
const FILES = ['rbb_wasm.js', 'rbb_wasm_bg.wasm']
const soft = process.argv.includes('--soft')

function log(msg) { console.log(`fetch-rbb-wasm: ${msg}`) }
class HashMismatch extends Error {}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// The engine's info() and exported functions, by loading the package in Node.
async function engineInfo(dir) {
  const glue = await import(pathToFileURL(join(dir, 'rbb_wasm.js')).href + `?t=${Date.now()}`)
  glue.initSync({ module: readFileSync(join(dir, 'rbb_wasm_bg.wasm')) })
  const info = JSON.parse(glue.info())
  return {
    api: info.api ?? null,
    version: info.version ?? null,
    rules_id: info.rules_id ?? null,
    supports_auction: typeof glue.auction === 'function' && typeof glue.meaning === 'function',
  }
}

function sha256(buf) { return createHash('sha256').update(buf).digest('hex') }

async function fromRelease(pin) {
  const prior = readJson(join(DEST, 'build-info.json'))
  if (prior && prior.source === 'release' && prior.tag === pin.tag && prior.sha256 === pin.sha256
      && FILES.every((f) => existsSync(join(DEST, f)))) {
    log(`${pin.tag} already in public/rbb-wasm/`)
    return
  }
  const url = `https://github.com/${pin.repo}/releases/download/${pin.tag}/${pin.asset}`
  log(`downloading ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const got = sha256(buf)
  if (got !== pin.sha256) {
    throw new HashMismatch(
      `${pin.asset} of ${pin.tag} has SHA-256 ${got}, but scripts/rbb-wasm.release.json expects ${pin.sha256}. ` +
      'The release asset changed or the pin is wrong: do not bump the hash without knowing why.')
  }
  const tmp = mkdtempSync(join(tmpdir(), 'rbb-wasm-'))
  try {
    writeFileSync(join(tmp, pin.asset), buf)
    execFileSync('tar', ['xzf', join(tmp, pin.asset), '-C', tmp])
    install(join(tmp, 'pkg'))
    const info = await engineInfo(DEST)
    writeInfo({ source: 'release', repo: pin.repo, tag: pin.tag, sha256: pin.sha256, ...info })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function fromLocal(dir) {
  const abs = resolve(ROOT, dir)
  if (!FILES.every((f) => existsSync(join(abs, f)))) {
    throw new Error(`RBB_WASM_LOCAL=${dir}: no ${FILES.join(' / ')} there (build it with crates/wasm/build.sh)`)
  }
  install(abs)
  const info = await engineInfo(DEST)
  writeInfo({ source: 'local', tag: null, sha256: sha256(readFileSync(join(DEST, 'rbb_wasm_bg.wasm'))), ...info })
}

function install(pkgDir) {
  mkdirSync(DEST, { recursive: true })
  for (const f of FILES) copyFileSync(join(pkgDir, f), join(DEST, f))
}

function writeInfo(info) {
  writeFileSync(join(DEST, 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
  log(`installed ${info.source === 'local' ? 'a local build' : info.tag}: api ${info.api}, ` +
      `version ${info.version}, rules ${info.rules_id}` +
      (info.supports_auction ? '' : ' (no `auction`: the Rusty table needs rusty-bidding-bot v0.2.0 or later)'))
}

try {
  const local = process.env.RBB_WASM_LOCAL
  if (local) await fromLocal(local)
  else {
    const pin = readJson(PIN_FILE)
    if (!pin?.tag || !pin?.sha256) throw new Error('scripts/rbb-wasm.release.json needs `tag` and `sha256`')
    await fromRelease(pin)
  }
} catch (err) {
  if (soft && !(err instanceof HashMismatch)) {
    log(`WARNING: ${err.message}. The Rusty bidder will not load; BBA tables are unaffected.`)
  } else {
    console.error(`fetch-rbb-wasm: ERROR: ${err.message}`)
    process.exit(1)
  }
}
