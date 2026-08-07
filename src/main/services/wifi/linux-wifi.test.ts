import { describe, it, expect } from 'vitest'
import {
  dbmFromNmcliSignal,
  parseIwDevInterface,
  parseIwRegCountry,
  parseIwScan,
  parseNmcliWifiList,
  parseProcNetWireless,
  securityFromNmcli,
  splitNmcliFields,
} from './linux-wifi'

describe('splitNmcliFields', () => {
  it('honours the backslash escaping every BSSID relies on', () => {
    expect(splitNmcliFields(String.raw`yes:Krishna:78\:20\:51\:D6\:38\:5F:Infra:44`)).toEqual([
      'yes',
      'Krishna',
      '78:20:51:D6:38:5F',
      'Infra',
      '44',
    ])
  })

  it('keeps empty fields', () => {
    expect(splitNmcliFields('a::b')).toEqual(['a', '', 'b'])
  })

  it('unescapes a literal backslash', () => {
    expect(splitNmcliFields(String.raw`a\\b:c`)).toEqual(['a\\b', 'c'])
  })
})

describe('dbmFromNmcliSignal', () => {
  it('inverts NetworkManager quality back to dBm', () => {
    expect(dbmFromNmcliSignal(100)).toBe(-50)
    expect(dbmFromNmcliSignal(50)).toBe(-75)
    expect(dbmFromNmcliSignal(0)).toBe(-100)
  })

  it('clamps and tolerates nulls', () => {
    expect(dbmFromNmcliSignal(150)).toBe(-50)
    expect(dbmFromNmcliSignal(-10)).toBe(-100)
    expect(dbmFromNmcliSignal(null)).toBeNull()
  })
})

describe('securityFromNmcli', () => {
  it('reads the common suites', () => {
    expect(securityFromNmcli('WPA2')).toEqual({ label: 'WPA2 Personal', short: 'WPA2' })
    expect(securityFromNmcli('WPA1 WPA2')).toEqual({ label: 'WPA/WPA2 Personal', short: 'WPA2' })
    expect(securityFromNmcli('WPA2 WPA3')).toEqual({ label: 'WPA2/WPA3 Personal', short: 'WPA3' })
    expect(securityFromNmcli('WPA3')).toEqual({ label: 'WPA3 Personal', short: 'WPA3' })
    expect(securityFromNmcli('WEP')).toEqual({ label: 'WEP', short: 'WEP' })
  })

  it('marks enterprise networks', () => {
    expect(securityFromNmcli('WPA2 802.1X')).toEqual({ label: 'WPA2 Enterprise', short: 'WPA2' })
  })

  it('treats an empty security column as open', () => {
    expect(securityFromNmcli('')).toEqual({ label: 'Open', short: 'Open' })
    expect(securityFromNmcli(null)).toEqual({ label: 'Open', short: 'Open' })
  })
})

describe('parseNmcliWifiList', () => {
  const output = [
    String.raw`yes:Krishna:78\:20\:51\:D6\:38\:5F:Infra:44:5220 MHz:270 Mbit/s:82:WPA2`,
    String.raw`no:Hacx_5G:AA\:BB\:CC\:00\:11\:22:Infra:36:5180 MHz:540 Mbit/s:47:WPA1 WPA2`,
    String.raw`no:--:DD\:EE\:FF\:00\:11\:22:Infra:11:2462 MHz:130 Mbit/s:30:`,
    '',
  ].join('\n')

  it('maps every column', () => {
    const rows = parseNmcliWifiList(output)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      ssid: 'Krishna',
      bssid: '78:20:51:d6:38:5f',
      channel: 44,
      frequency: 5220,
      rateMbps: 270,
      signalPercent: 82,
      signalDbm: -59,
      securityShort: 'WPA2',
      mode: 'infrastructure',
      isConnected: true,
    })
  })

  it('treats `--` as no SSID (a hidden network) but keeps the row', () => {
    const rows = parseNmcliWifiList(output)
    expect(rows[2].ssid).toBeNull()
    expect(rows[2].bssid).toBe('dd:ee:ff:00:11:22')
    expect(rows[2].securityLabel).toBe('Open')
  })

  it('drops rows with neither a name nor an address', () => {
    expect(parseNmcliWifiList('no:--:--:Infra:1:2412 MHz:0 Mbit/s:0:')).toEqual([])
  })
})

describe('parseIwScan', () => {
  const output = `
BSS 78:20:51:d6:38:5f(on wlan0) -- associated
	TSF: 1234567890 usec
	freq: 5220
	beacon interval: 100 TUs
	signal: -52.00 dBm
	SSID: Krishna
	Country: IN	Environment: Indoor/Outdoor
	HT capabilities:
		Capabilities: 0x19ef
	HT operation:
		 * secondary channel offset: below
	VHT capabilities:
		VHT Capabilities (0x339b79b6):
	VHT operation:
		 * channel width: 1 (80 MHz)
BSS aa:bb:cc:00:11:22(on wlan0)
	freq: 2462
	signal: -71.00 dBm
	SSID: Hacx_2.4G
`
  it('reads RSSI, frequency, beacon interval and country', () => {
    const rows = parseIwScan(output)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      bssid: '78:20:51:d6:38:5f',
      ssid: 'Krishna',
      signalDbm: -52,
      frequency: 5220,
      countryCode: 'IN',
      channelWidthMhz: 80,
    })
    expect(rows[0].phyModes).toContain('802.11n')
    expect(rows[0].phyModes).toContain('802.11ac')
  })

  it('leaves fields the driver did not report as null', () => {
    const rows = parseIwScan(output)
    expect(rows[1].beaconIntervalMs).toBeNull()
    expect(rows[1].countryCode).toBeNull()
  })

  it('converts beacon TUs to milliseconds', () => {
    // 100 TU × 1024 µs = 102.4 ms, which every UI shows as 102.
    expect(parseIwScan(output)[0].beaconIntervalMs).toBe(102)
  })

  it('returns nothing for empty input', () => {
    expect(parseIwScan('')).toEqual([])
  })
})

describe('parseIwRegCountry', () => {
  it('reads the regulatory domain', () => {
    expect(parseIwRegCountry('global\ncountry IN: DFS-JP\n\t(2402 - 2482 @ 40)')).toBe('IN')
  })

  it('returns null when unset', () => {
    expect(parseIwRegCountry('country 00: DFS-UNSET')).toBeNull()
  })
})

describe('parseProcNetWireless', () => {
  const text = `Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   57.  -53.  -92.       0      0      0      0     33        0
`
  it('reads the connected link level and noise floor', () => {
    const map = parseProcNetWireless(text)
    expect(map.get('wlan0')).toEqual({ signalDbm: -53, noiseDbm: -92 })
  })

  it('ignores headers', () => {
    expect(parseProcNetWireless(text).size).toBe(1)
  })
})

describe('parseIwDevInterface', () => {
  it('picks the first wireless interface', () => {
    expect(parseIwDevInterface('phy#0\n\tInterface wlan0\n\t\tifindex 3')).toBe('wlan0')
  })

  it('returns null when there is no radio', () => {
    expect(parseIwDevInterface('')).toBeNull()
  })
})
