import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import * as si from 'systeminformation'
import type {
  LocationAccessStatus,
  WifiNetworkDetail,
  WifiScanSnapshot,
  WifiNetworkType,
} from '../../shared/types'
import { bandFromChannel, securityLevelFromShort, wifiNetworkKey } from '../../shared/wifi'
import { bandFromFrequency, classifySecurity, isRedactedSsid, toSignalPercent } from './network-security'
import {
  bandLabelFromCode,
  coreWlanScan,
  frequencyFromChannel,
  phyModesFromCodes,
  securityFromCodes,
  widthFromCode,
  type CoreWlanScan,
  type RawCoreWlanNetwork,
} from './wifi/corewlan'
import { linuxWifiScan, type LinuxWifiNetwork } from './wifi/linux-wifi'
import { readConnectedAirportRecord, type ScutilAirportRecord } from './wifi/scutil-airport'

const execFileAsync = promisify(execFile)

// ─── OUI / AP-vendor lookup ─────────────────────────────────
let _oui: Record<string, string> | null = null
let _ouiPath: string | null = null

/**
 * Path to the IEEE OUI registry shipped as a packaged resource. Overridable via
 * CLARITY_OUI_PATH (used by tests).
 */
export function getOuiPath(): string {
  const override = process.env.CLARITY_OUI_PATH
  if (override) return override
  return app.isPackaged
    ? join(process.resourcesPath, 'oui.json')
    : join(app.getAppPath(), 'resources', 'oui.json')
}

/** Load the OUI registry (lowercase 6-hex OUI -> organization). Never throws. */
export function loadOuiDb(path: string = getOuiPath()): Record<string, string> {
  if (_oui && _ouiPath === path) return _oui
  let db: Record<string, string> = {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') db[k.toLowerCase()] = v
      }
    }
  } catch {
    db = {}
  }
  _oui = db
  _ouiPath = path
  return db
}

/** Extract the 24-bit OUI (lowercase hex) from any MAC-string shape. */
export function normalizeOui(mac: string | null | undefined): string | null {
  if (!mac) return null
  const hex = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  return hex.length >= 6 ? hex.slice(0, 6) : null
}

/** Look up the AP manufacturer for a BSSID, or null when unknown/unregistered. */
export function lookupVendor(bssid: string | null | undefined, db: Record<string, string> = loadOuiDb()): string | null {
  const oui = normalizeOui(bssid)
  return oui ? (db[oui] ?? null) : null
}

// ─── system_profiler (macOS) parsing ────────────────────────
export interface ParsedProfilerChannel {
  channel: number | null
  band: string | null
  channelWidthMhz: number | null
}

export interface ParsedProfilerNetwork {
  ssid: string | null
  channel: number | null
  band: string | null
  channelWidthMhz: number | null
  phyModes: string[]
  networkType: WifiNetworkType
  security: string | null
  signalDbm: number | null
  noiseDbm: number | null
}

export interface ParsedProfilerWifi {
  current: (ParsedProfilerNetwork & { countryCode: string | null }) | null
  nearby: ParsedProfilerNetwork[]
}

/**
 * Parse a macOS `system_profiler SPAirPortDataType -json` channel string like
 * "44 (5GHz, 80MHz)", "36 (5GHz)" or a bare "6".
 */
export function parseProfilerChannel(channel: string | null | undefined): ParsedProfilerChannel {
  if (!channel) return { channel: null, band: null, channelWidthMhz: null }
  const m = /^\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(channel)
  const num = m?.[1] ? Number(m[1]) : null
  if (num == null || !Number.isFinite(num)) return { channel: null, band: null, channelWidthMhz: null }
  let band: string | null = null
  let width: number | null = null
  if (m?.[2]) {
    const bandMatch = /(\d+)\s*ghz/i.exec(m[2])
    if (bandMatch) band = `${bandMatch[1]} GHz`
    const widthMatch = /(\d+)\s*mhz/i.exec(m[2])
    if (widthMatch) width = Number(widthMatch[1])
  }
  if (!band) band = bandFromChannelNumber(num)
  return { channel: num, band, channelWidthMhz: width }
}

function bandFromChannelNumber(channel: number): string | null {
  if (channel >= 1 && channel <= 14) return '2.4 GHz'
  return null
}

