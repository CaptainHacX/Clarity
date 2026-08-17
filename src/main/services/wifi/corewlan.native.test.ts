import { describe, it, expect } from 'vitest'
import { locationAccessFromAuthStatus, parseCoreWlanOutput } from './corewlan'

/**
 * macOS gates BSSID and country code behind a CoreLocation grant resolved
 * against the *requesting process's own bundle*. The scan therefore runs
 * in-process through the `clarity-corewlan` addon; the previous `osascript`
 * child was identified as `com.apple.osascript` with authorizationStatus 0, so
 * it could never see the grant the user gave the app.
 *
 * These cover the two pure pieces that decision rests on: the status mapping,
 * and that the addon's JSON is accepted by the same parser the JXA output used
 * (the addon is byte-compatible on purpose, so one validator serves both).
 */

describe('locationAccessFromAuthStatus', () => {
  it('treats both authorized variants as granted', () => {
    expect(locationAccessFromAuthStatus(3)).toBe('granted') // authorizedAlways
    expect(locationAccessFromAuthStatus(4)).toBe('granted') // authorizedWhenInUse
  })

  it('reports notDetermined so the prompt can still be offered', () => {
    expect(locationAccessFromAuthStatus(0)).toBe('not-determined')
  })

  it('reports restricted as denied — the user cannot grant it themselves', () => {
    // Parental controls / MDM. Offering the prompt would be a dead end.
    expect(locationAccessFromAuthStatus(1)).toBe('denied')
    expect(locationAccessFromAuthStatus(2)).toBe('denied')
  })

  it('falls back to unknown for a status it does not recognise', () => {
    expect(locationAccessFromAuthStatus(99)).toBe('unknown')
    expect(locationAccessFromAuthStatus(-1)).toBe('unknown')
  })
})

describe('parseCoreWlanOutput accepts the native addon payload', () => {
  // Captured from the compiled addon running inside Electron, trimmed to two
  // networks. This is the shape that finally carries real BSSIDs.
  const NATIVE_JSON = JSON.stringify({
    interfaceName: 'en1',
    powerOn: true,
    current: {
      ssid: 'Hacx_5G_EXT',
      bssid: '78:20:51:d6:38:5f',
      rssi: -71,
      noise: -85,
      txRate: 351,
      securityCode: 4,
      phyCode: 6,
      countryCode: 'IN',
      channel: 149,
      bandCode: 2,
      widthCode: 3,
      mode: 1,
    },
    active: false,
    networks: [
      {
        ssid: 'Krishna',
        bssid: '3c:84:6a:8a:60:a5',
        rssi: -60,
        noise: 0,
        channel: 8,
        bandCode: 1,
        widthCode: 1,
        countryCode: 'IN',
        beaconInterval: 100,
        ibss: false,
        securityCodes: [3, 4, 5],
        phyCodes: [3, 4],
      },
      {
        ssid: 'Sarvaiya',
        bssid: '04:95:e6:b8:05:21',
        rssi: -71,
        noise: null,
        channel: 1,
        bandCode: 1,
        widthCode: 1,
        countryCode: null,
        beaconInterval: 100,
        ibss: false,
        securityCodes: [4],
        phyCodes: [4],
      },
    ],
    error: null,
    ok: true,
  })

  const parsed = parseCoreWlanOutput(NATIVE_JSON)

  it('parses successfully', () => {
    expect(parsed.ok).toBe(true)
    expect(parsed.interfaceName).toBe('en1')
    expect(parsed.powerOn).toBe(true)
  })

  it('carries the BSSID and country code the osascript path could never return', () => {
    expect(parsed.current?.bssid).toBe('78:20:51:d6:38:5f')
    expect(parsed.current?.countryCode).toBe('IN')
    expect(parsed.networks.map((n) => n.bssid)).toEqual(['3c:84:6a:8a:60:a5', '04:95:e6:b8:05:21'])
  })

  it('still normalizes a 0 dBm noise reading to null', () => {
    // CoreWLAN reports 0 when the radio has no noise figure for an AP.
    expect(parsed.networks[0].noise).toBeNull()
    expect(parsed.current?.noise).toBe(-85)
  })

  it('keeps the security and PHY code lists', () => {
    expect(parsed.networks[0].securityCodes).toEqual([3, 4, 5])
    expect(parsed.networks[0].phyCodes).toEqual([3, 4])
  })

  it('rejects a malformed payload rather than inventing a scan', () => {
    expect(parseCoreWlanOutput('not json').ok).toBe(false)
    expect(parseCoreWlanOutput('not json').error).toBe('bad-json')
  })
})
