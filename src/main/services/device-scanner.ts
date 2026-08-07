import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import * as si from 'systeminformation'
import type {
  DevicesSnapshot,
  DevicesHostInfo,
  DeviceKind,
  DeviceObservation,
  DeviceServiceAd,
  DeviceTag,
  LinkQuality,
  NetworkContextInfo,
  NetworkDevice,
} from '../../shared/types'
import { deviceId, isPrivateMac, normalizeMac } from '../../shared/devices'
import { readArpCache, readNdpCache, type ArpEntry } from './devices/arp-provider'
import { bonjourDiscover, type BonjourEntry } from './devices/bonjour-provider'
import { ssdpDiscover, type SsdpEntry } from './devices/ssdp-provider'
import { netbiosDiscover, type NetbiosEntry } from './devices/netbios-provider'
import { runPingBurst, computeLinkQuality } from './devices/icmp-provider'
import { collectLocalListeners } from './devices/local-listeners'
import { loadOuiDb, lookupVendor } from './wifi-scanner'
import { loadDeviceTags } from './device-tags-store'
import { loadDeviceProbes } from './device-probes-store'
import { appendDeviceHistory } from './device-history-store'

const execFileAsync = promisify(execFile)

// ─── Kind inference ─────────────────────────────────────────

const PRINTER_VENDORS = new Set([
  'hp', 'hewlett-packard', 'epson', 'canon', 'brother', 'xerox', 'sharp', 'kyocera', 'lexmark', 'ricoh',
])
const ROUTER_VENDORS = new Set([
  'cisco', 'linksys', 'netgear', 'asus', 'tp-link', 'd-link', 'mikrotik', 'ubiquiti', 'zyxel', 'draytek', 'huawei',
])

/**
 * Vendor → kind, for devices that publish nothing else about themselves. It is
 * the weakest signal of the three (model, then services, then this), but it is
 * the difference between a row reading "Espressif · Smart device" and reading
 * "Unknown" — and on a home network the guess is right far more often than not.
 */
const VENDOR_KIND: Array<[RegExp, DeviceKind]> = [
  [/espressif|tuya|shelly|sonoff|tasmota|itead|broadlink|wiz |signify|philips lighting|lifx|tp-link technologies co\.,ltd\.?$/, 'iot'],
  [/sonos|bose|denon|yamaha|marantz|harman|jbl|bang ?& ?olufsen|libratone|devialet/, 'speaker'],
  [/roku|vizio|tcl|hisense|skyworth|amtran|funai/, 'tv'],
  [/amazon technologies/, 'media'],
  [/google, inc|google llc|nest labs/, 'media'],
  [/raspberry pi/, 'computer'],
  [/intel corporate|dell inc|lenovo|micro-star|gigabyte|asustek|acer|msi|framework computer|system76/, 'computer'],
  [/oneplus|vivo mobile|oppo|realme|guangdong|xiaomi|honor device/, 'phone'],
  [/hikvision|dahua|axis communications|reolink|wyze|arlo|amcrest/, 'camera'],
  [/synology|qnap|western digital|netgear.*(nas|readynas)/, 'computer'],
]

/**
 * Some MAC blocks are registered to the registry itself rather than to a maker
 * — the IEEE hands out MA-M and MA-S sub-blocks under its own name, and IANA
 * holds a range for virtual interfaces. Showing those as the manufacturer is
 * worse than showing nothing: it reads like a real answer and isn't one.
 */
const PLACEHOLDER_VENDOR_RE = /^(ieee registration authority|iana|private|unknown)/i

export function usableVendor(vendor: string | null | undefined): string | null {
  if (!vendor) return null
  const trimmed = vendor.trim()
  if (!trimmed || PLACEHOLDER_VENDOR_RE.test(trimmed)) return null
  return trimmed
}

