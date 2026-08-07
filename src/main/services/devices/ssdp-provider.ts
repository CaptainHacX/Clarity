import dgram from 'dgram'
import { isIpv4 } from '../../../shared/devices'

export interface SsdpEntry {
  ip: string
  location: string | null
  server: string | null
  usn: string | null
}

/** Parse one HTTP/1.1 SSDP response payload. */
export function parseSsdpResponse(payload: Buffer): SsdpEntry | null {
  const text = payload.toString('latin1')
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(text)) return null
  const header = (name: string): string | null => {
    const m = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))
    return m ? m[1]!.trim() : null
  }
  const location = header('LOCATION')
  let ip: string | null = null
  if (location) {
    try {
      const host = new URL(location).hostname
      if (isIpv4(host)) ip = host
    } catch {
      /* unparsable LOCATION — ignore */
    }
  }
  if (!ip) {
    // No parsable IPv4 in LOCATION; drop rather than fabricate an address.
    return null
  }
  return {
    ip,
    location,
    server: header('SERVER'),
    usn: header('USN'),
  }
}

const MULTICAST_GROUP = '239.255.255.250'
const SSDP_PORT = 1900

/** Run an SSDP discovery round for `durationMs`, collecting device responses. */
export async function ssdpDiscover(durationMs = 1800): Promise<SsdpEntry[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const entries = new Map<string, SsdpEntry>()
    const timer = setTimeout(finish, durationMs)

    function finish(): void {
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve([...entries.values()])
    }

    socket.on('error', () => finish())
    socket.on('message', (msg) => {
      const entry = parseSsdpResponse(msg)
      if (entry && !entries.has(entry.ip)) entries.set(entry.ip, entry)
    })

    socket.on('listening', () => {
      try { socket.setBroadcast(true) } catch { /* ignore */ }
      try { socket.setMulticastTTL(2) } catch { /* ignore */ }
      // Joining the group only matters if devices reply to the multicast group
      // rather than unicasting back to our port. Failures here are non-fatal.
      try { socket.addMembership(MULTICAST_GROUP) } catch { /* ignore */ }
      const query = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${MULTICAST_GROUP}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: ssdp:all',
        '',
        '',
      ].join('\r\n')
      try {
        socket.send(query, SSDP_PORT, MULTICAST_GROUP)
      } catch { /* ignore */ }
    })

    socket.bind(0)
  })
}