/** Parse "signal / noise" pairs like "-70 dBm / -91 dBm". */
export function parseSignalNoise(raw: string | null | undefined): { signalDbm: number | null; noiseDbm: number | null } {
  if (!raw) return { signalDbm: null, noiseDbm: null }
  const m = /(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/i.exec(raw.trim())
  if (!m) return { signalDbm: null, noiseDbm: null }
  return { signalDbm: Number(m[1]), noiseDbm: Number(m[2]) }
}

/** "802.11a/n/ac" -> ['802.11a', '802.11n', '802.11ac'] (lowercase, de-duped). */
export function phyModesFromString(mode: string | null | undefined): string[] {
  if (!mode) return []
  const seen: string[] = []
  for (const tok of mode.split(/[/\s]+/)) {
    if (!tok) continue
    const name = /^802\.11/i.test(tok) ? tok.toLowerCase() : `802.11${tok.toLowerCase()}`
    if (!/^802\.11[a-z]+$/.test(name)) continue
    if (!seen.includes(name)) seen.push(name)
  }
  return seen
}

/** spairport_security_mode_wpa2_personal -> "WPA2 Personal". */
export function profilerSecurityToLabel(mode: string | null | undefined): string | null {
  if (!mode) return null
  const suffix = mode.replace(/^spairport_security_mode_/, '')
  if (!suffix) return null
  if (suffix === 'open') return 'Open'
  if (suffix === 'wep') return 'WEP'
  return suffix
    .split('_')
    .map((tok) => (/^wpa\d*$/i.test(tok) ? tok.toUpperCase() : tok.charAt(0).toUpperCase() + tok.slice(1)))
    .join(' ')
}

/** spairport_network_type_station -> 'infrastructure'; *_ibss -> 'adhoc'. */
export function networkTypeFromProfiler(type: string | null | undefined): WifiNetworkType {
  if (!type) return 'unknown'
  if (/station|managed|infrastructure/i.test(type)) return 'infrastructure'
  if (/ibss|ad-?hoc/i.test(type)) return 'adhoc'
  return 'unknown'
}

/** Parse the JSON document emitted by `system_profiler SPAirPortDataType -json`. */
export function parseProfilerWifi(json: unknown): ParsedProfilerWifi {
  const empty: ParsedProfilerWifi = { current: null, nearby: [] }
  if (!json || typeof json !== 'object') return empty
  const top = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined
  const block = (top?.['SPAirPortDataType'] as Array<Record<string, unknown>> | undefined)?.[0]
  if (!block) return empty
  const ifaces = block.spairport_airport_interfaces
  const list = Array.isArray(ifaces) ? (ifaces as Array<Record<string, unknown>>) : []
  // awdl0 (AirDrop) also shows up as an interface and never carries a network;
  // take the first one that actually reports a current or nearby network.
  const first =
    list.find((i) => i?.spairport_current_network_information || i?.spairport_airport_other_local_wireless_networks) ??
    list[0] ??
    (ifaces as Record<string, unknown> | undefined)
  if (!first || typeof first !== 'object') return empty

  const cur = first.spairport_current_network_information as Record<string, unknown> | undefined
  const nearbyRaw = Array.isArray(first.spairport_airport_other_local_wireless_networks)
    ? (first.spairport_airport_other_local_wireless_networks as Array<Record<string, unknown>>)
    : []

  const mapNetwork = (raw: Record<string, unknown> | undefined): ParsedProfilerNetwork => {
    const ch = parseProfilerChannel(raw?.spairport_network_channel as string | undefined)
    const sig = parseSignalNoise(raw?.spairport_signal_noise as string | undefined)
    return {
      ssid: typeof raw?._name === 'string' ? raw._name : null,
      channel: ch.channel,
      band: ch.band,
      channelWidthMhz: ch.channelWidthMhz,
      phyModes: phyModesFromString(raw?.spairport_network_phymode as string | undefined),
      networkType: networkTypeFromProfiler(raw?.spairport_network_type as string | undefined),
      security: profilerSecurityToLabel(raw?.spairport_security_mode as string | undefined),
      signalDbm: sig.signalDbm,
      noiseDbm: sig.noiseDbm,
    }
  }

  const current = mapNetwork(cur)
  const country = typeof cur?.spairport_network_country_code === 'string' && cur.spairport_network_country_code
    ? (cur.spairport_network_country_code as string)
    : null

  return {
    current: cur ? { ...current, countryCode: country } : null,
    nearby: nearbyRaw.map(mapNetwork).filter((n) => n.ssid != null || n.channel != null),
  }
}

async function loadSystemProfilerWifi(): Promise<ParsedProfilerWifi | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPAirPortDataType', '-json'], {
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return parseProfilerWifi(JSON.parse(stdout))
  } catch {
    return null
  }
}

