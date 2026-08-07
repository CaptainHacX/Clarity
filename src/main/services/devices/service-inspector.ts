/**
 * Read-only service inspection.
 *
 * Netfox's rule, kept verbatim here: only ever read what a service *volunteers*
 * on connect. HTTP gets one GET, SSH and the mail/FTP family get their
 * greeting, and the two databases that stay silent until spoken to get a single
 * non-authenticating hello. No credential is ever sent, no command is ever
 * issued, and nothing runs unless the user turned it on.
 */
import { connect as netConnect, type Socket } from 'net'
import { connect as tlsConnect } from 'tls'
import type { ServiceInspection, ServicePosture } from '../../../shared/types'
import { isPrivateIpv4 } from '../../../shared/devices'

const CONNECT_TIMEOUT_MS = 2500
const READ_TIMEOUT_MS = 2500
const MAX_BYTES = 16 * 1024

/** Ports we treat as HTTP-ish without TLS. */
const HTTP_PORTS = new Set([80, 81, 591, 3000, 4200, 5000, 5173, 8000, 8008, 8080, 8081, 8123, 8888, 9000, 32400])
/** Ports we treat as HTTPS. */
const HTTPS_PORTS = new Set([443, 8443, 10443])
/** Services that announce themselves the moment the socket opens. */
const GREETING_PORTS = new Map<number, string>([
  [21, 'FTP'],
  [22, 'SSH'],
  [23, 'Telnet'],
  [25, 'SMTP'],
  [110, 'POP3'],
  [143, 'IMAP'],
  [587, 'SMTP'],
  [993, 'IMAPS'],
  [3306, 'MySQL'],
])

export function protocolForPort(port: number): ServiceInspection['protocol'] {
  if (HTTPS_PORTS.has(port)) return 'https'
  if (HTTP_PORTS.has(port)) return 'http'
  if (port === 6379) return 'redis'
  if (port === 5432) return 'postgres'
  const greeting = GREETING_PORTS.get(port)
  if (greeting) return 'banner'
  return 'unknown'
}

interface RawExchange {
  data: Buffer
  error: string | null
}

/**
 * Open a socket, optionally send one payload, and read whatever comes back
 * until the peer stops talking or the budget runs out.
 */
function exchange(
  ip: string,
  port: number,
  opts: { tls?: boolean; send?: Buffer | string; readMs?: number },
): Promise<RawExchange> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    let socket: Socket | null = null
    let readTimer: ReturnType<typeof setTimeout> | null = null

    const done = (error: string | null): void => {
      if (settled) return
      settled = true
      if (readTimer) clearTimeout(readTimer)
      try {
        socket?.destroy()
      } catch {
        // already gone
      }
      resolve({ data: Buffer.concat(chunks), error })
    }

    try {
      // Certificate validation is deliberately off, and only here. The peer is
      // a device on the user's own LAN — a printer, NAS or router whose HTTPS
      // admin page is self-signed by construction, so a valid chain is not
      // something any of them can present. Nothing confidential is sent over
      // this socket: the inspector issues one unauthenticated GET and reads the
      // reply. It is never used to carry a credential, a token or user data, so
      // an interceptor on the LAN would learn only what it could learn by
      // connecting to the same device itself.
      socket = opts.tls
        ? tlsConnect({ host: ip, port, servername: undefined, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS })
        : netConnect({ host: ip, port, family: 4, timeout: CONNECT_TIMEOUT_MS })
    } catch {
      done('connect-failed')
      return
    }

    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('timeout', () => done(chunks.length ? null : 'timeout'))
    socket.once('error', () => done(chunks.length ? null : 'connect-failed'))
    socket.once('close', () => done(null))
    socket.once(opts.tls ? 'secureConnect' : 'connect', () => {
      if (opts.send) socket?.write(opts.send)
      // Give the peer a fixed window to speak, then take what we have.
      readTimer = setTimeout(() => done(null), opts.readMs ?? READ_TIMEOUT_MS)
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total >= MAX_BYTES) done(null)
    })
  })
}

// ─── Parsers ────────────────────────────────────────────────

export function parseHttpResponse(raw: string): {
  status: number | null
  server: string | null
  title: string | null
  realm: string | null
  headers: string
} {
  const split = raw.indexOf('\r\n\r\n')
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw
  const body = split >= 0 ? raw.slice(split + 4) : ''
  const statusMatch = /^HTTP\/[\d.]+\s+(\d{3})/.exec(headerBlock)
  const serverMatch = /^server:\s*(.+)$/im.exec(headerBlock)
  const authMatch = /^www-authenticate:\s*(.+)$/im.exec(headerBlock)
  const realmMatch = authMatch ? /realm="?([^"\r\n]+)"?/i.exec(authMatch[1]) : null
  const titleMatch = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(body)
  return {
    status: statusMatch ? Number(statusMatch[1]) : null,
    server: serverMatch ? serverMatch[1].trim().slice(0, 120) : null,
    title: titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120) || null : null,
    realm: realmMatch ? realmMatch[1].trim().slice(0, 80) : null,
    headers: headerBlock.slice(0, 2000),
  }
}

