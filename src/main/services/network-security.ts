import * as si from 'systeminformation'
import type {
  LocationAccessStatus,
  NetworkInterfaceInfo,
  NetworkSecurityStatus,
  NearbyWifiInfo,
  WifiConnectionInfo,
  WifiSecurityLevel,
} from '../../shared/types'

/**
 * Tunnel-style interfaces that indicate a VPN or other secure tunnel is up.
 * Matched by name so we never have to make an external call to decide.
 */
const VPN_IFACE_RE = /^(utun|tun|tap|ppp|wg[0-9]*|ipsec|nordlynx|tailscale|zero|utun[0-9]+)/i

/** Encryption strings we treat as too weak for a modern network. */
const WEAK_SECURITY_RE = /wep|open/i

/** Encodings where systeminformation reports "no security". */
const NO_SECURITY = ['open', 'none', '', '--']

/** Interface type strings systeminformation uses for wireless adapters. */
const WIRELESS_TYPES = new Set(['wifi', 'wireless'])

/** macOS redacts network names in system_profiler when the process lacks Location Services permission. */
const REDACTED_SSID_RE = /^<redacted>$|^\*\*\*$|^hidden$/i

export function isRedactedSsid(ssid: string | null | undefined): boolean {
  return !!ssid && REDACTED_SSID_RE.test(ssid)
}

/** Derive the Wi-Fi band (2.4/5/6 GHz) from a center frequency in MHz. */
export function bandFromFrequency(frequency: number | null | undefined): string | null {
  if (frequency == null || !Number.isFinite(frequency)) return null
  if (frequency >= 2400 && frequency < 2500) return '2.4 GHz'
  if (frequency >= 5000 && frequency < 5900) return '5 GHz'
  if (frequency >= 5900 && frequency < 7200) return '6 GHz'
  return null
}

export function classifySecurity(security: string | string[] | null | undefined): WifiSecurityLevel {
  const raw = Array.isArray(security) ? security.join(' ') : (security ?? '')
  const cleaned = raw.trim()
  if (!cleaned || NO_SECURITY.includes(cleaned.toLowerCase())) return 'open'
  if (WEAK_SECURITY_RE.test(cleaned)) return 'weak'
  return 'secured'
}

export function toSignalPercent(signalDbm: number | null | undefined): number | null {
  if (signalDbm == null || !Number.isFinite(signalDbm)) return null
  // Typical RSSI range: -30 (excellent) .. -90 (dead zone)
  const clamped = Math.max(-90, Math.min(-30, signalDbm))
  return Math.round(((clamped + 90) / 60) * 100)
}

/**
 * macOS Location Services state for this process.
 *
 * Electron has no API for it — `systemPreferences.getMediaAccessStatus` only
 * knows camera/microphone/screen, and asking it for `'location'` throws, which
 * is why this used to report `unknown` forever and the Wi-Fi tool's Grant
 * button did nothing. So the state is read from its only observable effect:
 * CoreWLAN hands out BSSIDs once the app is authorized and withholds them until
 * then. Resolved through a dynamic import so the module stays unit-testable
 * outside Electron.
 */
export async function collectLocationAccess(): Promise<LocationAccessStatus> {
  if (process.platform !== 'darwin') return 'unknown'
  try {
    const { coreWlanScan } = await import('./wifi/corewlan')
    const scan = await coreWlanScan(false)
    if (!scan.ok) return 'unknown'
    const anyBssid = scan.networks.some((n) => n.bssid) || scan.current?.bssid != null
    if (anyBssid) return 'granted'
    // No BSSID anywhere: either never asked or explicitly refused. The two are
    // indistinguishable from userland, and both mean "prompt, then offer
    // Settings", so they collapse to not-determined.
    return 'not-determined'
  } catch {
    return 'unknown'
  }
}

function classifyIfaceType(iface: string, type: string, virtual: boolean): NetworkInterfaceInfo['type'] {
  if (virtual || VPN_IFACE_RE.test(iface)) return 'virtual'
  if (WIRELESS_TYPES.has((type || '').toLowerCase())) return 'wireless'
  if ((type || '').toLowerCase() === 'ethernet') return 'ethernet'
  return 'unknown'
}

