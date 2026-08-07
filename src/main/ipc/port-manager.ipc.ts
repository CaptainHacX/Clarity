import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { killPortProcess, scanPorts } from '../services/port-monitor'
import type { PortKillResult, PortScanResult } from '../../shared/types'

/**
 * Port Manager IPC.
 *
 * The feature is currently Linux + macOS only. On Windows the registration is
 * a no-op; the renderer hides the navigation entry via `features.portManager`
 * and the store refuses to scan.
 */
export function registerPortManagerIpc(): void {
  if (process.platform === 'win32') return

  ipcMain.handle(IPC.PORT_SCAN, async (): Promise<PortScanResult> => {
    return scanPorts()
  })

  // Validate the PID here as well as in the service — the handler is the
  // trust boundary for anything coming out of the renderer.
  ipcMain.handle(IPC.PORT_KILL, async (_event, pid: unknown): Promise<PortKillResult> => {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
      return { success: false, pid: null, processName: null, freedPorts: [], error: 'Invalid process ID' }
    }
    return killPortProcess(pid)
  })
}
