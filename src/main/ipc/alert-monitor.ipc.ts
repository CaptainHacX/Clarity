import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { alertMonitor } from '../services/alert-monitor'

export function registerAlertMonitorIpc(): void {
  ipcMain.handle(IPC.ALERT_GET_HISTORY, () => alertMonitor.getHistory())
  ipcMain.handle(IPC.ALERT_CLEAR_HISTORY, () => {
    alertMonitor.clearHistory()
    return true
  })
}
