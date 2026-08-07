import type { WifiNetworkDetail, WifiSecurityLevel } from './types'

/**
 * Stable identity for a network across scans — used for signal-history buffers,
 * selection state and export payloads.
 *
 * The BSSID is the real identity, but macOS withholds it until Location
 * Services is granted, and a hidden AP has no SSID either. Falling back to
 * `ssid|channel` alone made every un-named AP on a fresh channel a brand new
 * row, so the list grew on every poll. Folding the band and the security tag
 * into the fallback makes it as stable as the beacon itself: two APs are the
 * same row only when the four things the radio *can* still see all agree.
 */
export function wifiNetworkKey(
  n: Pick<WifiNetworkDetail, 'bssid' | 'ssid' | 'channel'> & Partial<Pick<WifiNetworkDetail, 'band' | 'securityShort'>>,
): string {
  if (n.bssid) return n.bssid.toLowerCase()
  const name = n.ssid ? `ssid:${n.ssid}` : 'hidden'
  const channel = n.channel != null ? String(n.channel) : '?'
  const band = n.band ?? '?'
  const security = n.securityShort ?? '?'
  return `${name}|${channel}|${band}|${security}`
}

/** Four buckets Netfox colours the Wi-Fi glyph by: weak → excellent. */
export type WifiSignalBucket = 'excellent' | 'good' | 'fair' | 'weak' | 'unknown'

export function signalBucket(dbm: number | null | undefined): WifiSignalBucket {
  if (dbm == null || !Number.isFinite(dbm)) return 'unknown'
  if (dbm >= -55) return 'excellent'
  if (dbm >= -67) return 'good'
  if (dbm >= -78) return 'fair'
  return 'weak'
}

/** Derive the band label from a channel number when the radio didn't say. */
export function bandFromChannel(channel: number | null | undefined): string | null {
  if (channel == null || !Number.isFinite(channel)) return null
  if (channel >= 1 && channel <= 14) return '2.4 GHz'
  if (channel >= 32 && channel <= 177) return '5 GHz'
  if (channel >= 1 && channel <= 233) return '6 GHz'
  return null
}

/** Security strength bucket used for the lock glyph's colour. */
export function securityLevelFromShort(short: string | null | undefined): WifiSecurityLevel {
  if (!short) return 'unknown'
  const s = short.toUpperCase()
  if (s === 'OPEN' || s === 'NONE') return 'open'
  if (s === 'WEP' || s === 'WPA') return 'weak'
  if (s === 'WPA2' || s === 'WPA3' || s === 'OWE') return 'secured'
  return 'unknown'
}

/**
 * The subtitle Netfox puts under each row: short security + channel + band,
 * with the access-point maker appended when the SSID is hidden — that vendor
 * is the only thing telling three `Hidden network` rows apart.
 */
export function networkSubtitle(
  n: Pick<WifiNetworkDetail, 'securityShort' | 'channel' | 'band' | 'vendor' | 'isHidden'>,
  labels: { channel: string; open: string },
): string {
  const parts: string[] = []
  parts.push(n.securityShort ?? labels.open)
  if (n.channel != null) parts.push(n.band ? `${labels.channel} ${n.channel} (${n.band})` : `${labels.channel} ${n.channel}`)
  if (n.isHidden && n.vendor) parts.push(n.vendor)
  return parts.join(' · ')
}

/** 2.4 GHz channels that overlap the given one (each channel is 5 MHz apart, 20 MHz wide). */
export function overlapping24Channels(channel: number): number[] {
  const out: number[] = []
  for (let c = 1; c <= 14; c++) {
    if (c !== channel && Math.abs(c - channel) < 5) out.push(c)
  }
  return out
}
