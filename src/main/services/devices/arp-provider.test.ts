import { describe, it, expect } from 'vitest'
import { canonicalMac, isGroupAddress, parseArpOutput, parseNdpOutput, parseProcNetArp } from './arp-provider'

const DARWIN_SAMPLE = `? (192.168.1.1) at a4:83:e7:11:22:33 on en0 ifscope [ethernet]
? (192.168.1.5) at (incomplete) on en0 ifscope [ethernet]
? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]
? (0.0.0.0) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]
? (192.168.1.10) at 00:1a:2b:3c:4d:5e on en1 ifscope [ethernet]
`

describe('arp-provider parseArpOutput', () => {
  it('parses resolved and incomplete macOS entries', () => {
    const entries = parseArpOutput(DARWIN_SAMPLE)
    expect(entries).toHaveLength(5)
    const r = entries.find((e) => e.ip === '192.168.1.1')
    expect(r).toMatchObject({ ip: '192.168.1.1', mac: 'a4:83:e7:11:22:33', reachable: true })
    const inc = entries.find((e) => e.ip === '192.168.1.5')
    expect(inc).toMatchObject({ ip: '192.168.1.5', mac: null, reachable: false })
  })

  it('parses Windows-style rows with dashed MACs', () => {
    const entries = parseArpOutput(`  192.168.1.7           A4-83-E7-AA-BB-CC     dynamic\n`)
    expect(entries[0]).toMatchObject({ ip: '192.168.1.7', mac: 'a4:83:e7:aa:bb:cc' })
  })

  // The old pattern demanded `?` in the name slot, so every device the resolver
  // could name — routers above all — vanished from the device list.
  it('keeps rows whose address the resolver named, and captures the name', () => {
    const named = `dpn-1442g.bwrouter (192.168.1.1) at 4c:ea:41:a8:62:e0 on en1 ifscope [ethernet]
re200.bwrouter (192.168.1.35) at 78:20:51:d6:38:5e on en1 ifscope [ethernet]
? (192.168.1.100) at 98:3d:ae:53:3f:10 on en1 ifscope [ethernet]
`
    const entries = parseArpOutput(named)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ ip: '192.168.1.1', mac: '4c:ea:41:a8:62:e0', hostname: 'dpn-1442g.bwrouter' })
    expect(entries[2].hostname).toBeNull()
  })

  it('pads the unpadded octets BSD prints', () => {
    const entries = parseArpOutput('mdns.mcast.net (224.0.0.251) at 1:0:5e:0:0:fb on en1 ifscope permanent [ethernet]\n')
    expect(entries[0].mac).toBe('01:00:5e:00:00:fb')
  })
})

describe('canonicalMac', () => {
  it('pads and lowercases any separator style', () => {
    expect(canonicalMac('1:0:5E:0:0:FB')).toBe('01:00:5e:00:00:fb')
    expect(canonicalMac('A4-83-E7-AA-BB-CC')).toBe('a4:83:e7:aa:bb:cc')
  })

  it('rejects anything that is not six octets', () => {
    expect(canonicalMac('incomplete')).toBeNull()
    expect(canonicalMac('a4:83:e7')).toBeNull()
  })
})

describe('isGroupAddress', () => {
  it('rejects the multicast groups that always sit in the ARP cache', () => {
    // Both used to render as anonymous devices nobody owns.
    expect(isGroupAddress('239.255.255.250', '01:00:5e:7f:ff:fa')).toBe(true)
    expect(isGroupAddress('224.0.0.251', '01:00:5e:00:00:fb')).toBe(true)
    expect(isGroupAddress('255.255.255.255', 'ff:ff:ff:ff:ff:ff')).toBe(true)
    expect(isGroupAddress('0.0.0.0', null)).toBe(true)
  })

  it('keeps real devices', () => {
    expect(isGroupAddress('192.168.1.1', '4c:ea:41:a8:62:e0')).toBe(false)
    expect(isGroupAddress('10.0.0.5', null)).toBe(false)
  })
})

describe('parseNdpOutput', () => {
  it('reads routable IPv6 neighbours and drops link-local noise', () => {
    const text = `Neighbor                    Linklayer Address  Netif Expire    St Flgs Prbs
2001:db8::1%en1             4c:ea:41:a8:62:e0    en1 23h59m56s S
fe80::1%en1                 4c:ea:41:a8:62:e0    en1 19h37m14s S  R
fe80::1%lo0                 (incomplete)         lo0 permanent R
`
    expect(parseNdpOutput(text)).toEqual([{ ip6: '2001:db8::1', mac: '4c:ea:41:a8:62:e0' }])
  })

  it('reads the Linux form too', () => {
    expect(parseNdpOutput('2001:db8::9 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE')).toEqual([
      { ip6: '2001:db8::9', mac: 'aa:bb:cc:dd:ee:ff' },
    ])
  })
})

describe('arp-provider parseProcNetArp', () => {
  it('parses reachable and stale Linux entries', () => {
    const text = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         a4:83:e7:11:22:33     *        enp0s3
192.168.1.9      0x1         0x4         00:1a:2b:3c:4d:5e     *        enp0s3
192.168.1.8      0x1         0x0         00:00:00:00:00:00     *        enp0s3`
    const entries = parseProcNetArp(text)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ ip: '192.168.1.1', mac: 'a4:83:e7:11:22:33', reachable: true })
    expect(entries[1]).toMatchObject({ ip: '192.168.1.9', mac: '00:1a:2b:3c:4d:5e', reachable: false })
    expect(entries[2]).toMatchObject({ ip: '192.168.1.8', mac: null, reachable: false })
  })
})
