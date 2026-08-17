/**
 * Loader for the CoreWLAN bridge.
 *
 * Returns `null` on anything other than a working macOS build — a missing
 * binary, an ABI mismatch, Windows, Linux. Callers treat null as "no native
 * scanner" and fall back to the per-platform paths, which on Windows
 * (`netsh wlan show networks mode=bssid`) and Linux (`nmcli ... BSSID`) already
 * return BSSIDs with no permission gate. Only macOS needs this module, because
 * only macOS ties BSSIDs to a per-bundle Location grant.
 *
 * Never throws: a Wi-Fi page must still render on a machine where this failed
 * to compile.
 */

let cached
let loaded = false

function load() {
  if (loaded) return cached
  loaded = true
  cached = null

  if (process.platform !== 'darwin') return cached

  // Both layouts: a debug build and the release build npm produces.
  const candidates = [
    './build/Release/clarity_corewlan.node',
    './build/Debug/clarity_corewlan.node',
  ]
  for (const rel of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(rel)
      if (mod && typeof mod.scanJson === 'function') {
        cached = mod
        break
      }
    } catch {
      // Try the next layout; exhausting them means no native scanner.
    }
  }
  return cached
}

module.exports = { load }
