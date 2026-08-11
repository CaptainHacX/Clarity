import * as si from 'systeminformation'
import { app } from 'electron'
import type {
  AlertEvent,
  HealthCheckStatus,
  SystemHealthReport,
  SystemHealthReportCheck,
} from '../../shared/types'
import { collectNetworkSecurityStatus } from './network-security'

const gb = (bytes: number): number => Math.round((bytes / 1e9) * 10) / 10
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))
const pct = (n: number): number => Math.round(n * 10) / 10

// Processes that always dominate CPU accounting on some OSes and add noise to a
// "top consumer" readout. Excluded from the top-CPU pick (not from the totals).
const NOISE_PROCESS = /^(system idle process|kernel_task|idle|swapper|launchd)$/i

function pickTop(
  list: Array<{ pid: number; name: string; cpu: number; mem: number }>,
  by: 'cpu' | 'mem',
  filterNoise: boolean
): SystemHealthReport['processes']['topCpu'] | null {
  if (!Array.isArray(list) || list.length === 0) return null
  const sorted = [...list]
    .filter((p) => p && typeof p[by] === 'number' && p.name)
    .filter((p) => (filterNoise ? !NOISE_PROCESS.test(p.name) : true))
    .sort((a, b) => (b[by] as number) - (a[by] as number))
  const top = sorted[0]
  if (!top) return null
  return { name: top.name, pid: top.pid, percent: pct(top[by] as number) }
}

function check(key: string, status: HealthCheckStatus, detail: string): SystemHealthReportCheck {
  return { key, status, detail }
}

/**
 * Derive an overall health posture from the raw snapshot. Scores start at 100
 * and lose 25 points per critical finding and 10 per warning, floor 0.
 */
function computeSummary(
  r: Pick<SystemHealthReport, 'system' | 'memory' | 'disk' | 'health' | 'network'>
): SystemHealthReport['summary'] {
  const checks: SystemHealthReportCheck[] = []

  if (r.health.cpuTemperatureC != null) {
    const t = r.health.cpuTemperatureC
    checks.push(check('temperature', t >= 90 ? 'critical' : t >= 75 ? 'warning' : 'ok', `${t} °C`))
  }

  checks.push(
    check(
      'memory',
      r.memory.usedPercent >= 90 ? 'critical' : r.memory.usedPercent >= 80 ? 'warning' : 'ok',
      `${r.memory.usedPercent}% used`
    )
  )

  const primary = r.disk[0]
  if (primary) {
    checks.push(
      check('disk', primary.percent >= 92 ? 'critical' : primary.percent >= 85 ? 'warning' : 'ok', `${primary.percent}% used`)
    )
  }

  if (r.system.loadAverage1 != null) {
    const load = r.system.loadAverage1
    checks.push(check('load', load >= 90 ? 'critical' : load >= 75 ? 'warning' : 'ok', `${load}%`))
  }

  if (r.health.batteryPresent && r.health.batteryHealthPercent != null) {
    const bh = r.health.batteryHealthPercent
    checks.push(check('battery', bh < 60 ? 'critical' : bh < 80 ? 'warning' : 'ok', `${bh}% health`))
  }

  const wifi = r.network.wifiSecurity
  if (wifi !== 'none' && wifi !== 'unknown') {
    checks.push(check('network', wifi === 'secured' ? 'ok' : 'warning', wifi))
  }

  const criticals = checks.filter((c) => c.status === 'critical').length
  const warnings = checks.filter((c) => c.status === 'warning').length
  return { score: clamp(100 - criticals * 25 - warnings * 10, 0, 100), checks }
}