export function inferKind(input: {
  vendor: string | null
  model: string | null
  hostname: string | null
  serviceTypes: string[]
  roles: { gateway: boolean; dns?: boolean; dhcp?: boolean }
}): DeviceKind {
  const hay = `${input.model ?? ''} ${input.hostname ?? ''}`.toLowerCase()
  // The model is the one identity signal that isn't inferred — a device that
  // states `AppleTV5,3` or `Mac14,15` is telling the truth about itself, so it
  // outranks the services it happens to speak.
  if (/(macbook|mac ?mini|imac|mac ?pro|mac ?studio|mac\d+,|thinkpad|thinkcentre|latitude|inspiron|xps|elitebook|surface ?(laptop|book)|pixel ?book|galaxy ?book|precision|workstation|raspberrypi)/.test(hay)) return 'computer'
  if (/(iphone\d*,|iphone|pixel [1-9]|galaxy s|galaxy note|oneplus|redmi|poco)/.test(hay)) return 'phone'
  if (/(ipad\d*,|ipad|galaxy tab|kindle|surface pro)/.test(hay)) return 'tablet'
  if (/(appletv\d*,|apple.?tv|bravia|android.?tv|roku|fire.?tv|smart.?tv|\btv\b|chromecast|shield)/.test(hay)) return 'tv'
  if (/(audioaccessory\d*,|homepod|echo|sonos|home.?pod|google home|nest ?(mini|audio|hub)|bose|jbl|soundbar|boom)/.test(hay)) return 'speaker'
  if (/(camera|webcam|doorbell|\bring\b|ipcam|nvr)/.test(hay)) return 'camera'
  if (/(esp32|esp8266|raspberry|tasmota|tuya|smart ?plug|zigbee|z-?wave|shelly|sonoff)/.test(hay)) return 'iot'
  if (/(printer|laserjet|officejet|deskjet|ecotank|pixma|mfc-|dcp-)/.test(hay)) return 'printer'

  const st = new Set(input.serviceTypes)
  if (st.has('_airprint._tcp') || st.has('_ipp._tcp') || st.has('_ipps._tcp') || st.has('_printer._tcp') || st.has('_pdl-datastream._tcp')) return 'printer'
  if (st.has('_googlecast._tcp') || st.has('_cast._tcp') || st.has('_mediaremotetv._tcp')) return 'media'
  if (st.has('_airplay._tcp') || st.has('_raop._tcp') || st.has('_airtunes._tcp')) {
    return input.roles.gateway ? 'media' : 'speaker'
  }
  if (st.has('_homekit._tcp') || st.has('_hap._tcp') || st.has('_matter._tcp') || st.has('_esphomelib._tcp')) return 'iot'
  if (st.has('_smb._tcp') || st.has('_afpovertcp._tcp') || st.has('_adisk._tcp')) return 'computer'

  const vendor = (input.vendor ?? '').toLowerCase()
  for (const p of PRINTER_VENDORS) if (vendor.includes(p)) return 'printer'
  if (input.roles.gateway) return 'router'
  // Not the gateway, but doing a job for the network — a mesh node, an access
  // point or a filtering resolver someone put in the path. If its maker builds
  // network gear, it's networking kit.
  if (input.roles.dns || input.roles.dhcp) {
    for (const r of ROUTER_VENDORS) if (vendor.includes(r)) return 'router'
  }
  for (const [re, kind] of VENDOR_KIND) {
    if (re.test(vendor)) return kind
  }
  return 'unknown'
}

// ─── Network context / roles ────────────────────────────────

/** Prefix length from either a netmask string or an integer bit count. */
export function cidrToPrefix(mask: string | number | null | undefined): number | null {
  if (mask === null || mask === undefined) return null
  if (typeof mask === 'number') {
    return Number.isInteger(mask) && mask >= 0 && mask <= 32 ? mask : null
  }
  const parts = mask.split('.')
  if (parts.length !== 4) return null
  let bits = 0
  for (const p of parts) {
    const octet = Number(p)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    for (let b = 7; b >= 0; b--) {
      if (octet & (1 << b)) bits++
      else return bits // non-contiguous → use bits seen so far
    }
  }
  return bits
}

