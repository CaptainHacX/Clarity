/**
 * Device-list helpers shared between main and renderer. Kept dependency-free so
 * the renderer can use them for keying and display.
 */

/** Collapse any MAC string shape into lowercase `xx:xx:xx:xx:xx:xx` or null. */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null
  const hex = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (hex.length !== 12) return null
  return hex.match(/.{1,2}/g)!.join(':')
}

/**
 * Locally administered (randomized / "private") MAC address: the U/L bit of the
 * first octet is set. Phones and laptops use these per network for privacy.
 */
export function isPrivateMac(mac: string | null | undefined): boolean {
  const first = normalizeMac(mac)?.slice(0, 2)
  if (!first) return false
  return (parseInt(first, 16) & 0x02) !== 0
}

/** Stable device id: the MAC when available, otherwise the IP it was seen on. */
export function deviceId(mac: string | null | undefined, ipv4?: string | null | undefined): string {
  const m = normalizeMac(mac)
  if (m) return m
  return ipv4 ? `ip:${ipv4}` : `ip:${String(ipv4 ?? 'unknown')}`
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIpv4(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 15 && IPV4_RE.test(s)
}

const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/

export function isIpv6(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.length >= 2 && s.length <= 45 && IPV6_RE.test(s)
}

export function isPrivateIpv4(s: string | null | undefined): boolean {
  if (!isIpv4(s)) return false
  const octets = s.split('.').map(Number)
  if (octets[0] === 10) return true
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  if (octets[0] === 169 && octets[1] === 254) return true
  return false
}

/** Shortest reasonable label for a device used in search + row subtitle. */
export function primaryIpv4(addrs: readonly string[] | null | undefined): string | null {
  if (!addrs?.length) return null
  return addrs[0] ?? null
}

/**
 * DNS-SD service types → what the service actually is, in words. A device's
 * advertised types are the most reliable statement it makes about itself after
 * its model, and "AirPlay · Printing" reads to a human in a way
 * `_airplay._tcp` never will. Types not worth showing map to null.
 */
const SERVICE_NAMES: Record<string, string | null> = {
  '_airplay._tcp': 'AirPlay',
  '_raop._tcp': 'AirPlay audio',
  '_airtunes._tcp': 'AirPlay audio',
  '_airport._tcp': 'AirPort',
  '_ipp._tcp': 'Printing',
  '_ipps._tcp': 'Printing',
  '_printer._tcp': 'Printing',
  '_pdl-datastream._tcp': 'Printing',
  '_scanner._tcp': 'Scanning',
  '_uscan._tcp': 'Scanning',
  '_uscans._tcp': 'Scanning',
  '_smb._tcp': 'File sharing',
  '_afpovertcp._tcp': 'File sharing',
  '_nfs._tcp': 'File sharing',
  '_ftp._tcp': 'FTP',
  '_sftp-ssh._tcp': 'SFTP',
  '_ssh._tcp': 'SSH',
  '_rfb._tcp': 'Screen sharing',
  '_http._tcp': 'Web service',
  '_https._tcp': 'Web service',
  '_googlecast._tcp': 'Chromecast',
  '_cast._tcp': 'Chromecast',
  '_spotify-connect._tcp': 'Spotify Connect',
  '_homekit._tcp': 'HomeKit',
  '_hap._tcp': 'HomeKit',
  '_matter._tcp': 'Matter',
  '_matterc._udp': 'Matter',
  '_daap._tcp': 'Music sharing',
  '_dacp._tcp': 'Remote control',
  '_touch-able._tcp': 'Remote control',
  '_mediaremotetv._tcp': 'Apple TV remote',
  '_companion-link._tcp': 'Apple Continuity',
  '_rdlink._tcp': 'Apple Continuity',
  '_nvstream._tcp': 'NVIDIA GameStream',
  '_plexmediasvr._tcp': 'Plex',
  '_sonos._tcp': 'Sonos',
  '_amzn-wplay._tcp': 'Amazon device',
  '_esphomelib._tcp': 'ESPHome',
  '_hue._tcp': 'Philips Hue',
  '_workstation._tcp': null,
  '_device-info._tcp': null,
  '_sleep-proxy._udp': null,
  '_adisk._tcp': 'Time Machine',
  '_services._dns-sd._udp': null,
}

/** Plain-English names for a device's advertised services, de-duped, order preserved. */
export function serviceNames(types: readonly string[]): string[] {
  const out: string[] = []
  for (const type of types) {
    const name = SERVICE_NAMES[type]
    if (name === null) continue
    const label = name ?? type.replace(/^_/, '').replace(/\._(tcp|udp)$/, '')
    if (!out.includes(label)) out.push(label)
  }
  return out
}

export interface DeviceIdentityInput {
  vendor: string | null
  kind: string
  serviceTypes: readonly string[]
  mac?: string | null
}

/**
 * Netfox's one-line identity: *vendor · kind · services*, e.g.
 * "Apple · Speaker · AirPlay". It's what a device with no friendly name leads
 * with, so a row reads as something recognisable instead of a bare IP or the
 * word "Unknown".
 */
export function deviceIdentityLine(
  input: DeviceIdentityInput,
  kindLabels: Record<string, string> = {},
  privateAddressLabel = 'Private address',
): string | null {
  const parts: string[] = []
  if (input.vendor) parts.push(input.vendor)
  else if (isPrivateMac(input.mac)) parts.push(privateAddressLabel)
  const kindLabel = input.kind && input.kind !== 'unknown' ? (kindLabels[input.kind] ?? input.kind) : null
  if (kindLabel) parts.push(kindLabel)
  const services = serviceNames(input.serviceTypes).slice(0, 2)
  if (services.length) parts.push(services.join(' + '))
  return parts.length ? parts.join(' · ') : null
}

export interface DeviceLabelInput extends DeviceIdentityInput {
  tagName?: string | null
  hostname?: string | null
  ipv4?: readonly string[] | null
  model?: string | null
}

/**
 * The name a device leads with. A name the user gave it wins, then the one it
 * reports, then the identity line, then the model, and only then the address —
 * "Unknown device" is a last resort rather than the common case it used to be.
 */
export function deviceDisplayName(
  input: DeviceLabelInput,
  kindLabels: Record<string, string> = {},
  fallback = 'Unknown device',
): string {
  const tag = input.tagName?.trim()
  if (tag) return tag
  const hostname = input.hostname?.trim()
  if (hostname) return hostname
  const identity = deviceIdentityLine(input, kindLabels)
  if (identity) return identity
  if (input.model) return input.model
  const ip = primaryIpv4(input.ipv4)
  if (ip) return ip
  return fallback
}