export async function generateSystemHealthReport(alerts: AlertEvent[] = []): Promise<SystemHealthReport> {
  const [
    osInfo,
    systemData,
    cpu,
    mem,
    fs,
    batt,
    temp,
    net,
    graphics,
    load,
    procs,
    bios,
  ] = await Promise.allSettled([
    si.osInfo(),
    si.system(),
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.battery(),
    si.cpuTemperature(),
    collectNetworkSecurityStatus(),
    si.graphics(),
    si.currentLoad(),
    si.processes(),
    si.bios(),
  ])

  const os = osInfo.status === 'fulfilled' ? osInfo.value : null
  const sys = systemData.status === 'fulfilled' ? systemData.value : null
  const cpuData = cpu.status === 'fulfilled' ? cpu.value : null
  const memData = mem.status === 'fulfilled' ? mem.value : null
  const fsData = fs.status === 'fulfilled' ? fs.value : []
  const battData = batt.status === 'fulfilled' ? batt.value : null
  const tempData = temp.status === 'fulfilled' ? temp.value : null
  const netData = net.status === 'fulfilled' ? net.value : null
  const gfxData = graphics.status === 'fulfilled' && Array.isArray(graphics.value?.controllers)
    ? graphics.value.controllers
    : []
  const loadData = load.status === 'fulfilled' ? load.value : null
  const procData = procs.status === 'fulfilled' && Array.isArray(procs.value?.list) ? procs.value : null
  const biosData = bios.status === 'fulfilled' ? bios.value : null

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

  const memory = {
    totalGb: memData ? gb(memData.total) : 0,
    usedGb: memData ? gb(memData.used) : 0,
    freeGb: memData ? gb(memData.free) : 0,
    usedPercent: memData && memData.total > 0 ? Math.round((memData.used / memData.total) * 100) : 0,
    activeGb: memData ? gb(memData.active ?? 0) : 0,
    swapTotalGb: memData ? gb(memData.swaptotal ?? 0) : 0,
    swapUsedGb: memData ? gb(memData.swapused ?? 0) : 0,
    swapPercent:
      memData && (memData.swaptotal ?? 0) > 0 ? Math.round(((memData.swapused ?? 0) / (memData.swaptotal ?? 0)) * 100) : 0,
  }

  const gpu = gfxData
    .filter((c) => c && (c.model || c.vendor))
    .map((c) => ({
      model: c.model || c.name || c.vendor || 'unknown',
      vendor: c.vendor || 'unknown',
      vramGb: typeof c.vram === 'number' ? Math.round((c.vram / 1024) * 10) / 10 : 0,
      driverVersion: c.driverVersion || '',
      bus: c.bus || '',
      temperatureC:
        typeof c.temperatureGpu === 'number' && c.temperatureGpu > 0 ? Math.round(c.temperatureGpu) : null,
      utilizationPct:
        typeof c.utilizationGpu === 'number' && c.utilizationGpu >= 0 ? Math.round(c.utilizationGpu) : null,
    }))

  const uptimeHours = Math.round(si.time().uptime / 3600)
  const timeInfo = si.time()
  // systeminformation types `avgLoad` as `Number` but returns a [1,5,15] tuple.
  const loadAvg = (loadData?.avgLoad as unknown as number[]) ?? []
  const connectedWifi = netData?.wifi.connected

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
      cpuModel: cpuData ? `${cpuData.manufacturer} ${cpuData.brand}`.trim() : 'unknown',
      cpuCores: cpuData?.physicalCores ?? 0,
      cpuThreads: cpuData?.cores ?? 0,
      osBuild: os?.build ?? '',
      osCodename: os?.codename ?? '',
      osUefi: typeof os?.uefi === 'boolean' ? os.uefi : null,
      osHypervisor: typeof os?.hypervizor === 'boolean' ? os.hypervizor : null,
      biosVendor: biosData?.vendor ?? '',
      biosVersion: biosData?.version ?? '',
      timezone: timeInfo.timezone ?? '',
      timezoneName: timeInfo.timezoneName ?? '',
      cpuSpeedGhZ: typeof cpuData?.speed === 'number' && cpuData.speed > 0 ? cpuData.speed : null,
      cpuMaxSpeedGhZ:
        typeof cpuData?.speedMax === 'number' && cpuData.speedMax > 0 ? cpuData.speedMax : null,
      cpuVirtualization:
        typeof cpuData?.virtualization === 'boolean' ? cpuData.virtualization : null,
      cpuCacheL3Mb:
        typeof cpuData?.cache?.l3 === 'number' && cpuData.cache.l3 > 0 ? Math.round(cpuData.cache.l3 / 1e6) : null,
      currentCpuLoad:
        typeof loadData?.currentLoad === 'number' ? Math.round(loadData.currentLoad) : null,
      loadAverage1: loadAvg?.[0] != null ? pct(loadAvg[0]) : null,
      loadAverage5: loadAvg?.[1] != null ? pct(loadAvg[1]) : null,
      loadAverage15: loadAvg?.[2] != null ? pct(loadAvg[2]) : null,
    },
    memory,
    disk,
    gpu,
    processes: {
      total: procData?.all ?? 0,
      running: procData?.running ?? 0,
      sleeping: procData?.sleeping ?? 0,
      blocked: procData?.blocked ?? 0,
      topCpu: pickTop(procData?.list ?? [], 'cpu', true),
      topMem: pickTop(procData?.list ?? [], 'mem', false),
    },
    health: {
      cpuTemperatureC:
        tempData && typeof tempData.main === 'number' && tempData.main > 0
          ? Math.round(tempData.main)
          : null,
      batteryPresent,
      batteryPercent:
        batteryPresent && typeof battData?.percent === 'number' ? Math.round(battData.percent) : null,
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
      batteryCycleCount: batteryPresent && typeof battData?.cycleCount === 'number'
        ? battData.cycleCount
        : null,
      batteryTimeRemainingMin: batteryPresent && typeof battData?.timeRemaining === 'number'
        ? Math.round(battData.timeRemaining / 60)
        : null,
      batteryAcConnected: batteryPresent && typeof battData?.acConnected === 'boolean'
        ? battData.acConnected
        : null,
      batteryVoltageV: batteryPresent && typeof battData?.voltage === 'number' && battData.voltage > 0
        ? battData.voltage
        : null,
      batteryType: batteryPresent && battData?.type ? battData.type : null,
    },
    network: {
      wifiSecurity: netData?.wifi.securitySummary ?? 'unknown',
      wifiSecurityDetail: connectedWifi?.security
        ? (Array.isArray(connectedWifi.security) ? connectedWifi.security.join(', ') : String(connectedWifi.security))
        : null,
      wifiSsid: connectedWifi?.ssid || null,
      wifiSignalPct: typeof connectedWifi?.signalPercent === 'number' ? Math.round(connectedWifi.signalPercent) : null,
      wifiChannel: typeof connectedWifi?.channel === 'number' ? connectedWifi.channel : null,
      vpnDetected: netData?.vpn.detected ?? false,
      vpnInterfaces: netData?.vpn.interfaces ?? [],
      gateway: netData?.gateway ?? null,
      ipv4: netData?.ipv4 ?? null,
      ipv6: netData?.ipv6 ?? null,
      interfaceCount: netData?.interfaces?.length ?? 0,
      nearbyNetworks: netData?.wifi.nearby?.length ?? 0,
      locationAccess: netData?.locationAccess ?? 'unknown',
    },
    summary: { score: 100, checks: [] },
    alerts,
    markdown: '',
  }

  report.summary = computeSummary(report)
  report.markdown = renderMarkdown(report)
  return report
}

