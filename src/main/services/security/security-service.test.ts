import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'

const appPath = join('/tmp', 'clarity-security-service-test-' + process.pid)

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => appPath },
}))

const scanDevicesMock = vi.fn()
vi.mock('../device-scanner', () => ({
  scanDevices: () => scanDevicesMock(),
}))

const probePortsMock = vi.fn()
const scanRangeMock = vi.fn()
vi.mock('./port-scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./port-scanner')>()
  return {
    ...actual,
    probePorts: (ip: string, ports: number[]) => probePortsMock(ip, ports),
    scanRange: (ip: string, from: number, to: number) => scanRangeMock(ip, from, to),
  }
})

beforeEach(() => {
  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(appPath, { recursive: true })
  vi.resetModules()
  scanDevicesMock.mockReset()
  probePortsMock.mockReset()
  scanRangeMock.mockReset()
})

import { scanAll, scanDeviceByIp, getSecuritySettings, setSecuritySettings, resetSecurityResults, startFullScan, getSecuritySnapshot } from './security-service'

function fakeDevices() {
  return {
    devices: [
      { id: 'aa:bb:cc:dd:ee:01', mac: 'aa:bb:cc:dd:ee:01', ipv4: ['192.168.1.10'], ipv6: [], hostname: 'nas', vendor: null, kind: 'iot', model: null, services: [], roles: {}, status: 'online', isLocal: false, sources: [], firstSeenAt: 1, lastSeenAt: 2, linkQuality: null, tag: null, lastPorts: [] },
      { id: 'aa:bb:cc:dd:ee:02', mac: 'aa:bb:cc:dd:ee:02', ipv4: ['192.168.1.11'], ipv6: [], hostname: null, vendor: null, kind: 'computer', model: null, services: [], roles: {}, status: 'offline', isLocal: false, sources: [], firstSeenAt: 1, lastSeenAt: 2, linkQuality: null, tag: null, lastPorts: [] },
    ],
    listeners: [],
    host: { hostname: 'host', ipv4: ['192.168.1.5'], ipv6: [], mac: null, connectionType: 'wifi', ipCidr: '192.168.1.5 /24' },
    networkContext: null,
    providerStatus: [],
    scannedAt: 1,
    newEvents: [],
  }
}

function allClosed(ports: number[]) {
  return ports.map((port) => ({ port, state: 'closed' as const }))
}

