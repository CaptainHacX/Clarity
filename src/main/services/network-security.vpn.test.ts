import { describe, it, expect } from 'vitest'
import { isActiveVpnInterface, isPrivateIpv4 } from './network-security'
import type { NetworkInterfaceInfo } from '../../shared/types'

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
 * VPN detection used to match on interface *name* only, which reported
 * "VPN active" on every Mac: macOS keeps utun0..utun3 around for iCloud Private
 * Relay, Continuity and AirDrop whether or not a VPN exists. A tunnel that is
 * genuinely carrying traffic has a routable address inside it; a dormant one has
 * only an auto-assigned link-local IPv6.
 */
describe('isActiveVpnInterface', () => {
  it('rejects the idle utun interfaces macOS creates on every machine', () => {
    // Exactly what this Mac reports with no VPN connected: link-local only.
    const idle = [
      iface({ iface: 'utun0', ip6: 'fe80::9eb6:1def:2f19:d938' }),
      iface({ iface: 'utun1', ip6: 'fe80::8c03:9d44:778d:85bc' }),
      iface({ iface: 'utun2', ip6: 'fe80::d5df:a899:b1ef:346b' }),
      iface({ iface: 'utun3', ip6: 'fe80::ce81:b1c:bd2c:69e' }),
    ]
    for (const i of idle) expect(isActiveVpnInterface(i)).toBe(false)
    expect(idle.filter(isActiveVpnInterface)).toHaveLength(0)
  })

  it('rejects a tunnel with no address at all', () => {
    expect(isActiveVpnInterface(iface({ iface: 'utun4' }))).toBe(false)
  })

  it('rejects a tunnel that is up but unconfigured', () => {
    expect(isActiveVpnInterface(iface({ iface: 'tun0', ip4: '0.0.0.0' }))).toBe(false)
    expect(isActiveVpnInterface(iface({ iface: 'tun0', ip6: '::' }))).toBe(false)
  })

  it('accepts a tunnel carrying an IPv4 — a connected VPN', () => {
    expect(isActiveVpnInterface(iface({ iface: 'utun5', ip4: '10.8.0.6' }))).toBe(true)
    expect(isActiveVpnInterface(iface({ iface: 'wg0', ip4: '10.2.0.2' }))).toBe(true)
    expect(isActiveVpnInterface(iface({ iface: 'ppp0', ip4: '172.20.1.9' }))).toBe(true)
    expect(isActiveVpnInterface(iface({ iface: 'nordlynx', ip4: '10.5.0.2' }))).toBe(true)
  })

  it('accepts an IPv6-only tunnel when the address is not link-local', () => {
    expect(isActiveVpnInterface(iface({ iface: 'utun6', ip6: 'fd7a:115c:a1e0::1' }))).toBe(true)
  })

  it('rejects a tunnel the OS reports as down even if it kept an address', () => {
    expect(isActiveVpnInterface(iface({ iface: 'wg0', ip4: '10.2.0.2', operstate: 'down' }))).toBe(false)
  })

  it('ignores ordinary interfaces regardless of their addresses', () => {
    expect(isActiveVpnInterface(iface({ iface: 'en1', ip4: '192.168.1.105' }))).toBe(false)
    expect(isActiveVpnInterface(iface({ iface: 'lo0', ip4: '127.0.0.1' }))).toBe(false)
    expect(isActiveVpnInterface(iface({ iface: 'bridge0', ip4: '192.168.64.1' }))).toBe(false)
    // 'tap' must not swallow an unrelated name that merely starts with it.
    expect(isActiveVpnInterface(iface({ iface: 'en0', ip4: '10.0.0.5' }))).toBe(false)
  })
})

/**
 * The stat card called this address "Public IPv4" while showing a LAN address.
 * Clarity never asks an outside service what our internet-facing address is, so
 * the honest label is just "IPv4"; this predicate is what lets the distinction
 * be stated in code rather than assumed.
 */
describe('isPrivateIpv4', () => {
  it('recognises the RFC1918 ranges', () => {
    expect(isPrivateIpv4('192.168.1.105')).toBe(true)
    expect(isPrivateIpv4('10.0.0.5')).toBe(true)
    expect(isPrivateIpv4('172.16.0.1')).toBe(true)
    expect(isPrivateIpv4('172.31.255.254')).toBe(true)
  })

  it('excludes the 172 addresses outside the /12', () => {
    expect(isPrivateIpv4('172.15.0.1')).toBe(false)
    expect(isPrivateIpv4('172.32.0.1')).toBe(false)
  })

  it('recognises loopback, link-local and CGNAT', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true)
    expect(isPrivateIpv4('169.254.1.1')).toBe(true)
    expect(isPrivateIpv4('100.64.0.1')).toBe(true)
    expect(isPrivateIpv4('100.127.255.255')).toBe(true)
    expect(isPrivateIpv4('100.128.0.1')).toBe(false)
  })

  it('treats routable addresses as public', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false)
    expect(isPrivateIpv4('93.184.216.34')).toBe(false)
    expect(isPrivateIpv4('1.1.1.1')).toBe(false)
  })

  it('handles nullish and malformed input without throwing', () => {
    expect(isPrivateIpv4(null)).toBe(false)
    expect(isPrivateIpv4(undefined)).toBe(false)
    expect(isPrivateIpv4('')).toBe(false)
    expect(isPrivateIpv4('not-an-ip')).toBe(false)
    expect(isPrivateIpv4('192.168.1')).toBe(false)
    expect(isPrivateIpv4('fe80::1')).toBe(false)
  })
})