/** Render the report as a plain-text / markdown document. Exported for tests. */
export function renderMarkdown(r: Omit<SystemHealthReport, 'markdown'>): string {
  const lines: string[] = []
  const fmt = (v: string | number | null | undefined, fallback = 'not available'): string =>
    v == null || v === '' ? fallback : String(v)
  lines.push('# Clarity System Health Report')
  lines.push(`Generated: ${new Date(r.generatedAt).toLocaleString()}`)
  lines.push(`Clarity version: ${r.app.version} (${r.app.platform}/${r.app.arch})`)
  lines.push('')
  lines.push(`## Health Summary — score ${r.summary.score}/100`)
  if (r.summary.checks.length === 0) {
    lines.push('- No checks computed')
  } else {
    for (const c of r.summary.checks) {
      lines.push(`- [${c.status}] ${c.key}: ${c.detail}`)
    }
  }
  lines.push('')
  lines.push('## System')
  lines.push(`- Hostname: ${fmt(r.system.hostname)}`)
  lines.push(`- OS: ${fmt(r.system.os)}`)
  lines.push(`- OS build: ${fmt(r.system.osBuild)}`)
  lines.push(`- OS codename: ${fmt(r.system.osCodename)}`)
  lines.push(`- Kernel: ${fmt(r.system.kernel)}`)
  lines.push(`- Architecture: ${fmt(r.system.arch)}`)
  lines.push(`- UEFI boot: ${r.system.osUefi == null ? 'unknown' : r.system.osUefi ? 'yes' : 'no'}`)
  lines.push(`- Hardware: ${fmt(r.system.manufacturer)} ${fmt(r.system.model, '')}`.trimEnd())
  lines.push(`- BIOS: ${fmt(r.system.biosVendor)} ${fmt(r.system.biosVersion, '')}`.trimEnd())
  lines.push(`- Uptime: ${r.system.uptimeHours} hours`)
  lines.push(`- Timezone: ${fmt(r.system.timezone)} ${fmt(r.system.timezoneName, '')}`.trimEnd())
  lines.push(`- CPU: ${fmt(r.system.cpuModel)} (${r.system.cpuCores} cores / ${r.system.cpuThreads} threads)`)
  lines.push(`- CPU base clock: ${fmt(r.system.cpuSpeedGhZ != null ? `${r.system.cpuSpeedGhZ} GHz` : null)}`)
  lines.push(`- CPU max clock: ${fmt(r.system.cpuMaxSpeedGhZ != null ? `${r.system.cpuMaxSpeedGhZ} GHz` : null)}`)
  lines.push(`- CPU virtualization: ${r.system.cpuVirtualization == null ? 'unknown' : r.system.cpuVirtualization ? 'supported' : 'not supported'}`)
  if (r.system.cpuCacheL3Mb != null) lines.push(`- CPU L3 cache: ${r.system.cpuCacheL3Mb} MB`)
  lines.push('')
  lines.push('## CPU Load')
  lines.push(`- Current CPU load: ${fmt(r.system.currentCpuLoad != null ? `${r.system.currentCpuLoad}%` : null)}`)
  lines.push(`- Load average (1/5/15 min): ${r.system.loadAverage1 ?? 'n/a'}% / ${r.system.loadAverage5 ?? 'n/a'}% / ${r.system.loadAverage15 ?? 'n/a'}%`)
  lines.push('')
  lines.push('## Memory & Swap')
  lines.push(`- Total memory: ${r.memory.totalGb} GB`)
  lines.push(`- Used memory: ${r.memory.usedGb} GB (${r.memory.usedPercent}%)`)
  lines.push(`- Free memory: ${r.memory.freeGb} GB`)
  lines.push(`- Active memory: ${r.memory.activeGb} GB`)
  lines.push(`- Swap: ${r.memory.swapUsedGb} GB used of ${r.memory.swapTotalGb} GB (${r.memory.swapPercent}%)`)
  lines.push('')
  if (r.gpu.length > 0) {
    lines.push('## GPU')
    for (const g of r.gpu) {
      const meta = [g.vendor, g.bus, g.driverVersion].filter(Boolean).join(' · ')
      lines.push(`- ${g.model} — ${g.vramGb} GB VRAM${meta ? ` (${meta})` : ''}`)
      if (g.temperatureC != null || g.utilizationPct != null) {
        lines.push(`  - Temp: ${g.temperatureC != null ? `${g.temperatureC} °C` : 'n/a'} · Utilization: ${g.utilizationPct != null ? `${g.utilizationPct}%` : 'n/a'}`)
      }
    }
    lines.push('')
  }
  lines.push('## Processes')
  lines.push(`- Total: ${r.processes.total} (running ${r.processes.running}, sleeping ${r.processes.sleeping}, blocked ${r.processes.blocked})`)
  if (r.processes.topCpu) lines.push(`- Top CPU: ${r.processes.topCpu.name} (PID ${r.processes.topCpu.pid}) — ${r.processes.topCpu.percent}%`)
  if (r.processes.topMem) lines.push(`- Top memory: ${r.processes.topMem.name} (PID ${r.processes.topMem.pid}) — ${r.processes.topMem.percent}%`)
  lines.push('')
  lines.push('## Thermal & Battery')
  lines.push(`- CPU temperature: ${r.health.cpuTemperatureC != null ? `${r.health.cpuTemperatureC} °C` : 'not available'}`)
  if (r.health.batteryPresent) {
    lines.push(`- Battery: ${r.health.batteryPercent != null ? `${r.health.batteryPercent}%` : 'unknown'}`)
    lines.push(`- Battery health: ${r.health.batteryHealthPercent != null ? `${r.health.batteryHealthPercent}%` : 'unknown'}`)
    lines.push(`- Charging: ${r.health.batteryCharging == null ? 'unknown' : r.health.batteryCharging ? 'yes' : 'no'}`)
    if (r.health.batteryCycleCount != null) lines.push(`- Battery cycle count: ${r.health.batteryCycleCount}`)
    if (r.health.batteryTimeRemainingMin != null) lines.push(`- Time remaining: ${r.health.batteryTimeRemainingMin} min`)
    if (r.health.batteryVoltageV != null) lines.push(`- Battery voltage: ${r.health.batteryVoltageV} V`)
    if (r.health.batteryType) lines.push(`- Battery type: ${r.health.batteryType}`)
  } else {
    lines.push('- Battery: none detected')
  }
  lines.push('')
  lines.push('## Disk')
  if (r.disk.length === 0) {
    lines.push('- No disks reported')
  } else {
    for (const d of r.disk) {
      lines.push(`- ${d.mount} (${d.type}): ${d.totalGb} GB total, ${d.freeGb} GB free, ${d.usedGb} GB used (${d.percent}% used)`)
    }
  }
  lines.push('')
  lines.push('## Network Security')
  lines.push(`- WiFi security: ${r.network.wifiSecurity}`)
  if (r.network.wifiSecurityDetail) lines.push(`- WiFi security detail: ${r.network.wifiSecurityDetail}`)
  if (r.network.wifiSsid) {
    lines.push(`- Connected to: ${r.network.wifiSsid}${r.network.wifiChannel != null ? ` (channel ${r.network.wifiChannel})` : ''}`)
    lines.push(`- Signal: ${r.network.wifiSignalPct != null ? `${r.network.wifiSignalPct}%` : 'n/a'}`)
  }
  lines.push(`- VPN: ${r.network.vpnDetected ? `active (${r.network.vpnInterfaces.join(', ')})` : 'not detected'}`)
  lines.push(`- Network interfaces: ${r.network.interfaceCount}`)
  lines.push(`- Nearby WiFi networks: ${r.network.nearbyNetworks}`)
  lines.push(`- Gateway: ${r.network.gateway ?? 'unknown'}`)
  lines.push(`- IPv4: ${r.network.ipv4 ?? 'unknown'}`)
  lines.push(`- IPv6: ${r.network.ipv6 ?? 'unknown'}`)
  lines.push(`- Location access: ${r.network.locationAccess}`)
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