/**
 * Name the product behind a web service. Netfox's point: "port 8080 open"
 * becomes "that's the printer's web admin".
 */
export function productFromHttp(server: string | null, title: string | null, realm: string | null): string | null {
  const hay = `${server ?? ''} ${title ?? ''} ${realm ?? ''}`.toLowerCase()
  if (!hay.trim()) return null
  const table: Array<[RegExp, string]> = [
    [/hp\s*http\s*server|hewlett|laserjet|officejet/, 'HP printer'],
    [/epson/, 'Epson printer'],
    [/brother/, 'Brother printer'],
    [/canon/, 'Canon printer'],
    [/synology|diskstation/, 'Synology NAS'],
    [/qnap|qts/, 'QNAP NAS'],
    [/truenas|freenas/, 'TrueNAS'],
    [/openwrt|luci/, 'OpenWrt router'],
    [/routeros|mikrotik/, 'MikroTik router'],
    [/unifi|ubiquiti/, 'UniFi'],
    [/asuswrt|asus/, 'ASUS router'],
    [/tp-?link|archer/, 'TP-Link router'],
    [/netgear|orbi/, 'Netgear router'],
    [/fritz!?box/, 'FRITZ!Box router'],
    [/home\s*assistant|hass/, 'Home Assistant'],
    [/plex/, 'Plex Media Server'],
    [/jellyfin/, 'Jellyfin'],
    [/transmission/, 'Transmission'],
    [/pi-?hole/, 'Pi-hole'],
    [/portainer/, 'Portainer'],
    [/grafana/, 'Grafana'],
    [/jenkins/, 'Jenkins'],
    [/nginx/, 'nginx'],
    [/apache/, 'Apache httpd'],
    [/lighttpd/, 'lighttpd'],
    [/caddy/, 'Caddy'],
    [/microsoft-?iis/, 'Microsoft IIS'],
    [/express/, 'Express (Node.js)'],
    [/werkzeug|gunicorn|django/, 'Python web server'],
    [/vite/, 'Vite dev server'],
    [/next\.js/, 'Next.js'],
    [/sonos/, 'Sonos'],
    [/roku/, 'Roku'],
    [/tasmota|esphome|shelly/, 'Smart-home device'],
  ]
  for (const [re, name] of table) {
    if (re.test(hay)) return name
  }
  return null
}

/** `SSH-2.0-OpenSSH_9.6` → a readable product name. */
export function productFromBanner(banner: string): string | null {
  const b = banner.trim()
  if (!b) return null
  const ssh = /^SSH-\d+\.\d+-(\S+)/.exec(b)
  if (ssh) {
    const impl = ssh[1]
    if (/openssh/i.test(impl)) return `OpenSSH ${impl.replace(/^OpenSSH[_-]?/i, '')}`.trim()
    if (/dropbear/i.test(impl)) return `Dropbear ${impl.replace(/^dropbear[_-]?/i, '')}`.trim()
    return impl.slice(0, 60)
  }
  const mysql = /\d+\.\d+\.\d+[-\w.]*/.exec(b)
  if (/mysql|mariadb/i.test(b) && mysql) return `MySQL ${mysql[0]}`
  const ftp = /^220[- ](.+)$/m.exec(b)
  if (ftp) return ftp[1].trim().slice(0, 80)
  return b.split(/[\r\n]/)[0]?.slice(0, 80) || null
}

// ─── PostgreSQL / Redis handshakes ──────────────────────────

/** The 8-byte SSLRequest packet — a question, not a login. */
function postgresSslRequest(): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeInt32BE(8, 0)
  buf.writeInt32BE(80877103, 4)
  return buf
}

/**
 * A PostgreSQL StartupMessage naming a user but sending no credential. The
 * server's reply says which authentication it wants — `AuthenticationOk` means
 * it wanted none, which is the exposure worth catching.
 */
function postgresStartup(user: string): Buffer {
  const params = `user\0${user}\0database\0postgres\0\0`
  const body = Buffer.from(params, 'utf8')
  const buf = Buffer.alloc(8 + body.length)
  buf.writeInt32BE(8 + body.length, 0)
  buf.writeInt32BE(196608, 4) // protocol 3.0
  body.copy(buf, 8)
  return buf
}

export function parsePostgresAuth(data: Buffer): { posture: ServicePosture; detail: string } {
  if (data.length === 0) return { posture: 'unknown', detail: 'No reply' }
  if (data[0] === 0x45 /* 'E' ErrorResponse */) {
    const text = data.toString('utf8', 5).replace(/\0+/g, ' ').trim()
    return { posture: 'auth-required', detail: text.slice(0, 200) || 'Server rejected the connection' }
  }
  if (data[0] === 0x52 /* 'R' Authentication */ && data.length >= 9) {
    const type = data.readInt32BE(5)
    if (type === 0) return { posture: 'open-no-auth', detail: 'Accepted the connection with no password' }
    const names: Record<number, string> = {
      2: 'Kerberos',
      3: 'clear-text password',
      5: 'MD5 password',
      7: 'GSSAPI',
      10: 'SASL / SCRAM',
    }
    return { posture: 'auth-required', detail: `Requires ${names[type] ?? `auth method ${type}`}` }
  }
  return { posture: 'unknown', detail: 'Unrecognised reply' }
}

