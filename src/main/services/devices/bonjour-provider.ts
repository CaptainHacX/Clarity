import { execFile } from 'child_process'
import { promisify } from 'util'
import { isIpv4 } from '../../../shared/devices'

const execFileAsync = promisify(execFile)

export interface BonjourEntry {
  instance: string | null
  type: string
  hostname: string | null
  ip: string | null
  port: number | null
  model: string | null
  mac: string | null
}

export interface BonjourProviderResult {
  entries: BonjourEntry[]
  ok: boolean
  error?: string
}

async function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, encoding: 'utf-8' })
    return stdout
  } catch (err) {
    // A killed process (timeout) still hands back its captured stdout.
    const stdout = (err as { stdout?: string }).stdout ?? ''
    return stdout
  }
}

/**
 * Service types from `dns-sd -B _services._dns-sd._udp.` — each `Add` row puts
 * the advertised protocol in the "Service Type" column and the actual service
 * type (e.g. `_airplay`) in the "Instance Name" column.
 */
export function parseBonjourBrowse(stdout: string): string[] {
  const types = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    if (!/\bAdd\b/.test(line)) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 7) continue
    const service = parts[5] ?? ''
    const instance = parts[6] ?? ''
    if (!instance.startsWith('_') || !/^_(tcp|udp)(?:\.local)?\.?$/.test(service)) continue
    const protocol = service.replace(/\.local\.?$/, '')
    types.add(`${instance}.${protocol}`)
  }
  return [...types]
}

/** Pull a TXT value out of `dns-sd -Z` TXT block lines, e.g. `model=AppleTV5,3`. */
export function parseTxtValue(lines: string[], key: string): string | null {
  const wanted = key.toLowerCase()
  for (const line of lines) {
    const m = line.match(/^\s+(.+?)=(?:0x[0-9a-fA-F]+)\s+\((.+)\)$/)
    if (m) {
      if (m[1]!.toLowerCase() === wanted) return m[2]!.trim()
      continue
    }
    const m2 = line.match(/^\s+([A-Za-z0-9_-]+)=(.*)$/)
    if (m2 && m2[1]!.toLowerCase() === wanted) {
      const v = m2[2]!.trim()
      return v === '""' || v.length === 0 ? null : v
    }
  }
  return null
}