export function computeRoles(ipv4: string[], ctx: NetworkContextInfo | null): { gateway: boolean; dns: boolean; dhcp: boolean } {
  const ipSet = new Set(ipv4)
  return {
    gateway: ctx ? ipSet.has(ctx.router ?? '') : false,
    dns: ctx ? ctx.dnsServers.some((d) => ipSet.has(d)) : false,
    dhcp: ctx ? ipSet.has(ctx.dhcpServer ?? '') : false,
  }
}

// ─── Merge providers ────────────────────────────────────────

interface SeenDevice {
  id: string
  mac: string | null
  ipv4: Set<string>
  hostname: string | null
  model: string | null
  services: DeviceServiceAd[]
  sources: Set<string>
  seenThisRound: boolean
}

/** `Koushiks-iPhone.local.` → `koushiks-iphone` — the comparable part of an mDNS name. */
function hostKey(hostname: string | null | undefined): string | null {
  if (!hostname) return null
  const trimmed = hostname.trim().replace(/\.$/, '').replace(/\.local$/i, '').toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Index of every identifier that points at a device record, so a device seen
 * by MAC in the ARP cache and by name over mDNS lands in one row rather than
 * two half-empty ones.
 */
interface SeenIndex {
  byId: Map<string, SeenDevice>
  byMac: Map<string, string>
  byIp: Map<string, string>
  byHost: Map<string, string>
}

function newIndex(): SeenIndex {
  return { byId: new Map(), byMac: new Map(), byIp: new Map(), byHost: new Map() }
}

/**
 * Find or create the record for one observation, then fold in whatever new
 * identifiers it brought. Resolution order is MAC (a hardware fact), then IPv4,
 * then hostname — the same order of confidence the identity itself has.
 */
function upsert(
  index: SeenIndex,
  observed: { mac?: string | null; ip?: string | null; hostname?: string | null },
): SeenDevice | null {
  const mac = normalizeMac(observed.mac ?? null)
  const ip = observed.ip ?? null
  const host = hostKey(observed.hostname)
  if (!mac && !ip && !host) return null

  const existingId =
    (mac ? index.byMac.get(mac) : undefined) ??
    (ip ? index.byIp.get(ip) : undefined) ??
    (host ? index.byHost.get(host) : undefined)

  let device = existingId ? index.byId.get(existingId) : undefined
  if (!device) {
    const id = mac ? mac : ip ? `ip:${ip}` : `host:${host}`
    device = { id, mac, ipv4: new Set(), hostname: null, model: null, services: [], sources: new Set(), seenThisRound: false }
    index.byId.set(id, device)
  }
  if (mac && !device.mac) {
    device.mac = mac
    // A record first keyed by address gains its real identity; re-key it so a
    // later MAC-only observation finds the same row.
    if (device.id.startsWith('ip:') || device.id.startsWith('host:')) {
      index.byId.delete(device.id)
      device.id = mac
      index.byId.set(mac, device)
    }
  }
  if (mac) index.byMac.set(mac, device.id)
  if (ip) {
    device.ipv4.add(ip)
    index.byIp.set(ip, device.id)
  }
  if (host) index.byHost.set(host, device.id)
  if (observed.hostname && !device.hostname) device.hostname = observed.hostname.replace(/\.$/, '')
  return device
}

export function mergeProviderResults(input: {
  arp: ArpEntry[]
  bonjour: BonjourEntry[]
  ssdp: SsdpEntry[]
  netbios: NetbiosEntry[]
  hostMac: string | null
  hostIpv4?: string[]
  hostHostname?: string | null
}): Map<string, SeenDevice> {
  const index = newIndex()

  // This machine goes in first with everything we already know about it, so
  // every later observation about it — its mDNS records above all — merges
  // onto that one row instead of forking a second "unknown device".
  if (input.hostMac || input.hostIpv4?.length) {
    const local = upsert(index, {
      mac: input.hostMac,
      ip: input.hostIpv4?.[0] ?? null,
      hostname: input.hostHostname ?? null,
    })
    if (local) {
      local.sources.add('arp')
      local.seenThisRound = true
      for (const ip of input.hostIpv4 ?? []) local.ipv4.add(ip)
    }
  }

  for (const a of input.arp) {
    const d = upsert(index, { mac: a.mac, ip: a.ip, hostname: a.hostname ?? null })
    if (!d) continue
    d.sources.add('arp')
    if (a.reachable) d.seenThisRound = true
  }
  for (const s of input.ssdp) {
    const d = upsert(index, { ip: s.ip })
    if (!d) continue
    d.sources.add('ssdp')
    d.seenThisRound = true
    if (s.server && !d.model) d.model = s.server.slice(0, 120)
  }
  for (const n of input.netbios) {
    const d = upsert(index, { mac: n.mac, ip: n.ip, hostname: n.hostname })
    if (!d) continue
    d.sources.add('netbios')
    d.seenThisRound = true
  }
  // Bonjour last: by now the address-bearing providers have established the
  // records, so a service advertisement attaches to an existing device far more
  // often than it creates one.
  for (const b of input.bonjour) {
    const d = upsert(index, { mac: b.mac, ip: b.ip, hostname: b.hostname })
    if (!d) continue
    d.sources.add('bonjour')
    d.seenThisRound = true
    if (b.model && !d.model) d.model = b.model
    if (b.instance || b.port !== null) {
      // One host often advertises the same service on several interfaces; the
      // Services row should name it once.
      const already = d.services.some((s) => s.type === b.type && s.port === (b.port ?? 0))
      if (!already) {
        d.services.push({
          name: b.instance ?? '',
          type: b.type,
          port: b.port ?? 0,
          ...(b.model ? { model: b.model } : {}),
        })
      }
    }
  }

  return index.byId
}

// ─── Subnet sweep ──────────────────────────────────────────

/** Refuse subnets bigger than a /23 — a misread netmask must never launch a flood. */
const MAX_SWEEP_HOSTS = 510
/** How often a sweep may run. Between sweeps the kernel's ARP cache carries the load. */
const SWEEP_INTERVAL_MS = 60_000
let lastSweepAt = 0

/**
 * Every usable host address in `hostIpv4`'s subnet, network and broadcast
 * excluded and the local address itself excluded. Empty when the prefix is
 * unknown, invalid, or the subnet would exceed `MAX_SWEEP_HOSTS`.
 */
export function enumerateSubnet(hostIpv4: string, prefix: number | null): string[] {
  if (!prefix || prefix < 1 || prefix > 30) return []
  const parts = hostIpv4.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return []
  const hostLong =
    ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const hostCount = 2 ** (32 - prefix)
  if (hostCount - 2 > MAX_SWEEP_HOSTS) return []
  const network = hostLong & mask
  const out: string[] = []
  for (let i = 1; i < hostCount - 1; i++) {
    const addr = (network + i) >>> 0
    if (addr === hostLong) continue
    out.push(`${(addr >>> 24) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 8) & 0xff}.${addr & 0xff}`)
  }
  return out
}

// ─── Link-quality ring (kept across scans) ──────────────────

const RING_MAX = 15
const qualityRing = new Map<string, (number | null)[]>()

function sampleQualityRing(ip: string, timeMs: number | null): LinkQuality {
  const ring = qualityRing.get(ip) ?? []
  ring.push(timeMs)
  if (ring.length > RING_MAX) ring.shift()
  qualityRing.set(ip, ring)
  const answered = ring.filter((t): t is number => t !== null)
  const loss = ring.length > 0 ? (ring.length - answered.length) / ring.length : null
  if (answered.length === 0) {
    return { latencyMs: null, avgMs: null, variabilityMs: null, packetLossPct: loss, measuredAt: Date.now() }
  }
  const min = Math.min(...answered)
  const avg = answered.reduce((a, b) => a + b, 0) / answered.length
  const variance = answered.reduce((a, b) => a + (b - avg) ** 2, 0) / answered.length
  return {
    latencyMs: min,
    avgMs: avg,
    variabilityMs: Math.sqrt(variance),
    packetLossPct: loss,
    measuredAt: Date.now(),
  }
}

// ─── History diff ───────────────────────────────────────────

let _eventSeq = 0

function makeEvent(deviceId: string, at: number, kind: DeviceObservation['kind'], text: string): DeviceObservation {
  _eventSeq = (_eventSeq + 1) % 0xffffffff
  return { id: `${at.toString(36)}-${_eventSeq.toString(36)}`, at, deviceId, kind, text }
}

export function diffEvents(previous: Map<string, NetworkDevice>, next: NetworkDevice[], now: number): DeviceObservation[] {
  const events: DeviceObservation[] = []
  for (const dev of next) {
    const prev = previous.get(dev.id)
    if (!prev) {
      const label = dev.hostname ?? dev.ipv4[0] ?? dev.vendor ?? 'device'
      events.push(makeEvent(dev.id, now, 'online', `${label} joined the network`))
      continue
    }
    if (prev.status !== dev.status && dev.status === 'online') {
      const label = dev.hostname ?? dev.ipv4[0] ?? dev.vendor ?? 'device'
      events.push(makeEvent(dev.id, now, 'online', `${label} came online`))
    } else if (prev.status !== dev.status && dev.status === 'offline') {
      const label = prev.hostname ?? dev.ipv4[0] ?? prev.vendor ?? 'device'
      events.push(makeEvent(dev.id, now, 'offline', `${label} went offline`))
    }
    if (dev.ipv4.length > 0) {
      const prevSet = new Set(prev.ipv4)
      const changed = dev.ipv4.some((ip) => !prevSet.has(ip))
      if (changed && prev.ipv4.length > 0) {
        events.push(makeEvent(dev.id, now, 'ipv4', `IPv4 changed → ${dev.ipv4.join(', ')}`))
      } else if (changed && prev.ipv4.length === 0) {
        events.push(makeEvent(dev.id, now, 'ipv4', `IPv4 learned → ${dev.ipv4.join(', ')}`))
      }
    }
    if (dev.hostname && prev.hostname !== dev.hostname) {
      events.push(makeEvent(dev.id, now, 'hostname', `Hostname → ${dev.hostname}`))
    }
    if (dev.vendor && !prev.vendor) {
      events.push(makeEvent(dev.id, now, 'vendor', `Vendor identified: ${dev.vendor}`))
    }
    if (dev.kind !== 'unknown' && prev.kind === 'unknown') {
      events.push(makeEvent(dev.id, now, 'kind', `Classified as ${dev.kind}`))
    }
  }
  return events
}

// ─── Scan orchestration ─────────────────────────────────────

let _known: Map<string, { firstSeenAt: number }> = new Map()
let _previous: Map<string, NetworkDevice> = new Map()

async function getLocalInterface(): Promise<si.Systeminformation.NetworkInterfacesData | null> {
  try {
    const ifaces = await si.networkInterfaces()
    const usable = ifaces.filter((i) => !i.internal && i.operstate === 'up' && i.ip4 && i.mac && i.mac !== '00:00:00:00:00:00')
    const sorted = [...usable].sort((a, b) => (b.default === true ? 1 : 0) - (a.default === true ? 1 : 0))
    return sorted[0] ?? null
  } catch {
    return null
  }
}

function readDnsFromResolv(): { dnsServers: string[]; domain: string | null } {
  try {
    const dnsServers: string[] = []
    let domain: string | null = null
    for (const line of readFileSync('/etc/resolv.conf', 'utf-8').split(/\r?\n/)) {
      const parts = line.replace(/#.*$/, '').trim().split(/\s+/)
      if (parts[0] === 'nameserver' && parts[1]) dnsServers.push(parts[1])
      if ((parts[0] === 'search' || parts[0] === 'domain') && parts[1]) domain = parts[1]
    }
    return { dnsServers, domain }
  } catch {
    return { dnsServers: [], domain: null }
  }
}

async function getNetworkContext(ifaceName: string | null): Promise<NetworkContextInfo | null> {
  try {
    let router: string | null = null
    try { router = await si.networkGatewayDefault() } catch { /* ignore */ }
    let dnsServers: string[] = []
    let domain: string | null = null
    try {
      const { default: dns } = await import('node:dns')
      dnsServers = dns.getServers()?.filter(Boolean) ?? []
    } catch { /* ignore */ }
    const resolv = readDnsFromResolv()
    if (resolv.dnsServers.length > 0) dnsServers = resolv.dnsServers
    if (resolv.domain) domain = resolv.domain

    let dhcpServer: string | null = null
    if (ifaceName && process.platform === 'darwin') {
      try {
        const { stdout } = await execFileAsync('ipconfig', ['getoption', ifaceName, 'server_identifier'], { timeout: 3000, encoding: 'utf-8' })
        const v = stdout.trim()
        if (v && v.includes('.')) dhcpServer = v
      } catch { /* not available */ }
    }

    return {
      subnetMask: null,
      router,
      dnsServers,
      domain,
      dhcpServer,
    }
  } catch {
    return null
  }
}

async function runIcmpProbes(
  ips: string[],
  hostIps: Set<string>,
  opts: { limit?: number; concurrency?: number; waitMs?: number } = {},
): Promise<Map<string, number | null>> {
  const { limit = 60, concurrency = 12, waitMs = 1000 } = opts
  const targets = [...new Set(ips.filter((ip) => !hostIps.has(ip)))].slice(0, limit)
  const results = new Map<string, number | null>()
  const CONCURRENCY = concurrency
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const ip = targets[cursor++]!
      const { times } = await runPingBurst(ip, 1, waitMs)
      results.set(ip, times[0] ?? null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()))
  return results
}

/**
 * Actively ping every host in the local subnet. The point is not the replies —
 * it is that each ping performs an ARP exchange first, so even devices that
 * silently drop ICMP land in the kernel's ARP cache, which is the backbone of
 * the device list. Without this, a cold ARP cache shrinks the list to the
 * router and this machine. Bound to /23 and run at most once per interval.
 */
async function sweepSubnet(iface: si.Systeminformation.NetworkInterfacesData | null, hostIpv4: string[]): Promise<ArpEntry[]> {
  if (!iface?.ip4 || hostIpv4.length === 0) return []
  const prefix = cidrToPrefix(iface.ip4subnet ?? null)
  const targets = enumerateSubnet(hostIpv4[0]!, prefix)
  if (targets.length === 0) return []
  // Shorter wait and more workers than the known-device pass: this is a batch
  // discovery sweep over hundreds of mostly-absent addresses.
  await runIcmpProbes(targets, new Set(hostIpv4), { limit: MAX_SWEEP_HOSTS, concurrency: 48, waitMs: 700 })
  return (await readArpCache()).entries
}

/**
 * Best-effort PTR lookups for devices without a hostname. Bounded concurrency
 * and a per-IP timeout so a slow resolver can never stall a scan. Only useful
 * on networks whose DNS serves reverse records for LAN addresses.
 */
export async function resolveReverseDns(ips: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ips.filter((x): x is string => typeof x === 'string' && x.length > 0))]
  const results = new Map<string, string>()
  if (unique.length === 0) return results
  const reverseFn = await (async () => {
    try {
      return (await import('node:dns/promises')).reverse
    } catch {
      return null
    }
  })()
  if (!reverseFn) return results
  const reverse: (hostname: string, options?: unknown) => Promise<string[]> = reverseFn
  const CONCURRENCY = 8
  const TIMEOUT_MS = 1500
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const ip = unique[cursor++]!
      try {
        const name = await Promise.race([
          reverse(ip).catch(() => []),
          new Promise<string[]>((res) => setTimeout(() => res([]), TIMEOUT_MS)),
        ])
        const n = name[0]
        if (n) results.set(ip, n.endsWith('.') ? n.slice(0, -1) : n)
      } catch {
        // No reverse record — leave unnamed.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => worker()))
  return results
}

