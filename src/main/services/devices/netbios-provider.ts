import dgram from 'dgram'
import { isIpv4 } from '../../../shared/devices'

export interface NetbiosEntry {
  ip: string
  hostname: string | null
  mac: string | null
}

/** RFC 1001 "first-level encoding": each byte becomes two A–P nibble chars. */
export function encodeNetbiosName(name: string, length = 16): string {
  // The wildcard name pads with NULs, everything else with spaces.
  const padChar = name === '*' ? '\0' : ' '
  const padded = (name.padEnd(length, padChar)).slice(0, length)
  let out = ''
  for (let i = 0; i < padded.length; i++) {
    const b = padded.charCodeAt(i) & 0xff
    out += String.fromCharCode((b >> 4) + 0x41)
    out += String.fromCharCode((b & 0x0f) + 0x41)
  }
  return out
}

export function decodeNetbiosName(encoded: string): string {
  let out = ''
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const hi = encoded.charCodeAt(i) - 0x41
    const lo = encoded.charCodeAt(i + 1) - 0x41
    out += String.fromCharCode((hi << 4) | (lo & 0x0f))
  }
  return out.replace(/\s+$/g, '')
}

/** Name-service wildcard query packet (NB type 0x20), broadcast-flagged. */
export function netbiosQueryPacket(id: number): Buffer {
  const header = Buffer.from([0x00, 0x00, 0x00, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  header.writeUInt16BE(id & 0xffff, 0)
  const nameField = Buffer.concat([
    Buffer.from([0x20]),
    Buffer.from(encodeNetbiosName('*'), 'latin1'),
    Buffer.from([0x00]),
  ])
  const tail = Buffer.from([0x00, 0x20, 0x00, 0x01])
  return Buffer.concat([header, nameField, tail])
}

export interface NetbiosNameRecord {
  name: string
  type: number
  flags: number
}

export interface NetbiosResponse {
  hostname: string | null
  mac: string | null
  names: NetbiosNameRecord[]
}

/**
 * Parse a datagram that answered our wildcard query. Answers carry the
 * NBSTAT-style name list (count + 18-byte entries + trailing adapter address).
 */
export function parseNetbiosResponse(payload: Buffer, expectedId: number): NetbiosResponse | null {
  if (payload.length < 12) return null
  const id = payload.readUInt16BE(0)
  if (id !== (expectedId & 0xffff)) return null
  const flags = payload.readUInt16BE(2)
  if ((flags & 0x8000) === 0) return null
  const anCount = payload.readUInt16BE(6)
  if (anCount === 0) return null

  let offset = 12
  for (let a = 0; a < anCount; a++) {
    // NAME — skip a compression pointer (2 bytes) or an uncompressed name.
    if (offset >= payload.length) return null
    const first = payload[offset]!
    if ((first & 0xc0) === 0xc0) {
      offset += 2
    } else {
      const len = first
      offset += 1 + len + 1
    }
    if (offset + 10 > payload.length) return null
    const type = payload.readUInt16BE(offset)
    const rdlength = payload.readUInt16BE(offset + 8)
    const rdataStart = offset + 10
    if (rdataStart + rdlength > payload.length) return null
    const rdata = payload.subarray(rdataStart, rdataStart + rdlength)
    if (type === 0x21) {
      const parsed = parseNetbiosRdata(rdata)
      if (parsed) return parsed
    }
    offset = rdataStart + rdlength
  }
  return null
}

/**
 * NBSTAT (Node Status) resource data — RFC 1002 §4.2.18. Layout:
 *   1 byte  count of names
 *   each name: 15-byte raw name, 1-byte type suffix, 2-byte flags (18 bytes)
 *   remaining: statistics, whose first 6 bytes are the adapter MAC.
 */
export function parseNetbiosRdata(rdata: Buffer): NetbiosResponse | null {
  if (rdata.length < 1) return null
  const count = rdata[0]!
  const names: NetbiosNameRecord[] = []
  let offset = 1
  let mac: string | null = null
  for (let i = 0; i < count; i++) {
    if (offset + 18 > rdata.length) break
    const rawName = rdata.subarray(offset, offset + 15).toString('latin1')
    const type = rdata[offset + 15]!
    const flags = rdata.readUInt16BE(offset + 16)
    const name = rawName.replace(/[\s\u0000]+$/g, '').trim()
    if (name) names.push({ name, type, flags })
    offset += 18
  }
  // Adapter address (unit id) leads the statistics block.
  if (offset + 6 <= rdata.length) {
    mac = [...rdata.subarray(offset, offset + 6)].map((b) => b.toString(16).padStart(2, '0')).join(':')
  }
  const server = names.find((n) => n.type === 0x20) ?? names[0]
  return { hostname: server?.name ?? null, mac, names }
}

const NB_PORT = 137
const NB_BROADCAST = '255.255.255.255'

/**
 * Broadcast one wildcard NetBIOS name query and collect every responder's name
 * and adapter MAC. Read-only UDP discovery — the standard NetBIOS "who's here".
 */
export async function netbiosDiscover(durationMs = 1200): Promise<NetbiosEntry[]> {
  return new Promise((resolve) => {
    const id = (Date.now() & 0xffff)
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const byIp = new Map<string, NetbiosEntry>()
    const timer = setTimeout(finish, durationMs)

    function finish(): void {
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve([...byIp.values()])
    }

    socket.on('error', () => finish())
    socket.on('message', (msg, rinfo) => {
      if (rinfo.port !== NB_PORT || !isIpv4(rinfo.address)) return
      const parsed = parseNetbiosResponse(msg, id)
      if (!parsed || !parsed.hostname) return
      const existing = byIp.get(rinfo.address)
      if (existing) {
        if (parsed.mac) existing.mac = parsed.mac
        return
      }
      byIp.set(rinfo.address, { ip: rinfo.address, hostname: parsed.hostname, mac: parsed.mac })
    })

    socket.on('listening', () => {
      try { socket.setBroadcast(true) } catch { /* ignore */ }
      try { socket.send(netbiosQueryPacket(id), NB_PORT, NB_BROADCAST) } catch { /* ignore */ }
    })

    socket.bind(0)
  })
}
