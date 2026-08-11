import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Systeminformation } from 'systeminformation'

const siMock = vi.hoisted(() => ({
  osInfo: vi.fn(),
  system: vi.fn(),
  cpu: vi.fn(),
  mem: vi.fn(),
  fsSize: vi.fn(),
  battery: vi.fn(),
  cpuTemperature: vi.fn(),
  graphics: vi.fn(),
  currentLoad: vi.fn(),
  processes: vi.fn(),
  bios: vi.fn(),
  time: vi.fn(() => ({ uptime: 3600 * 24, timezone: 'UTC', timezoneName: 'Coordinated Universal Time' })),
}))

const appMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => '1.0.0'),
}))

const netMock = vi.hoisted(() => ({
  collectNetworkSecurityStatus: vi.fn(),
}))

vi.mock('systeminformation', () => siMock)
vi.mock('electron', () => ({ app: appMock }))
vi.mock('./network-security', () => netMock)

import { generateSystemHealthReport, renderMarkdown } from './system-health-report'
import type { AlertEvent, SystemHealthReport } from '../../shared/types'

function osInfo(overrides: Partial<Systeminformation.OsData> = {}): Systeminformation.OsData {
  return {
    platform: 'darwin',
    distro: 'macOS',
    release: '15.0',
    codename: 'Sequoia',
    kernel: '24.0.0',
    arch: 'arm64',
    hostname: 'MacBook-Pro',
    fqdn: 'MacBook-Pro.local',
    codepage: '',
    logofile: '',
    serial: '',
    build: '24A335',
    servicepack: '',
    uefi: true,
    hypervizor: false,
    ...overrides,
  }
}

function systemData(overrides: Partial<Systeminformation.SystemData> = {}): Systeminformation.SystemData {
  return {
    manufacturer: 'Apple',
    model: 'MacBookPro18,1',
    version: '1.0',
    serial: 'SER123',
    uuid: 'abc',
    sku: '',
    virtual: false,
    ...overrides,
  }
}

function cpu(overrides: Partial<Systeminformation.CpuData> = {}): Systeminformation.CpuData {
  return {
    manufacturer: 'Apple',
    brand: 'M2',
    vendor: '',
    family: '',
    model: '',
    stepping: '',
    revision: '',
    voltage: '',
    speed: 3.5,
    speedMin: 0,
    speedMax: 4.2,
    governor: '',
    cores: 8,
    physicalCores: 8,
    performanceCores: 8,
    efficiencyCores: 0,
    processors: 1,
    socket: '',
    flags: '',
    virtualization: true,
    cache: { l1d: 0, l1i: 0, l2: 0, l3: 8_000_000 },
    ...overrides,
  }
}

function mem(overrides: Partial<Systeminformation.MemData> = {}): Systeminformation.MemData {
  return {
    total: 16_000_000_000,
    free: 8_000_000_000,
    used: 8_000_000_000,
    active: 8_000_000_000,
    available: 8_000_000_000,
    buffcache: 0,
    buffers: 0,
    cached: 0,
    slab: 0,
    reclaimable: 0,
    swaptotal: 4_000_000_000,
    swapused: 1_000_000_000,
    swapfree: 3_000_000_000,
    writeback: null,
    dirty: null,
    ...overrides,
  }
}

function fsMount(overrides: Partial<Systeminformation.FsSizeData> = {}): Systeminformation.FsSizeData {
  return {
    fs: '/dev/disk1',
    type: 'apfs',
    size: 500_000_000_000,
    used: 250_000_000_000,
    available: 250_000_000_000,
    use: 50,
    mount: '/',
    rw: true,
    ...overrides,
  }
}

function gpuList(): Systeminformation.GraphicsControllerData[] {
  return [
    {
      vendor: 'Apple',
      model: 'Apple M2',
      bus: 'soc',
      vram: 0,
      vramDynamic: true,
      driverVersion: '',
      name: 'Apple M2',
      temperatureGpu: 0,
      utilizationGpu: undefined,
    },
  ]
}

