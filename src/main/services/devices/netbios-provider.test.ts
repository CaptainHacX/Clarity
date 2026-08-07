import { describe, it, expect } from 'vitest'
import {
  encodeNetbiosName,
  decodeNetbiosName,
  netbiosQueryPacket,
  parseNetbiosResponse,
  parseNetbiosRdata,
} from './netbios-provider'

describe('netbios-provider encoding', () => {
  it('round-trips a name through first-level encoding', () => {
    const enc = encodeNetbiosName('MYPC')
    expect(enc).toHaveLength(32)
    expect(decodeNetbiosName(enc)).toBe('MYPC')
  })

  it('pads short names with spaces', () => {
    expect(encodeNetbiosName('A')).toBe(encodeNetbiosName('A    '))
  })

  it('pads the wildcard name with NULs (RFC 1002)', () => {
    const enc = encodeNetbiosName('*')
    expect(enc).toHaveLength(32)
    expect(enc.slice(0, 2)).toBe('CK') // '*' -> hi nibble C, lo nibble K
    expect(enc.slice(2)).toBe('AA'.repeat(15)) // 15 NUL bytes encoded
  })
})

describe('netbios-provider query packet', () => {
  it('builds a well-formed wildcard query', () => {
    const packet = netbiosQueryPacket(0x1234)
    expect(packet).toHaveLength(50)
    expect(packet.readUInt16BE(0)).toBe(0x1234)
    // broadcast flag
    expect(packet.readUInt16BE(2) & 0x0010).toBe(0x0010)
    // QDCOUNT = 1
    expect(packet.readUInt16BE(4)).toBe(1)
    // encoded "*" with NUL padding
    expect(packet.subarray(13, 45).toString('latin1')).toBe('CK' + 'AA'.repeat(15))
    // question type NB
    expect(packet.readUInt16BE(46)).toBe(0x20)
  })
})

function buildNbstatRdata(name: string, suffix: number, mac: string): Buffer {
  const padded = name.padEnd(15, ' ').slice(0, 15)
  const macBytes = mac.split(':').map((b) => parseInt(b, 16))
  return Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(padded, 'latin1'),
    Buffer.from([suffix]),
    Buffer.from([0x00, 0x04]), // flags
    Buffer.from(macBytes),
  ])
}

describe('netbios-provider response parsing', () => {
  it('parses an NBSTAT rdata with name, suffix and adapter MAC', () => {
    const rdata = buildNbstatRdata('SERVER1', 0x20, 'aa:bb:cc:dd:ee:ff')
    const parsed = parseNetbiosRdata(rdata)
    expect(parsed?.hostname).toBe('SERVER1')
    expect(parsed?.mac).toBe('aa:bb:cc:dd:ee:ff')
    expect(parsed?.names[0]).toMatchObject({ name: 'SERVER1', type: 0x20, flags: 0x0004 })
  })

  it('picks the 0x20 (server) name over other entries', () => {
    const second = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from('WORKGROUP'.padEnd(15, ' '), 'latin1'),
      Buffer.from([0x00]),
      Buffer.from([0x00, 0x04]),
      Buffer.from('SERVER'.padEnd(15, ' '), 'latin1'),
      Buffer.from([0x20]),
      Buffer.from([0x00, 0x04]),
      Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
    ])
    const parsed = parseNetbiosRdata(second)
    expect(parsed?.hostname).toBe('SERVER')
    expect(parsed?.names).toHaveLength(2)
    expect(parsed?.mac).toBe('11:22:33:44:55:66')
  })

  it('extracts the MAC from the leading statistics bytes', () => {
    const rdata = Buffer.concat([
      buildNbstatRdata('NAS', 0x20, '11:22:33:44:55:66'),
      Buffer.alloc(44, 0x00), // full 50-byte statistics block
    ])
    const parsed = parseNetbiosRdata(rdata)
    expect(parsed?.mac).toBe('11:22:33:44:55:66')
  })

  it('accepts a full datagram wrapping the NBSTAT answer', () => {
    const rdata = buildNbstatRdata('NAS', 0x20, '11:22:33:44:55:66')
    const header = Buffer.alloc(12)
    header.writeUInt16BE(0xbeef, 0) // transaction id
    header.writeUInt16BE(0x8400, 2) // response
    header.writeUInt16BE(1, 6)      // ANCOUNT
    const answer = Buffer.concat([
      Buffer.from([0xc0, 0x0c]),    // name pointer
      Buffer.from([0x00, 0x21]),    // type NBSTAT
      Buffer.from([0x00, 0x01]),    // class IN
      Buffer.from([0x00, 0x00, 0x00, 0x78]), // ttl
      Buffer.from([0x00, rdata.length]),
      rdata,
    ])
    const parsed = parseNetbiosResponse(Buffer.concat([header, answer]), 0xbeef)
    expect(parsed?.hostname).toBe('NAS')
    expect(parsed?.mac).toBe('11:22:33:44:55:66')
  })

  it('rejects datagrams with the wrong transaction id', () => {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(0x0001, 0)
    expect(parseNetbiosResponse(header, 0xbeef)).toBeNull()
  })

  it('ignores non-NBSTAT answer types', () => {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(0xbeef, 0)
    header.writeUInt16BE(0x8400, 2)
    header.writeUInt16BE(1, 6)
    const answer = Buffer.concat([
      Buffer.from([0xc0, 0x0c]),
      Buffer.from([0x00, 0x20]), // type NB (plain address answer)
      Buffer.from([0x00, 0x01]),
      Buffer.from([0x00, 0x00, 0x00, 0x78]),
      Buffer.from([0x00, 0x06]),
      Buffer.from([0x00, 0x04, 0xc0, 0xa8, 0x01, 0x01]),
    ])
    const parsed = parseNetbiosResponse(Buffer.concat([header, answer]), 0xbeef)
    expect(parsed).toBeNull()
  })
})
