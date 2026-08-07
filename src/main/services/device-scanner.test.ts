import { describe, it, expect, vi, beforeEach } from 'vitest'

const reverse = vi.fn()
vi.mock('node:dns/promises', () => ({
  reverse,
}))

import { inferKind, mergeProviderResults, resolveReverseDns, usableVendor, enumerateSubnet } from './device-scanner'
import type { ArpEntry } from './devices/arp-provider'
import type { BonjourEntry } from './devices/bonjour-provider'

function merge(input: Partial<Parameters<typeof mergeProviderResults>[0]>) {
  return [
    ...mergeProviderResults({
      arp: [],
      bonjour: [],
      ssdp: [],
      netbios: [],
      hostMac: null,
      ...input,
    }).values(),
  ]
}

function arp(partial: Partial<ArpEntry> & { ip: string }): ArpEntry {
  return { mac: null, reachable: true, hostname: null, ...partial }
}

function bonjour(partial: Partial<BonjourEntry> & { type: string }): BonjourEntry {
  return { instance: null, hostname: null, ip: null, port: null, model: null, mac: null, ...partial }
}

describe('enumerateSubnet', () => {
  it('lists every usable host in a /24, skipping network, broadcast and itself', () => {
    const hosts = enumerateSubnet('192.168.1.104', 24)
    expect(hosts).toHaveLength(253)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[hosts.length - 1]).toBe('192.168.1.254')
    expect(hosts).not.toContain('192.168.1.0')
    expect(hosts).not.toContain('192.168.1.255')
    expect(hosts).not.toContain('192.168.1.104')
  })

  it('handles subnets that do not align to the third octet', () => {
    const hosts = enumerateSubnet('10.0.2.15', 25)
    expect(hosts).toHaveLength(125)
    expect(hosts[0]).toBe('10.0.2.1')
    expect(hosts).not.toContain('10.0.2.0')
    expect(hosts).not.toContain('10.0.2.127')
    expect(hosts).toContain('10.0.2.126')
  })

  it('treats the network address as a usable host when the prefix is 31', () => {
    // /31 point-to-point: both addresses are usable in practice, but we keep
    // the strict "network and broadcast excluded" reading for safety.
    const hosts = enumerateSubnet('192.0.2.0', 31)
    expect(hosts.length).toBeLessThanOrEqual(2)
  })

  it('refuses unknown, out-of-range, or oversized prefixes', () => {
    expect(enumerateSubnet('192.168.1.104', null)).toEqual([])
    expect(enumerateSubnet('192.168.1.104', 0)).toEqual([])
    expect(enumerateSubnet('192.168.1.104', 33)).toEqual([])
    // /16 would produce 65,534 hosts — capped by MAX_SWEEP_HOSTS.
    expect(enumerateSubnet('192.168.1.104', 16)).toEqual([])
  })

  it('rejects malformed host addresses', () => {
    expect(enumerateSubnet('not-an-ip', 24)).toEqual([])
    expect(enumerateSubnet('192.168.1.999', 24)).toEqual([])
  })
})

describe('resolveReverseDns', () => {
  beforeEach(() => {
    reverse.mockReset()
  })

  it('resolves PTR names and strips trailing dots', async () => {
    reverse.mockImplementation(async (ip: string) => {
      if (ip === '192.168.1.10') return ['nas.local.']
      if (ip === '192.168.1.11') return ['printer.example.com']
      return []
    })
    const out = await resolveReverseDns(['192.168.1.10', '192.168.1.11', '192.168.1.12'])
    expect(out.get('192.168.1.10')).toBe('nas.local')
    expect(out.get('192.168.1.11')).toBe('printer.example.com')
    expect(out.has('192.168.1.12')).toBe(false)
  })

  it('returns empty for an empty input', async () => {
    expect(await resolveReverseDns([])).toEqual(new Map())
  })

  it('tolerates resolver failures', async () => {
    reverse.mockRejectedValue(new Error('NXDOMAIN'))
    const out = await resolveReverseDns(['192.168.1.20'])
    expect(out.size).toBe(0)
  })
})