// ─── Shared assembly helpers ────────────────────────────────

function emptyNetwork(): WifiNetworkDetail {
  return {
    ssid: null,
    ssidRedacted: false,
    isHidden: false,
    bssid: null,
    vendor: null,
    channel: null,
    band: null,
    channelWidthMhz: null,
    frequency: null,
    security: [],
    securityLabel: null,
    securityShort: null,
    securityLevel: 'unknown',
    countryCode: null,
    beaconIntervalMs: null,
    networkType: 'unknown',
    phyModes: [],
    signalDbm: null,
    signalPercent: null,
    noiseDbm: null,
    snrDbm: null,
    txRateMbps: null,
    isConnected: false,
    lastSeen: 0,
  }
}

/** Sort networks strongest-signal first; null-signal networks sort last by name. */
export function sortNetworksBySignal(networks: WifiNetworkDetail[]): WifiNetworkDetail[] {
  return [...networks].sort((a, b) => {
    const aS = a.signalDbm ?? -Infinity
    const bS = b.signalDbm ?? -Infinity
    if (aS !== bS) return bS - aS
    return (a.ssid ?? '').localeCompare(b.ssid ?? '')
  })
}

/**
 * Collapse rows that resolve to the same physical radio. Prefers the connected
 * entry, then the stronger signal, then the row carrying more detail — so a
 * cached read never overwrites a richer active-scan row with nulls.
 */
export function dedupeNetworks(networks: WifiNetworkDetail[]): WifiNetworkDetail[] {
  const byKey = new Map<string, WifiNetworkDetail>()
  for (const n of networks) {
    const key = wifiNetworkKey(n)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, n)
      continue
    }
    if (n.isConnected && !prev.isConnected) {
      byKey.set(key, n)
      continue
    }
    if (prev.isConnected && !n.isConnected) continue
    const cur = n.signalDbm ?? -Infinity
    const old = prev.signalDbm ?? -Infinity
    if (cur > old) byKey.set(key, n)
  }
  return [...byKey.values()]
}

function finalize(n: WifiNetworkDetail, now: number): WifiNetworkDetail {
  const snr = n.signalDbm != null && n.noiseDbm != null ? n.signalDbm - n.noiseDbm : null
  return {
    ...n,
    band: n.band ?? bandFromFrequency(n.frequency) ?? bandFromChannel(n.channel),
    signalPercent: n.signalPercent ?? toSignalPercent(n.signalDbm),
    snrDbm: snr,
    isHidden: n.isHidden || (n.ssid == null && !n.ssidRedacted),
    lastSeen: n.lastSeen || now,
  }
}

function emptySnapshot(now: number, patch: Partial<WifiScanSnapshot> = {}): WifiScanSnapshot {
  return {
    collectedAt: now,
    connectedBssid: null,
    networks: [],
    interfaceName: null,
    supported: true,
    powerOn: true,
    active: false,
    locationAccess: 'unknown',
    bssidHidden: false,
    countryCode: null,
    error: null,
    ...patch,
  }
}

// ─── macOS (CoreWLAN) ───────────────────────────────────────

function mapCoreWlanNetwork(raw: RawCoreWlanNetwork, oui: Record<string, string>, now: number): WifiNetworkDetail {
  const security = securityFromCodes(raw.securityCodes)
  const ssid = raw.ssid && !isRedactedSsid(raw.ssid) ? raw.ssid : null
  return finalize(
    {
      ...emptyNetwork(),
      ssid,
      ssidRedacted: isRedactedSsid(raw.ssid),
      isHidden: ssid == null,
      bssid: raw.bssid ? raw.bssid.toLowerCase() : null,
      vendor: lookupVendor(raw.bssid, oui),
      channel: raw.channel,
      band: bandLabelFromCode(raw.bandCode),
      channelWidthMhz: widthFromCode(raw.widthCode),
      frequency: frequencyFromChannel(raw.channel, raw.bandCode),
      security: security.label ? [security.label] : [],
      securityLabel: security.label,
      securityShort: security.short,
      securityLevel: securityLevelFromShort(security.short),
      countryCode: raw.countryCode,
      beaconIntervalMs: raw.beaconInterval,
      networkType: raw.ibss ? 'adhoc' : 'infrastructure',
      phyModes: phyModesFromCodes(raw.phyCodes),
      signalDbm: raw.rssi,
      noiseDbm: raw.noise,
      lastSeen: now,
    },
    now,
  )
}

