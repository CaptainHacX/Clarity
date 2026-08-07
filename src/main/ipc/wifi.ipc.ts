import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { IPC } from '../../shared/channels'
import { probeLocationAccess, scanWifiNetworks } from '../services/wifi-scanner'
import { validateWifiExportPayload } from '../services/ipc-validation'

export function registerWifiIpc(getWindow: () => Electron.BrowserWindow | null): void {
  // detailed=true sweeps the radio (CoreWLAN active scan / `nmcli --rescan yes`)
  // and parses system_profiler on macOS — a few seconds. The renderer only sends
  // it on first scan and manual refresh; the live poll reads the driver cache.
  ipcMain.handle(IPC.WIFI_SCAN, (_event, detailed: unknown) => scanWifiNetworks(detailed === true))

  ipcMain.handle(IPC.WIFI_LOCATION_STATUS, () => probeLocationAccess())

  ipcMain.handle(IPC.WIFI_EXPORT, async (_event, payload: unknown) => {
    const validated = validateWifiExportPayload(payload)
    if (!validated) return null

    const win = getWindow()
    const opts: Electron.SaveDialogOptions = {
      title: 'Export Wi-Fi data',
      defaultPath: `clarity-wifi-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = process.platform === 'darwin' || !win
      ? await dialog.showSaveDialog(opts)
      : await dialog.showSaveDialog(win, opts)
    if (result.canceled || !result.filePath) return null

    try {
      writeFileSync(result.filePath, JSON.stringify(validated, null, 2), 'utf-8')
      return result.filePath
    } catch {
      return null
    }
  })
}
