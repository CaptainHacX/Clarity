import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/kudu-test',
  },
}))

vi.mock('systeminformation', () => ({
  wifiConnections: vi.fn(),
  wifiNetworks: vi.fn(),
}))

// The macOS path shells out to CoreWLAN; stub it so `scanWifiNetworks` exercises
// the systeminformation fallback deterministically on every platform.
vi.mock('./wifi/corewlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wifi/corewlan')>()
  return { ...actual, coreWlanScan: vi.fn() }
})
vi.mock('./wifi/linux-wifi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wifi/linux-wifi')>()
  return { ...actual, linuxWifiScan: vi.fn() }
})

import * as si from 'systeminformation'
import { coreWlanScan, type CoreWlanScan, type RawCoreWlanNetwork } from './wifi/corewlan'
import { linuxWifiScan } from './wifi/linux-wifi'
import {
  buildDarwinSnapshot,
  dedupeNetworks,
  loadOuiDb,
  lookupVendor,
  matchConnectedIndex,
  networkTypeFromProfiler,
  normalizeOui,
  parseProfilerChannel,
  parseProfilerWifi,
  parseSignalNoise,
  phyModesFromString,
  profilerSecurityToLabel,
  scanWifiNetworks,
  sortNetworksBySignal,
} from './wifi-scanner'
import type { WifiNetworkDetail } from '../../shared/types'

const mockedConnections = vi.mocked(si.wifiConnections)
const mockedNetworks = vi.mocked(si.wifiNetworks)
const mockedCoreWlan = vi.mocked(coreWlanScan)
const mockedLinuxWifi = vi.mocked(linuxWifiScan)

function detail(partial: Partial<WifiNetworkDetail>): WifiNetworkDetail {
  return {
    ssid: null,
    ssidRedacted: false,
    isHidden: false,
    bssid: null,
    vendor: null,
    channel: null,
    band: null,
    channelWidthMhz: null,
    frequency: null,
    security: [],
    securityLabel: null,
    securityShort: null,
    securityLevel: 'unknown',
    countryCode: null,
    beaconIntervalMs: null,
    networkType: 'unknown',
    phyModes: [],
    signalDbm: null,
    signalPercent: null,
    noiseDbm: null,
    snrDbm: null,
    txRateMbps: null,
    isConnected: false,
    lastSeen: 0,
    ...partial,
  }
}

function rawNetwork(partial: Partial<RawCoreWlanNetwork>): RawCoreWlanNetwork {
  return {
    ssid: null,
    bssid: null,
    rssi: null,
    noise: null,
    channel: null,
    bandCode: null,
    widthCode: null,
    countryCode: null,
    beaconInterval: null,
    ibss: false,
    securityCodes: [],
    phyCodes: [],
    ...partial,
  }
}

function coreScan(partial: Partial<CoreWlanScan>): CoreWlanScan {
  return {
    ok: true,
    interfaceName: 'en1',
    powerOn: true,
    active: true,
    current: null,
    networks: [],
    error: null,
    ...partial,
  }
}

beforeEach(() => {
  mockedConnections.mockReset()
  mockedNetworks.mockReset()
  mockedCoreWlan.mockReset()
  mockedLinuxWifi.mockReset()
  // Default: the native path finds nothing, so the fallback runs.
  mockedCoreWlan.mockResolvedValue(coreScan({ ok: false, error: 'unavailable' }))
  mockedLinuxWifi.mockResolvedValue({ ok: false, interfaceName: null, networks: [], error: 'unavailable' })
})

