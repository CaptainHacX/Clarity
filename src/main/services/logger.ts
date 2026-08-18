import { join } from 'path'
import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { app } from 'electron'
import { homedir } from 'os'

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB
const ROTATION_CHECK_INTERVAL_MS = 60_000 // only stat the file every 60s

// Lazy getters — LOG_DIR must not be resolved at import time because
// app.setPath('userData', ...) may run later (e.g. elevated relaunch).
let _logDir: string | null = null
function logDir(): string {
  if (!_logDir) {
    _logDir = join(app.getPath('userData'), 'logs')
    try { mkdirSync(_logDir, { recursive: true }) } catch { /* ignore */ }
  }
  return _logDir
}
function logFile(): string { return join(logDir(), 'clarity.log') }
function logFileOld(): string { return join(logDir(), 'clarity.old.log') }

const lastRotationCheck = new Map<string, number>()

function rotateIfNeeded(file: string, oldFile: string): void {
  const now = Date.now()
  const lastCheck = lastRotationCheck.get(file) ?? 0
  if (now - lastCheck < ROTATION_CHECK_INTERVAL_MS) return

  lastRotationCheck.set(file, now)
  try {
    const stats = statSync(file)
    if (stats.size > MAX_LOG_SIZE) {
      try { unlinkSync(oldFile) } catch { /* ignore */ }
      renameSync(file, oldFile)
    }
  } catch {
    // File doesn't exist yet, no rotation needed
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

/**
 * Replace the user's home directory with `~` in anything written to the log.
 *
 * Nothing here logs a credential — the app has no accounts and collects no
 * passwords — but stack traces and error messages carry absolute paths, and on
 * both macOS (`/Users/<name>`) and Windows (`C:\Users\<name>`) that path embeds
 * the account name. clarity.log is the file users attach to bug reports, so it
 * was handing over a real name with every crash. `~/…` keeps the path just as
 * readable for debugging.
 *
 * Resolved lazily and cached: os.homedir() is stable for the process, and the
 * substitution runs on every log line.
 */
let _homeDir: string | null = null
function homeDir(): string {
  if (_homeDir === null) {
    try {
      _homeDir = homedir()
    } catch {
      _homeDir = ''
    }
  }
  return _homeDir
}

export function redactHome(text: string): string {
  const home = homeDir()
  if (!home) return text
  // Both separators: a Windows path may be reported with either, and JS stack
  // frames on Windows sometimes carry forward slashes.
  const variants = [home, home.replace(/\\/g, '/')]
  let out = text
  for (const variant of variants) {
    if (!variant) continue
    out = out.split(variant).join('~')
  }
  return out
}

export function logInfo(message: string): void {
  const line = `[${timestamp()}] INFO: ${redactHome(message)}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}

export function logError(message: string, error?: unknown): void {
  const errStr = error instanceof Error ? error.message : String(error ?? '')
  const line = `[${timestamp()}] ERROR: ${redactHome(message)} ${redactHome(errStr)}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}

export function logDebug(message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `[${timestamp()}] DEBUG: ${redactHome(message)}${redactHome(extra)}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}
