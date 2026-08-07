import { describe, it, expect } from 'vitest'
import { extractCachedScanRecordHex, parseAirportRecord } from './scutil-airport'

describe('extractCachedScanRecordHex', () => {
  const sample = `<dictionary> {
  CHANNEL : 44
  CachedScanRecord : <data> 0x62706c6973743030
  Power Status : TRUE
  SSID_STR :
}`

  it('pulls the archived record out of scutil output', () => {
    expect(extractCachedScanRecordHex(sample)).toBe('62706c6973743030')
  })

  it('returns null when the key is absent', () => {
    expect(extractCachedScanRecordHex('<dictionary> {\n  type : IEEE80211\n}')).toBeNull()
  })

  it('refuses an odd-length blob rather than corrupting it', () => {
    expect(extractCachedScanRecordHex('CachedScanRecord : <data> 0xabc')).toBeNull()
  })
})

describe('parseAirportRecord', () => {
  it('reads the identity macOS does not redact here', () => {
    const json = JSON.stringify({
      SSID_STR: 'Hacx_5G_EXT',
      BSSID: '78:20:51:D6:38:5F',
      CHANNEL: 44,
      RSSI: -67,
      NOISE: -92,
      BEACON_INT: 100,
      IE_KEY_80211D_COUNTRY_CODE: 'IN',
    })
    expect(parseAirportRecord(json)).toEqual({
      ssid: 'Hacx_5G_EXT',
      bssid: '78:20:51:d6:38:5f',
      channel: 44,
      rssi: -67,
      noise: -92,
      beaconIntervalMs: 100,
      countryCode: 'IN',
    })
  })

  it('treats the redaction placeholders as absent', () => {
    const json = JSON.stringify({ SSID_STR: '<redacted>', BSSID: '02:00:00:00:00:00', CHANNEL: 44 })
    expect(parseAirportRecord(json)).toMatchObject({ ssid: null, bssid: null, channel: 44 })
  })

  it('treats a zero noise reading as no reading', () => {
    expect(parseAirportRecord(JSON.stringify({ SSID_STR: 'A', NOISE: 0, CHANNEL: 1 }))?.noise).toBeNull()
  })

  it('returns null when the record carried nothing usable', () => {
    expect(parseAirportRecord(JSON.stringify({ SSID_STR: '', BSSID: '', CHANNEL: null }))).toBeNull()
    expect(parseAirportRecord(JSON.stringify({ error: 'unarchive-failed' }))).toBeNull()
    expect(parseAirportRecord('not json')).toBeNull()
  })
})
