import { ipcMain, shell } from 'electron'
import { release } from 'os'
import { IPC } from '../../shared/channels'
import { collectLocationAccess, collectNetworkSecurityStatus } from '../services/network-security'
import { coreWlanRequestLocation } from '../services/wifi/corewlan'

/**
 * macOS Settings > Privacy & Security > Location Services.
 *
 * Ventura (Darwin 22) replaced System Preferences with System Settings and
 * renamed every pane URL. The old identifier silently no-ops on modern macOS —
 * which is why the Wi-Fi tool's "Grant access" button appeared to do nothing —
 * so pick by kernel major and keep the legacy one for older releases.
 */
const LOCATION_SETTINGS_MODERN =
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocationServices'
const LOCATION_SETTINGS_LEGACY =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices'

export function locationSettingsUrl(darwinRelease: string = release()): string {
  const major = Number.parseInt(darwinRelease.split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major >= 22 ? LOCATION_SETTINGS_MODERN : LOCATION_SETTINGS_LEGACY
}

export async function openLocationSettings(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  // Try the pane identifier for this Darwin release first, then the other one —
  // both are registered with LaunchServices, so whichever one opens is enough.
  const primary = locationSettingsUrl()
  const candidates = primary === LOCATION_SETTINGS_MODERN
    ? [LOCATION_SETTINGS_MODERN, LOCATION_SETTINGS_LEGACY]
    : [LOCATION_SETTINGS_LEGACY, LOCATION_SETTINGS_MODERN]
  for (const url of candidates) {
    try {
      await shell.openExternal(url)
      return true
    } catch {
      // try the other pane identifier
    }
  }
  return false
}

export function registerNetworkSecurityIpc(): void {
  ipcMain.handle(IPC.NETWORK_SECURITY_SCAN, () => collectNetworkSecurityStatus())

  // Ask CoreLocation directly through the native addon when it is present —
  // that raises the prompt for this bundle, which is the identity the BSSID
  // gate actually checks. The renderer's `navigator.geolocation` trigger stays
  // as the fallback for a build without the addon; on its own it authorized the
  // app while the scan still ran in a differently-identified child process, so
  // the grant appeared to do nothing.
  ipcMain.handle(IPC.NETWORK_SECURITY_REQUEST_LOCATION, async () => {
    if (coreWlanRequestLocation()) {
      // The prompt resolves asynchronously on the main run loop; give it a
      // moment so the status this returns reflects the user's answer rather
      // than the state from before they were asked.
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
    await collectLocationAccess()
    return collectNetworkSecurityStatus()
  })

  ipcMain.handle(IPC.NETWORK_SECURITY_OPEN_LOCATION_SETTINGS, () => openLocationSettings())
}
