import { describe, it, expect } from 'vitest'
import { parseSsdpResponse } from './ssdp-provider'

function ssdpPayload(location: string | null, extra = ''): Buffer {
  const lines = [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    ...(location !== null ? [`LOCATION: ${location}`] : []),
    'SERVER: UPnP/1.0 DLNADOC/1.50',
    'USN: uuid:9f2b0e5e-c2c2-11ea-9c6c-0015c34e0000::upnp:rootdevice',
    extra,
    '',
    '',
  ]
  return Buffer.from(lines.join('\r\n'), 'latin1')
}

describe('ssdp-provider parseSsdpResponse', () => {
  it('extracts ip, location, server and usn from a valid response', () => {
    const entry = parseSsdpResponse(ssdpPayload('http://192.168.1.50:8080/rootDesc.xml'))
    expect(entry).toEqual({
      ip: '192.168.1.50',
      location: 'http://192.168.1.50:8080/rootDesc.xml',
      server: 'UPnP/1.0 DLNADOC/1.50',
      usn: 'uuid:9f2b0e5e-c2c2-11ea-9c6c-0015c34e0000::upnp:rootdevice',
    })
  })

  it('rejects non-200 replies', () => {
    expect(parseSsdpResponse(Buffer.from('HTTP/1.1 404 Not Found\r\n\r\n'))).toBeNull()
  })

  it('rejects responses without a parsable LOCATION', () => {
    expect(parseSsdpResponse(ssdpPayload(null))).toBeNull()
  })

  it('rejects LOCATION values that resolve to a hostname, not an IPv4', () => {
    expect(parseSsdpResponse(ssdpPayload('http://my-tv.local/root.xml'))).toBeNull()
  })
})
