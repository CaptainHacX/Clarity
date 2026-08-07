import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PlatformSecurity } from '../types'

const execFileAsync = promisify(execFile)

let cachedIsServer: boolean | null = null
let cachedIsServerAt = 0
const IS_SERVER_TTL_MS = 24 * 60 * 60_000 // re-check daily

async function isServerMode(): Promise<boolean> {
  if (cachedIsServer !== null && Date.now() - cachedIsServerAt < IS_SERVER_TTL_MS) return cachedIsServer
  try {
    const { stdout } = await execFileAsync('systemctl', ['get-default'], { timeout: 5_000 })
    const target = stdout.trim()
    if (target === 'multi-user.target') {
      cachedIsServer = true
    } else if (target === 'graphical.target') {
      // graphical.target can be set even on headless servers (e.g. Ubuntu with
      // desktop packages installed but no display server running).  Check if a
      // graphical session is actually active via loginctl.
      cachedIsServer = !(await hasGraphicalSession())
    } else {
      cachedIsServer = true // rescue, emergency, etc.
    }
  } catch {
    cachedIsServer = !process.env.XDG_SESSION_TYPE || process.env.XDG_SESSION_TYPE === 'tty'
  }
  cachedIsServerAt = Date.now()
  return cachedIsServer
}

/** Return true if loginctl reports at least one x11 or wayland session. */
async function hasGraphicalSession(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'loginctl', ['list-sessions', '--no-legend', '--no-pager'],
      { timeout: 5_000 },
    )
    // Each line is: SESSION UID USER SEAT TTY
    // Fetch the Type property for each session id.
    for (const line of stdout.trim().split('\n')) {
      const sessionId = line.trim().split(/\s+/)[0]
      if (!sessionId) continue
      try {
        const { stdout: typeLine } = await execFileAsync(
          'loginctl', ['show-session', sessionId, '--property=Type', '--value'],
          { timeout: 3_000 },
        )
        const t = typeLine.trim()
        if (t === 'x11' || t === 'wayland') return true
      } catch { /* skip individual session errors */ }
    }
  } catch { /* loginctl not available — fall through */ }
  return false
}

export function createLinuxSecurity(): PlatformSecurity {
  return {
    isServer: isServerMode,
  }
}