/**
 * Full LAN device snapshot. Providers run in parallel and merge into one record
 * per physical device. ICMP is the only outbound traffic the scan generates —
 * the subnet sweep is a batch of plain pings whose real purpose is refilling
 * the kernel's ARP cache, so devices that drop ICMP still appear.
 */
export async function scanDevices(): Promise<DevicesSnapshot> {
  const now = Date.now()

  const iface = await getLocalInterface()
  const hostIpv4 = iface?.ip4 ? [iface.ip4] : []
  const hostIpv6 = iface?.ip6 ? [iface.ip6] : []
  const hostMac = normalizeMac(iface?.mac ?? null)

  // The ARP cache is read before and after the sweep: the first read is cheap
  // and immediate, the sweep repopulates the kernel cache, and the second read
  // harvests whatever the pings surfaced. A sweep every ~60s keeps the cache
  // warm enough that the between-sweep scans stay complete without flooding the
  // LAN with probes.
  const [, arp, bonjour, ssdp, netbios, listenersRes, hostnameRes, ndp, sweptArp] = await Promise.all([
    Promise.resolve(iface),
    readArpCache(),
    bonjourDiscover(),
    ssdpDiscover(),
    netbiosDiscover(),
    collectLocalListeners(),
    si.osInfo(),
    readNdpCache(),
    now - lastSweepAt >= SWEEP_INTERVAL_MS
      ? sweepSubnet(iface, hostIpv4).then((entries) => {
          if (entries.length > 0) lastSweepAt = now
          return entries
        })
      : Promise.resolve([] as ArpEntry[]),
  ])

  const arpEntries = sweptArp.length > 0 ? sweptArp : arp.entries

  // IPv6 neighbours are keyed by MAC — the same physical radio the ARP cache
  // saw over IPv4, so the two views merge onto one device record.
  const ipv6ByMac = new Map<string, string[]>()
  for (const entry of ndp) {
    const mac = normalizeMac(entry.mac)
    if (!mac) continue
    const list = ipv6ByMac.get(mac) ?? []
    if (!list.includes(entry.ip6)) list.push(entry.ip6)
    ipv6ByMac.set(mac, list)
  }

  const icmp = await runIcmpProbes(
    [
      ...arpEntries.map((e) => e.ip),
      ...bonjour.entries.map((e) => e.ip).filter((x): x is string => Boolean(x)),
      ...ssdp.map((e) => e.ip),
      ...netbios.map((e) => e.ip),
    ],
    new Set(hostIpv4),
  )

  const ctx = await getNetworkContext(iface?.iface ?? null)
  if (ctx && iface?.ip4subnet !== undefined) ctx.subnetMask = String(iface.ip4subnet)

  const seen = mergeProviderResults({
    arp: arpEntries,
    bonjour: bonjour.entries,
    ssdp,
    netbios,
    hostMac,
    hostIpv4,
    hostHostname: hostnameRes?.hostname ?? null,
  })
  const tags = loadDeviceTags()
  const probes = loadDeviceProbes()
  const oui = loadOuiDb()

  const devices: NetworkDevice[] = []
  for (const s of seen.values()) {
    const online = s.seenThisRound || (icmp.get([...s.ipv4][0] ?? '') !== undefined && icmp.get([...s.ipv4][0] ?? '') !== null)
    const ipv4 = [...s.ipv4]
    const roles = computeRoles(ipv4, ctx)
    const vendor = usableVendor(s.mac && !isPrivateMac(s.mac) ? lookupVendor(s.mac, oui) : null)
    const kind = inferKind({ vendor, model: s.model, hostname: s.hostname, serviceTypes: s.services.map((sv) => sv.type), roles })
    const known = _known.get(s.id)
    if (!known) {
      _known.set(s.id, { firstSeenAt: now })
    }
    const firstSeenAt = known?.firstSeenAt ?? now
    const lastSeenAt = online ? now : (known?.firstSeenAt ?? now)

    // Link quality from the latest echo for the primary IPv4.
    let linkQuality: LinkQuality | null = null
    const primaryIp = ipv4[0]
    if (primaryIp && icmp.get(primaryIp) !== undefined) {
      linkQuality = sampleQualityRing(primaryIp, icmp.get(primaryIp) ?? null)
    }

    const probe = probes[s.id]
    const tag: DeviceTag | null = tags[s.id] ?? null

    devices.push({
      id: s.id,
      mac: s.mac,
      ipv4: ipv4.sort(),
      ipv6: s.mac ? (ipv6ByMac.get(s.mac) ?? []).slice(0, 4) : [],
      hostname: s.hostname,
      vendor,
      kind,
      model: s.model,
      services: s.services,
      roles,
      status: online ? 'online' : 'offline',
      isLocal: hostMac ? s.id === hostMac : hostIpv4.some((ip) => ipv4.includes(ip)),
      sources: [...s.sources] as NetworkDevice['sources'],
      firstSeenAt,
      lastSeenAt,
      linkQuality,
      tag,
      lastPorts: probe?.ports ?? [],
    })
  }

  const unnamedOnline = devices.filter((d) => !d.hostname && d.status === 'online')
  if (unnamedOnline.length > 0) {
    const names = await resolveReverseDns(unnamedOnline.map((d) => d.ipv4[0] ?? ''))
    for (const d of unnamedOnline) {
      const name = names.get(d.ipv4[0] ?? '')
      if (name) d.hostname = name
    }
  }

  devices.sort((a, b) => {
    if (a.isLocal) return -1
    if (b.isLocal) return 1
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1
    return (a.hostname ?? a.vendor ?? a.ipv4[0] ?? '').localeCompare(b.hostname ?? b.vendor ?? b.ipv4[0] ?? '')
  })

  const events = diffEvents(_previous, devices, now)
  if (events.length > 0) appendDeviceHistory(events)
  _previous = new Map(devices.map((d) => [d.id, d]))

  const host: DevicesHostInfo = {
    hostname: hostnameRes?.hostname ?? '',
    ipv4: hostIpv4,
    ipv6: hostIpv6,
    mac: hostMac,
    connectionType: iface?.type ?? null,
    ipCidr: iface?.ip4 ? `${iface.ip4} /${cidrToPrefix(iface.ip4subnet ?? null) ?? '?'}` : null,
  }

  return {
    devices,
    listeners: listenersRes.listeners,
    host,
    networkContext: ctx,
    providerStatus: [
      { provider: 'arp', ok: arp.ok, ...(arp.error ? { error: arp.error } : {}) },
      { provider: 'bonjour', ok: bonjour.ok, ...(bonjour.error ? { error: bonjour.error } : {}) },
      { provider: 'ssdp', ok: true },
      { provider: 'netbios', ok: true },
      { provider: 'icmp', ok: true },
    ],
    scannedAt: now,
    newEvents: events,
  }
}

/** One-shot reachability check for a single device (context-menu "Probe This Device"). */
export async function probeDevice(ip: string): Promise<{ ip: string; online: boolean; linkQuality: LinkQuality | null }> {
  const { times } = await runPingBurst(ip, 3)
  const online = times.length > 0
  const linkQuality = computeLinkQuality(times, 3)
  if (online) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    sampleQualityRing(ip, avg)
  } else {
    sampleQualityRing(ip, null)
  }
  return { ip, online, linkQuality }
}

/** Fresh burst for the link-quality panel ("Measure now"). */
export async function measureLinkQuality(ip: string, burst = 5): Promise<LinkQuality | null> {
  const { times } = await runPingBurst(ip, burst)
  const quality = computeLinkQuality(times, burst)
  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    sampleQualityRing(ip, avg)
  } else {
    sampleQualityRing(ip, null)
  }
  return quality
}