describe('OUI vendor lookup', () => {
  it('normalizeOui extracts the 24-bit OUI from any MAC shape', () => {
    expect(normalizeOui('AA:BB:CC:00:11:22')).toBe('aabbcc')
    expect(normalizeOui('AA-BB-CC-00-11-22')).toBe('aabbcc')
    expect(normalizeOui('aabbcc001122')).toBe('aabbcc')
    expect(normalizeOui('xx')).toBeNull()
    expect(normalizeOui(null)).toBeNull()
    expect(normalizeOui(undefined)).toBeNull()
  })

  it('lookupVendor resolves via the OUI registry', () => {
    const db = { aabbcc: 'Fake AP Co.' }
    expect(lookupVendor('AA:BB:CC:00:00:00', db)).toBe('Fake AP Co.')
    expect(lookupVendor('AABBCC001122', db)).toBe('Fake AP Co.')
    expect(lookupVendor('00:11:22:33:44:55', db)).toBeNull()
    expect(lookupVendor(null, db)).toBeNull()
  })

  it('loadOuiDb lowercases keys and tolerates missing/corrupt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kudu-oui-'))
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ AABBCC: 'Vendor X', ddEEFF: 'Vendor Y' }))
    expect(loadOuiDb(good)).toEqual({ aabbcc: 'Vendor X', ddeeff: 'Vendor Y' })
    expect(loadOuiDb(join(dir, 'missing.json'))).toEqual({})
    expect(loadOuiDb(join(dir, 'bad.json'))).toEqual({})
  })
})

describe('system_profiler parsers', () => {
  it('parseProfilerChannel handles width, band and bare channels', () => {
    expect(parseProfilerChannel('44 (5GHz, 80MHz)')).toEqual({ channel: 44, band: '5 GHz', channelWidthMhz: 80 })
    expect(parseProfilerChannel('36 (5GHz)')).toEqual({ channel: 36, band: '5 GHz', channelWidthMhz: null })
    expect(parseProfilerChannel('6')).toEqual({ channel: 6, band: '2.4 GHz', channelWidthMhz: null })
    expect(parseProfilerChannel('6 (2GHz, 20MHz)')).toEqual({ channel: 6, band: '2 GHz', channelWidthMhz: 20 })
    expect(parseProfilerChannel(null)).toEqual({ channel: null, band: null, channelWidthMhz: null })
    expect(parseProfilerChannel('nope')).toEqual({ channel: null, band: null, channelWidthMhz: null })
  })

  it('parseSignalNoise reads "signal / noise" pairs', () => {
    expect(parseSignalNoise('-70 dBm / -91 dBm')).toEqual({ signalDbm: -70, noiseDbm: -91 })
    expect(parseSignalNoise('N/A')).toEqual({ signalDbm: null, noiseDbm: null })
    expect(parseSignalNoise(null)).toEqual({ signalDbm: null, noiseDbm: null })
  })

  it('phyModesFromString splits and de-dupes PHY modes', () => {
    expect(phyModesFromString('802.11a/n/ac')).toEqual(['802.11a', '802.11n', '802.11ac'])
    expect(phyModesFromString('802.11ac')).toEqual(['802.11ac'])
    expect(phyModesFromString('802.11ac 802.11ac 802.11ax')).toEqual(['802.11ac', '802.11ax'])
    expect(phyModesFromString(null)).toEqual([])
  })

  it('profilerSecurityToLabel maps security modes to readable labels', () => {
    expect(profilerSecurityToLabel('spairport_security_mode_wpa2_personal')).toBe('WPA2 Personal')
    expect(profilerSecurityToLabel('spairport_security_mode_wpa3_personal')).toBe('WPA3 Personal')
    expect(profilerSecurityToLabel('spairport_security_mode_wep')).toBe('WEP')
    expect(profilerSecurityToLabel('spairport_security_mode_open')).toBe('Open')
    expect(profilerSecurityToLabel(null)).toBeNull()
  })

  it('networkTypeFromProfiler classifies station vs ad-hoc', () => {
    expect(networkTypeFromProfiler('spairport_network_type_station')).toBe('infrastructure')
    expect(networkTypeFromProfiler('spairport_network_type_ibss')).toBe('adhoc')
    expect(networkTypeFromProfiler(undefined)).toBe('unknown')
  })

  it('parseProfilerWifi extracts current + nearby networks from a real fixture', () => {
    const fixture = {
      SPAirPortDataType: [
        {
          spairport_airport_interfaces: [
            {
              spairport_current_network_information: {
                _name: '<redacted>',
                spairport_network_channel: '44 (5GHz, 80MHz)',
                spairport_network_country_code: 'IN',
                spairport_network_mcs: 6,
                spairport_network_phymode: '802.11ac',
                spairport_network_rate: 292,
                spairport_network_type: 'spairport_network_type_station',
                spairport_security_mode: 'spairport_security_mode_wpa2_personal',
                spairport_signal_noise: '-70 dBm / -91 dBm',
              },
              spairport_airport_other_local_wireless_networks: [
                {
                  _name: '<redacted>',
                  spairport_network_channel: '36 (5GHz)',
                  spairport_network_phymode: '802.11a/n/ac',
                  spairport_network_type: 'spairport_network_type_station',
                  spairport_security_mode: 'spairport_security_mode_wpa2_personal',
                },
              ],
            },
          ],
        },
      ],
    }

    const parsed = parseProfilerWifi(fixture)
    expect(parsed.current).toMatchObject({
      ssid: '<redacted>',
      channel: 44,
      band: '5 GHz',
      channelWidthMhz: 80,
      countryCode: 'IN',
      phyModes: ['802.11ac'],
      networkType: 'infrastructure',
      security: 'WPA2 Personal',
      signalDbm: -70,
      noiseDbm: -91,
    })
    expect(parsed.nearby).toHaveLength(1)
    expect(parsed.nearby[0]).toMatchObject({
      channel: 36,
      band: '5 GHz',
      channelWidthMhz: null,
      phyModes: ['802.11a', '802.11n', '802.11ac'],
      networkType: 'infrastructure',
      security: 'WPA2 Personal',
      signalDbm: null,
      noiseDbm: null,
    })
  })

  it('parseProfilerWifi tolerates garbage input', () => {
    expect(parseProfilerWifi(null)).toEqual({ current: null, nearby: [] })
    expect(parseProfilerWifi({})).toEqual({ current: null, nearby: [] })
    expect(parseProfilerWifi('junk')).toEqual({ current: null, nearby: [] })
  })
})

