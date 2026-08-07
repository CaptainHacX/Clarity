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
  time: vi.fn(() => ({ uptime: 3600 * 24 })),
}))

const appMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => '1.48.0'),
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
    codename: '',
    kernel: '24.0.0',
    arch: 'arm64',
    hostname: 'MacBook-Pro',
    fqdn: 'MacBook-Pro.local',
    codepage: '',
    logofile: '',
    serial: '',
    build: '',
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
    speedMax: 0,
    governor: '',
    cores: 8,
    physicalCores: 8,
    performanceCores: 8,
    efficiencyCores: 0,
    processors: 1,
    socket: '',
    flags: '',
    virtualization: false,
    cache: { l1d: 0, l1i: 0, l2: 0, l3: 0 },
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
    swaptotal: 0,
    swapused: 0,
    swapfree: 0,
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

beforeEach(() => {
  vi.clearAllMocks()
  siMock.time.mockReturnValue({ uptime: 3600 * 24 })
  appMock.getVersion.mockReturnValue('1.48.0')
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
    expect(report.system.totalMemGb).toBe(16)
    expect(report.system.uptimeHours).toBe(24)
    expect(report.app.version).toBe('1.48.0')
    expect(report.markdown).toBeTruthy()
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
  })

  it('survives individual collector failures', async () => {
    siMock.cpu.mockRejectedValue(new Error('boom'))
    siMock.fsSize.mockRejectedValue(new Error('boom'))
    const report = await generateSystemHealthReport()
    expect(report.system.cpuModel).toBe('unknown')
    expect(report.disk).toEqual([])
    expect(report.system.totalMemGb).toBe(16)
  })

  it('merges network security posture into the report', async () => {
    netMock.collectNetworkSecurityStatus.mockResolvedValue({
      collectedAt: Date.now(),
      wifi: {
        connected: { ssid: 'Home', bssid: '', channel: 6, frequency: 2437, security: 'WPA2', securityLevel: 'secured', signalDbm: -40, signalPercent: 80, txRate: 144 },
        nearby: [],
        securitySummary: 'secured',
      },
      interfaces: [],
      gateway: '10.0.0.1',
      vpn: { detected: true, interfaces: ['utun4'] },
      ipv4: '10.0.0.5',
      ipv6: null,
    })
    const report = await generateSystemHealthReport()
    expect(report.network.wifiSecurity).toBe('secured')
    expect(report.network.vpnDetected).toBe(true)
    expect(report.network.gateway).toBe('10.0.0.1')
    expect(report.network.ipv4).toBe('10.0.0.5')
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
      app: { version: '1.48.0', platform: 'darwin', arch: 'arm64' },
      system: {
        hostname: 'MacBook-Pro', os: 'macOS 15.0', kernel: '24.0.0', arch: 'arm64', uptimeHours: 24,
        manufacturer: 'Apple', model: 'MacBookPro18,1', cpuModel: 'Apple M2', cpuCores: 8, cpuThreads: 8, totalMemGb: 16,
      },
      disk: [{ mount: '/', type: 'apfs', totalGb: 500, usedGb: 250, freeGb: 250, percent: 50 }],
      health: { cpuTemperatureC: 55, batteryPercent: 60, batteryHealthPercent: 90, batteryCharging: false, batteryPresent: true },
      network: { wifiSecurity: 'secured', vpnDetected: false, gateway: '192.168.1.1', ipv4: '192.168.1.5' },
      alerts: [],
      markdown: '',
    }
  }

  it('renders a markdown document with all sections', () => {
    const md = renderMarkdown(baseReport())
    expect(md).toContain('# Clarity System Health Report')
    expect(md).toContain('## System')
    expect(md).toContain('## Thermal & Battery')
    expect(md).toContain('## Disk')
    expect(md).toContain('## Network Security')
    expect(md).toContain('## Recent Alerts')
    expect(md).toContain('CPU temperature: 55 °C')
    expect(md).toContain('Battery health: 90%')
  })

  it('handles absent battery and sensors gracefully', () => {
    const r = baseReport()
    r.health.batteryPresent = false
    r.health.cpuTemperatureC = null
    r.disk = []
    const md = renderMarkdown(r)
    expect(md).toContain('CPU temperature: not available')
    expect(md).toContain('- Battery: none detected')
    expect(md).toContain('- No disks reported')
  })
})
