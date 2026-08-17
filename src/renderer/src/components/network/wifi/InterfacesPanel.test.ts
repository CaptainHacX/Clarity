import { describe, it, expect } from 'vitest'
import { hasIpv4 } from './InterfacesPanel'
import type { NetworkInterfaceInfo } from '@shared/types'

function iface(partial: Partial<NetworkInterfaceInfo>): NetworkInterfaceInfo {
  return {
    iface: 'en0',
    ifaceName: null,
    internal: false,
    virtual: false,
    ip4: null,
    ip6: null,
    mac: null,
    type: 'unknown',
    speed: null,
    operstate: null,
    ...partial,
  } as NetworkInterfaceInfo
}

/**
 * The interfaces table lists only interfaces holding an IPv4 address. macOS
 * reports ~20, and all but one or two have none — the table was mostly em
 * dashes with the useful row buried among them.
 */
describe('hasIpv4', () => {
  it('keeps an interface with a routable IPv4', () => {
    expect(hasIpv4(iface({ iface: 'en1', ip4: '192.168.1.105' }))).toBe(true)
  })

  it('keeps loopback — 127.0.0.1 is still an IPv4 address', () => {
    expect(hasIpv4(iface({ iface: 'lo0', ip4: '127.0.0.1', internal: true }))).toBe(true)
  })

  it('drops interfaces with no IPv4 at all', () => {
    expect(hasIpv4(iface({ iface: 'anpi0', ip4: null }))).toBe(false)
    expect(hasIpv4(iface({ iface: 'bridge0', ip4: '' }))).toBe(false)
    expect(hasIpv4(iface({ iface: 'en2', ip4: '   ' }))).toBe(false)
  })

  it('drops an IPv6-only interface', () => {
    // utun tunnels and awdl0 report a link-local IPv6 and nothing else.
    expect(hasIpv4(iface({ iface: 'utun0', ip6: 'fe80::9eb6:1def:2f19:d938' }))).toBe(false)
    expect(hasIpv4(iface({ iface: 'awdl0', ip6: 'fe80::8c55:51ff:feeb:34e6', mac: '8e:55:51:eb:34:e6' }))).toBe(false)
  })

  it('drops 0.0.0.0 — up but unconfigured is the same as having no address', () => {
    expect(hasIpv4(iface({ iface: 'en5', ip4: '0.0.0.0' }))).toBe(false)
  })

  it('filters a realistic macOS interface list down to the addressed ones', () => {
    const all = [
      iface({ iface: 'lo0', ip4: '127.0.0.1', ip6: '::1' }),
      iface({ iface: 'anpi0', mac: 'b2:b0:25:60:56:d4' }),
      iface({ iface: 'en0', mac: '1c:f6:4c:4e:0e:b6' }),
      iface({ iface: 'bridge0', mac: '36:e7:f6:28:b3:c0' }),
      iface({ iface: 'ap1', mac: '2a:80:80:1d:c2:92' }),
      iface({ iface: 'en1', ip4: '192.168.1.105', ip6: 'fe80::cc4:f428:ee03:5c90' }),
      iface({ iface: 'awdl0', ip6: 'fe80::8c55:51ff:feeb:34e6' }),
      iface({ iface: 'utun0', ip6: 'fe80::9eb6:1def:2f19:d938' }),
      iface({ iface: 'utun3', ip6: 'fe80::ce81:b1c:bd2c:69e' }),
    ]
    expect(all.filter(hasIpv4).map((i) => i.iface)).toEqual(['lo0', 'en1'])
  })
})