export function parseRedisPing(data: Buffer): { posture: ServicePosture; detail: string } {
  const text = data.toString('utf8').trim()
  if (!text) return { posture: 'unknown', detail: 'No reply' }
  if (/^\+PONG/i.test(text)) return { posture: 'open-no-auth', detail: 'Answered PING with no password' }
  if (/NOAUTH/i.test(text)) return { posture: 'auth-required', detail: 'Requires a password' }
  if (/DENIED|WRONGPASS/i.test(text)) return { posture: 'auth-required', detail: 'Requires a password' }
  if (/^-/.test(text)) return { posture: 'auth-required', detail: text.slice(1, 120) }
  return { posture: 'unknown', detail: text.slice(0, 120) }
}

// ─── Entry point ────────────────────────────────────────────

function empty(port: number, protocol: ServiceInspection['protocol']): ServiceInspection {
  return {
    port,
    protocol,
    product: null,
    title: null,
    server: null,
    banner: null,
    posture: 'unknown',
    postureDetail: null,
    raw: null,
    inspectedAt: Date.now(),
    error: null,
  }
}

/**
 * Inspect one open port on one LAN device. Never throws; a service that says
 * nothing comes back as an inspection with null fields rather than an error.
 */
export async function inspectService(ip: string, port: number): Promise<ServiceInspection> {
  const protocol = protocolForPort(port)
  const result = empty(port, protocol)

  if (!isPrivateIpv4(ip)) {
    return { ...result, error: 'Only devices on your local network can be inspected.' }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ...result, error: 'Invalid port.' }
  }

  if (protocol === 'http' || protocol === 'https') {
    const request = `GET / HTTP/1.1\r\nHost: ${ip}\r\nUser-Agent: Clarity/1.0\r\nAccept: text/html\r\nConnection: close\r\n\r\n`
    const { data, error } = await exchange(ip, port, { tls: protocol === 'https', send: request })
    if (!data.length) return { ...result, error: error ?? 'No response' }
    const raw = data.toString('utf8')
    const parsed = parseHttpResponse(raw)
    const needsAuth = parsed.status === 401 || parsed.realm != null
    return {
      ...result,
      product: productFromHttp(parsed.server, parsed.title, parsed.realm),
      title: parsed.title,
      server: parsed.server,
      banner: null,
      posture: needsAuth ? 'auth-required' : parsed.status != null ? 'reachable' : 'unknown',
      postureDetail: needsAuth
        ? `Asks for a password${parsed.realm ? ` (${parsed.realm})` : ''}`
        : parsed.status != null
          ? `Answered HTTP ${parsed.status}`
          : null,
      raw: parsed.headers,
      error: null,
    }
  }

  if (protocol === 'redis') {
    const { data, error } = await exchange(ip, port, { send: '*1\r\n$4\r\nPING\r\n', readMs: 1500 })
    if (!data.length) return { ...result, error: error ?? 'No response' }
    const verdict = parseRedisPing(data)
    return {
      ...result,
      product: 'Redis',
      posture: verdict.posture,
      postureDetail: verdict.detail,
      raw: data.toString('utf8').slice(0, 500),
      error: null,
    }
  }

  if (protocol === 'postgres') {
    const ssl = await exchange(ip, port, { send: postgresSslRequest(), readMs: 1200 })
    const startup = await exchange(ip, port, { send: postgresStartup('postgres'), readMs: 1500 })
    if (!startup.data.length && !ssl.data.length) return { ...result, error: startup.error ?? 'No response' }
    const verdict = parsePostgresAuth(startup.data)
    return {
      ...result,
      product: 'PostgreSQL',
      posture: verdict.posture,
      postureDetail: verdict.detail,
      raw: `SSLRequest → ${ssl.data.toString('utf8').slice(0, 1) || '-'}\n${startup.data.toString('utf8').replace(/[^\x20-\x7e\n]/g, '.').slice(0, 500)}`,
      error: null,
    }
  }

  // Everything else: connect and listen. Whatever it says first is the answer.
  const { data, error } = await exchange(ip, port, { readMs: 2000 })
  if (!data.length) return { ...result, error: error ?? 'The service said nothing on connect.' }
  const banner = data.toString('utf8').replace(/[^\x20-\x7e\r\n]/g, '.').trim()
  return {
    ...result,
    protocol: 'banner',
    product: productFromBanner(banner),
    banner: banner.slice(0, 300),
    posture: 'reachable',
    postureDetail: 'Announced itself on connect',
    raw: banner.slice(0, 1000),
    error: null,
  }
}