/**
 * Pick the scanned row that is the network we're joined to. With Location
 * granted the BSSID (or SSID) matches outright; without it, CoreWLAN withholds
 * both on the *interface* while still naming the neighbours, so the match falls
 * back to the operating channel and, when several APs share it, the one whose
 * RSSI is closest to what the radio reports for the live link.
 */
export function matchConnectedIndex(
  networks: WifiNetworkDetail[],
  current: { ssid: string | null; bssid: string | null; channel: number | null; rssi: number | null } | null,
): number {
  if (!current) return -1
  if (current.bssid) {
    const byBssid = networks.findIndex((n) => n.bssid && n.bssid === current.bssid!.toLowerCase())
    if (byBssid >= 0) return byBssid
  }
  if (current.ssid) {
    const sameSsid = networks
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.ssid === current.ssid)
    if (sameSsid.length === 1) return sameSsid[0].i
    if (sameSsid.length > 1) {
      const onChannel = sameSsid.filter(({ n }) => current.channel != null && n.channel === current.channel)
      const pool = onChannel.length > 0 ? onChannel : sameSsid
      return pool.reduce((best, cand) => {
        const bd = Math.abs((best.n.signalDbm ?? -999) - (current.rssi ?? -999))
        const cd = Math.abs((cand.n.signalDbm ?? -999) - (current.rssi ?? -999))
        return cd < bd ? cand : best
      }).i
    }
  }
  if (current.channel != null) {
    const onChannel = networks.map((n, i) => ({ n, i })).filter(({ n }) => n.channel === current.channel)
    if (onChannel.length === 1) return onChannel[0].i
    if (onChannel.length > 1 && current.rssi != null) {
      return onChannel.reduce((best, cand) => {
        const bd = Math.abs((best.n.signalDbm ?? -999) - current.rssi!)
        const cd = Math.abs((cand.n.signalDbm ?? -999) - current.rssi!)
        return cd < bd ? cand : best
      }).i
    }
  }
  return -1
}

