import { describe, it, expect } from 'vitest'
import { deviceDisplayName, deviceIdentityLine, isPrivateMac, normalizeMac, serviceNames } from './devices'

const KIND_LABELS = { router: 'Router', speaker: 'Speaker', printer: 'Printer', unknown: 'Unknown' }

describe('serviceNames', () => {
  it('translates DNS-SD types into plain English', () => {
    expect(serviceNames(['_airplay._tcp', '_ipp._tcp', '_ssh._tcp'])).toEqual(['AirPlay', 'Printing', 'SSH'])
  })

  it('de-dupes types that mean the same thing', () => {
    expect(serviceNames(['_ipp._tcp', '_ipps._tcp', '_printer._tcp'])).toEqual(['Printing'])
  })

  it('drops types not worth showing', () => {
    expect(serviceNames(['_device-info._tcp', '_workstation._tcp', '_sleep-proxy._udp'])).toEqual([])
  })

  it('falls back to a readable form of an unknown type', () => {
    expect(serviceNames(['_weirdthing._tcp'])).toEqual(['weirdthing'])
  })
})

describe('deviceIdentityLine', () => {
  it('composes vendor · kind · services', () => {
    expect(
      deviceIdentityLine({ vendor: 'Apple', kind: 'speaker', serviceTypes: ['_airplay._tcp'] }, KIND_LABELS),
    ).toBe('Apple · Speaker · AirPlay')
  })

  it('says "Private address" when the MAC is randomised and there is no vendor', () => {
    expect(deviceIdentityLine({ vendor: null, kind: 'unknown', serviceTypes: [], mac: '02:11:22:33:44:55' }, KIND_LABELS)).toBe(
      'Private address',
    )
  })

  it('omits the kind when it is unknown', () => {
    expect(deviceIdentityLine({ vendor: 'Netgear', kind: 'unknown', serviceTypes: ['_http._tcp'] }, KIND_LABELS)).toBe(
      'Netgear · Web service',
    )
  })

  it('returns null when there is genuinely nothing to say', () => {
    expect(deviceIdentityLine({ vendor: null, kind: 'unknown', serviceTypes: [], mac: 'a4:83:e7:11:22:33' }, KIND_LABELS)).toBeNull()
  })
})

describe('deviceDisplayName', () => {
  const base = { vendor: 'Netgear', kind: 'router', serviceTypes: ['_http._tcp'], ipv4: ['192.168.1.1'] }

  it('prefers a name the user gave the device', () => {
    expect(deviceDisplayName({ ...base, tagName: 'Front room router', hostname: 'rt-ax58u' }, KIND_LABELS)).toBe(
      'Front room router',
    )
  })

  it('then the hostname the device reports', () => {
    expect(deviceDisplayName({ ...base, hostname: 'rt-ax58u' }, KIND_LABELS)).toBe('rt-ax58u')
  })

  // The whole point: an unnamed device leads with something recognisable
  // instead of a bare address or the word "Unknown".
  it('then the plain-English identity', () => {
    expect(deviceDisplayName(base, KIND_LABELS)).toBe('Netgear · Router · Web service')
  })

  it('then the model, then the address', () => {
    expect(deviceDisplayName({ vendor: null, kind: 'unknown', serviceTypes: [], model: 'AppleTV5,3' }, KIND_LABELS)).toBe(
      'AppleTV5,3',
    )
    expect(deviceDisplayName({ vendor: null, kind: 'unknown', serviceTypes: [], ipv4: ['192.168.1.44'] }, KIND_LABELS)).toBe(
      '192.168.1.44',
    )
  })

  it('falls back only when there is nothing at all', () => {
    expect(deviceDisplayName({ vendor: null, kind: 'unknown', serviceTypes: [] }, KIND_LABELS, 'Unknown device')).toBe(
      'Unknown device',
    )
  })
})

describe('mac helpers', () => {
  it('normalises any MAC shape', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac('aabbccddeeff')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac('nope')).toBeNull()
  })

  it('detects locally administered addresses', () => {
    expect(isPrivateMac('02:11:22:33:44:55')).toBe(true)
    expect(isPrivateMac('a4:83:e7:11:22:33')).toBe(false)
  })
})