function macFromDeviceId(deviceid: string | null): string | null {
  if (!deviceid) return null
  const m = deviceid.match(/(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/)
  return m ? m[0].toLowerCase() : null
}

/**
 * Parse `dns-sd -Z <type>` zone-transfer output into per-instance entries.
 * Real records are one per line, e.g.:
 *   _airplay._tcp            PTR  koushik-mac._airplay._tcp
 *   koushik-mac._airplay._tcp SRV  0 0 7000 koushik-mac.local. ; comment
 *   koushik-mac._airplay._tcp TXT  "deviceid=..." "model=Mac16,10"
 *   koushik-mac.local.        A    192.168.1.50
 * IPs are optional (`-Z` often omits A records); a `deviceid`/MAC lets the
 * merge step pair the service with the ARP-cache entry for the same device.
 */
export function parseBonjourZ(stdout: string): BonjourEntry[] {
  const recs: Array<{ name: string; rtype: string; data: string }> = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trimEnd()
    if (!line) continue
    // Records may carry an optional `120 IN` TTL/class prefix (mainly A/AAAA).
    const m = line.match(/^(\S+)\s+(?:\d+\s+IN\s+)?(PTR|SRV|TXT|A|AAAA)\s+(.+)$/)
    if (m) recs.push({ name: m[1]!, rtype: m[2]!, data: m[3]!.trim() })
  }

  // Split `koushik-mac._airplay._tcp` into instance + type.
  const splitName = (name: string): { type: string; instance: string | null } => {
    const m = name.match(/^(.*)\.(_[^.]+\._(tcp|udp))$/)
    if (!m) return { type: name, instance: null }
    const instance = m[1]!
    return { type: m[2]!, instance: instance.length > 0 ? instance : null }
  }

  interface Group {
    type: string
    instance: string | null
    port: number | null
    hostname: string | null
    txt: string | null
  }
  const groups = new Map<string, Group>()
  const groupFor = (key: string, type: string, instance: string | null): Group => {
    let g = groups.get(key)
    if (!g) {
      g = { type, instance, port: null, hostname: null, txt: null }
      groups.set(key, g)
    }
    if (instance && !g.instance) g.instance = instance
    return g
  }

  // A/AAAA records are keyed by hostname, not by instance — match them to the
  // SRV hostname later.
  const addrs = new Map<string, string>()

  for (const r of recs) {
    if (r.rtype === 'PTR') {
      if (r.data === '@') continue // zone-transfer placeholder
      // name column = type; data = `<instance>.<type>`
      const { type } = splitName(r.name)
      const instance = r.data.endsWith(`.${type}`) ? r.data.slice(0, r.data.length - type.length - 1) : r.data
      if (!instance) continue
      groupFor(`${instance}|${type}`, type, instance)
      continue
    }
    if (r.rtype === 'A' || r.rtype === 'AAAA') {
      if (r.rtype === 'A' && isIpv4(r.data)) addrs.set(r.name.replace(/\.$/, ''), r.data)
      else if (r.rtype === 'AAAA') addrs.set(r.name.replace(/\.$/, ''), r.data)
      continue
    }
    const { type, instance } = splitName(r.name)
    const g = groupFor(`${instance ?? ''}|${type}`, type, instance)
    if (r.rtype === 'SRV') {
      const sm = r.data.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/)
      if (sm) {
        g.port = Number(sm[3])
        const h = sm[4]!.replace(/\.$/, '')
        if (h && h !== '@') g.hostname = h
      }
    } else if (r.rtype === 'TXT') {
      g.txt = r.data
    }
  }

  const entries: BonjourEntry[] = []
  for (const g of groups.values()) {
    let model: string | null = null
    let mac: string | null = null
    let host: string | null = null
    if (g.txt) {
      const quoted = g.txt.match(/"([^"]+)"/g) ?? []
      for (const q of quoted) {
        const kv = q.slice(1, -1)
        const eq = kv.indexOf('=')
        if (eq <= 0) continue
        const k = kv.slice(0, eq).toLowerCase()
        const v = kv.slice(eq + 1)
        if (k === 'model' && v && !model) model = v
        if (k === 'deviceid') mac = macFromDeviceId(v)
        if (k === 'host' && v && !host) host = v
      }
    }
    const hostname = host ?? g.hostname ?? null
    entries.push({
      instance: g.instance,
      type: g.type,
      hostname,
      ip: hostname && addrs.has(hostname) ? addrs.get(hostname)! : null,
      port: g.port,
      model,
      mac,
    })
  }

  // De-duplicate by (ip, type, instance).
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.ip ?? ''}|${e.type}|${e.instance ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Parse `avahi-browse -art -p` (Linux) into entries. */
export function parseAvahiBrowse(stdout: string): BonjourEntry[] {
  const entries: BonjourEntry[] = []
  let current: {
    type: string
    instance: string | null
    hostname: string | null
    ip: string | null
    port: number | null
    model: string | null
    mac: string | null
  } | null = null

  const flush = (): void => {
    if (current) {
      entries.push(current)
      current = null
    }
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('=')) {
      flush()
      const parts = line.split(';')
      // =;eth0;IPv4;Instance;_type._tcp;local
      if (parts.length >= 5) {
        const type = (parts[4] ?? '').replace(/\.$/, '')
        current = {
          type,
          instance: parts[3] && parts[3] !== '' ? parts[3] : null,
          hostname: null,
          ip: null,
          port: null,
          model: null,
          mac: null,
        }
      }
    } else if (current) {
      const hm = line.match(/^hostname=\[(.*)\]$/)
      if (hm) current.hostname = hm[1] && hm[1].length ? hm[1] : null
      const am = line.match(/^address=\[([^\]]+)\]$/)
      if (am && isIpv4(am[1])) current.ip = am[1]
      const pm = line.match(/^port=\[(\d+)\]$/)
      if (pm) current.port = Number(pm[1])
      const tm = line.match(/^txt=\[?(.*?)\]?$/)
      if (tm && tm[1].length) {
        const quoted = tm[1].match(/"([^"]+)"/g) ?? []
        for (const q of quoted) {
          const kv = q.slice(1, -1)
          const eq = kv.indexOf('=')
          if (eq <= 0) continue
          const k = kv.slice(0, eq).toLowerCase()
          const v = kv.slice(eq + 1)
          if (k === 'model' && v && !current.model) current.model = v
          if (k === 'deviceid') current.mac = macFromDeviceId(v)
          if (k === 'host' && v && !current.hostname) current.hostname = v
        }
      }
    }
  }
  flush()
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.ip ?? ''}|${e.type}|${e.instance ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const CURATED_TYPES = [
  '_airplay._tcp', '_raop._tcp', '_airtunes._tcp', '_airprint._tcp', '_ipp._tcp',
  '_googlecast._tcp', '_spotify-connect._tcp', '_http._tcp', '_https._tcp', '_ssh._tcp',
  '_smb._tcp', '_afpovertcp._tcp', '_companion-link._tcp', '_homekit._tcp', '_hap._tcp',
  '_privet._tcp', '_rfb._tcp', '_scanner._tcp', '_dpap._tcp', '_mediaremotetv._tcp',
]

const MAX_TYPES = 20
const MAX_TOTAL_MS = 8000

async function discoverDarwin(): Promise<BonjourProviderResult> {
  const browse = await run('dns-sd', ['-B', '_services._dns-sd._udp.', 'local.'], 1500)
  const active = parseBonjourBrowse(browse)
  const types = [...new Set([...active, ...CURATED_TYPES])].slice(0, MAX_TYPES)
  const entries: BonjourEntry[] = []
  const deadline = Date.now() + MAX_TOTAL_MS
  for (const type of types) {
    if (Date.now() > deadline) break
    const out = await run('dns-sd', ['-Z', type, 'local.'], 700)
    entries.push(...parseBonjourZ(out))
  }
  if (entries.length === 0 && types.length === 0) {
    return { entries, ok: true }
  }
  return { entries, ok: true }
}

async function discoverLinux(): Promise<BonjourProviderResult> {
  const out = await run('avahi-browse', ['-art', '-p'], 2500)
  if (out.length === 0) return { entries: [], ok: true, error: 'avahi-browse unavailable or empty' }
  return { entries: parseAvahiBrowse(out), ok: true }
}

/**
 * Turn the `.local` names Bonjour advertises into IPv4 addresses.
 *
 * `dns-sd -Z` names the host but doesn't resolve it, so without this pass every
 * Bonjour device arrives address-less and can't be matched with the same
 * device seen in the ARP cache — which is how one Apple TV ended up as two
 * half-empty rows. The system resolver handles `.local` through mDNS on macOS
 * and through nss-mdns on Linux; where it doesn't, the entry just stays
 * address-less as before.
 */
export async function resolveMdnsHosts(hostnames: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(hostnames.filter((h): h is string => typeof h === 'string' && h.length > 0))]
  const out = new Map<string, string>()
  if (unique.length === 0) return out
  let lookup: typeof import('node:dns/promises').lookup
  try {
    lookup = (await import('node:dns/promises')).lookup
  } catch {
    return out
  }
  const CONCURRENCY = 8
  const TIMEOUT_MS = 1500
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const host = unique[cursor++]!
      try {
        const result = await Promise.race([
          lookup(host, { family: 4 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
        ])
        const address = result && typeof result === 'object' && 'address' in result ? result.address : null
        // A device resolving to loopback is this machine answering about
        // itself; its real LAN address comes from the interface, not here.
        if (address && isIpv4(address) && !address.startsWith('127.')) out.set(host, address)
      } catch {
        // No mDNS answer — leave it address-less.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => worker()))
  return out
}

/** mDNS/Bonjour discovery. macOS uses dns-sd; Linux falls back to avahi-browse. */
export async function bonjourDiscover(): Promise<BonjourProviderResult> {
  try {
    let result: BonjourProviderResult
    if (process.platform === 'darwin') result = await discoverDarwin()
    else if (process.platform === 'linux') result = await discoverLinux()
    else return { entries: [], ok: true }

    const needsIp = result.entries.filter((e) => !e.ip && e.hostname).map((e) => e.hostname!)
    if (needsIp.length > 0) {
      const resolved = await resolveMdnsHosts(needsIp)
      result = {
        ...result,
        entries: result.entries.map((e) => (e.ip || !e.hostname ? e : { ...e, ip: resolved.get(e.hostname) ?? null })),
      }
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'bonjour failed'
    return { entries: [], ok: false, error: msg.slice(0, 200) }
  }
}
