import { BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/channels'
import { threatMonitor, type ThreatCallback } from './threat-monitor'
import { getSettings } from './settings-store'

export function installThreatMonitorAlerts(): ThreatCallback {
  const cb: ThreatCallback = (snapshot) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.THREAT_MONITOR_UPDATED, snapshot)
    }

    const settings = getSettings()
    if (settings.showThreatNotifications && Notification.isSupported()) {
      const connCount = snapshot.flaggedConnections.length
      const dnsCount = snapshot.flaggedDns.length
      if (connCount === 0 && dnsCount === 0) return
      const parts: string[] = []
      if (connCount > 0) parts.push(`${connCount} suspicious connection${connCount > 1 ? 's' : ''}`)
      if (dnsCount > 0) parts.push(`${dnsCount} suspicious DNS entr${dnsCount > 1 ? 'ies' : 'y'}`)
      new Notification({
        title: 'Clarity - Threat Detected',
        body: `Detected ${parts.join(' and ')}.`,
        silent: false,
      }).show()
    }
  }
  threatMonitor.setThreatCallback(cb)
  return cb
}