describe('scanWifiNetworks', () => {
  it('assembles, flags and sorts a snapshot from systeminformation', async () => {
    mockedConnections.mockResolvedValue([
      { id: 'en0', iface: 'en0', model: '', ssid: '<redacted>', bssid: '', channel: 44, frequency: 5220, type: '802.11ac', security: 'WPA2', signalLevel: -66, quality: 68, txRate: 263 },
    ])
    mockedNetworks.mockResolvedValue([
      { ssid: '<redacted>', bssid: '', mode: '802.11a/n/ac', channel: 36, frequency: 5180, signalLevel: -55, quality: 80, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
      { ssid: '<redacted>', bssid: '', mode: '802.11n', channel: 44, frequency: 5220, signalLevel: -70, quality: 50, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
      { ssid: 'OpenNet', bssid: 'AA:BB:CC:00:11:22', mode: '802.11ac', channel: 149, frequency: 5745, signalLevel: -90, quality: 10, security: ['Open'], wpaFlags: [], rsnFlags: [] },
    ])

    const snapshot = await scanWifiNetworks()

    expect(snapshot.networks).toHaveLength(3)
    // Strongest signal first
    expect(snapshot.networks[0].channel).toBe(36)
    expect(snapshot.networks[1].channel).toBe(44)
    // Weakest last
    expect(snapshot.networks[2].channel).toBe(149)
    // The connected (channel 44) entry is flagged
    const connectedEntry = snapshot.networks.find((n) => n.channel === 44)
    expect(connectedEntry?.isConnected).toBe(true)
    expect(connectedEntry?.signalDbm).toBe(-70)
    // Vendor resolved from the BSSID on the open network
    expect(snapshot.networks[2].vendor).toBeNull() // unknown OUI
    // Connected network exposed separately
    expect(snapshot.connectedBssid).toBeNull()
    expect(snapshot.collectedAt).toBeGreaterThan(0)
  })

  it('adds the connected network when it is missing from nearby', async () => {
    mockedConnections.mockResolvedValue([
      { id: 'en0', iface: 'en0', model: '', ssid: 'HomeNet', bssid: 'AABBCC001122', channel: 6, frequency: 2437, type: '802.11n', security: 'WPA2', signalLevel: -60, quality: 70, txRate: 144 },
    ])
    mockedNetworks.mockResolvedValue([
      { ssid: 'Cafe', bssid: 'DDFFEE', mode: '802.11ac', channel: 36, frequency: 5180, signalLevel: -45, quality: 90, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
    ])

    const snapshot = await scanWifiNetworks()

    expect(snapshot.networks).toHaveLength(2)
    const home = snapshot.networks.find((n) => n.ssid === 'HomeNet')
    expect(home).toBeDefined()
    expect(home?.isConnected).toBe(true)
    expect(home?.vendor).toBeNull() // OUI db is empty in the test environment
    expect(snapshot.connectedBssid).toBe('AABBCC001122')
  })

  it('collapses duplicate identities (same BSSID or redacted same-channel) into one row', async () => {
    mockedConnections.mockResolvedValue([])
    mockedNetworks.mockResolvedValue([
      // Dual-band AP: same BSSID advertised on both bands.
      { ssid: 'DualBand', bssid: 'AA:BB:CC:00:11:22', mode: '802.11ac', channel: 36, frequency: 5180, signalLevel: -50, quality: 80, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
      { ssid: 'DualBand', bssid: 'AA:BB:CC:00:11:22', mode: '802.11n', channel: 6, frequency: 2437, signalLevel: -55, quality: 75, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
      // Redacted network repeated on the same channel.
      { ssid: '<redacted>', bssid: '', mode: '802.11n', channel: 11, frequency: 2462, signalLevel: -70, quality: 40, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
      { ssid: '<redacted>', bssid: '', mode: '802.11n', channel: 11, frequency: 2462, signalLevel: -60, quality: 60, security: ['WPA2'], wpaFlags: [], rsnFlags: [] },
    ])

    const snapshot = await scanWifiNetworks()

    expect(snapshot.networks).toHaveLength(2)
    const dualBand = snapshot.networks.find((n) => n.ssid === 'DualBand')
    expect(dualBand?.channel).toBe(36) // strongest band kept
    const redacted = snapshot.networks.find((n) => n.ssid === null && n.ssidRedacted)
    expect(redacted?.signalDbm).toBe(-60) // stronger repeat kept
  })

  it('degrades to an empty snapshot when reads fail', async () => {
    mockedConnections.mockRejectedValue(new Error('boom'))
    mockedNetworks.mockRejectedValue(new Error('boom'))
    const snapshot = await scanWifiNetworks()
    expect(snapshot.networks).toEqual([])
    expect(snapshot.connectedBssid).toBeNull()
  })
})

describe('sortNetworksBySignal', () => {
  it('puts null-signal networks last, alphabetically', () => {
    const a = detail({ ssid: 'Alpha', channel: 1, signalDbm: null })
    const b = detail({ ssid: 'Zulu', channel: 2, signalDbm: null })
    const c = detail({ ssid: 'Mid', channel: 3, signalDbm: -50 })
    const d = detail({ ssid: 'Top', channel: 4, signalDbm: -40 })
    const sorted = sortNetworksBySignal([a, b, c, d])
    expect(sorted.map((n) => n.ssid)).toEqual(['Top', 'Mid', 'Alpha', 'Zulu'])
  })
})

describe('dedupeNetworks', () => {
  it('keeps hidden networks apart by channel, band and security', () => {
    const rows = [
      detail({ ssid: null, isHidden: true, channel: 1, band: '2.4 GHz', securityShort: 'WPA2', signalDbm: -60 }),
      detail({ ssid: null, isHidden: true, channel: 6, band: '2.4 GHz', securityShort: 'WPA2', signalDbm: -65 }),
      detail({ ssid: null, isHidden: true, channel: 6, band: '2.4 GHz', securityShort: 'Open', signalDbm: -70 }),
    ]
    expect(dedupeNetworks(rows)).toHaveLength(3)
  })

  it('collapses repeats of the same hidden AP instead of growing the list', () => {
    const row = () => detail({ ssid: null, isHidden: true, channel: 11, band: '2.4 GHz', securityShort: 'WPA2', signalDbm: -70 })
    // Five polls of the same beacon must still be one row.
    expect(dedupeNetworks([row(), row(), row(), row(), row()])).toHaveLength(1)
  })

  it('never lets a weaker duplicate displace the connected row', () => {
    const rows = [
      detail({ bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'Home', signalDbm: -75, isConnected: true }),
      detail({ bssid: 'aa:bb:cc:dd:ee:ff', ssid: 'Home', signalDbm: -40 }),
    ]
    const [only] = dedupeNetworks(rows)
    expect(only.isConnected).toBe(true)
  })
})

describe('matchConnectedIndex', () => {
  const rows = [
    detail({ ssid: 'Home', bssid: 'aa:bb:cc:00:00:01', channel: 6, signalDbm: -50 }),
    detail({ ssid: 'Home', bssid: 'aa:bb:cc:00:00:02', channel: 44, signalDbm: -70 }),
    detail({ ssid: 'Guest', bssid: 'aa:bb:cc:00:00:03', channel: 44, signalDbm: -55 }),
  ]

  it('matches on BSSID first', () => {
    expect(matchConnectedIndex(rows, { ssid: null, bssid: 'AA:BB:CC:00:00:02', channel: null, rssi: null })).toBe(1)
  })

  it('falls back to SSID, disambiguated by channel', () => {
    expect(matchConnectedIndex(rows, { ssid: 'Home', bssid: null, channel: 44, rssi: -70 })).toBe(1)
  })

  it('falls back to the closest RSSI on the operating channel when both are withheld', () => {
    expect(matchConnectedIndex(rows, { ssid: null, bssid: null, channel: 44, rssi: -56 })).toBe(2)
  })

  it('reports no match rather than guessing when nothing lines up', () => {
    expect(matchConnectedIndex(rows, { ssid: null, bssid: null, channel: 100, rssi: -50 })).toBe(-1)
  })
})

describe('buildDarwinSnapshot', () => {
  const now = 1_700_000_000_000

  it('maps CoreWLAN records into full network details', () => {
    const scan = coreScan({
      networks: [
        rawNetwork({
          ssid: 'Krishna',
          bssid: '78:20:51:D6:38:5F',
          rssi: -52,
          noise: -92,
          channel: 8,
          bandCode: 1,
          widthCode: 2,
          beaconInterval: 100,
          securityCodes: [3, 4, 5, 13],
          phyCodes: [2, 3, 4],
        }),
      ],
      current: null,
    })
    const snapshot = buildDarwinSnapshot(scan, null, now, {})
    expect(snapshot.networks).toHaveLength(1)
    expect(snapshot.networks[0]).toMatchObject({
      ssid: 'Krishna',
      isHidden: false,
      bssid: '78:20:51:d6:38:5f',
      channel: 8,
      band: '2.4 GHz',
      channelWidthMhz: 40,
      frequency: 2447,
      // WPA2 wins over the WPA3-transition flag CoreWLAN also reports.
      securityLabel: 'WPA2 Personal',
      securityShort: 'WPA2',
      securityLevel: 'secured',
      beaconIntervalMs: 100,
      networkType: 'infrastructure',
      phyModes: ['802.11b', '802.11g', '802.11n'],
      signalDbm: -52,
      noiseDbm: -92,
      snrDbm: 40,
    })
    expect(snapshot.bssidHidden).toBe(false)
    expect(snapshot.locationAccess).toBe('granted')
  })

  it('reports names but flags withheld BSSIDs as a location problem', () => {
    const scan = coreScan({
      networks: [
        rawNetwork({ ssid: 'Krishna', channel: 8, bandCode: 1, rssi: -52, securityCodes: [4] }),
        rawNetwork({ ssid: 'Hacx_5G', channel: 44, bandCode: 2, rssi: -73, securityCodes: [4] }),
      ],
    })
    const snapshot = buildDarwinSnapshot(scan, null, now, {})
    expect(snapshot.networks.map((n) => n.ssid)).toEqual(['Krishna', 'Hacx_5G'])
    expect(snapshot.networks.every((n) => n.ssid !== null)).toBe(true)
    expect(snapshot.bssidHidden).toBe(true)
    expect(snapshot.locationAccess).toBe('not-determined')
  })

  it('flags the joined network by channel when the interface withholds its SSID', () => {
    const scan = coreScan({
      networks: [
        rawNetwork({ ssid: 'Hacx_5G_EXT', channel: 44, bandCode: 2, rssi: -63, securityCodes: [4] }),
        rawNetwork({ ssid: 'Hacx_5G', channel: 44, bandCode: 2, rssi: -85, securityCodes: [4] }),
      ],
      current: {
        ssid: null,
        bssid: null,
        rssi: -64,
        noise: -91,
        txRate: 325,
        securityCode: 4,
        phyCode: 5,
        countryCode: null,
        channel: 44,
        bandCode: 2,
        widthCode: 3,
        mode: 1,
      },
    })
    const snapshot = buildDarwinSnapshot(scan, null, now, {})
    const connected = snapshot.networks.find((n) => n.isConnected)
    expect(connected?.ssid).toBe('Hacx_5G_EXT')
    expect(connected?.txRateMbps).toBe(325)
    expect(connected?.noiseDbm).toBe(-91)
  })

  it('applies the regulatory country to networks whose beacon did not carry one', () => {
    const scan = coreScan({ networks: [rawNetwork({ ssid: 'A', channel: 1, bandCode: 1, rssi: -50 })] })
    const profiler = {
      current: {
        ssid: '<redacted>',
        channel: 44,
        band: '5 GHz',
        channelWidthMhz: 80,
        phyModes: [],
        networkType: 'infrastructure' as const,
        security: 'WPA2 Personal',
        signalDbm: -70,
        noiseDbm: -91,
        countryCode: 'IN',
      },
      nearby: [],
    }
    const snapshot = buildDarwinSnapshot(scan, profiler, now, {})
    expect(snapshot.countryCode).toBe('IN')
    expect(snapshot.networks[0].countryCode).toBe('IN')
  })

  it('marks a hidden AP as hidden rather than redacted', () => {
    const scan = coreScan({ networks: [rawNetwork({ ssid: null, channel: 11, bandCode: 1, rssi: -60, securityCodes: [4] })] })
    const snapshot = buildDarwinSnapshot(scan, null, now, {})
    expect(snapshot.networks[0]).toMatchObject({ ssid: null, isHidden: true, ssidRedacted: false })
  })

  // Two APs on one channel with near-identical RSSI can't be told apart by
  // signal, and CoreWLAN won't name the joined one until Location is granted —
  // but the driver's own record will.
  it('uses the driver record to identify the joined AP and show its BSSID', () => {
    const scan = coreScan({
      networks: [
        rawNetwork({ ssid: 'Hacx_5G_EXT', channel: 44, bandCode: 2, rssi: -67, securityCodes: [4] }),
        rawNetwork({ ssid: 'Hacx_5G', channel: 44, bandCode: 2, rssi: -68, securityCodes: [4] }),
      ],
      current: {
        ssid: null, bssid: null, rssi: -68, noise: -92, txRate: 292, securityCode: 4,
        phyCode: 5, countryCode: null, channel: 44, bandCode: 2, widthCode: 3, mode: 1,
      },
    })
    const joined = {
      ssid: 'Hacx_5G_EXT',
      bssid: '78:20:51:d6:38:5f',
      channel: 44,
      rssi: -67,
      noise: null,
      beaconIntervalMs: 100,
      countryCode: 'IN',
    }
    const snapshot = buildDarwinSnapshot(scan, null, now, {}, joined)
    const connected = snapshot.networks.find((n) => n.isConnected)
    expect(connected?.ssid).toBe('Hacx_5G_EXT')
    expect(connected?.bssid).toBe('78:20:51:d6:38:5f')
    expect(snapshot.connectedBssid).toBe('78:20:51:d6:38:5f')
    expect(snapshot.countryCode).toBe('IN')
  })

  it('still flags the location banner when only the joined AP has an address', () => {
    const scan = coreScan({
      networks: [
        rawNetwork({ ssid: 'Home', channel: 6, bandCode: 1, rssi: -50, securityCodes: [4] }),
        rawNetwork({ ssid: 'Neighbour', channel: 11, bandCode: 1, rssi: -80, securityCodes: [4] }),
      ],
      current: {
        ssid: null, bssid: null, rssi: -50, noise: null, txRate: null, securityCode: 4,
        phyCode: 4, countryCode: null, channel: 6, bandCode: 1, widthCode: 1, mode: 1,
      },
    })
    const joined = { ssid: 'Home', bssid: 'aa:bb:cc:00:11:22', channel: 6, rssi: -50, noise: null, beaconIntervalMs: 100, countryCode: null }
    const snapshot = buildDarwinSnapshot(scan, null, now, {}, joined)
    expect(snapshot.networks.find((n) => n.isConnected)?.bssid).toBe('aa:bb:cc:00:11:22')
    // The neighbours are still nameless at the radio level, so the prompt is
    // still worth showing.
    expect(snapshot.bssidHidden).toBe(true)
  })
})
