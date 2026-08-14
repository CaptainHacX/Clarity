import * as si from 'systeminformation'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import type {
  PerfSystemInfo,
  PerfSnapshot,
  PerfProcess,
  PerfProcessList,
  PerfKillResult,
  DiskSmartInfo,
  DiskVolumeUsage,
  HardwareHealthSnapshot,
  StartupItem
} from '../../shared/types'
import { psUtf8 } from './exec-utf8'

const execFileAsync = promisify(execFile)

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private hardwareTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private cachedSystemInfo: PerfSystemInfo | null = null
  private startupExeMap: Map<string, string> = new Map()
  // Guards to prevent overlapping async calls from piling up if si hangs
  private snapshotRunning = false
  private processesRunning = false
  private hardwareHealthRunning = false
  private volumesRunning = false
  // Cache si.networkStats() and poll it a bit less often than the fast tick so
  // the gauge/chart stay responsive without a syscall per second.
  private cachedNetworkStats = { rxBytesPerSec: 0, txBytesPerSec: 0 }
  private lastNetworkPoll = 0
  private readonly NETWORK_POLL_INTERVAL_MS = 2000
  // Thermal/battery sensors are slow and often need elevated privileges on
  // some platforms — poll on a 30s cadence, never on the 1s tick.
  private readonly HARDWARE_POLL_INTERVAL_MS = 30_000
  // Swap usage comes from si.mem(), which is expensive on Windows — cache it
  // from the slow process-list tick (every 10s) instead of the fast tick.
  private cachedSwap = { usedBytes: 0, totalBytes: 0, percent: 0 }
  // Data cadence for the fast tick, configurable from the renderer.
  private refreshIntervalMs = 1000

  async getSystemInfo(): Promise<PerfSystemInfo> {
    if (this.cachedSystemInfo) return this.cachedSystemInfo

    const [cpu, osInfo, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()])

    this.cachedSystemInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      totalMemBytes: mem.total,
      osVersion: `${osInfo.distro} ${osInfo.release}`,
      platform: process.platform,
      kernel: osInfo.kernel || null,
      arch: osInfo.arch || null,
      hostname: osInfo.hostname
    }
    return this.cachedSystemInfo
  }

  /** Reconfigure the fast-tick cadence without stopping other timers. */
  setRefreshInterval(intervalMs: number): void {
    const clamped = Math.max(1000, Math.min(intervalMs, 15 * 60 * 1000))
    this.refreshIntervalMs = clamped
    if (this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = setInterval(() => this.collectSnapshot(), this.refreshIntervalMs)
    }
  }

  /** Force an immediate refresh of every data source (used by "Refresh Now"). */
  async refreshNow(): Promise<void> {
    await Promise.allSettled([
      this.collectSnapshot(),
      this.collectProcesses(),
      this.collectVolumes(),
      this.collectHardwareHealth()
    ])
  }

  async startMonitoring(
    sender: Electron.WebContents,
    getStartupItems?: () => Promise<StartupItem[]>,
    intervalMs?: number
  ): Promise<void> {
    // If already running, just update the sender
    if (this.fastTimer) {
      this.sender = sender
      if (intervalMs) this.setRefreshInterval(intervalMs)
      return
    }

    this.sender = sender
    if (intervalMs) this.refreshIntervalMs = Math.max(1000, Math.min(intervalMs, 15 * 60 * 1000))

    // Build startup exe map for correlation
    if (getStartupItems) {
      try {
        const items = await getStartupItems()
        this.startupExeMap.clear()
        for (const item of items) {
          // Extract exe name from command string
          const match = item.command.match(/([^/\\]+\.exe)/i)
          if (match) {
            this.startupExeMap.set(match[1].toLowerCase(), item.displayName || item.name)
          }
        }
      } catch {
        // Startup correlation is optional
      }
    }

    // Fast interval: system metrics every refreshIntervalMs (default 1s)
    this.fastTimer = setInterval(() => this.collectSnapshot(), this.refreshIntervalMs)
    // Collect immediately
    this.collectSnapshot()

    // Slow interval: process list + disk volumes every 10s (si.processes() is expensive)
    this.slowTimer = setInterval(() => {
      this.collectProcesses()
      this.collectVolumes()
    }, 10000)
    this.collectProcesses()
    this.collectVolumes()

    // Hardware health: thermal + battery every 30s (sensor reads are slow)
    this.hardwareTimer = setInterval(() => this.collectHardwareHealth(), this.HARDWARE_POLL_INTERVAL_MS)
    this.collectHardwareHealth()
  }

  stopMonitoring(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = null
    }
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
    if (this.hardwareTimer) {
      clearInterval(this.hardwareTimer)
      this.hardwareTimer = null
    }
    this.sender = null
  }

  async getProcessName(pid: number): Promise<string | null> {
    try {
      const data = await si.processes()
      const proc = data.list.find((p) => p.pid === pid)
      return proc?.name ?? null
    } catch {
      return null
    }
  }

  async killProcess(pid: number): Promise<PerfKillResult> {
    try {
      process.kill(pid)
      return { success: true }
    } catch {
      // Fallback to platform-specific kill command
      try {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/F', '/PID', String(pid)])
        } else {
          await execFileAsync('kill', ['-9', String(pid)])
        }
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const requiresAdmin = message.includes('Access') || message.includes('denied') || message.includes('Operation not permitted')
        return {
          success: false,
          error: requiresAdmin
            ? 'Access denied. Run Clarity as Administrator to end this process.'
            : `Failed to end process: ${message}`,
          requiresAdmin
        }
      }
    }
  }

  async getDiskHealth(): Promise<DiskSmartInfo[]> {
    try {
      const disks = await si.diskLayout()
      const reliabilityMap = await this.getStorageReliability()

      return disks.map((d) => {
        const smartStatus =
          d.smartStatus === 'Ok'
            ? 'Healthy'
            : d.smartStatus === 'Caution'
              ? 'Caution'
              : d.smartStatus === 'Bad'
                ? 'Bad'
                : 'Unknown'

        let diskType: DiskSmartInfo['type'] = 'Unknown'
        if (d.interfaceType === 'NVMe') diskType = 'NVMe'
        else if (d.type === 'SSD') diskType = 'SSD'
        else if (d.type === 'HD') diskType = 'HDD'

        // Match reliability data by device index (e.g. "\\.\PHYSICALDRIVE0" → "0")
        const deviceIndex = d.device.replace(/\D/g, '')
        const rel = reliabilityMap.get(deviceIndex)

        return {
          device: d.device,
          model: d.name,
          type: diskType,
          sizeBytes: d.size,
          temperature: rel?.temperature ?? d.temperature ?? null,
          healthStatus: smartStatus as DiskSmartInfo['healthStatus'],
          powerOnHours: rel?.powerOnHours ?? null,
          remainingLife: rel?.wear !== null && rel?.wear !== undefined ? 100 - rel.wear : null,
          readErrors: rel?.readErrors ?? null,
          writeErrors: rel?.writeErrors ?? null,
          reallocatedSectors: null,
          smartAttributes: []
        }
      })
    } catch {
      return []
    }
  }

  /** One-shot hardware health read (used by the IPC handler). */
  async getHardwareHealth(): Promise<HardwareHealthSnapshot> {
    return this.collectHardwareHealthSnapshot()
  }

  /**
   * Gather thermal + battery data. Every read is best-effort: sensors are
   * often absent (desktops, VMs, Linux without lm-sensors) or require
   * elevated privileges (Apple Silicon temps need root), so a failed read
   * yields nulls, never an exception.
   */
  private async collectHardwareHealthSnapshot(): Promise<HardwareHealthSnapshot> {
    const [cpuTemp, battery, graphics] = await Promise.allSettled([
      si.cpuTemperature(),
      si.battery(),
      si.graphics(),
    ])

    // si returns -1 or an empty object when a sensor is absent — treat any
    // non-positive value as "not available".
    const cpuTemperature = (() => {
      if (cpuTemp.status !== 'fulfilled') return null
      const main = cpuTemp.value.main
      if (typeof main !== 'number' || main <= 0) return null
      return Math.round(main)
    })()

    const gpus = (() => {
      if (graphics.status !== 'fulfilled') return []
      const out: HardwareHealthSnapshot['gpus'] = []
      for (const c of graphics.value.controllers ?? []) {
        const t = c.temperatureGpu
        const load = c.utilizationGpu
        const vram = typeof c.memoryTotal === 'number' && c.memoryTotal > 0 ? c.memoryTotal : null
        out.push({
          name: c.model || 'GPU',
          temperature: typeof t === 'number' && t > 0 ? Math.round(t) : null,
          loadPercent: typeof load === 'number' && load >= 0 ? Math.round(load) : null,
          vramBytes: vram,
        })
      }
      return out
    })()

    const batteryData = (() => {
      if (battery.status !== 'fulfilled') return null
      const b = battery.value
      if (!b || b.hasBattery === false) return null
      const percent = typeof b.percent === 'number' ? Math.min(100, Math.max(0, Math.round(b.percent))) : null
      const designed = typeof b.designedCapacity === 'number' ? b.designedCapacity : 0
      const maxCap = typeof b.maxCapacity === 'number' ? b.maxCapacity : 0
      const healthPercent = designed > 0 && maxCap >= 0 ? Math.max(0, Math.round((maxCap / designed) * 100)) : null
      // si reports timeRemaining in minutes; -1 means "unknown/not discharging".
      const timeRemainingSec =
        typeof b.timeRemaining === 'number' && b.timeRemaining >= 0
          ? Math.round(b.timeRemaining * 60)
          : null
      return {
        present: true,
        percent,
        isCharging: typeof b.isCharging === 'boolean' ? b.isCharging : null,
        acConnected: typeof b.acConnected === 'boolean' ? b.acConnected : null,
        timeRemainingSec,
        cycleCount: typeof b.cycleCount === 'number' ? b.cycleCount : null,
        healthPercent,
      }
    })()

    return {
      timestamp: Date.now(),
      cpuTemperature,
      gpus,
      battery: batteryData,
    }
  }

  private async collectHardwareHealth(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.hardwareHealthRunning) return
    this.hardwareHealthRunning = true

    try {
      const snapshot = await this.collectHardwareHealthSnapshot()
      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_HARDWARE_HEALTH, snapshot)
      }
    } catch {
      // Silently skip failed reads
    } finally {
      this.hardwareHealthRunning = false
    }
  }

  private async getStorageReliability(): Promise<
    Map<string, { temperature: number | null; powerOnHours: number | null; wear: number | null; readErrors: number | null; writeErrors: number | null }>
  > {
    const map = new Map<string, { temperature: number | null; powerOnHours: number | null; wear: number | null; readErrors: number | null; writeErrors: number | null }>()

    try {
      const script = 'Get-PhysicalDisk | ForEach-Object { $disk = $_; $rel = $_ | Get-StorageReliabilityCounter; [PSCustomObject]@{ DeviceId = $disk.DeviceId; Temperature = $rel.Temperature; PowerOnHours = $rel.PowerOnHours; ReadErrorsTotal = $rel.ReadErrorsTotal; WriteErrorsTotal = $rel.WriteErrorsTotal; Wear = $rel.Wear } } | ConvertTo-Json -Compress'

      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(script)], {
        timeout: 10000, windowsHide: true
      })

      const parsed = JSON.parse(stdout.trim())
      const entries = Array.isArray(parsed) ? parsed : [parsed]

      for (const entry of entries) {
        map.set(String(entry.DeviceId), {
          temperature: entry.Temperature ?? null,
          powerOnHours: entry.PowerOnHours ?? null,
          wear: entry.Wear ?? null,
          readErrors: entry.ReadErrorsTotal ?? null,
          writeErrors: entry.WriteErrorsTotal ?? null
        })
      }
    } catch {
      // Requires admin — return empty map, fall back to basic data
    }

    return map
  }

  private async collectSnapshot(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.snapshotRunning) return
    this.snapshotRunning = true

    try {
      // Only poll si.networkStats() every 5s — it costs ~320ms per call.
      const now = Date.now()
      const needsNetworkPoll = now - this.lastNetworkPoll >= this.NETWORK_POLL_INTERVAL_MS

      // On Windows, si.mem() costs ~290ms per call — use os.totalmem()/os.freemem()
      // instead (identical values, near-zero cost). On Linux/macOS, si.mem() is cheap
      // (reads /proc/meminfo or vm_stat) and os.freemem() excludes buffers/cache,
      // so we must keep si.mem() to avoid overstating memory pressure.
      const isWindows = process.platform === 'win32'

      const [load, disk, net, mem] = await Promise.all([
        si.currentLoad(),
        this.collectDiskIo(),
        needsNetworkPoll ? si.networkStats() : Promise.resolve(null),
        isWindows ? Promise.resolve(null) : si.mem()
      ])

      if (net) {
        this.cachedNetworkStats = {
          rxBytesPerSec: net.reduce((sum, n) => sum + n.rx_sec, 0),
          txBytesPerSec: net.reduce((sum, n) => sum + n.tx_sec, 0)
        }
        this.lastNetworkPoll = now
      }

      let usedMem: number, totalMem: number, cachedMem: number
      if (isWindows) {
        totalMem = os.totalmem()
        usedMem = totalMem - os.freemem()
        cachedMem = 0
      } else if (process.platform === 'darwin') {
        totalMem = mem!.total
        // mem.active includes file-backed/reclaimable pages and vastly overstates
        // real pressure on macOS.  (total − available) matches Activity Monitor.
        usedMem = totalMem - mem!.available
        cachedMem = mem!.cached
      } else {
        usedMem = mem!.active
        totalMem = mem!.total
        cachedMem = mem!.cached
      }

      const snapshot: PerfSnapshot = {
        timestamp: Date.now(),
        cpu: {
          overall: load.currentLoad,
          perCore: load.cpus.map((c) => c.load)
        },
        memory: {
          usedBytes: usedMem,
          totalBytes: totalMem,
          cachedBytes: cachedMem,
          percent: (usedMem / totalMem) * 100
        },
        swap: this.cachedSwap,
        disk: {
          readBytesPerSec: disk?.readBytesPerSec ?? 0,
          writeBytesPerSec: disk?.writeBytesPerSec ?? 0
        },
        network: this.cachedNetworkStats,
        uptime: si.time().uptime
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_SNAPSHOT, snapshot)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.snapshotRunning = false
    }
  }

  /**
   * Best-effort disk I/O in bytes/sec.
   *
   * si.disksIO() is only correct on Linux (it reads /sys/block sector stats).
   * On macOS it positionally parses the IOBlockStorageDriver "Statistics"
   * dictionary (after tr-flattening) and ends up reporting operation *counts*
   * (Operations Read/Write) instead of byte counters, so rIO_sec/wIO_sec hover
   * near zero even under heavy load. On Windows disksIO() and fsStats() both
   * resolve to null. So each platform needs its own source:
   *  - darwin: si.fsStats() uses the correct dictionary indices (Bytes Read/Write)
   *  - linux:  si.disksIO() reads sector counters from /sys/block
   *  - win32:  formatted physical-disk perf counters already expose rates
   */
  private async collectDiskIo(): Promise<{ readBytesPerSec: number; writeBytesPerSec: number } | null> {
    try {
      const platform = process.platform
      if (platform === 'darwin') {
        const fs = await si.fsStats()
        if (!fs) return null
        return {
          readBytesPerSec: fs.rx_sec ?? 0,
          writeBytesPerSec: fs.wx_sec ?? 0
        }
      }
      if (platform === 'linux') {
        const disk = await si.disksIO()
        if (!disk) return null
        return {
          readBytesPerSec: disk.rIO_sec ?? 0,
          writeBytesPerSec: disk.wIO_sec ?? 0
        }
      }
      if (platform === 'win32') {
        const script =
          "Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -eq '_Total' } | Select-Object @{n='ReadBytesPerSec';e={[long]$_.DiskReadBytesPerSec}}, @{n='WriteBytesPerSec';e={[long]$_.DiskWriteBytesPerSec}} | ConvertTo-Json -Compress"
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
          { timeout: 10_000, windowsHide: true }
        )
        const parsed = JSON.parse(stdout.trim())
        return {
          readBytesPerSec: Number(parsed.ReadBytesPerSec) || 0,
          writeBytesPerSec: Number(parsed.WriteBytesPerSec) || 0
        }
      }
    } catch {
      // Best-effort — failed reads fall back to zero rates.
    }
    return null
  }

  private async collectProcesses(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.processesRunning) return
    this.processesRunning = true

    try {
      const [data, mem] = await Promise.all([si.processes(), si.mem()])
      const totalMem = mem.total

      // Cache swap usage for the fast snapshot tick
      if (typeof mem.swapused === 'number' && typeof mem.swaptotal === 'number') {
        const usedBytes = mem.swapused
        const totalBytes = mem.swaptotal
        this.cachedSwap = {
          usedBytes,
          totalBytes,
          percent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
        }
      }

      // Sort by CPU + memory and take top 100
      const sorted = data.list
        .sort((a, b) => b.cpu + b.memRss - (a.cpu + a.memRss))
        .slice(0, 100)

      const processes: PerfProcess[] = sorted.map((p) => {
        const exeName = (p.name || '').toLowerCase()
        const startupName = this.startupExeMap.get(
          exeName.endsWith('.exe') ? exeName : `${exeName}.exe`
        )

        return {
          pid: p.pid,
          name: p.name,
          cpuPercent: p.cpu,
          memBytes: p.memRss,
          memPercent: totalMem > 0 ? (p.memRss / totalMem) * 100 : 0,
          user: p.user || '',
          started: p.started || '',
          isStartupItem: !!startupName,
          startupItemName: startupName
        }
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount: data.all
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_PROCESS_LIST, result)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.processesRunning = false
    }
  }

  /** Poll filesystem volume sizes on the slow cadence (fsSize is not free). */
  private async collectVolumes(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.volumesRunning) return
    this.volumesRunning = true

    try {
      const fs = await si.fsSize()
      const volumes: DiskVolumeUsage[] = fs
        .filter((f) => f.size > 0)
        .map((f) => ({
          mount: f.mount,
          name: f.fs || f.mount,
          fsType: f.type || 'Unknown',
          totalBytes: f.size,
          usedBytes: f.used,
          freeBytes: f.size - f.used,
          percent: f.size > 0 ? (f.used / f.size) * 100 : 0
        }))

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_DISK_VOLUMES, volumes)
      }
    } catch {
      // Silently skip failed reads
    } finally {
      this.volumesRunning = false
    }
  }
}
