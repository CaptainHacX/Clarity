import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const siMock = vi.hoisted(() => ({
  currentLoad: vi.fn(),
  mem: vi.fn(),
  fsSize: vi.fn(),
  battery: vi.fn(),
  cpuTemperature: vi.fn(),
}))

const sendMock = vi.hoisted(() => vi.fn())
const notifyShowMock = vi.hoisted(() => vi.fn())

vi.mock('systeminformation', () => siMock)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: sendMock } }],
  },
  Notification: class {
    static isSupported = () => true
    show() { notifyShowMock() }
  },
}))

let alertsConfig: Record<string, unknown> = {}
let uuidCounter = 0
vi.mock('./settings-store', () => ({
  getSettings: () => ({ alerts: alertsConfig }),
}))
vi.mock('crypto', () => ({
  randomUUID: () => `alert-${++uuidCounter}`,
}))

import { AlertMonitorService } from './alert-monitor'
import type { Systeminformation } from 'systeminformation'

function makeAlerts(overrides: Partial<typeof alertsConfig> = {}): typeof alertsConfig {
  return {
    enabled: true,
    showInApp: true,
    showSystem: true,
    cpuUsageThreshold: 90,
    cpuTempThreshold: 90,
    memoryThreshold: 90,
    diskSpaceThresholdGb: 10,
    batteryThreshold: 20,
    cooldownMinutes: 30,
    ...overrides,
  }
}

function fsMount(overrides: Partial<Systeminformation.FsSizeData> = {}): Systeminformation.FsSizeData {
  return {
    fs: '/dev/disk1',
    type: 'apfs',
    size: 500e9,
    used: 100e9,
    available: 400e9,
    use: 20,
    mount: '/',
    rw: true,
    ...overrides,
  }
}

describe('AlertMonitorService', () => {
  beforeEach(() => {
    alertsConfig = makeAlerts()
    uuidCounter = 0
    sendMock.mockClear()
    notifyShowMock.mockClear()
    vi.clearAllMocks()
    siMock.currentLoad.mockReset()
    siMock.mem.mockReset()
    siMock.fsSize.mockReset()
    siMock.battery.mockReset()
    siMock.cpuTemperature.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns no events when alerts are disabled', async () => {
    alertsConfig = { enabled: false }
    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toEqual([])
    expect(siMock.currentLoad).not.toHaveBeenCalled()
  })

  it('returns no events when thresholds are not met', async () => {
    siMock.currentLoad.mockResolvedValue({ currentLoad: 30 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount({ size: 500e9, used: 200e9 })])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    expect(await svc.check()).toEqual([])
    expect(sendMock).not.toHaveBeenCalled()
    expect(notifyShowMock).not.toHaveBeenCalled()
  })

  it('fires a cpu-usage warning when load exceeds threshold', async () => {
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount({ size: 500e9, used: 200e9 })])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].type).toBe('cpu-usage')
    expect(fired[0].severity).toBe('warning')
    expect(fired[0].data?.value).toBe(95)
    expect(sendMock).toHaveBeenCalledWith('alert:event', expect.objectContaining({ type: 'cpu-usage' }))
    expect(notifyShowMock).toHaveBeenCalledTimes(1)
  })

  it('fires a critical cpu-temp alert when temperature exceeds threshold', async () => {
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 96 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].type).toBe('cpu-temp')
    expect(fired[0].severity).toBe('critical')
  })

  it('fires a memory warning when usage exceeds threshold', async () => {
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 15e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].type).toBe('memory')
  })

  it('fires a disk-space warning when the main mount is nearly full', async () => {
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount({ size: 100e9, used: 96e9 })])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].type).toBe('disk-space')
    expect(fired[0].data?.mount).toBe('/')
  })

  it('fires a battery warning only when on battery power and low', async () => {
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 15 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].type).toBe('battery')
  })

  it('does not fire battery alerts while charging', async () => {
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: true, percent: 10 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    expect(await svc.check()).toEqual([])
  })

  it('suppresses repeat alerts within the cooldown window', async () => {
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    expect(await svc.check()).toHaveLength(1)
    expect(await svc.check()).toHaveLength(0)
  })

  it('fires again after the cooldown elapses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    expect(await svc.check()).toHaveLength(1)

    vi.advanceTimersByTime(31 * 60_000)
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(fired[0].id).toBe('alert-2')
  })

  it('caps history at 50 entries', async () => {
    vi.useFakeTimers()
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    // Fire 60 alerts by elapsing cooldown each time.
    for (let i = 0; i < 60; i++) {
      await svc.check()
      vi.advanceTimersByTime(31 * 60_000)
    }
    const history = svc.getHistory()
    expect(history).toHaveLength(50)
  })

  it('treats a rejected sensor read as non-fatal', async () => {
    siMock.currentLoad.mockRejectedValue(new Error('boom'))
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toEqual([])
  })

  it('clearHistory empties the event list', async () => {
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    await svc.check()
    expect(svc.getHistory()).toHaveLength(1)
    svc.clearHistory()
    expect(svc.getHistory()).toEqual([])
  })

  it('does not send a native notification when showSystem is off', async () => {
    alertsConfig = makeAlerts({ showSystem: false })
    siMock.currentLoad.mockResolvedValue({ currentLoad: 95 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService()
    const fired = await svc.check()
    expect(fired).toHaveLength(1)
    expect(notifyShowMock).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('start() samples immediately and schedules subsequent polls', async () => {
    vi.useFakeTimers()
    siMock.currentLoad.mockResolvedValue({ percent: 10 })
    siMock.mem.mockResolvedValue({ total: 16e9, used: 4e9 })
    siMock.fsSize.mockResolvedValue([fsMount()])
    siMock.battery.mockResolvedValue({ hasBattery: true, isCharging: false, percent: 80 })
    siMock.cpuTemperature.mockResolvedValue({ main: 40 })

    const svc = new AlertMonitorService(60_000)
    svc.start()
    expect(siMock.currentLoad).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(siMock.currentLoad).toHaveBeenCalledTimes(2)
    svc.stop()
    vi.advanceTimersByTime(120_000)
    expect(siMock.currentLoad).toHaveBeenCalledTimes(2)
  })
})
