import { describe, it, expect } from 'vitest'
import {
  bandLabelFromCode,
  frequencyFromChannel,
  parseCoreWlanOutput,
  phyModesFromCodes,
  securityFromCodes,
  widthFromCode,
} from './corewlan'

describe('securityFromCodes', () => {
  it('collapses the permissive supportsSecurity answers to the real suite', () => {
    // A plain WPA2 AP reports WPA/WPA2-mixed, WPA2, generic Personal and the
    // WPA3-transition flag all at once; system_profiler calls it WPA2.
    expect(securityFromCodes([3, 4, 5, 13])).toEqual({ label: 'WPA2 Personal', short: 'WPA2' })
  })

  it('prefers a real WPA3 claim over WPA2', () => {
    expect(securityFromCodes([4, 5, 11])).toEqual({ label: 'WPA3 Personal', short: 'WPA3' })
  })

  it('recognises open and WEP networks', () => {
    expect(securityFromCodes([0])).toEqual({ label: 'Open', short: 'Open' })
    expect(securityFromCodes([1])).toEqual({ label: 'WEP', short: 'WEP' })
  })

  it('recognises enterprise suites', () => {
    expect(securityFromCodes([9, 10])).toEqual({ label: 'WPA2 Enterprise', short: 'WPA2' })
  })

  it('returns nulls when the radio said nothing', () => {
    expect(securityFromCodes([])).toEqual({ label: null, short: null })
  })
})

describe('channel maths', () => {
  it('labels bands from CWChannelBand', () => {
    expect(bandLabelFromCode(1)).toBe('2.4 GHz')
    expect(bandLabelFromCode(2)).toBe('5 GHz')
    expect(bandLabelFromCode(3)).toBe('6 GHz')
    expect(bandLabelFromCode(0)).toBeNull()
    expect(bandLabelFromCode(null)).toBeNull()
  })

  it('maps CWChannelWidth to MHz', () => {
    expect(widthFromCode(1)).toBe(20)
    expect(widthFromCode(2)).toBe(40)
    expect(widthFromCode(3)).toBe(80)
    expect(widthFromCode(4)).toBe(160)
    expect(widthFromCode(0)).toBeNull()
  })

  it('derives centre frequencies from channel + band', () => {
    expect(frequencyFromChannel(1, 1)).toBe(2412)
    expect(frequencyFromChannel(11, 1)).toBe(2462)
    expect(frequencyFromChannel(14, 1)).toBe(2484)
    expect(frequencyFromChannel(44, 2)).toBe(5220)
    expect(frequencyFromChannel(149, 2)).toBe(5745)
    expect(frequencyFromChannel(37, 3)).toBe(6135)
    expect(frequencyFromChannel(null, 1)).toBeNull()
  })

  it('infers 2.4 GHz from a low channel when the band is unknown', () => {
    expect(frequencyFromChannel(6, null)).toBe(2437)
  })
})

describe('phyModesFromCodes', () => {
  it('names PHY modes and de-dupes', () => {
    expect(phyModesFromCodes([2, 3, 4, 4])).toEqual(['802.11b', '802.11g', '802.11n'])
    expect(phyModesFromCodes([5])).toEqual(['802.11ac'])
    expect(phyModesFromCodes([99])).toEqual([])
  })
})

describe('parseCoreWlanOutput', () => {
  it('coerces a real payload into the declared shape', () => {
    const payload = JSON.stringify({
      ok: true,
      interfaceName: 'en1',
      powerOn: true,
      active: true,
      current: { ssid: null, bssid: null, rssi: -68, noise: -91, txRate: 325, securityCode: 4, phyCode: 5, countryCode: null, channel: 44, bandCode: 2, widthCode: 3, mode: 1 },
      networks: [
        { ssid: 'Krishna', bssid: null, rssi: -52, noise: 0, channel: 8, bandCode: 1, widthCode: 2, countryCode: null, beaconInterval: 100, ibss: false, securityCodes: [3, 4], phyCodes: [2, 3, 4] },
      ],
      error: null,
    })
    const parsed = parseCoreWlanOutput(payload)
    expect(parsed.ok).toBe(true)
    expect(parsed.interfaceName).toBe('en1')
    expect(parsed.networks).toHaveLength(1)
    // 0 dBm is CoreWLAN's "no reading", not a real noise floor.
    expect(parsed.networks[0].noise).toBeNull()
    expect(parsed.networks[0].rssi).toBe(-52)
    expect(parsed.current?.txRate).toBe(325)
  })

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseCoreWlanOutput('not json').ok).toBe(false)
    expect(parseCoreWlanOutput('not json').error).toBe('bad-json')
    expect(parseCoreWlanOutput('null').ok).toBe(false)
  })

  it('drops entries that are not objects and caps the list', () => {
    const payload = JSON.stringify({ ok: true, networks: [null, 'x', { ssid: 'A' }] })
    const parsed = parseCoreWlanOutput(payload)
    expect(parsed.networks).toHaveLength(1)
    expect(parsed.networks[0].ssid).toBe('A')
  })

  it('normalises missing fields to null instead of undefined', () => {
    const parsed = parseCoreWlanOutput(JSON.stringify({ ok: true, networks: [{}] }))
    expect(parsed.networks[0]).toMatchObject({
      ssid: null,
      bssid: null,
      rssi: null,
      channel: null,
      ibss: false,
      securityCodes: [],
      phyCodes: [],
    })
  })
})