function mapConnection(raw: si.Systeminformation.WifiConnectionData | undefined | null): WifiConnectionInfo | null {
  if (!raw) return null
  const rawSsid = raw.ssid || null
  return {
    ssid: isRedactedSsid(rawSsid) ? null : rawSsid,
    ssidRedacted: isRedactedSsid(rawSsid),
    bssid: raw.bssid || null,
    band: bandFromFrequency(raw.frequency),
    signalDbm: typeof raw.signalLevel === 'number' ? raw.signalLevel : null,
    signalPercent: toSignalPercent(raw.signalLevel),
    channel: typeof raw.channel === 'number' ? raw.channel : null,
    frequency: typeof raw.frequency === 'number' ? raw.frequency : null,
    security: raw.security || null,
    securityLevel: classifySecurity(raw.security),
    txRate: typeof raw.txRate === 'number' ? raw.txRate : null,
    quality: typeof raw.quality === 'number' ? raw.quality : null,
  }
}

function mapNearby(raw: si.Systeminformation.WifiNetworkData): NearbyWifiInfo {
  const rawSsid = raw.ssid || null
  return {
    ssid: isRedactedSsid(rawSsid) ? null : rawSsid,
    ssidRedacted: isRedactedSsid(rawSsid),
    bssid: raw.bssid || '',
    band: bandFromFrequency(raw.frequency),
    channel: typeof raw.channel === 'number' ? raw.channel : null,
    frequency: typeof raw.frequency === 'number' ? raw.frequency : null,
    signalDbm: typeof raw.signalLevel === 'number' ? raw.signalLevel : null,
    quality: typeof raw.quality === 'number' ? raw.quality : null,
    security: Array.isArray(raw.security) ? raw.security.filter(Boolean) : [],
    securityLevel: classifySecurity(raw.security),
  }
}

function mapInterface(raw: si.Systeminformation.NetworkInterfacesData): NetworkInterfaceInfo {
  return {
    iface: raw.iface,
    ifaceName: raw.ifaceName || null,
    internal: !!raw.internal,
    virtual: !!raw.virtual,
    ip4: raw.ip4 || null,
    ip6: raw.ip6 || null,
    mac: raw.mac || null,
    type: classifyIfaceType(raw.iface, raw.type, !!raw.virtual),
    speed: typeof raw.speed === 'number' ? raw.speed : null,
    operstate: raw.operstate || null,
  }
}

function pickPrimaryIp(ifaces: NetworkInterfaceInfo[], v4: boolean): string | null {
  for (const i of ifaces) {
    if (i.internal || i.virtual || i.type === 'virtual') continue
    const ip = v4 ? i.ip4 : i.ip6
    if (ip && !ip.startsWith('fe80')) return ip
  }
  return null
}

/**
 * Collect the WiFi + network security posture of this machine. Best-effort:
 * every sub-read is individually guarded, so a missing WiFi adapter or a
 * failed interface query degrades gracefully instead of throwing.
 */
export async function collectNetworkSecurityStatus(): Promise<NetworkSecurityStatus> {
  const [connections, nearby, ifaces, gateway, locationAccess] = await Promise.allSettled([
    si.wifiConnections(),
    si.wifiNetworks(),
    si.networkInterfaces(),
    si.networkGatewayDefault(),
    collectLocationAccess(),
  ])

  const mappedIfaces: NetworkInterfaceInfo[] = ifaces.status === 'fulfilled'
    ? ifaces.value.map(mapInterface)
    : []

  const connectionRaw = connections.status === 'fulfilled' ? connections.value?.[0] : undefined
  const connected = mapConnection(connectionRaw)

  const nearbyNetworks: NearbyWifiInfo[] = nearby.status === 'fulfilled'
    ? nearby.value.map(mapNearby).filter((n) => n.ssid || n.bssid)
    : []

  const vpnIfaces = mappedIfaces.filter((i) => VPN_IFACE_RE.test(i.iface))

  let securitySummary: NetworkSecurityStatus['wifi']['securitySummary'] = 'none'
  if (connected) {
    securitySummary = connected.securityLevel
  }

  return {
    collectedAt: Date.now(),
    wifi: {
      connected,
      nearby: nearbyNetworks,
      securitySummary,
    },
    interfaces: mappedIfaces,
    gateway: gateway.status === 'fulfilled' ? (gateway.value || null) : null,
    vpn: {
      detected: vpnIfaces.length > 0,
      interfaces: vpnIfaces.map((i) => i.iface),
    },
    ipv4: pickPrimaryIp(mappedIfaces, true),
    ipv6: pickPrimaryIp(mappedIfaces, false),
    locationAccess: locationAccess.status === 'fulfilled' ? locationAccess.value : 'unknown',
  }
}
