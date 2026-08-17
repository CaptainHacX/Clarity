import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const siMock = vi.hoisted(() => ({
  wifiConnections: vi.fn(),
  wifiNetworks: vi.fn(),
  networkInterfaces: vi.fn(),
  networkGatewayDefault: vi.fn(),
}))

const electronMock = vi.hoisted(() => ({
  systemPreferences: { getMediaAccessStatus: vi.fn() },
}))

// `coreWlanLocationAuthStatus` returns null here so these cases exercise the
// inference fallback. The authoritative native path — where CoreLocation is
// asked directly — is covered separately below.
const coreWlanMock = vi.hoisted(() => ({
  coreWlanScan: vi.fn(),
  coreWlanLocationAuthStatus: vi.fn(() => null as number | null),
  coreWlanLocationServicesEnabled: vi.fn(() => null as boolean | null),
  // The real mapping — a pure switch, so there is nothing to fake and stubbing
  // it would only let the mock drift from the behaviour under test.
  locationAccessFromAuthStatus: (status: number): string => {
    if (status === 3 || status === 4) return 'granted'
    if (status === 1 || status === 2) return 'denied'
    if (status === 0) return 'not-determined'
    return 'unknown'
  },
}))

vi.mock('systeminformation', () => siMock)
vi.mock('electron', () => electronMock)
vi.mock('./wifi/corewlan', () => coreWlanMock)

import { collectLocationAccess, collectNetworkSecurityStatus, classifySecurity, toSignalPercent } from './network-security'
import type { Systeminformation } from 'systeminformation'

function scanResult(
  overrides: { ok?: boolean; networks?: Array<{ bssid: string | null }>; currentBssid?: string | null } = {},
): { ok: boolean; networks: Array<{ bssid: string | null }>; current: { bssid: string | null } | null } {
  return {
    ok: overrides.ok ?? true,
    networks: overrides.networks ?? [],
    current: { bssid: overrides.currentBssid ?? null },
  }
}

function conn(overrides: Partial<Systeminformation.WifiConnectionData> = {}): Systeminformation.WifiConnectionData {
  return {
    id: 'en0',
    iface: 'en0',
    model: '',
    ssid: 'CoffeeShop',
    bssid: 'aa:bb:cc:dd:ee:ff',
    channel: 6,
    frequency: 2437,
    type: '802.11',
    security: 'WPA2-Personal',
    signalLevel: -45,
    quality: 80,
    txRate: 144,
    ...overrides,
  }
}

function net(overrides: Partial<Systeminformation.WifiNetworkData> = {}): Systeminformation.WifiNetworkData {
  return {
    ssid: 'OpenGuest',
    bssid: '11:22:33:44:55:66',
    mode: '',
    channel: 1,
    frequency: 2412,
    signalLevel: -60,
    quality: 60,
    security: ['Open'],
    wpaFlags: [],
    rsnFlags: [],
    ...overrides,
  }
}

function iface(overrides: Partial<Systeminformation.NetworkInterfacesData> = {}): Systeminformation.NetworkInterfacesData {
  return {
    iface: 'en0',
    ifaceName: 'Wi-Fi',
    default: true,
    ip4: '192.168.1.5',
    ip4subnet: '255.255.255.0',
    ip6: 'fe80::1',
    ip6subnet: 'ffff:ffff:ffff:ffff::',
    mac: 'aa:bb:cc:dd:ee:ff',
    internal: false,
    virtual: false,
    operstate: 'up',
    type: 'wifi',
    duplex: 'full',
    mtu: 1500,
    speed: 144,
    dhcp: true,
    dnsSuffix: '',
    ieee8021xAuth: '',
    ieee8021xState: '',
    carrierChanges: 0,
    ...overrides,
  }
}

describe('classifySecurity', () => {
  it('classifies WPA2/WPA3 as secured', () => {
    expect(classifySecurity('WPA2-Personal')).toBe('secured')
    expect(classifySecurity('WPA3')).toBe('secured')
    expect(classifySecurity(['WPA2', 'AES'])).toBe('secured')
  })

  it('classifies WEP as weak', () => {
    expect(classifySecurity('WEP')).toBe('weak')
  })

  it('classifies open networks', () => {
    expect(classifySecurity('Open')).toBe('open')
    expect(classifySecurity(['Open'])).toBe('open')
    expect(classifySecurity('')).toBe('open')
    expect(classifySecurity(null)).toBe('open')
    expect(classifySecurity(undefined)).toBe('open')
    expect(classifySecurity([])).toBe('open')
  })
})

