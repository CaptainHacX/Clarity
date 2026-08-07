import * as si from 'systeminformation'
import { app } from 'electron'
import type { AlertEvent, SystemHealthReport } from '../../shared/types'
import { collectNetworkSecurityStatus } from './network-security'

const gb = (bytes: number): number => Math.round((bytes / 1e9) * 10) / 10

export async function generateSystemHealthReport(alerts: AlertEvent[] = []): Promise<SystemHealthReport> {
  const [osInfo, systemData, cpu, mem, fs, batt, temp, net] = await Promise.allSettled([
    si.osInfo(),
    si.system(),
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.battery(),
    si.cpuTemperature(),
    collectNetworkSecurityStatus(),
  ])

  const os = osInfo.status === 'fulfilled' ? osInfo.value : null
  const sys = systemData.status === 'fulfilled' ? systemData.value : null
  const cpuData = cpu.status === 'fulfilled' ? cpu.value : null
  const memData = mem.status === 'fulfilled' ? mem.value : null
  const fsData = fs.status === 'fulfilled' ? fs.value : []
  const battData = batt.status === 'fulfilled' ? batt.value : null
  const tempData = temp.status === 'fulfilled' ? temp.value : null
  const netData = net.status === 'fulfilled' ? net.value : null

  const batteryPresent = !!battData?.hasBattery
  const disk = fsData
    .filter((d) => d && typeof d.size === 'number' && d.size > 0 && d.mount)
    .map((d) => ({
      mount: d.mount,
      type: d.type || 'unknown',
      totalGb: gb(d.size),
      usedGb: gb(d.used),
      freeGb: gb(d.available),
      percent: typeof d.use === 'number' ? Math.round(d.use) : Math.round((d.used / d.size) * 100),
    }))
    .sort((a, b) => b.totalGb - a.totalGb)

  const uptimeHours = Math.round(si.time().uptime / 3600)

  const report: SystemHealthReport = {
    generatedAt: Date.now(),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    },
    system: {
      hostname: os?.hostname ?? 'unknown',
      os: os ? `${os.distro} ${os.release}` : 'unknown',
      kernel: os?.kernel ?? 'unknown',
      arch: os?.arch ?? process.arch,
      uptimeHours,
      manufacturer: sys?.manufacturer ?? 'unknown',
      model: sys?.model ?? 'unknown',
      cpuModel: cpuData ? `${cpuData.manufacturer} ${cpuData.brand}` : 'unknown',
      cpuCores: cpuData?.physicalCores ?? 0,
      cpuThreads: cpuData?.cores ?? 0,
      totalMemGb: memData ? gb(memData.total) : 0,
    },
    disk,
    health: {
      cpuTemperatureC:
        tempData && typeof tempData.main === 'number' && tempData.main > 0
          ? Math.round(tempData.main)
          : null,
      batteryPresent,
      batteryPercent:
        batteryPresent && typeof battData?.percent === 'number'
          ? Math.round(battData.percent)
          : null,
      batteryHealthPercent:
        batteryPresent &&
        typeof battData?.designedCapacity === 'number' &&
        battData.designedCapacity > 0 &&
        typeof battData?.maxCapacity === 'number'
          ? Math.max(0, Math.round((battData.maxCapacity / battData.designedCapacity) * 100))
          : null,
      batteryCharging: batteryPresent && typeof battData?.isCharging === 'boolean'
        ? battData.isCharging
        : null,
    },
    network: {
      wifiSecurity: netData?.wifi.securitySummary ?? 'unknown',
      vpnDetected: netData?.vpn.detected ?? false,
      gateway: netData?.gateway ?? null,
      ipv4: netData?.ipv4 ?? null,
    },
    alerts,
    markdown: '',
  }

  report.markdown = renderMarkdown(report)
  return report
}

/** Render the report as a plain-text / markdown document. Exported for tests. */
export function renderMarkdown(r: Omit<SystemHealthReport, 'markdown'>): string {
  const lines: string[] = []
  lines.push('# Clarity System Health Report')
  lines.push(`Generated: ${new Date(r.generatedAt).toLocaleString()}`)
  lines.push(`Clarity version: ${r.app.version} (${r.app.platform}/${r.app.arch})`)
  lines.push('')
  lines.push('## System')
  lines.push(`- Hostname: ${r.system.hostname}`)
  lines.push(`- OS: ${r.system.os}`)
  lines.push(`- Kernel: ${r.system.kernel}`)
  lines.push(`- Hardware: ${r.system.manufacturer} ${r.system.model}`)
  lines.push(`- Uptime: ${r.system.uptimeHours} hours`)
  lines.push(`- CPU: ${r.system.cpuModel} (${r.system.cpuCores} cores / ${r.system.cpuThreads} threads)`)
  lines.push(`- Memory: ${r.system.totalMemGb} GB`)
  lines.push('')
  lines.push('## Thermal & Battery')
  lines.push(`- CPU temperature: ${r.health.cpuTemperatureC != null ? `${r.health.cpuTemperatureC} °C` : 'not available'}`)
  if (r.health.batteryPresent) {
    lines.push(`- Battery: ${r.health.batteryPercent != null ? `${r.health.batteryPercent}%` : 'unknown'}`)
    lines.push(`- Battery health: ${r.health.batteryHealthPercent != null ? `${r.health.batteryHealthPercent}%` : 'unknown'}`)
    lines.push(`- Charging: ${r.health.batteryCharging == null ? 'unknown' : r.health.batteryCharging ? 'yes' : 'no'}`)
  } else {
    lines.push('- Battery: none detected')
  }
  lines.push('')
  lines.push('## Disk')
  if (r.disk.length === 0) {
    lines.push('- No disks reported')
  } else {
    for (const d of r.disk) {
      lines.push(`- ${d.mount}: ${d.totalGb} GB total, ${d.freeGb} GB free (${d.percent}% used)`)
    }
  }
  lines.push('')
  lines.push('## Network Security')
  lines.push(`- WiFi security: ${r.network.wifiSecurity}`)
  lines.push(`- VPN: ${r.network.vpnDetected ? 'active' : 'not detected'}`)
  lines.push(`- Gateway: ${r.network.gateway ?? 'unknown'}`)
  lines.push(`- IPv4: ${r.network.ipv4 ?? 'unknown'}`)
  lines.push('')
  lines.push('## Recent Alerts')
  if (r.alerts.length === 0) {
    lines.push('- No active alerts')
  } else {
    for (const a of r.alerts.slice(-10).reverse()) {
      lines.push(`- [${a.severity}] ${a.title}: ${a.message}`)
    }
  }
  return lines.join('\n')
}