function processList(): Systeminformation.ProcessesProcessData[] {
  return [
    { pid: 1, parentPid: 0, name: 'launchd', cpu: 0, cpuu: 0, cpus: 1, mem: 0.1, priority: 0, memVsz: 0, memRss: 0, nice: 0, started: '', state: 'S', tty: '', user: 'root', command: 'launchd', params: '', path: '/sbin/launchd' },
    { pid: 123, parentPid: 1, name: 'Clarity', cpu: 30, cpuu: 20, cpus: 1, mem: 5.2, priority: 0, memVsz: 0, memRss: 0, nice: 0, started: '', state: 'S', tty: '', user: 'k', command: 'Clarity', params: '', path: '' },
    { pid: 456, parentPid: 1, name: 'node', cpu: 10, cpuu: 8, cpus: 1, mem: 2.0, priority: 0, memVsz: 0, memRss: 0, nice: 0, started: '', state: 'S', tty: '', user: 'k', command: 'node', params: '', path: '' },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  siMock.time.mockReturnValue({ uptime: 3600 * 24, timezone: 'UTC', timezoneName: 'Coordinated Universal Time' })
  appMock.getVersion.mockReturnValue('1.0.0')
  siMock.osInfo.mockResolvedValue(osInfo())
  siMock.system.mockResolvedValue(systemData())
  siMock.cpu.mockResolvedValue(cpu())
  siMock.mem.mockResolvedValue(mem())
  siMock.fsSize.mockResolvedValue([fsMount()])
  siMock.battery.mockResolvedValue({
    hasBattery: true,
    cycleCount: 120,
    isCharging: false,
    designedCapacity: 5000,
    maxCapacity: 4500,
    currentCapacity: 3000,
    voltage: 12,
    percent: 60,
    timeRemaining: 7200,
    acConnected: false,
    type: 'Li-ion',
    model: 'battery-1',
    manufacturer: 'Apple',
    serial: 'ABC123',
  })
  siMock.cpuTemperature.mockResolvedValue({ main: 55, cores: [], max: 55 })
  siMock.graphics.mockResolvedValue({ controllers: gpuList(), displays: [] })
  siMock.currentLoad.mockResolvedValue({
    avgLoad: [20, 15, 10],
    currentLoad: 25,
    currentLoadUser: 10,
    currentLoadSystem: 5,
    currentLoadNice: 0,
    currentLoadIdle: 75,
    currentLoadIrq: 0,
    currentLoadCpu: 0,
    cpus: [],
  })
  siMock.processes.mockResolvedValue({ all: 200, running: 5, blocked: 0, sleeping: 195, unknown: 0, list: processList() })
  siMock.bios.mockResolvedValue({ vendor: 'Apple Inc.', version: '10151.101.1', releaseDate: '', revision: '' })
  netMock.collectNetworkSecurityStatus.mockResolvedValue({
    collectedAt: Date.now(),
    wifi: {
      connected: null,
      nearby: [],
      securitySummary: 'none',
    },
    interfaces: [],
    gateway: '192.168.1.1',
    vpn: { detected: false, interfaces: [] },
    ipv4: '192.168.1.5',
    ipv6: null,
  })
})

