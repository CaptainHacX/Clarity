#!/usr/bin/env node

/**
 * Compile the macOS CoreWLAN addon after an install.
 *
 * Why this exists rather than letting npm do it: `clarity-corewlan` is an
 * optionalDependency on a `file:` path, so npm records it in the lockfile as a
 * bare link —
 *
 *   "node_modules/clarity-corewlan": { "resolved": "src/native/corewlan", "link": true }
 *
 * — with no `hasInstallScript` flag. `npm ci` therefore symlinks the directory
 * and never invokes node-gyp, so a clean checkout has no binary. `npm rebuild
 * clarity-corewlan` reports "rebuilt dependencies successfully" and also builds
 * nothing, for the same reason. The gap is invisible locally, because an earlier
 * `npm install` leaves `build/` behind and `build/` is gitignored.
 *
 * The consequence was not just red CI: a packaged macOS build had no addon, so
 * BSSIDs were unavailable in the shipped app.
 *
 * The addon is pure N-API (`node_api.h`), and N-API is ABI-stable across Node
 * and Electron, so this single Release build is loadable by both the test run
 * and the packaged app — no per-runtime rebuild needed.
 *
 * Exit code is 0 on every path, including failure. Windows and Linux compile
 * nothing (binding.gyp sets `type: none` there) and the JS loader reads a
 * missing binary as "no native scanner", falling back to `netsh wlan show
 * networks mode=bssid` and `nmcli`, neither of which needs a permission grant.
 * A developer without the Xcode command line tools should still end up with a
 * working checkout. CI asserts the binary is present in its own step, so a
 * silent regression cannot reach a release.
 */

const { spawnSync } = require('child_process')
const { existsSync, statSync } = require('fs')
const path = require('path')

const ADDON_DIR = path.join(__dirname, '..', 'src', 'native', 'corewlan')
const BINARY = path.join(ADDON_DIR, 'build', 'Release', 'clarity_corewlan.node')
const SOURCES = ['corewlan.mm', 'binding.gyp'].map((f) => path.join(ADDON_DIR, f))

function log(msg) {
  console.log(`[build-native] ${msg}`)
}

// Only macOS has CoreWLAN. Everywhere else this is a no-op by design.
if (process.platform !== 'darwin') {
  log(`${process.platform}: nothing to build (BSSIDs come from netsh/nmcli)`)
  process.exit(0)
}

if (!existsSync(ADDON_DIR)) {
  log('addon sources not found; skipping')
  process.exit(0)
}

// Skip a recompile when the binary is already newer than every source, so
// repeated installs stay fast.
if (existsSync(BINARY)) {
  const built = statSync(BINARY).mtimeMs
  const newestSource = Math.max(
    ...SOURCES.filter(existsSync).map((f) => statSync(f).mtimeMs),
  )
  if (built >= newestSource) {
    log('binary is up to date')
    process.exit(0)
  }
  log('sources changed since the last build; recompiling')
}

// Prefer resolving node-gyp as a module over the .bin shim: the shim only
// exists while some dependency happens to hoist it, whereas this follows the
// declared devDependency.
function resolveNodeGyp() {
  try {
    return require.resolve('node-gyp/bin/node-gyp.js')
  } catch {
    const shim = path.join(
      __dirname,
      '..',
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp',
    )
    return existsSync(shim) ? shim : null
  }
}

const gyp = resolveNodeGyp()
if (!gyp) {
  log('WARNING: node-gyp not found — skipping the CoreWLAN addon.')
  log('         Wi-Fi scanning still works; BSSIDs will be unavailable.')
  process.exit(0)
}

const isJs = gyp.endsWith('.js')
const result = spawnSync(
  isJs ? process.execPath : gyp,
  isJs ? [gyp, 'rebuild'] : ['rebuild'],
  { cwd: ADDON_DIR, stdio: 'inherit' },
)

if (result.status !== 0 || !existsSync(BINARY)) {
  log('WARNING: the CoreWLAN addon failed to build.')
  log('         Wi-Fi scanning still works; BSSIDs will be unavailable until')
  log('         the Xcode command line tools are installed (xcode-select --install).')
  process.exit(0)
}

log('CoreWLAN addon built')