export function buildDarwinSnapshot(
  scan: CoreWlanScan,
  profiler: ParsedProfilerWifi | null,
  now: number,
  oui: Record<string, string> = loadOuiDb(),
  joined: ScutilAirportRecord | null = null,
): WifiScanSnapshot {
  const networks = scan.networks.map((raw) => mapCoreWlanNetwork(raw, oui, now))
  // The driver's own record of the joined network is the one place macOS does
  // not redact the SSID or BSSID, so it outranks the interface reading for
  // identity while the interface still owns the live signal numbers.
  const cur = scan.current
    ? {
        ...scan.current,
        ssid: scan.current.ssid ?? joined?.ssid ?? null,
        bssid: scan.current.bssid ?? joined?.bssid ?? null,
        channel: scan.current.channel ?? joined?.channel ?? null,
        rssi: scan.current.rssi ?? joined?.rssi ?? null,
        noise: scan.current.noise ?? joined?.noise ?? null,
        countryCode: scan.current.countryCode ?? joined?.countryCode ?? null,
      }
    : joined
      ? {
          ssid: joined.ssid,
          bssid: joined.bssid,
          rssi: joined.rssi,
          noise: joined.noise,
          txRate: null,
          securityCode: null,
          phyCode: null,
          countryCode: joined.countryCode,
          channel: joined.channel,
          bandCode: null,
          widthCode: null,
          mode: 1,
        }
      : null
  const regulatoryCountry = cur?.countryCode ?? profiler?.current?.countryCode ?? null

  if (cur && (cur.rssi != null || cur.channel != null)) {
    const idx = matchConnectedIndex(networks, {
      ssid: cur.ssid,
      bssid: cur.bssid,
      channel: cur.channel,
      rssi: cur.rssi,
    })
    if (idx >= 0) {
      const security = cur.securityCode != null ? securityFromCodes([cur.securityCode]) : { label: null, short: null }
      const bssid = networks[idx].bssid ?? cur.bssid?.toLowerCase() ?? null
      networks[idx] = finalize(
        {
          ...networks[idx],
          isConnected: true,
          // A BSSID from the driver record means the connected AP's address is
          // readable even while CoreWLAN is withholding the neighbours'.
          bssid,
          vendor: networks[idx].vendor ?? lookupVendor(bssid, oui),
          ssid: networks[idx].ssid ?? cur.ssid,
          isHidden: networks[idx].ssid == null && cur.ssid == null,
          signalDbm: cur.rssi ?? networks[idx].signalDbm,
          noiseDbm: cur.noise ?? networks[idx].noiseDbm,
          signalPercent: null,
          txRateMbps: cur.txRate,
          countryCode: networks[idx].countryCode ?? regulatoryCountry,
          channelWidthMhz: networks[idx].channelWidthMhz ?? widthFromCode(cur.widthCode),
          beaconIntervalMs: networks[idx].beaconIntervalMs ?? joined?.beaconIntervalMs ?? null,
          securityLabel: networks[idx].securityLabel ?? security.label,
          securityShort: networks[idx].securityShort ?? security.short,
          networkType: cur.mode === 2 ? 'adhoc' : 'infrastructure',
        },
        now,
      )
    } else if (cur.channel != null) {
      // Joined to a network the neighbour list didn't return (rare — usually a
      // hidden AP). Show it anyway rather than pretending we're not connected.
      const security = cur.securityCode != null ? securityFromCodes([cur.securityCode]) : { label: null, short: null }
      networks.push(
        finalize(
          {
            ...emptyNetwork(),
            ssid: cur.ssid && !isRedactedSsid(cur.ssid) ? cur.ssid : null,
            ssidRedacted: isRedactedSsid(cur.ssid),
            isHidden: !cur.ssid || isRedactedSsid(cur.ssid),
            bssid: cur.bssid ? cur.bssid.toLowerCase() : null,
            vendor: lookupVendor(cur.bssid, oui),
            channel: cur.channel,
            band: bandLabelFromCode(cur.bandCode),
            channelWidthMhz: widthFromCode(cur.widthCode),
            frequency: frequencyFromChannel(cur.channel, cur.bandCode),
            security: security.label ? [security.label] : [],
            securityLabel: security.label,
            securityShort: security.short,
            securityLevel: securityLevelFromShort(security.short),
            countryCode: regulatoryCountry,
            networkType: cur.mode === 2 ? 'adhoc' : 'infrastructure',
            phyModes: cur.phyCode != null ? phyModesFromCodes([cur.phyCode]) : [],
            beaconIntervalMs: joined?.beaconIntervalMs ?? null,
            signalDbm: cur.rssi,
            noiseDbm: cur.noise,
            txRateMbps: cur.txRate,
            isConnected: true,
            lastSeen: now,
          },
          now,
        ),
      )
    }
  }

  // The regulatory domain applies to every AP the radio can hear, so use it
  // wherever the beacon itself didn't carry a country IE.
  const withCountry = regulatoryCountry
    ? networks.map((n) => (n.countryCode ? n : { ...n, countryCode: regulatoryCountry }))
    : networks

  const deduped = sortNetworksBySignal(dedupeNetworks(withCountry))
  // "Hidden" here means the *neighbour* addresses are withheld: the connected
  // AP's own BSSID comes from the driver record whether or not Location was
  // granted, so it must not count as evidence that the permission is in place.
  const others = deduped.filter((n) => !n.isConnected)
  const bssidHidden = others.length > 0 && others.every((n) => n.bssid == null)
  const connected = deduped.find((n) => n.isConnected) ?? null

  return emptySnapshot(now, {
    connectedBssid: connected?.bssid ?? null,
    networks: deduped,
    interfaceName: scan.interfaceName,
    supported: scan.interfaceName != null,
    powerOn: scan.powerOn,
    active: scan.active,
    locationAccess: bssidHidden ? 'not-determined' : 'granted',
    bssidHidden,
    countryCode: regulatoryCountry,
    error: scan.ok ? null : scan.error,
  })
}

// ─── Linux ──────────────────────────────────────────────────