describe('generateSystemHealthReport', () => {
  it('collects system info into the report', async () => {
    const report = await generateSystemHealthReport()
    expect(report.system.hostname).toBe('MacBook-Pro')
    expect(report.system.os).toBe('macOS 15.0')
    expect(report.system.cpuModel).toBe('Apple M2')
    expect(report.system.cpuCores).toBe(8)
    expect(report.system.cpuThreads).toBe(8)
    expect(report.system.uptimeHours).toBe(24)
    expect(report.app.version).toBe('1.0.0')
    expect(report.markdown).toBeTruthy()
  })

  it('captures extended OS, BIOS, and timezone detail', async () => {
    const report = await generateSystemHealthReport()
    expect(report.system.osBuild).toBe('24A335')
    expect(report.system.osCodename).toBe('Sequoia')
    expect(report.system.osUefi).toBe(true)
    expect(report.system.osHypervisor).toBe(false)
    expect(report.system.biosVendor).toBe('Apple Inc.')
    expect(report.system.biosVersion).toBe('10151.101.1')
    expect(report.system.timezone).toBe('UTC')
  })

  it('captures CPU clocks, cache, virtualization, and load', async () => {
    const report = await generateSystemHealthReport()
    expect(report.system.cpuSpeedGhZ).toBe(3.5)
    expect(report.system.cpuMaxSpeedGhZ).toBe(4.2)
    expect(report.system.cpuVirtualization).toBe(true)
    expect(report.system.cpuCacheL3Mb).toBe(8)
    expect(report.system.currentCpuLoad).toBe(25)
    expect(report.system.loadAverage1).toBe(20)
    expect(report.system.loadAverage5).toBe(15)
    expect(report.system.loadAverage15).toBe(10)
  })

  it('reports memory and swap', async () => {
    const report = await generateSystemHealthReport()
    expect(report.memory.totalGb).toBe(16)
    expect(report.memory.usedGb).toBe(8)
    expect(report.memory.freeGb).toBe(8)
    expect(report.memory.usedPercent).toBe(50)
    expect(report.memory.swapTotalGb).toBe(4)
    expect(report.memory.swapUsedGb).toBe(1)
    expect(report.memory.swapPercent).toBe(25)
  })

  it('collects GPU controllers with VRAM and telemetry', async () => {
    const report = await generateSystemHealthReport()
    expect(report.gpu).toHaveLength(1)
    expect(report.gpu[0].model).toBe('Apple M2')
    expect(report.gpu[0].vendor).toBe('Apple')
  })

  it('collects process counts and top consumers, skipping idle noise', async () => {
    const report = await generateSystemHealthReport()
    expect(report.processes.total).toBe(200)
    expect(report.processes.running).toBe(5)
    expect(report.processes.sleeping).toBe(195)
    expect(report.processes.blocked).toBe(0)
    expect(report.processes.topCpu).toEqual({ name: 'Clarity', pid: 123, percent: 30 })
    expect(report.processes.topMem).toEqual({ name: 'Clarity', pid: 123, percent: 5.2 })
  })

  it('computes a health score and checks from real data', async () => {
    const report = await generateSystemHealthReport()
    expect(report.summary.score).toBeGreaterThan(0)
    expect(report.summary.checks.length).toBeGreaterThan(0)
    const memoryCheck = report.summary.checks.find((c) => c.key === 'memory')
    expect(memoryCheck?.status).toBe('ok')
    expect(memoryCheck?.detail).toContain('50%')
  })

  it('flags warning/critical checks when data crosses thresholds', async () => {
    siMock.mem.mockResolvedValue(mem({ total: 16_000_000_000, used: 15_000_000_000, free: 1_000_000_000 }))
    siMock.cpuTemperature.mockResolvedValue({ main: 95, cores: [], max: 95 })
    const report = await generateSystemHealthReport()
    const memoryCheck = report.summary.checks.find((c) => c.key === 'memory')
    const tempCheck = report.summary.checks.find((c) => c.key === 'temperature')
    expect(memoryCheck?.status).toBe('critical')
    expect(tempCheck?.status).toBe('critical')
    expect(report.summary.score).toBeLessThan(70)
  })

  it('sizes and sorts disks with GB math', async () => {
    siMock.fsSize.mockResolvedValue([
      fsMount({ mount: '/', size: 500_000_000_000, used: 250_000_000_000, available: 250_000_000_000, use: 50 }),
      fsMount({ mount: '/Volumes/Data', size: 1_000_000_000_000, used: 800_000_000_000, available: 200_000_000_000, use: 80 }),
    ])
    const report = await generateSystemHealthReport()
    expect(report.disk).toHaveLength(2)
    expect(report.disk[0].mount).toBe('/Volumes/Data')
    expect(report.disk[0].freeGb).toBe(200)
    expect(report.disk[1].percent).toBe(50)
  })

  it('ignores zero-size or missing mount fs entries', async () => {
    siMock.fsSize.mockResolvedValue([
      fsMount(),
      { fs: 'x', type: 'x', size: 0, used: 0, available: 0, use: 0, mount: '', rw: false },
    ])
    const report = await generateSystemHealthReport()
    expect(report.disk).toHaveLength(1)
  })

  it('reports thermal and battery health', async () => {
    const report = await generateSystemHealthReport()
    expect(report.health.cpuTemperatureC).toBe(55)
    expect(report.health.batteryPercent).toBe(60)
    expect(report.health.batteryHealthPercent).toBe(90)
    expect(report.health.batteryCharging).toBe(false)
    expect(report.health.batteryPresent).toBe(true)
  })

  it('captures extended battery detail', async () => {
    const report = await generateSystemHealthReport()
    expect(report.health.batteryCycleCount).toBe(120)
    expect(report.health.batteryTimeRemainingMin).toBe(120)
    expect(report.health.batteryAcConnected).toBe(false)
    expect(report.health.batteryVoltageV).toBe(12)
    expect(report.health.batteryType).toBe('Li-ion')
  })

  it('treats a desktop without battery as present=false', async () => {
    siMock.battery.mockResolvedValue({
      hasBattery: false,
      cycleCount: 0,
      isCharging: null,
      designedCapacity: 0,
      maxCapacity: 0,
      currentCapacity: 0,
      voltage: 0,
      percent: 0,
      timeRemaining: 0,
      acConnected: true,
      type: '',
      model: '',
      manufacturer: '',
      serial: '',
    })
    const report = await generateSystemHealthReport()
    expect(report.health.batteryPresent).toBe(false)
    expect(report.health.batteryPercent).toBeNull()
    expect(report.health.batteryCycleCount).toBeNull()
  })

  it('nulls battery percentages when capacity data is missing', async () => {
    siMock.battery.mockResolvedValue({
      hasBattery: true,
      cycleCount: 0,
      isCharging: true,
      designedCapacity: 0,
      maxCapacity: 0,
      currentCapacity: 0,
      voltage: 0,
      percent: 42,
      timeRemaining: 0,
      acConnected: true,
      type: '',
      model: '',
      manufacturer: '',
      serial: '',
    })
    const report = await generateSystemHealthReport()
    expect(report.health.batteryPercent).toBe(42)
    expect(report.health.batteryHealthPercent).toBeNull()
  })

  it('nulls temperature when the sensor is unavailable', async () => {
    siMock.cpuTemperature.mockResolvedValue({ main: 0, cores: [], max: 0 })
    const report = await generateSystemHealthReport()
    expect(report.health.cpuTemperatureC).toBeNull()
    expect(report.summary.checks.find((c) => c.key === 'temperature')).toBeUndefined()
  })

  it('survives individual collector failures', async () => {
    siMock.cpu.mockRejectedValue(new Error('boom'))
    siMock.fsSize.mockRejectedValue(new Error('boom'))
    siMock.graphics.mockRejectedValue(new Error('boom'))
    siMock.processes.mockRejectedValue(new Error('boom'))
    const report = await generateSystemHealthReport()
    expect(report.system.cpuModel).toBe('unknown')
    expect(report.disk).toEqual([])
    expect(report.gpu).toEqual([])
    expect(report.processes.total).toBe(0)
    expect(report.processes.topCpu).toBeNull()
    expect(report.memory.totalGb).toBe(16)
  })

  it('merges network security posture into the report', async () => {
    netMock.collectNetworkSecurityStatus.mockResolvedValue({
      collectedAt: Date.now(),
      wifi: {
        connected: { ssid: 'Home', bssid: '', channel: 6, frequency: 2437, security: 'WPA2', securityLevel: 'secured', signalDbm: -40, signalPercent: 80, txRate: 144 },
        nearby: [{ ssid: 'Neighbor' }],
        securitySummary: 'secured',
      },
      interfaces: [{ iface: 'en0' }],
      gateway: '10.0.0.1',
      vpn: { detected: true, interfaces: ['utun4'] },
      ipv4: '10.0.0.5',
      ipv6: 'fe80::1',
    })
    const report = await generateSystemHealthReport()
    expect(report.network.wifiSecurity).toBe('secured')
    expect(report.network.wifiSsid).toBe('Home')
    expect(report.network.wifiChannel).toBe(6)
    expect(report.network.wifiSignalPct).toBe(80)
    expect(report.network.wifiSecurityDetail).toBe('WPA2')
    expect(report.network.vpnDetected).toBe(true)
    expect(report.network.vpnInterfaces).toEqual(['utun4'])
    expect(report.network.gateway).toBe('10.0.0.1')
    expect(report.network.ipv4).toBe('10.0.0.5')
    expect(report.network.ipv6).toBe('fe80::1')
    expect(report.network.interfaceCount).toBe(1)
    expect(report.network.nearbyNetworks).toBe(1)
  })

  it('includes passed-in alert history', async () => {
    const alerts: AlertEvent[] = [
      {
        id: 'a1', type: 'disk-space', severity: 'warning', title: 'Disk low', message: 'Main disk below 10 GB',
        timestamp: 1_700_000_000_000, data: { freeGb: 8 },
      },
    ]
    const report = await generateSystemHealthReport(alerts)
    expect(report.alerts).toEqual(alerts)
  })
})