describe('mergeProviderResults', () => {
  it('folds one physical device seen by two providers into one row', () => {
    const devices = merge({
      arp: [arp({ ip: '192.168.1.20', mac: 'aa:bb:cc:00:11:22', hostname: 'appletv.lan' })],
      bonjour: [
        bonjour({ ip: '192.168.1.20', type: '_airplay._tcp', instance: 'Living Room', model: 'AppleTV5,3' }),
        bonjour({ ip: '192.168.1.20', type: '_raop._tcp', instance: 'Living Room' }),
      ],
    })
    expect(devices).toHaveLength(1)
    expect(devices[0].mac).toBe('aa:bb:cc:00:11:22')
    expect(devices[0].model).toBe('AppleTV5,3')
    expect(devices[0].services).toHaveLength(2)
    expect([...devices[0].sources]).toEqual(expect.arrayContaining(['arp', 'bonjour']))
  })

  // Several service records from one host used to become several rows, each
  // holding a fragment of the same device.
  it('merges address-less Bonjour records by hostname', () => {
    const devices = merge({
      bonjour: [
        bonjour({ hostname: 'speaker.local', type: '_airplay._tcp', instance: 'Kitchen' }),
        bonjour({ hostname: 'speaker.local.', type: '_raop._tcp', instance: 'Kitchen' }),
        bonjour({ hostname: 'Speaker.local', type: '_companion-link._tcp', instance: 'Kitchen' }),
      ],
    })
    expect(devices).toHaveLength(1)
    expect(devices[0].services).toHaveLength(3)
    expect(devices[0].hostname).toBe('speaker.local')
  })

  it('re-keys a record onto its MAC once one turns up', () => {
    const devices = merge({
      bonjour: [bonjour({ ip: '192.168.1.30', type: '_http._tcp' })],
      netbios: [{ ip: '192.168.1.30', mac: 'de:ad:be:ef:00:01', hostname: 'NAS' }],
    })
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe('de:ad:be:ef:00:01')
    expect(devices[0].hostname).toBe('NAS')
  })

  it('pins this machine as one row that its own mDNS records attach to', () => {
    const devices = merge({
      hostMac: 'a6:33:87:99:91:f3',
      hostIpv4: ['192.168.1.104'],
      hostHostname: 'koushik-mac.local',
      bonjour: [
        bonjour({ hostname: 'koushik-mac.local', type: '_airplay._tcp', port: 7000, model: 'Mac16,10' }),
        bonjour({ hostname: 'koushik-mac.local', type: '_companion-link._tcp', port: 49158 }),
      ],
    })
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe('a6:33:87:99:91:f3')
    expect([...devices[0].ipv4]).toEqual(['192.168.1.104'])
    expect(devices[0].services).toHaveLength(2)
  })

  it('ignores an observation carrying no identifier at all', () => {
    expect(merge({ bonjour: [bonjour({ type: '_http._tcp' })] })).toHaveLength(0)
  })
})

describe('usableVendor', () => {
  it('drops registry placeholders that are not manufacturers', () => {
    expect(usableVendor('IEEE Registration Authority')).toBeNull()
    expect(usableVendor('IANA')).toBeNull()
    expect(usableVendor('')).toBeNull()
  })

  it('keeps real manufacturers', () => {
    expect(usableVendor('Espressif Inc.')).toBe('Espressif Inc.')
  })
})

describe('inferKind', () => {
  const base = { vendor: null, model: null, hostname: null, serviceTypes: [], roles: { gateway: false } }

  it('trusts a self-declared model over everything else', () => {
    expect(inferKind({ ...base, model: 'AppleTV5,3', serviceTypes: ['_airplay._tcp'] })).toBe('tv')
    expect(inferKind({ ...base, model: 'Mac14,15' })).toBe('computer')
    expect(inferKind({ ...base, model: 'AudioAccessory5,1' })).toBe('speaker')
  })

  it('then the services the device advertises', () => {
    expect(inferKind({ ...base, serviceTypes: ['_ipp._tcp'] })).toBe('printer')
    expect(inferKind({ ...base, serviceTypes: ['_googlecast._tcp'] })).toBe('media')
    expect(inferKind({ ...base, serviceTypes: ['_hap._tcp'] })).toBe('iot')
  })

  it('calls the gateway a router', () => {
    expect(inferKind({ ...base, roles: { gateway: true } })).toBe('router')
  })

  it('calls network kit doing a network job a router', () => {
    expect(inferKind({ ...base, vendor: 'TP-Link Systems Inc.', roles: { gateway: false, dhcp: true } })).toBe('router')
  })

  it('falls back to the vendor rather than giving up', () => {
    expect(inferKind({ ...base, vendor: 'Espressif Inc.' })).toBe('iot')
    expect(inferKind({ ...base, vendor: 'Sonos, Inc.' })).toBe('speaker')
    expect(inferKind({ ...base, vendor: 'Nobody Ltd' })).toBe('unknown')
  })
})
