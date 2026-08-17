import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { killPortProcess, scanPorts } from '../services/port-monitor'
import type { PortKillResult, PortScanResult } from '../../shared/types'

/**
 * Port Manager IPC.
 *
 * Registered on every platform. Windows enumerates sockets through netstat
 * rather than systeminformation — see the port-monitor module header.
 */
export function registerPortManagerIpc(): void {
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