function mapLinuxNetwork(raw: LinuxWifiNetwork, oui: Record<string, string>, now: number): WifiNetworkDetail {
  return finalize(
    {
      ...emptyNetwork(),
      ssid: raw.ssid,
      ssidRedacted: false,
      isHidden: raw.ssid == null,
      bssid: raw.bssid,
      vendor: lookupVendor(raw.bssid, oui),
      channel: raw.channel,
      band: bandFromFrequency(raw.frequency) ?? bandFromChannel(raw.channel),
      channelWidthMhz: raw.channelWidthMhz,
      frequency: raw.frequency,
      security: raw.securityLabel ? [raw.securityLabel] : [],
      securityLabel: raw.securityLabel,
      securityShort: raw.securityShort,
      securityLevel: securityLevelFromShort(raw.securityShort),
      countryCode: raw.countryCode,
      beaconIntervalMs: raw.beaconIntervalMs,
      networkType: raw.mode,
      phyModes: raw.phyModes,
      signalDbm: raw.signalDbm,
      signalPercent: raw.signalPercent,
      noiseDbm: raw.noiseDbm,
      txRateMbps: raw.isConnected ? raw.rateMbps : null,
      isConnected: raw.isConnected,
      lastSeen: now,
    },
    now,
  )
}

export function buildLinuxSnapshot(
  scan: { ok: boolean; interfaceName: string | null; networks: LinuxWifiNetwork[]; error: string | null },
  now: number,
  active: boolean,
  oui: Record<string, string> = loadOuiDb(),
): WifiScanSnapshot {
  const networks = sortNetworksBySignal(dedupeNetworks(scan.networks.map((n) => mapLinuxNetwork(n, oui, now))))
  const connected = networks.find((n) => n.isConnected) ?? null
  return emptySnapshot(now, {
    connectedBssid: connected?.bssid ?? null,
    networks,
    interfaceName: scan.interfaceName,
    supported: scan.interfaceName != null || networks.length > 0,
    powerOn: true,
    active,
    // Linux never gates SSIDs behind a location permission.
    locationAccess: 'granted',
    bssidHidden: networks.length > 0 && networks.every((n) => n.bssid == null),
    countryCode: networks.find((n) => n.countryCode)?.countryCode ?? null,
    error: scan.ok ? null : scan.error,
  })
}

// ─── systeminformation fallback (Windows, and any platform whose
//     native path failed) ───────────────────────────────────

function mapSiNetwork(
  raw: si.Systeminformation.WifiNetworkData,
  profilerMatch: ParsedProfilerNetwork | undefined,
  oui: Record<string, string>,
  now: number,
): WifiNetworkDetail {
  const rawSsid = raw.ssid || null
  const securityArr = profilerMatch?.security
    ? [profilerMatch.security]
    : Array.isArray(raw.security)
      ? raw.security.filter(Boolean)
      : []
  const label = securityArr[0] ?? null
  const short = label ? (/^(WPA3|WPA2|WPA|WEP|OWE|Open)/i.exec(label)?.[1] ?? label) : null
  return finalize(
    {
      ...emptyNetwork(),
      ssid: isRedactedSsid(rawSsid) ? null : rawSsid,
      ssidRedacted: isRedactedSsid(rawSsid),
      isHidden: !rawSsid,
      bssid: raw.bssid ? raw.bssid.toLowerCase() : null,
      vendor: lookupVendor(raw.bssid || null, oui),
      channel: profilerMatch?.channel ?? (typeof raw.channel === 'number' ? raw.channel : null),
      band: profilerMatch?.band ?? bandFromFrequency(raw.frequency),
      channelWidthMhz: profilerMatch?.channelWidthMhz ?? null,
      frequency: typeof raw.frequency === 'number' ? raw.frequency : null,
      security: securityArr,
      securityLabel: label,
      securityShort: short,
      securityLevel: classifySecurity(securityArr),
      networkType:
        profilerMatch?.networkType && profilerMatch.networkType !== 'unknown' ? profilerMatch.networkType : 'unknown',
      phyModes: profilerMatch?.phyModes?.length ? profilerMatch.phyModes : phyModesFromString(raw.mode),
      signalDbm: typeof raw.signalLevel === 'number' ? raw.signalLevel : profilerMatch?.signalDbm ?? null,
      noiseDbm: profilerMatch?.noiseDbm ?? null,
      lastSeen: now,
    },
    now,
  )
}

