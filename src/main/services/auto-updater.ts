import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { getSettings } from './settings-store'
import type { UpdateStatus } from '../../shared/types'

// The app publishes to GitHub (see package.json repository / electron-builder.yml).
// Used as a fallback when app-update.yml is missing so "Check for updates" never
// crashes with an ENOENT for locally built (--dir) packages.
const GITHUB_OWNER = 'CaptainHacX'
const GITHUB_REPO = 'Clarity'
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

let status: UpdateStatus = { state: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null

// electron-updater requires app-update.yml, which electron-builder only writes
// into the packaged resources when a publishable target is built. Detect it once
// up front; when absent we use the GitHub releases API instead of electron-updater.
let hasUpdateConfig = false

function hasAppUpdateConfig(): boolean {
  if (!app.isPackaged) return false
  return existsSync(join(process.resourcesPath, 'app-update.yml'))
}

/** Compare dotted numeric versions (e.g. "1.0.3" vs "1.2.0"). Returns true when latest > current. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

function broadcast(s: UpdateStatus): void {
  status = s
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    // isDestroyed() returns false while the render frame is mid-teardown,
    // so .send() still throws "Render frame was disposed before WebFrameMain
    // could be accessed". Swallow it — there's no recipient anyway, and the
    // unhandled stack trace was the loudest signal in issue #148, masking
    // the actual renderer crash.
    try {
      win.webContents.send(IPC.UPDATER_STATUS, s)
    } catch { /* renderer gone — nothing to deliver to */ }
  }
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  // On Linux, electron-updater only supports AppImage.
  // Skip if not running as an AppImage to avoid silent failures.
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    console.log('Auto-updater: skipping on Linux (not running as AppImage)')
    return
  }

  const settings = getSettings()
  hasUpdateConfig = hasAppUpdateConfig()

  if (hasUpdateConfig) {
    autoUpdater.autoDownload = settings.autoUpdate
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      broadcast({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      broadcast({ state: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      broadcast({ state: 'not-available' })
    })

    autoUpdater.on('download-progress', (prog) => {
      broadcast({ state: 'downloading', progress: Math.round(prog.percent) })
    })

    autoUpdater.on('update-downloaded', (info) => {
      broadcast({ state: 'downloaded', version: info.version })
      // GUI mode: auto-restart if the user opted in
      const current = getSettings()
      if (current.autoRestart) {
        console.log(`Auto-updater: auto-restart enabled, installing v${info.version} and restarting...`)
        autoUpdater.quitAndInstall(true, true)
      }
    })

    autoUpdater.on('error', (err) => {
      broadcast({ state: 'error', error: err?.message || 'Update failed' })
    })
  } else {
    console.log('Auto-updater: app-update.yml not found in resources — using GitHub releases API fallback')
  }

  // Check on startup (routes through electron-updater or the GitHub fallback)
  checkForUpdates()

  // Periodic background checks
  startPeriodicChecks(settings.updateCheckIntervalHours)
}

function startPeriodicChecks(intervalHours: number): void {
  if (checkInterval) clearInterval(checkInterval)
  if (intervalHours <= 0) return
  const ms = intervalHours * 60 * 60 * 1000
  checkInterval = setInterval(() => {
    const settings = getSettings()
    if (hasUpdateConfig) {
      autoUpdater.autoDownload = settings.autoUpdate
    }
    void checkForUpdates()
  }, ms)
}

/** Call when the user changes updateCheckIntervalHours at runtime */
export function updateCheckInterval(hours: number): void {
  if (!app.isPackaged) return
  startPeriodicChecks(hours)
}

export function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  if (!hasUpdateConfig) return checkViaGitHub()
  // electron-updater already broadcasts the failure via its 'error' event; swallow
  // the rejection so it never surfaces as an unhandled rejection in the renderer.
  return autoUpdater.checkForUpdates().then(
    () => {},
    (err) => console.error('Auto-updater check failed:', (err as Error)?.message || err),
  )
}

export function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  if (!hasUpdateConfig) {
    // No app-update.yml (e.g. locally built --dir package): there is no
    // installable artifact electron-updater can pull, so open the release page
    // in the browser as the download option.
    shell.openExternal(GITHUB_RELEASES_PAGE).catch(() => {})
    return Promise.resolve()
  }
  return autoUpdater.downloadUpdate().then(
    () => {},
    (err) => console.error('Auto-updater download failed:', (err as Error)?.message || err),
  )
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  if (hasUpdateConfig) {
    autoUpdater.quitAndInstall(true, true)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setAutoDownload(enabled: boolean): void {
  if (app.isPackaged && hasUpdateConfig) {
    autoUpdater.autoDownload = enabled
  }
}

/**
 * GitHub releases API fallback used when app-update.yml is absent (electron-builder
 * only writes it for publishable targets). Compares the latest release tag against
 * the running app version so "Check for updates" still works for locally built
 * packages instead of crashing with ENOENT.
 */
async function checkViaGitHub(): Promise<void> {
  broadcast({ state: 'checking' })
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Clarity/${app.getVersion()}` },
    })
    if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string }
    const latest = (data.tag_name ?? '').replace(/^v/i, '')
    const current = app.getVersion()
    if (latest && isNewerVersion(latest, current)) {
      broadcast({ state: 'available', version: latest })
    } else {
      broadcast({ state: 'not-available' })
    }
  } catch (err) {
    broadcast({ state: 'error', error: (err as Error)?.message || 'Update check failed' })
  }
}
