import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import {
  scanAll,
  scanDeviceByIp,
  getSecuritySnapshot,
  startFullScan,
  cancelFullScan,
  getFullScanStatus,
  getSecuritySettings,
  setSecuritySettings,
  resetSecurityResults,
} from '../services/security/security-service'
import {
  validateFullScanRequest,
  validateSecuritySettingsPatch,
} from '../services/ipc-validation'
import type { SecuritySettings } from '../../shared/types'

function validIp(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= 45
}

export function registerSecurityIpc(): void {
  ipcMain.handle(IPC.SECURITY_SCAN_ALL, () => scanAll())

  ipcMain.handle(IPC.SECURITY_SCAN_DEVICE, (_event, ip: unknown) => {
    if (!validIp(ip)) return null
    return scanDeviceByIp(ip)
  })

  ipcMain.handle(IPC.SECURITY_RESULTS_GET, () => getSecuritySnapshot())

  ipcMain.handle(IPC.SECURITY_FULL_SCAN_START, (_event, request: unknown) => {
    const validated = validateFullScanRequest(request)
    if (!validated) {
      return { ok: false, error: 'Pick a device with an IPv4 address and a valid 1-65535 range.' }
    }
    // Resolves as soon as the sweep starts — the UI polls for progress.
    return startFullScan(validated)
  })

  ipcMain.handle(IPC.SECURITY_FULL_SCAN_STATUS, (_event, ip: unknown) => {
    if (!validIp(ip)) return null
    return getFullScanStatus(ip)
  })

  ipcMain.handle(IPC.SECURITY_FULL_SCAN_CANCEL, (_event, ip: unknown) => {
    if (!validIp(ip)) return false
    cancelFullScan(ip)
    return true
  })

  ipcMain.handle(IPC.SECURITY_SETTINGS_GET, () => getSecuritySettings())

  ipcMain.handle(IPC.SECURITY_SETTINGS_SET, (_event, patch: unknown) => {
    const validated = validateSecuritySettingsPatch(patch)
    if (!validated) return null
    return setSecuritySettings(validated as Partial<SecuritySettings>)
  })

  ipcMain.handle(IPC.SECURITY_CLEAR_RESULTS, () => {
    resetSecurityResults()
    return true
  })
}