function mapSiConnected(
  raw: si.Systeminformation.WifiConnectionData | undefined,
  profilerCurrent: ParsedProfilerWifi['current'] | null,
  oui: Record<string, string>,
  now: number,
): WifiNetworkDetail | null {
  if (!raw && !profilerCurrent) return null
  const rawSsid = raw?.ssid || null
  const profSsid = profilerCurrent?.ssid ?? null
  let ssid = isRedactedSsid(rawSsid) ? null : rawSsid
  let ssidRedacted = isRedactedSsid(rawSsid)
  if (profSsid) {
    if (!isRedactedSsid(profSsid) && ssid == null) {
      ssid = profSsid
      ssidRedacted = false
    } else if (isRedactedSsid(profSsid)) {
      ssidRedacted = true
    }
  }

  const securityArr = profilerCurrent?.security ? [profilerCurrent.security] : raw?.security ? [raw.security] : []
  const label = securityArr[0] ?? null
  const short = label ? (/^(WPA3|WPA2|WPA|WEP|OWE|Open)/i.exec(label)?.[1] ?? label) : null
  const signalDbm = profilerCurrent?.signalDbm ?? (typeof raw?.signalLevel === 'number' ? raw.signalLevel : null)

  return finalize(
    {
      ...emptyNetwork(),
      ssid,
      ssidRedacted,
      isHidden: ssid == null && !ssidRedacted,
      bssid: raw?.bssid ? raw.bssid.toLowerCase() : null,
      vendor: lookupVendor(raw?.bssid || null, oui),
      channel: profilerCurrent?.channel ?? (typeof raw?.channel === 'number' ? raw.channel : null),
      band: profilerCurrent?.band ?? bandFromFrequency(raw?.frequency),
      channelWidthMhz: profilerCurrent?.channelWidthMhz ?? null,
      frequency: typeof raw?.frequency === 'number' ? raw.frequency : null,
      security: securityArr,
      securityLabel: label,
      securityShort: short,
      securityLevel: classifySecurity(securityArr),
      countryCode: profilerCurrent?.countryCode ?? null,
      networkType:
        profilerCurrent?.networkType && profilerCurrent.networkType !== 'unknown'
          ? profilerCurrent.networkType
          : 'unknown',
      phyModes: profilerCurrent?.phyModes?.length ? profilerCurrent.phyModes : phyModesFromString(raw?.type),
      signalDbm,
      noiseDbm: profilerCurrent?.noiseDbm ?? null,
      txRateMbps: typeof raw?.txRate === 'number' ? raw.txRate : null,
      isConnected: true,
      lastSeen: now,
    },
    now,
  )
}

let cachedProfiler: ParsedProfilerWifi | null = null

/**
 * The joined network's driver record costs two child processes to read, and the
 * network you are joined to does not change between two 3-second polls. Re-read
 * it on manual refreshes and on a slow timer; reuse it in between so the live
 * signal poll stays cheap.
 */
const JOINED_RECORD_TTL_MS = 30_000
let cachedJoined: { at: number; iface: string; record: ScutilAirportRecord | null } | null = null

async function readJoinedRecord(iface: string | null, force: boolean, now: number): Promise<ScutilAirportRecord | null> {
  if (!iface) return null
  if (!force && cachedJoined && cachedJoined.iface === iface && now - cachedJoined.at < JOINED_RECORD_TTL_MS) {
    return cachedJoined.record
  }
  const record = await readConnectedAirportRecord(iface)
  cachedJoined = { at: now, iface, record }
  return record
}

function findProfilerNearby(
  nearby: ParsedProfilerWifi['nearby'],
  raw: si.Systeminformation.WifiNetworkData,
): ParsedProfilerNetwork | undefined {
  const ch = typeof raw.channel === 'number' ? raw.channel : null
  if (ch == null) return undefined
  return nearby.find((p) => p.channel === ch)
}