describe('security-service', () => {
  it('scanAll probes online devices only and flags risks', async () => {
    scanDevicesMock.mockResolvedValue(fakeDevices())
    probePortsMock.mockImplementation((ip: string, ports: number[]) =>
      Promise.resolve(
        ports.map((port) => ({
          port,
          state: ip === '192.168.1.10' && (port === 3306 || port === 5353) ? 'open' : 'closed',
        })),
      ),
    )

    await scanAll()

    const snap = getSecuritySnapshot()
    const nas = snap.devices.find((d) => d.ip === '192.168.1.10')
    expect(nas?.severity).toBe('high')
    expect(nas?.online).toBe(true)
    expect(nas?.openPorts.map((p) => p.port)).toEqual(expect.arrayContaining([3306, 5353]))
    const offline = snap.devices.find((d) => d.ip === '192.168.1.11')
    expect(offline?.severity).toBe('untested')
    expect(offline?.online).toBe(false)
    expect(snap.job.state).toBe('done')
    expect(snap.job.total).toBe(2)
  })

  it('scanAll reports low severity for a clean probe', async () => {
    scanDevicesMock.mockResolvedValue(fakeDevices())
    probePortsMock.mockImplementation((ip: string, ports: number[]) => Promise.resolve(allClosed(ports)))
    await scanAll()
    const snap = getSecuritySnapshot()
    const nas = snap.devices.find((d) => d.ip === '192.168.1.10')
    expect(nas?.severity).toBe('low')
    expect(nas?.findings).toHaveLength(0)
  })

  it('refuses to scan a public address', async () => {
    scanDevicesMock.mockResolvedValue(fakeDevices())
    probePortsMock.mockResolvedValue([])
    await expect(scanDeviceByIp('8.8.8.8')).resolves.toBeNull()
  })

  it('persists settings with validation and reset clears results', async () => {
    setSecuritySettings({ autoProbeEnabled: true, autoProbeIntervalHours: 999 })
    expect(getSecuritySettings().autoProbeIntervalHours).toBe(168)
    expect(getSecuritySettings().autoProbeEnabled).toBe(true)

    scanDevicesMock.mockResolvedValue(fakeDevices())
    probePortsMock.mockImplementation((ip: string, ports: number[]) => Promise.resolve(allClosed(ports)))
    await scanAll()
    expect(Object.keys(getSecuritySnapshot().devices).length).toBeGreaterThan(0)

    resetSecurityResults()
    expect(getSecuritySnapshot().devices).toEqual([])
  })

  it('carries device identity onto the result so rows never read "unknown"', async () => {
    const snapshot = fakeDevices()
    ;(snapshot.devices[0] as { vendor: string | null }).vendor = 'Netgear'
    snapshot.devices[0].hostname = null
    snapshot.devices[0].kind = 'router'
    snapshot.devices[0].services = [{ name: 'admin', type: '_http._tcp', port: 80 }] as never
    scanDevicesMock.mockResolvedValue(snapshot)
    probePortsMock.mockImplementation((_ip: string, ports: number[]) => Promise.resolve(allClosed(ports)))

    await scanAll()
    const nas = getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')
    expect(nas?.vendor).toBe('Netgear')
    expect(nas?.kind).toBe('router')
    expect(nas?.mac).toBe('aa:bb:cc:dd:ee:01')
    expect(nas?.serviceTypes).toEqual(['_http._tcp'])
  })

  it('seeds every target before probing so the list is never empty mid-sweep', async () => {
    scanDevicesMock.mockResolvedValue(fakeDevices())
    let seenDuringSweep = -1
    probePortsMock.mockImplementation((_ip: string, ports: number[]) => {
      seenDuringSweep = getSecuritySnapshot().devices.length
      return Promise.resolve(allClosed(ports))
    })
    await scanAll()
    expect(seenDuringSweep).toBe(2)
  })

  describe('full scan', () => {
    it('records open ports into the result', async () => {
      scanRangeMock.mockResolvedValue({ open: [8080, 9000], closed: 100, filtered: 10, checked: 100, aborted: false })
      scanDevicesMock.mockResolvedValue(fakeDevices())
      probePortsMock.mockResolvedValue([])

      const started = await startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })
      expect(started).toEqual({ ok: true, error: null })
      await vi.waitFor(() => {
        expect(getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')?.fullScan.state).toBe('done')
      })
      const nas = getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')
      expect(nas?.fullScan.open).toBe(2)
      expect(nas?.openPorts.map((p) => p.port)).toEqual(expect.arrayContaining([8080, 9000]))
    })

    it('resolves as soon as the sweep starts, not when it finishes', async () => {
      scanDevicesMock.mockResolvedValue(fakeDevices())
      let release: (() => void) | null = null
      scanRangeMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ open: [], closed: 1, filtered: 0, checked: 1, aborted: false })
          }),
      )

      const started = await startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })
      expect(started.ok).toBe(true)
      // The sweep is still in flight, and the UI can already read its progress.
      expect(getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')?.fullScan.state).toBe('running')
      ;(release as (() => void) | null)?.()
    })

    it('explains a refusal instead of failing silently', async () => {
      scanDevicesMock.mockResolvedValue(fakeDevices())
      await expect(startFullScan({ ip: '', from: 1, to: 1024 })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('no IPv4 address'),
      })
      await expect(startFullScan({ ip: '8.8.8.8', from: 1, to: 1024 })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('local network'),
      })
      await expect(startFullScan({ ip: '192.168.1.10', from: 500, to: 100 })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('1 and 65535'),
      })
    })

    it('starts on a device that has never been catalog-probed', async () => {
      // The old code looked the result up first and dropped the error on the
      // floor when there was none, so a never-probed device just said "failed".
      scanDevicesMock.mockResolvedValue(fakeDevices())
      scanRangeMock.mockResolvedValue({ open: [22], closed: 10, filtered: 0, checked: 11, aborted: false })
      const started = await startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })
      expect(started.ok).toBe(true)
      await vi.waitFor(() => {
        expect(getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')?.fullScan.state).toBe('done')
      })
    })

    it('refuses a second sweep of the same device while one is running', async () => {
      scanDevicesMock.mockResolvedValue(fakeDevices())
      let release: (() => void) | null = null
      scanRangeMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ open: [], closed: 1, filtered: 0, checked: 1, aborted: false })
          }),
      )
      await startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })
      await expect(startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('already running'),
      })
      ;(release as (() => void) | null)?.()
    })

    it('surfaces an engine failure as an error state with its reason', async () => {
      scanDevicesMock.mockResolvedValue(fakeDevices())
      scanRangeMock.mockRejectedValue(new Error('socket exhausted'))
      await startFullScan({ ip: '192.168.1.10', from: 1, to: 1024 })
      await vi.waitFor(() => {
        const nas = getSecuritySnapshot().devices.find((d) => d.ip === '192.168.1.10')
        expect(nas?.fullScan.state).toBe('error')
        expect(nas?.fullScan.error).toBe('socket exhausted')
      })
    })
  })
})