describe('renderMarkdown', () => {
  function baseReport(): SystemHealthReport {
    return {
      generatedAt: 1_700_000_000_000,
      app: { version: '1.0.0', platform: 'darwin', arch: 'arm64' },
      system: {
        hostname: 'MacBook-Pro', os: 'macOS 15.0', kernel: '24.0.0', arch: 'arm64', uptimeHours: 24,
        manufacturer: 'Apple', model: 'MacBookPro18,1', cpuModel: 'Apple M2', cpuCores: 8, cpuThreads: 8,
        osBuild: '24A335', osCodename: 'Sequoia', osUefi: true, osHypervisor: false,
        biosVendor: 'Apple Inc.', biosVersion: '10151.101.1', timezone: 'UTC', timezoneName: 'Coordinated Universal Time',
        cpuSpeedGhZ: 3.5, cpuMaxSpeedGhZ: 4.2, cpuVirtualization: true, cpuCacheL3Mb: 8,
        currentCpuLoad: 25, loadAverage1: 20, loadAverage5: 15, loadAverage15: 10,
      },
      memory: { totalGb: 16, usedGb: 8, freeGb: 8, usedPercent: 50, activeGb: 8, swapTotalGb: 4, swapUsedGb: 1, swapPercent: 25 },
      disk: [{ mount: '/', type: 'apfs', totalGb: 500, usedGb: 250, freeGb: 250, percent: 50 }],
      gpu: [{ model: 'Apple M2', vendor: 'Apple', vramGb: 0, driverVersion: '', bus: 'soc', temperatureC: null, utilizationPct: null }],
      processes: { total: 200, running: 5, sleeping: 195, blocked: 0, topCpu: { name: 'Clarity', pid: 123, percent: 30 }, topMem: { name: 'Clarity', pid: 123, percent: 5.2 } },
      health: { cpuTemperatureC: 55, batteryPercent: 60, batteryHealthPercent: 90, batteryCharging: false, batteryPresent: true, batteryCycleCount: 120, batteryTimeRemainingMin: 120, batteryAcConnected: false, batteryVoltageV: 12, batteryType: 'Li-ion' },
      network: { wifiSecurity: 'secured', wifiSecurityDetail: 'WPA2', wifiSsid: 'Home', wifiSignalPct: 80, wifiChannel: 6, vpnDetected: false, vpnInterfaces: [], gateway: '192.168.1.1', ipv4: '192.168.1.5', ipv6: 'fe80::1', interfaceCount: 2, nearbyNetworks: 4, locationAccess: 'granted' },
      summary: { score: 90, checks: [{ key: 'memory', status: 'ok', detail: '50% used' }] },
      alerts: [],
      markdown: '',
    }
  }

  it('renders a markdown document with all sections', () => {
    const md = renderMarkdown(baseReport())
    expect(md).toContain('# Clarity System Health Report')
    expect(md).toContain('## Health Summary — score 90/100')
    expect(md).toContain('## System')
    expect(md).toContain('## CPU Load')
    expect(md).toContain('## Memory & Swap')
    expect(md).toContain('## GPU')
    expect(md).toContain('## Processes')
    expect(md).toContain('## Thermal & Battery')
    expect(md).toContain('## Disk')
    expect(md).toContain('## Network Security')
    expect(md).toContain('## Recent Alerts')
    expect(md).toContain('CPU temperature: 55 °C')
    expect(md).toContain('Battery health: 90%')
    expect(md).toContain('Load average (1/5/15 min): 20% / 15% / 10%')
    expect(md).toContain('Swap: 1 GB used of 4 GB (25%)')
    expect(md).toContain('Top CPU: Clarity (PID 123) — 30%')
  })

  it('handles absent battery and sensors gracefully', () => {
    const r = baseReport()
    r.health.batteryPresent = false
    r.health.cpuTemperatureC = null
    r.disk = []
    r.gpu = []
    const md = renderMarkdown(r)
    expect(md).toContain('CPU temperature: not available')
    expect(md).toContain('- Battery: none detected')
    expect(md).toContain('- No disks reported')
  })
})
