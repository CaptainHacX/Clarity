import { describe, it, expect } from 'vitest'
import { parseBonjourBrowse, parseBonjourZ, parseAvahiBrowse, parseTxtValue } from './bonjour-provider'

describe('bonjour-provider parseBonjourBrowse', () => {
  it('reconstructs service types from the _services browse', () => {
    const out = `Browsing for _services._dns-sd._udp..local.
DATE: ---Wed 05 Aug 2026---
22:50:27.806  Add        3   1 .                    _tcp.local.          _airplay
22:50:27.806  Add        3   1 .                    _tcp.local.          _raop
22:50:27.806  Add        3   1 .                    _udp.local.          _asquic
22:50:27.932  Add        2  17 .                    _sub.local.          _I92CB7AA5AE311421`
    expect(parseBonjourBrowse(out).sort()).toEqual(['_airplay._tcp', '_asquic._udp', '_raop._tcp'])
  })
})

describe('bonjour-provider parseTxtValue', () => {
  it('reads hex-annotated TXT lines from dns-sd -L output', () => {
    const lines = ['    model=0x0d (AppleTV5,3)']
    expect(parseTxtValue(lines, 'model')).toBe('AppleTV5,3')
  })

  it('reads plain TXT key=value lines', () => {
    expect(parseTxtValue(['    host=my-mac.local.'], 'host')).toBe('my-mac.local.')
  })

  it('treats empty quoted values as absent', () => {
    expect(parseTxtValue(['    model=""'], 'model')).toBeNull()
  })
})

describe('bonjour-provider parseBonjourZ', () => {
  const DARWIN_Z = `Browsing for _airplay._tcp..local.
DATE: ---Wed 05 Aug 2026---

; To direct clients to browse a different domain, substitute that domain in place of '@'
lb._dns-sd._udp                                 PTR     @

_airplay._tcp                                   PTR     koushik-mac._airplay._tcp
koushik-mac._airplay._tcp                       SRV     0 0 7000 koushik-mac.local. ; Replace with unicast FQDN of target host
koushik-mac._airplay._tcp                       TXT     "deviceid=C2:E7:A2:52:24:A8" "model=Mac16,10" "srcvers=960.13.1"
`

  it('parses a dns-sd -Z zone transfer into an entry with model, MAC and SRV port', () => {
    const entries = parseBonjourZ(DARWIN_Z)
    expect(entries).toHaveLength(1)
    const e = entries[0]!
    expect(e).toMatchObject({
      instance: 'koushik-mac',
      type: '_airplay._tcp',
      hostname: 'koushik-mac.local',
      port: 7000,
      model: 'Mac16,10',
      mac: 'c2:e7:a2:52:24:a8',
    })
    expect(e.ip).toBeNull()
  })

  it('picks up an A record when the transfer includes one', () => {
    const withA = DARWIN_Z + '\nkoushik-mac.local.  120  IN  A  192.168.1.50\n'
    const entries = parseBonjourZ(withA)
    expect(entries[0]?.ip).toBe('192.168.1.50')
  })

  it('ignores comment and PTR-@ lines', () => {
    const noisy = `_homekit._tcp                             PTR     @
; a comment line
`
    expect(parseBonjourZ(noisy)).toHaveLength(0)
  })
})

describe('bonjour-provider parseAvahiBrowse', () => {
  const AVAHI = `=;eth0;IPv4;Koushik Apple TV;_airplay._tcp;local
hostname=[AppleTV.local]
address=[192.168.1.50]
port=[7000]
txt=["model=AppleTV5,3" "deviceid=AA:BB:CC:DD:EE:FF"]
`

  it('parses an avahi-browse -p service block', () => {
    const entries = parseAvahiBrowse(AVAHI)
    expect(entries).toHaveLength(1)
    const e = entries[0]!
    expect(e).toMatchObject({
      instance: 'Koushik Apple TV',
      type: '_airplay._tcp',
      hostname: 'AppleTV.local',
      ip: '192.168.1.50',
      port: 7000,
      model: 'AppleTV5,3',
      mac: 'aa:bb:cc:dd:ee:ff',
    })
  })
})
