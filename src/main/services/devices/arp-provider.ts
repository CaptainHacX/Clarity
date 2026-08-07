import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import { isIpv4 } from '../../../shared/devices'

const execFileAsync = promisify(execFile)

export interface ArpEntry {
  ip: string
  mac: string | null
  /** Linux: the kernel cache flags it reachable (vs stale). Darwin: assumed fresh. */
  reachable: boolean
  /** The name the resolver put in front of the address, when there was one. */
  hostname?: string | null
}

/**
 * Pad a BSD-style MAC into canonical form. `arp -a` on macOS prints octets
 * without leading zeros (`1:0:5e:0:0:fb`), which every naive `startsWith`
 * check then fails to recognise as multicast.
 */
export function canonicalMac(raw: string): string | null {
  const parts = raw.trim().toLowerCase().replace(/-/g, ':').split(':')
  if (parts.length !== 6) return null
  const out: string[] = []
  for (const p of parts) {
    if (!/^[0-9a-f]{1,2}$/.test(p)) return null
    out.push(p.padStart(2, '0'))
  }
  return out.join(':')
}

/**
 * Parse `arp -a` output (macOS/BSD and Windows).
 *
 * The BSD row is `<name-or-?> (<ip>) at <mac> on <iface> …`. The old pattern
 * insisted on `?` in the name slot, so every device whose address the resolver
 * *could* name — routers and anything with a DHCP-registered name, which is
 * most of a home network — was silently dropped from the device list. The name
 * is now captured instead: it is a free hostname for a device that advertises
 * nothing.
 */
export function parseArpOutput(stdout: string): ArpEntry[] {
  const entries: ArpEntry[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*(\S+)?\s*\(([0-9.]+)\)\s+at\s+(\(incomplete\)|[0-9a-fA-F:-]{5,})/)
    if (!m) {
      // Windows: `  192.168.1.1    aa-bb-cc-dd-ee-ff   dynamic`
      const w = line.match(/^\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s+([0-9a-fA-F-]{11,})\s+\S+\s*$/)
      if (w) {
        const ip = w[1]
        const mac = canonicalMac(w[2])
        if (isIpv4(ip) && mac) entries.push({ ip, mac, reachable: true, hostname: null })
      }
      continue
    }
    const rawName = m[1]
    const ip = m[2]
    if (!isIpv4(ip)) continue
    const hostname = rawName && rawName !== '?' && rawName !== '(?)' ? rawName : null
    if (m[3] === '(incomplete)') {
      entries.push({ ip, mac: null, reachable: false, hostname })
    } else {
      entries.push({ ip, mac: canonicalMac(m[3]!), reachable: true, hostname })
    }
  }
  return entries
}

/** Parse Linux /proc/net/arp (no subprocess needed). */
export function parseProcNetArp(text: string): ArpEntry[] {
  const entries: ArpEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s+0x1\s+0x([0-9a-fA-F])\s+([0-9a-fA-F:]{8,}|00:00:00:00:00:00)\s+\*\s+\S+$/)
    if (!m) continue
    const ip = m[1]
    if (!isIpv4(ip)) continue
    const mac = m[3]!.toLowerCase()
    entries.push({
      ip,
      mac: mac === '00:00:00:00:00:00' ? null : mac,
      reachable: (parseInt(m[2]!, 16) & 0x02) !== 0,
    })
  }
  return entries
}

export interface ArpProviderResult {
  entries: ArpEntry[]
  ok: boolean
  error?: string
}

/**
 * Multicast and broadcast rows are the ARP cache talking about groups, not
 * devices. `239.255.255.250` (SSDP) and `224.0.0.251` (mDNS) are the two that
 * always show up; both would otherwise render as anonymous devices nobody owns.
 */
export function isGroupAddress(ip: string, mac: string | null): boolean {
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return true
  const firstOctet = Number(ip.split('.')[0])
  if (Number.isFinite(firstOctet) && firstOctet >= 224) return true
  if (!mac) return false
  if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') return true
  // The low bit of a MAC's first octet marks a group (multicast) address.
  const first = Number.parseInt(mac.slice(0, 2), 16)
  return Number.isFinite(first) && (first & 0x01) !== 0
}

export interface NdpEntry {
  ip6: string
  mac: string
}

/**
 * Parse the IPv6 neighbour cache — `ndp -an` on macOS, `ip -6 neigh` on Linux.
 * Both are read-only views of what the kernel already learned, so neither
 * generates traffic. Link-local `fe80::` addresses are kept out: every device
 * has one, and it says nothing a MAC address doesn't already say.
 */
export function parseNdpOutput(stdout: string): NdpEntry[] {
  const entries: NdpEntry[] = []
  for (const line of stdout.split(/\r?\n/)) {
    // macOS: "2001:db8::1%en0    a4:83:e7:11:22:33   en0 23h59m0s S  R"
    // Linux: "2001:db8::1 dev wlan0 lladdr a4:83:e7:11:22:33 REACHABLE"
    const mac = /\b([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})\b/.exec(line)
    if (!mac) continue
    const addr = /^\s*([0-9a-fA-F:]{3,}(?:%[\w.]+)?)/.exec(line)
    if (!addr) continue
    const ip6 = addr[1].split('%')[0]!.toLowerCase()
    if (!ip6.includes(':')) continue
    if (ip6.startsWith('fe80') || ip6.startsWith('ff0')) continue
    entries.push({ ip6, mac: mac[1].toLowerCase() })
  }
  return entries
}

/** Read the IPv6 neighbour cache. Never throws; an empty list is a fine answer. */
export async function readNdpCache(): Promise<NdpEntry[]> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('ip', ['-6', 'neigh', 'show'], { timeout: 5000, encoding: 'utf-8' })
      return parseNdpOutput(stdout)
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/sbin/ndp', ['-an'], { timeout: 5000, encoding: 'utf-8' })
      return parseNdpOutput(stdout)
    }
    return []
  } catch {
    return []
  }
}

/** Read the system ARP cache. Never throws; degrades to ok:false with an error. */
export async function readArpCache(): Promise<ArpProviderResult> {
  try {
    if (process.platform === 'linux') {
      const text = readFileSync('/proc/net/arp', 'utf-8')
      const entries = parseProcNetArp(text).filter((e) => !isGroupAddress(e.ip, e.mac))
      return { entries, ok: true }
    }
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 5000, encoding: 'utf-8' })
    const entries = parseArpOutput(stdout).filter((e) => !isGroupAddress(e.ip, e.mac))
    return { entries, ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'arp failed'
    return { entries: [], ok: false, error: msg.slice(0, 200) }
  }
}
