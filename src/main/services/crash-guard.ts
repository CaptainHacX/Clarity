import { app, crashReporter, dialog } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { logError, logInfo } from './logger'

const CRASH_SUBMIT_URL = process.env.CLARITY_CRASH_URL || ''

export function installCrashGuard(): void {
  try {
    crashReporter.start({
      productName: 'Clarity',
      companyName: 'Clarity',
      submitURL: CRASH_SUBMIT_URL,
      uploadToServer: Boolean(CRASH_SUBMIT_URL),
      compress: true
    })
    logInfo(`Crash reporter started${CRASH_SUBMIT_URL ? '' : ' (local dumps only — set CLARITY_CRASH_URL to upload)'}`)
  } catch (err) {
    logError('crashReporter.start failed', err)
  }

  process.on('uncaughtException', (err) => {
    const msg = `UNCAUGHT EXCEPTION: ${err?.stack || err}`
    logError(msg)
    persistCrash(msg)
    const isHeadless = process.argv.includes('--cli')
    if (!isHeadless) {
      try {
        dialog.showErrorBox('Clarity', `Clarity hit an unexpected error and needs to restart.\n\n${err?.message || err}`)
      } catch {
        /* dialog unavailable — log only */
      }
    }
    // Do not stay alive with a corrupted main process — scheduled deletions
    // and network scans must not continue in an unknown state.
    setTimeout(() => app.exit(1), 250)
  })

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    logError(`UNHANDLED REJECTION: ${err.stack || err.message}`)
  })
}

function persistCrash(message: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'crash-last.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf-8')
  } catch {
    /* best-effort persistence */
  }
}
