/**
 * Make sure Windows system binaries resolve to the genuine ones.
 *
 * The app spawns roughly ninety system tools by bare name — `powershell.exe`,
 * `netstat`, `ipconfig`, `taskkill`, `cmd`, `shutdown.exe` — and it ships with
 * `requestedExecutionLevel: requireAdministrator`, so anything it launches
 * launches elevated. A bare name is resolved by the OS, and whoever controls
 * that resolution controls what runs as administrator.
 *
 * Most of those tools are safe by accident: CreateProcess searches the system
 * directory before it searches PATH, so `netstat` and friends in System32 cannot
 * be shadowed by a PATH entry. `powershell.exe` is the exception, and it is by
 * far the most-used of them — it lives in
 * `System32\WindowsPowerShell\v1.0\`, which is *not* the system directory, so it
 * is found by walking PATH. A user-writable directory earlier in PATH than that
 * one (a stray `C:\tools`, a loosely-permissioned SDK folder) is enough for an
 * unprivileged local user to drop a `powershell.exe` there and have this app run
 * it with administrator rights.
 *
 * Rather than rewrite ninety call sites, this puts the real directories at the
 * front of PATH once, at startup, before anything spawns. Entries are prepended
 * rather than replacing PATH, because `winget` and `choco` legitimately live
 * elsewhere in it and are still needed.
 *
 * No-op off Windows: pkexec and sudo sanitise the environment themselves, and
 * the unix tools are looked up on a PATH that a non-root user cannot edit for
 * root.
 */

import { join } from 'path'

/** The directories Windows keeps its own tooling in, most specific first. */
function systemBinDirs(systemRoot: string): string[] {
  return [
    join(systemRoot, 'System32'),
    systemRoot,
    join(systemRoot, 'System32', 'Wbem'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ]
}

/**
 * Build the hardened PATH value, exported for testing.
 *
 * Returns null when nothing needs changing, so the caller can leave the
 * environment untouched rather than rewrite it to an identical string.
 */
export function hardenedPath(
  currentPath: string | undefined,
  systemRoot: string | undefined,
): string | null {
  if (!systemRoot) return null

  const dirs = systemBinDirs(systemRoot)
  const existing = (currentPath ?? '').split(';').filter((p) => p.trim() !== '')

  // Case-insensitive comparison: Windows paths are case-insensitive, and the
  // same directory may already appear with different capitalisation.
  const lowered = new Set(dirs.map((d) => d.toLowerCase()))
  const remainder = existing.filter((p) => !lowered.has(p.trim().toLowerCase()))

  const next = [...dirs, ...remainder].join(';')
  return next === currentPath ? null : next
}

/** Prepend the Windows system directories to PATH. Safe to call more than once. */
export function hardenExecutablePath(): void {
  if (process.platform !== 'win32') return
  const systemRoot = process.env.SystemRoot || process.env.windir
  const next = hardenedPath(process.env.PATH, systemRoot)
  if (next !== null) process.env.PATH = next
}
