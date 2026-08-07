import * as si from 'systeminformation'
import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/channels'
import type { AlertEvent, AlertType } from '../../shared/types'
import { getSettings } from './settings-store'

const HISTORY_LIMIT = 50
const DEFAULT_POLL_INTERVAL_MS = 60_000

// fs types that are not user data: virtual/ram filesystems, squashfs images,
// and network mounts. The main-disk picker ignores these so a small EFI boot
// partition or an NFS share can't trigger (or mask) a low-disk alert.
const NON_PHYSICAL_FS_RE = /^(overlay|squashfs|tmpfs|devtmpfs|proc|sysfs|devpts|securityfs|debugfs|tracefs|fusectl|configfs|pstore|cgroup|mqueue|hugetlbfs|autofs|binfmt_misc|ramfs|nsfs|bpf|none|nfs|smb|cifs|sshfs|ftpfs)/i

export class AlertMonitorService {
  private timer: ReturnType<typeof setInterval> | null = null
  private history: AlertEvent[] = []
  private lastFiredAt: Partial<Record<AlertType, number>> = {}
  private readonly pollIntervalMs: number

  constructor(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
    this.pollIntervalMs = pollIntervalMs
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.check(), this.pollIntervalMs)
    void this.check()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getHistory(): AlertEvent[] {
    return [...this.history]
  }

  clearHistory(): void {
    this.history = []
  }

  /**
   * Sample system health once and raise any alerts whose thresholds are met.
   * Returns the events fired (useful for tests). Never throws: a failing
   * sensor read simply means its alert isn't evaluated this cycle.
   */
  async check(): Promise<AlertEvent[]> {
    const config = getSettings().alerts
    if (!config?.enabled) return []

    const [cpu, mem, fs, battery, cpuTemp] = await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.battery(),
      si.cpuTemperature(),
    ])

    const now = Date.now()
    const cooldownMs = (config.cooldownMinutes ?? 30) * 60_000
    const fired: AlertEvent[] = []

    if (cpu.status === 'fulfilled') {
      const value = cpu.value.currentLoad
      if (typeof value === 'number' && value >= (config.cpuUsageThreshold ?? 90)) {
        const ev = this.fire('cpu-usage', 'warning', now, cooldownMs, {
          title: 'High CPU usage',
          message: `CPU usage is ${Math.round(value)}%.`,
          data: { value: Math.round(value) },
        })
        if (ev) fired.push(ev)
      }
    }

    if (cpuTemp.status === 'fulfilled') {
      const value = cpuTemp.value.main
      if (typeof value === 'number' && value >= (config.cpuTempThreshold ?? 90)) {
        const ev = this.fire('cpu-temp', 'critical', now, cooldownMs, {
          title: 'CPU temperature high',
          message: `CPU temperature reached ${Math.round(value)}°C.`,
          data: { value: Math.round(value) },
        })
        if (ev) fired.push(ev)
      }
    }

    if (mem.status === 'fulfilled') {
      const total = mem.value.total
      const used = mem.value.used
      if (total > 0) {
        const percent = (used / total) * 100
        if (percent >= (config.memoryThreshold ?? 90)) {
          const ev = this.fire('memory', 'warning', now, cooldownMs, {
            title: 'Memory usage high',
            message: `Memory usage is ${Math.round(percent)}%.`,
            data: { value: Math.round(percent) },
          })
          if (ev) fired.push(ev)
        }
      }
    }

    if (fs.status === 'fulfilled') {
      const main = pickMainMount(fs.value)
      if (main) {
        const freeGb = (main.size - main.used) / 1e9
        if (freeGb <= (config.diskSpaceThresholdGb ?? 10)) {
          const ev = this.fire('disk-space', 'warning', now, cooldownMs, {
            title: 'Low disk space',
            message: `Only ${freeGb.toFixed(1)} GB free on ${main.mount}.`,
            data: { mount: main.mount, value: Number(freeGb.toFixed(1)) },
          })
          if (ev) fired.push(ev)
        }
      }
    }

    if (battery.status === 'fulfilled') {
      const b = battery.value
      if (b && b.hasBattery !== false && !b.isCharging && typeof b.percent === 'number') {
        if (b.percent <= (config.batteryThreshold ?? 20)) {
          const ev = this.fire('battery', 'warning', now, cooldownMs, {
            title: 'Battery low',
            message: `Battery is at ${Math.round(b.percent)}%.`,
            data: { value: Math.round(b.percent) },
          })
          if (ev) fired.push(ev)
        }
      }
    }

    return fired
  }

  private fire(
    type: AlertType,
    severity: AlertEvent['severity'],
    now: number,
    cooldownMs: number,
    content: { title: string; message: string; data?: AlertEvent['data'] }
  ): AlertEvent | null {
    const last = this.lastFiredAt[type]
    if (last !== undefined && now - last < cooldownMs) return null
    this.lastFiredAt[type] = now

    const event: AlertEvent = {
      id: randomUUID(),
      type,
      severity,
      title: content.title,
      message: content.message,
      timestamp: now,
      data: content.data,
    }
    this.history.push(event)
    if (this.history.length > HISTORY_LIMIT) {
      this.history = this.history.slice(-HISTORY_LIMIT)
    }

    // Live push to the renderer (in-app toasts / dashboard panel)
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.ALERT_EVENT, event)
    }

    // Native OS notification — gated by the user's delivery preference.
    const config = getSettings().alerts
    if (config?.showSystem && Notification.isSupported()) {
      new Notification({
        title: `Clarity - ${event.title}`,
        body: event.message,
        silent: false,
      }).show()
    }

    return event
  }
}

function pickMainMount(mounts: si.Systeminformation.FsSizeData[]): si.Systeminformation.FsSizeData | null {
  let main: si.Systeminformation.FsSizeData | null = null
  for (const m of mounts) {
    if (!m || typeof m.size !== 'number' || typeof m.used !== 'number') continue
    if (NON_PHYSICAL_FS_RE.test(m.type || '')) continue
    if (!main || m.size > main.size) main = m
  }
  return main
}

export const alertMonitor = new AlertMonitorService()