async function scanViaSystemInformation(detailed: boolean, now: number): Promise<WifiScanSnapshot> {
  const oui = loadOuiDb()
  const tasks: Promise<unknown>[] = [si.wifiConnections(), si.wifiNetworks()]
  if (detailed && process.platform === 'darwin') tasks.push(loadSystemProfilerWifi())
  const [connRes, netsRes, profRes] = await Promise.allSettled(tasks)

  let profiler: ParsedProfilerWifi | null = cachedProfiler
  if (profRes && profRes.status === 'fulfilled' && profRes.value) {
    profiler = profRes.value as ParsedProfilerWifi
    cachedProfiler = profiler
  }

  const connRaw =
    connRes.status === 'fulfilled' ? (connRes.value as si.Systeminformation.WifiConnectionData[])?.[0] : undefined
  const netsRaw = netsRes.status === 'fulfilled' ? (netsRes.value as si.Systeminformation.WifiNetworkData[]) : []

  const connected = mapSiConnected(connRaw, profiler?.current ?? null, oui, now)
  const connectedBssid = connRaw?.bssid || connected?.bssid || null

  const profNearby = profiler?.nearby ?? []
  const networks = netsRaw.map((raw) => mapSiNetwork(raw, findProfilerNearby(profNearby, raw), oui, now))

  if (connected) {
    const idx = matchConnectedIndex(networks, {
      ssid: connected.ssid,
      bssid: connected.bssid,
      channel: connected.channel,
      rssi: connected.signalDbm,
    })
    if (idx >= 0) {
      networks[idx] = {
        ...networks[idx],
        isConnected: true,
        signalDbm: networks[idx].signalDbm ?? connected.signalDbm,
        signalPercent: networks[idx].signalPercent ?? connected.signalPercent,
        txRateMbps: connected.txRateMbps,
        countryCode: networks[idx].countryCode ?? connected.countryCode,
      }
    } else {
      networks.push({ ...connected, isConnected: true })
    }
  }

  const deduped = sortNetworksBySignal(dedupeNetworks(networks))
  const bssidHidden = deduped.length > 0 && deduped.every((n) => n.bssid == null)
  return emptySnapshot(now, {
    connectedBssid: connectedBssid || null,
    networks: deduped,
    interfaceName: connRaw?.iface ?? null,
    supported: true,
    powerOn: true,
    active: detailed,
    locationAccess: process.platform === 'darwin' ? (bssidHidden ? 'not-determined' : 'granted') : 'unknown',
    bssidHidden,
    countryCode: profiler?.current?.countryCode ?? null,
  })
}

// ─── Public entry point ─────────────────────────────────────

/**
 * Collect every visible Wi-Fi network (and the current connection) as a
 * snapshot.
 *
 * `detailed` means "sweep the radio": a full active scan on macOS/Linux plus
 * the slow `system_profiler` read. The renderer only sends it on first load and
 * manual refresh; the 3-second live poll reads the driver's cached neighbour
 * list instead, which is what makes a per-network signal chart affordable.
 *
 * Best-effort throughout: a platform path that fails falls back to
 * systeminformation, and a failed sub-read degrades to null fields rather than
 * throwing.
 */
export async function scanWifiNetworks(detailed = false): Promise<WifiScanSnapshot> {
  const now = Date.now()

  if (process.platform === 'darwin') {
    const [scan, profiler] = await Promise.all([
      coreWlanScan(detailed),
      detailed ? loadSystemProfilerWifi() : Promise.resolve(cachedProfiler),
    ])
    if (profiler) cachedProfiler = profiler
    if (scan.ok && (scan.networks.length > 0 || scan.current != null)) {
      const joined = await readJoinedRecord(scan.interfaceName, detailed, now)
      return buildDarwinSnapshot(scan, profiler ?? cachedProfiler, now, loadOuiDb(), joined)
    }
    const fallback = await scanViaSystemInformation(detailed, now)
    return { ...fallback, error: fallback.error ?? scan.error }
  }

  if (process.platform === 'linux') {
    const scan = await linuxWifiScan(detailed)
    if (scan.ok) return buildLinuxSnapshot(scan, now, detailed)
    const fallback = await scanViaSystemInformation(detailed, now)
    return { ...fallback, error: fallback.error ?? scan.error }
  }

  return scanViaSystemInformation(detailed, now)
}

/** macOS Location Services state as far as the Wi-Fi scanner can tell. */
export async function probeLocationAccess(): Promise<LocationAccessStatus> {
  if (process.platform !== 'darwin') return 'unknown'
  const scan = await coreWlanScan(false)
  if (!scan.ok) return 'unknown'
  const anyBssid = scan.networks.some((n) => n.bssid) || scan.current?.bssid != null
  return anyBssid ? 'granted' : 'not-determined'
}
