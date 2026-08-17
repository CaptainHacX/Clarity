import * as si from 'systeminformation'
import { getPublicIp } from './public-ip'
import type {
  LocationAccessStatus,
  NetworkInterfaceInfo,
  NetworkSecurityStatus,
  NearbyWifiInfo,
  WifiConnectionInfo,
  WifiSecurityLevel,
} from '../../shared/types'

/**
 * Interface names used by VPNs and other point-to-point tunnels.
 *
 * A name match alone is *not* a VPN — see `isActiveVpnInterface`. macOS creates
 * `utun0`…`utun3` on essentially every Mac for iCloud Private Relay, Continuity
 * and AirDrop sidebands, so their existence said "VPN active" on a machine with
 * no VPN at all.
 */
const VPN_IFACE_RE = /^(utun|tun|tap|ppp|wg[0-9]*|ipsec|nordlynx|tailscale|zt)/i

/** IPv6 link-local. Assigned to an idle tunnel, so it proves nothing. */
const IPV6_LINK_LOCAL_RE = /^fe80:/i

/**
 * Does this interface hold an address that could actually carry traffic?
 *
 * `0.0.0.0` means up-but-unconfigured, and `fe80::` is auto-assigned to a
 * tunnel whether or not anything is using it. Either way there is no route.
 */
function hasRoutableAddress(iface: NetworkInterfaceInfo): boolean {
  const ip4 = iface.ip4?.trim()
  if (ip4 && ip4 !== '0.0.0.0') return true
  const ip6 = iface.ip6?.trim()
  if (ip6 && !IPV6_LINK_LOCAL_RE.test(ip6) && ip6 !== '::') return true
  return false
}

/**
 * Is this a tunnel that is genuinely up and carrying a VPN?
 *
 * Requires a tunnel-style name *and* a routable address: a VPN that is actually
 * connected has an address assigned inside the tunnel, while the dormant
 * `utun`s macOS keeps around have only a link-local IPv6. An interface the OS
 * reports as explicitly `down` is excluded regardless.
 *
 * Exported for tests.
 */
export function isActiveVpnInterface(iface: NetworkInterfaceInfo): boolean {
  if (!VPN_IFACE_RE.test(iface.iface)) return false
  if (iface.operstate && iface.operstate.toLowerCase() === 'down') return false
  return hasRoutableAddress(iface)
}

/**
 * Is this an RFC1918 / CGNAT / link-local IPv4 — i.e. not reachable from the
 * internet? Used to label the address honestly rather than calling a LAN
 * address "public". Exported for tests.
 */
