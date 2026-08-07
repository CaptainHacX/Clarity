import { describe, it, expect } from 'vitest'
import { bandFromChannel, securityLevelFromShort, signalBucket, wifiNetworkKey } from './wifi'

describe('wifiNetworkKey', () => {
  it('uses the BSSID when the platform gives one', () => {
    expect(wifiNetworkKey({ bssid: 'AA:BB:CC:00:11:22', ssid: 'Home', channel: 6 })).toBe('aa:bb:cc:00:11:22')
  })

  it('keys a named network by SSID, channel, band and security', () => {
    expect(wifiNetworkKey({ bssid: null, ssid: 'Home', channel: 6, band: '2.4 GHz', securityShort: 'WPA2' })).toBe(
      'ssid:Home|6|2.4 GHz|WPA2',
    )
  })

  it('gives every hidden AP a stable key rather than a fresh one per poll', () => {
    const a = wifiNetworkKey({ bssid: null, ssid: null, channel: 11, band: '2.4 GHz', securityShort: 'WPA2' })
    const b = wifiNetworkKey({ bssid: null, ssid: null, channel: 11, band: '2.4 GHz', securityShort: 'WPA2' })
    expect(a).toBe(b)
    expect(a).toBe('hidden|11|2.4 GHz|WPA2')
  })

  it('keeps two different hidden APs apart', () => {
    const ch1 = wifiNetworkKey({ bssid: null, ssid: null, channel: 1, band: '2.4 GHz', securityShort: 'WPA2' })
    const ch6 = wifiNetworkKey({ bssid: null, ssid: null, channel: 6, band: '2.4 GHz', securityShort: 'WPA2' })
    const open6 = wifiNetworkKey({ bssid: null, ssid: null, channel: 6, band: '2.4 GHz', securityShort: 'Open' })
    expect(new Set([ch1, ch6, open6]).size).toBe(3)
  })

  it('is stable when the band and security are unknown', () => {
    expect(wifiNetworkKey({ bssid: null, ssid: null, channel: null })).toBe('hidden|?|?|?')
  })
})

describe('signalBucket', () => {
  it('maps dBm to the four buckets', () => {
    expect(signalBucket(-40)).toBe('excellent')
    expect(signalBucket(-60)).toBe('good')
    expect(signalBucket(-72)).toBe('fair')
    expect(signalBucket(-88)).toBe('weak')
    expect(signalBucket(null)).toBe('unknown')
  })
})

describe('bandFromChannel', () => {
  it('reads 2.4 GHz channels', () => {
    expect(bandFromChannel(1)).toBe('2.4 GHz')
    expect(bandFromChannel(14)).toBe('2.4 GHz')
  })

  it('reads 5 GHz channels', () => {
    expect(bandFromChannel(36)).toBe('5 GHz')
    expect(bandFromChannel(165)).toBe('5 GHz')
  })

  it('returns null with nothing to go on', () => {
    expect(bandFromChannel(null)).toBeNull()
    expect(bandFromChannel(999)).toBeNull()
  })
})

describe('securityLevelFromShort', () => {
  it('grades encryption strength', () => {
    expect(securityLevelFromShort('WPA3')).toBe('secured')
    expect(securityLevelFromShort('WPA2')).toBe('secured')
    expect(securityLevelFromShort('WPA')).toBe('weak')
    expect(securityLevelFromShort('WEP')).toBe('weak')
    expect(securityLevelFromShort('Open')).toBe('open')
    expect(securityLevelFromShort(null)).toBe('unknown')
  })
})
