import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { generateSystemHealthReport } from '../services/system-health-report'
import { alertMonitor } from '../services/alert-monitor'

export function registerHealthReportIpc(): void {
  ipcMain.handle(IPC.HEALTH_REPORT_GENERATE, () => generateSystemHealthReport(alertMonitor.getHistory()))
}