export function isPrivateIpv4(ip: string | null | undefined): boolean {
  if (!ip) return false
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return false
  const [a, b] = parts.map((p) => Number.parseInt(p, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (a === 10) return true                      // 10.0.0.0/8
  if (a === 127) return true                     // loopback
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true        // 192.168.0.0/16
  if (a === 169 && b === 254) return true        // link-local
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  return false
}

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
/**
 * One deferred load of the CoreWLAN module, shared by everything here that needs
 * it.
 *
 * Deferred (rather than a top-level import) so this module stays unit-testable
 * outside Electron — CoreWLAN pulls in the native addon. Single call site so the
 * bundler reports one dynamic edge instead of one per consumer.
 */
function loadCoreWlan(): Promise<typeof import('./wifi/corewlan')> {
  return import('./wifi/corewlan')
}

export async function collectLocationAccess(): Promise<LocationAccessStatus> {
  if (process.platform !== 'darwin') return 'unknown'
  try {
    const {
      coreWlanScan,
      coreWlanLocationAuthStatus,
      coreWlanLocationServicesEnabled,
      locationAccessFromAuthStatus,
    } = await loadCoreWlan()

    // Authoritative when the native addon is loaded: CoreLocation's own answer
    // for this process, rather than a guess from its side effects. Guarded by a
    // typeof check so a build (or a test double) without these exports falls
    // through to the inference below instead of throwing.
    const status = typeof coreWlanLocationAuthStatus === 'function' ? coreWlanLocationAuthStatus() : null
    if (status != null) {
      const enabled =
        typeof coreWlanLocationServicesEnabled === 'function' ? coreWlanLocationServicesEnabled() : null
      if (enabled === false) return 'denied'
      if (typeof locationAccessFromAuthStatus === 'function') return locationAccessFromAuthStatus(status)
    }

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

/**
 * Fill in the connected network's SSID and BSSID from CoreWLAN on macOS.
 *
 * `si.wifiConnections()` reads `system_profiler`, which redacts both for a
 * process without Location access — so the panel showed "hidden" even once the
 * grant was in place. CoreWLAN in-process has the real values, and it is the
 * same source the Wi-Fi scanner uses, so the two views agree instead of
 * contradicting each other.
 *
 * Only fields that are actually missing get overwritten; a value
 * `system_profiler` did supply is left alone.
 */
async function enrichConnectedFromCoreWlan(
  connected: WifiConnectionInfo | null,
): Promise<WifiConnectionInfo | null> {
  if (process.platform !== 'darwin') return connected
  try {
    const { coreWlanScan } = await loadCoreWlan()
    const scan = await coreWlanScan(false)
    const current = scan.ok ? scan.current : null
    if (!current) return connected

    // CoreWLAN returns a `current` block whether or not the radio is associated;
    // every field is null when it isn't. An SSID or a BSSID is what actually
    // evidences an association, so without either there is no connection to
    // report and a disconnected machine must stay disconnected.
    const associated = current.ssid != null || current.bssid != null
    if (!associated) return connected

    // No connection row at all, but CoreWLAN sees an association: build one.
    const base: WifiConnectionInfo = connected ?? {
      ssid: null,
      ssidRedacted: false,
      bssid: null,
      band: null,
      signalDbm: null,
      signalPercent: null,
      channel: null,
      frequency: null,
      security: null,
      securityLevel: 'unknown',
      txRate: null,
      quality: null,
    }

    const ssid = current.ssid && !isRedactedSsid(current.ssid) ? current.ssid : base.ssid
    return {
      ...base,
      ssid,
      // Redaction is only still true if neither source produced a name.
      ssidRedacted: ssid == null ? base.ssidRedacted : false,
      bssid: base.bssid ?? current.bssid,
      signalDbm: base.signalDbm ?? current.rssi,
      signalPercent: base.signalPercent ?? toSignalPercent(current.rssi),
      channel: base.channel ?? current.channel,
      txRate: base.txRate ?? current.txRate,
    }
  } catch {
    return connected
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
  const connected = await enrichConnectedFromCoreWlan(mapConnection(connectionRaw))

  const nearbyNetworks: NearbyWifiInfo[] = nearby.status === 'fulfilled'
    ? nearby.value.map(mapNearby).filter((n) => n.ssid || n.bssid)
    : []

  // Only tunnels that actually carry an address count. Matching the name alone
  // reported "VPN active" on every Mac, because of the idle utun0-3 macOS keeps.
  const vpnIfaces = mappedIfaces.filter(isActiveVpnInterface)

  // Needs the local identity first, so a network change invalidates the cached
  // answer. Guarded rather than awaited bare: an unreachable internet must slow
  // this scan by the lookup's own short budget at most, and never fail it.
  const localIpv4 = pickPrimaryIp(mappedIfaces, true)
  const gatewayAddr = gateway.status === 'fulfilled' ? (gateway.value || null) : null
  let publicIp: NetworkSecurityStatus['publicIp'] = { address: null, state: 'unknown', checkedAt: null }
  try {
    publicIp = await getPublicIp(localIpv4, gatewayAddr)
  } catch {
    publicIp = { address: null, state: 'offline', checkedAt: Date.now() }
  }

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
    gateway: gatewayAddr,
    vpn: {
      detected: vpnIfaces.length > 0,
      interfaces: vpnIfaces.map((i) => i.iface),
    },
    ipv4: localIpv4,
    publicIp,
    ipv6: pickPrimaryIp(mappedIfaces, false),
    locationAccess: locationAccess.status === 'fulfilled' ? locationAccess.value : 'unknown',
  }
}