describe('toSignalPercent', () => {
  it('maps -30 dBm to 100%', () => {
    expect(toSignalPercent(-30)).toBe(100)
  })

  it('maps -90 dBm to 0%', () => {
    expect(toSignalPercent(-90)).toBe(0)
  })

  it('maps -60 dBm to 50%', () => {
    expect(toSignalPercent(-60)).toBe(50)
  })

  it('clamps out-of-range values', () => {
    expect(toSignalPercent(-110)).toBe(0)
    expect(toSignalPercent(0)).toBe(100)
  })

  it('returns null for missing input', () => {
    expect(toSignalPercent(null)).toBeNull()
    expect(toSignalPercent(undefined)).toBeNull()
  })
})

describe('collectNetworkSecurityStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    siMock.wifiConnections.mockReset()
    siMock.wifiNetworks.mockReset()
    siMock.networkInterfaces.mockReset()
    siMock.networkGatewayDefault.mockReset()
    coreWlanMock.coreWlanScan.mockReset()
    coreWlanMock.coreWlanScan.mockResolvedValue(scanResult())
    coreWlanMock.coreWlanLocationAuthStatus.mockReset()
    coreWlanMock.coreWlanLocationAuthStatus.mockReturnValue(null)
    coreWlanMock.coreWlanLocationServicesEnabled.mockReset()
    coreWlanMock.coreWlanLocationServicesEnabled.mockReturnValue(null)
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Location state is read from its only observable effect: CoreWLAN hands out
  // BSSIDs once the app is authorized and withholds them until then.
  it('reports granted once BSSIDs come back from CoreWLAN', async () => {
    coreWlanMock.coreWlanScan.mockResolvedValue(
      scanResult({ networks: [{ bssid: 'aa:bb:cc:dd:ee:ff' }, { bssid: null }] }),
    )
    await expect(collectLocationAccess()).resolves.toBe('granted')
  })

  it('reports not-determined while every BSSID is withheld', async () => {
    coreWlanMock.coreWlanScan.mockResolvedValue(scanResult({ networks: [{ bssid: null }, { bssid: null }] }))
    await expect(collectLocationAccess()).resolves.toBe('not-determined')
  })

  it('returns unknown when CoreWLAN itself could not be reached', async () => {
    coreWlanMock.coreWlanScan.mockResolvedValue(scanResult({ ok: false }))
    await expect(collectLocationAccess()).resolves.toBe('unknown')
  })

  // With the native addon loaded, CoreLocation is asked directly rather than
  // inferred from whether BSSIDs came back. This is what makes a granted app
  // report "granted" — the inference could not, because the process it inferred
  // from (`osascript`) never saw the grant.
  it('trusts the native authorization status over the BSSID inference', async () => {
    // Every BSSID withheld — inference alone would say not-determined.
    coreWlanMock.coreWlanScan.mockResolvedValue(scanResult({ networks: [{ bssid: null }] }))
    coreWlanMock.coreWlanLocationAuthStatus.mockReturnValue(3) // authorizedAlways
    coreWlanMock.coreWlanLocationServicesEnabled.mockReturnValue(true)
    await expect(collectLocationAccess()).resolves.toBe('granted')
  })

  it('reports not-determined from the native status', async () => {
    coreWlanMock.coreWlanLocationAuthStatus.mockReturnValue(0)
    coreWlanMock.coreWlanLocationServicesEnabled.mockReturnValue(true)
    await expect(collectLocationAccess()).resolves.toBe('not-determined')
  })

  it('reports denied when the system-wide Location switch is off, whatever the app was granted', async () => {
    coreWlanMock.coreWlanLocationAuthStatus.mockReturnValue(3)
    coreWlanMock.coreWlanLocationServicesEnabled.mockReturnValue(false)
    await expect(collectLocationAccess()).resolves.toBe('denied')
  })

  it('exposes the Location permission in the collected status', async () => {
    coreWlanMock.coreWlanScan.mockResolvedValue(scanResult({ networks: [{ bssid: null }] }))
    siMock.wifiConnections.mockResolvedValue([conn()])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([iface()])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')
    const status = await collectNetworkSecurityStatus()
    expect(status.locationAccess).toBe('not-determined')
  })

  it('reports a secured connection with nearby networks and gateway', async () => {
    siMock.wifiConnections.mockResolvedValue([conn()])
    siMock.wifiNetworks.mockResolvedValue([net(), net({ ssid: 'HomeNet', security: ['WPA2'] })])
    siMock.networkInterfaces.mockResolvedValue([iface()])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.wifi.connected?.ssid).toBe('CoffeeShop')
    expect(status.wifi.securitySummary).toBe('secured')
    expect(status.wifi.nearby).toHaveLength(2)
    expect(status.wifi.nearby[0].securityLevel).toBe('open')
    expect(status.wifi.nearby[1].securityLevel).toBe('secured')
    expect(status.gateway).toBe('192.168.1.1')
    expect(status.ipv4).toBe('192.168.1.5')
  })

  it('flags an open WiFi connection as open', async () => {
    siMock.wifiConnections.mockResolvedValue([conn({ security: 'Open' })])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([iface()])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.wifi.connected?.securityLevel).toBe('open')
    expect(status.wifi.securitySummary).toBe('open')
  })

  it('reports no WiFi when disconnected', async () => {
    siMock.wifiConnections.mockResolvedValue([])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([iface()])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.wifi.connected).toBeNull()
    expect(status.wifi.securitySummary).toBe('none')
  })

  it('detects a tunnel that carries an address as a connected VPN', async () => {
    siMock.wifiConnections.mockResolvedValue([conn()])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([
      iface(),
      iface({ iface: 'utun3', ip4: '10.8.0.2', type: 'unknown', virtual: true }),
    ])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.vpn.detected).toBe(true)
    expect(status.vpn.interfaces).toContain('utun3')
  })

  it('does not report a VPN for the idle utuns macOS keeps on every machine', async () => {
    // The regression: matching interface names alone said "VPN active" on a Mac
    // with no VPN, because iCloud Private Relay / Continuity leave utun0-3
    // present with nothing but a link-local IPv6.
    siMock.wifiConnections.mockResolvedValue([conn()])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([
      iface(),
      iface({ iface: 'utun0', ip4: '', ip6: 'fe80::9eb6:1def:2f19:d938', virtual: true }),
      iface({ iface: 'utun1', ip4: '', ip6: 'fe80::8c03:9d44:778d:85bc', virtual: true }),
      iface({ iface: 'utun2', ip4: '', ip6: 'fe80::d5df:a899:b1ef:346b', virtual: true }),
      iface({ iface: 'utun3', ip4: '', ip6: 'fe80::ce81:b1c:bd2c:69e', virtual: true }),
    ])
    siMock.networkGatewayDefault.mockResolvedValue('192.168.1.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.vpn.detected).toBe(false)
    expect(status.vpn.interfaces).toEqual([])
  })

  it('skips virtual/internal interfaces when picking the primary IPv4', async () => {
    siMock.wifiConnections.mockResolvedValue([])
    siMock.wifiNetworks.mockResolvedValue([])
    siMock.networkInterfaces.mockResolvedValue([
      iface({ iface: 'lo0', ip4: '127.0.0.1', internal: true }),
      iface({ iface: 'utun0', ip4: '10.8.0.2', type: 'unknown', virtual: true }),
      iface({ iface: 'en1', ip4: '10.0.0.20', type: 'ethernet' }),
    ])
    siMock.networkGatewayDefault.mockResolvedValue('10.0.0.1')

    const status = await collectNetworkSecurityStatus()
    expect(status.ipv4).toBe('10.0.0.20')
  })

  it('degrades gracefully when every sensor read fails', async () => {
    siMock.wifiConnections.mockRejectedValue(new Error('no wifi'))
    siMock.wifiNetworks.mockRejectedValue(new Error('no scan'))
    siMock.networkInterfaces.mockRejectedValue(new Error('no ifaces'))
    siMock.networkGatewayDefault.mockRejectedValue(new Error('no gw'))

    const status = await collectNetworkSecurityStatus()
    expect(status.wifi.connected).toBeNull()
    expect(status.wifi.nearby).toEqual([])
    expect(status.interfaces).toEqual([])
    expect(status.gateway).toBeNull()
    expect(status.vpn.detected).toBe(false)
    expect(status.wifi.securitySummary).toBe('none')
  })
})
