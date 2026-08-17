/**
 * macOS Wi-Fi scanning through CoreWLAN.
 *
 * `airport -s` was removed in macOS 14 and `system_profiler SPAirPortDataType`
 * redacts every SSID/BSSID for a process without Location Services access — so
 * neither is a usable source on a modern Mac. CoreWLAN's `CWInterface` is the
 * framework Apple's own Wi-Fi UI uses; it returns real SSIDs even before the
 * Location prompt is answered (only BSSID and country code stay gated), plus
 * the channel/band/width, PHY modes, security suites, beacon interval and the
 * noise floor the tool needs.
 *
 * The framework is reached two ways, in this order:
 *
 * 1. `clarity-corewlan`, an in-process N-API addon. This is the only path that
 *    can return BSSIDs, because macOS resolves the Location authorization
 *    against the *requesting process's own bundle identity*. In-process, that
 *    identity is `com.clarity.app` — the bundle carrying
 *    NSLocationWhenInUseUsageDescription and the grant the user gave.
 *
 * 2. `osascript -l JavaScript` driving the same API through JXA, used when the
 *    addon is absent (not compiled, ABI mismatch). It still yields SSIDs,
 *    channel, band, width, security and PHY — everything except the two
 *    location-gated fields — so the tool degrades rather than dying.
 *
 * The JXA path was once assumed to inherit the app's TCC identity. It does not.
 * Measured on macOS 26: inside that child, `NSBundle.mainBundle.bundleIdentifier`
 * is `com.apple.osascript` and `CLLocationManager.authorizationStatus` is 0
 * (notDetermined) while the app itself is authorized — so every BSSID and
 * country code came back nil no matter what the user granted Clarity. A
 * bundle-less helper binary fares worse still (no bundle id, no SSIDs either),
 * which is why the fix is in-process rather than another spawned process.
 *
 * Both paths emit the same JSON shape, so `parseCoreWlanOutput` remains the one
 * place that validates the payload.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { LocationAccessStatus } from '../../../shared/types'

const execFileAsync = promisify(execFile)

// ─── CoreWLAN enums ─────────────────────────────────────────

/** `CWChannelBand`. */
export const BAND_2GHZ = 1
export const BAND_5GHZ = 2
export const BAND_6GHZ = 3

/** `CWChannelWidth` → MHz. Index is the raw enum value. */
const WIDTH_MHZ: Record<number, number> = { 1: 20, 2: 40, 3: 80, 4: 160 }

/** `CWPHYMode` → IEEE name. */
const PHY_NAME: Record<number, string> = {
  1: '802.11a',
  2: '802.11b',
  3: '802.11g',
  4: '802.11n',
  5: '802.11ac',
  6: '802.11ax',
}

/**
 * `CWSecurity` codes in descending specificity. `-[CWNetwork supportsSecurity:]`
 * answers yes for every suite an AP is compatible with, so a plain WPA2 network
 * reports WPA/WPA2-mixed, WPA2, generic Personal *and* the WPA3 transition flag
 * at once. Reading the list in this order collapses that back to the single
 * label the AP actually advertises (verified against `system_profiler`'s
 * `spairport_security_mode`, which agrees on WPA2 for such a network).
 */
const SECURITY_ORDER: Array<{ code: number; label: string; short: string }> = [
  { code: 15, label: 'OWE Transition', short: 'OWE' },
  { code: 14, label: 'Enhanced Open (OWE)', short: 'OWE' },
  { code: 12, label: 'WPA3 Enterprise', short: 'WPA3' },
  { code: 11, label: 'WPA3 Personal', short: 'WPA3' },
  { code: 9, label: 'WPA2 Enterprise', short: 'WPA2' },
  { code: 4, label: 'WPA2 Personal', short: 'WPA2' },
  { code: 13, label: 'WPA2/WPA3 Personal', short: 'WPA3' },
  { code: 8, label: 'WPA/WPA2 Enterprise', short: 'WPA2' },
  { code: 3, label: 'WPA/WPA2 Personal', short: 'WPA2' },
  { code: 7, label: 'WPA Enterprise', short: 'WPA' },
  { code: 2, label: 'WPA Personal', short: 'WPA' },
  { code: 10, label: 'Enterprise', short: 'WPA2' },
  { code: 5, label: 'Personal', short: 'WPA2' },
  { code: 6, label: 'Dynamic WEP', short: 'WEP' },
  { code: 1, label: 'WEP', short: 'WEP' },
  { code: 0, label: 'Open', short: 'Open' },
]

export function securityFromCodes(codes: readonly number[]): { label: string | null; short: string | null } {
  const set = new Set(codes)
  for (const entry of SECURITY_ORDER) {
    if (set.has(entry.code)) return { label: entry.label, short: entry.short }
  }
  return { label: null, short: null }
}

export function bandLabelFromCode(code: number | null): string | null {
  if (code === BAND_2GHZ) return '2.4 GHz'
  if (code === BAND_5GHZ) return '5 GHz'
  if (code === BAND_6GHZ) return '6 GHz'
  return null
}

export function widthFromCode(code: number | null): number | null {
  return code != null ? (WIDTH_MHZ[code] ?? null) : null
}

export function phyModesFromCodes(codes: readonly number[]): string[] {
  const out: string[] = []
  for (const c of codes) {
    const name = PHY_NAME[c]
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Centre frequency in MHz for a channel number + band. CoreWLAN reports the
 * channel, not the frequency; the Wi-Fi tool shows both.
 */
export function frequencyFromChannel(channel: number | null, bandCode: number | null): number | null {
  if (channel == null || !Number.isFinite(channel)) return null
  if (bandCode === BAND_2GHZ || (bandCode == null && channel >= 1 && channel <= 14)) {
    if (channel === 14) return 2484
    if (channel >= 1 && channel <= 13) return 2407 + channel * 5
    return null
  }
  if (bandCode === BAND_6GHZ) return 5950 + channel * 5
  if (bandCode === BAND_5GHZ || channel >= 32) return 5000 + channel * 5
  return null
}

// ─── JXA bridge ─────────────────────────────────────────────

export interface RawCoreWlanNetwork {
  ssid: string | null
  bssid: string | null
  rssi: number | null
  noise: number | null
  channel: number | null
  bandCode: number | null
  widthCode: number | null
  countryCode: string | null
  beaconInterval: number | null
  ibss: boolean
  securityCodes: number[]
  phyCodes: number[]
}

export interface RawCoreWlanCurrent {
  ssid: string | null
  bssid: string | null
  rssi: number | null
  noise: number | null
  txRate: number | null
  securityCode: number | null
  phyCode: number | null
  countryCode: string | null
  channel: number | null
  bandCode: number | null
  widthCode: number | null
  mode: number | null
}

export interface CoreWlanScan {
  ok: boolean
  interfaceName: string | null
  powerOn: boolean
  /** True when the scan used an active radio sweep rather than the cached list. */
  active: boolean
  current: RawCoreWlanCurrent | null
  networks: RawCoreWlanNetwork[]
  error: string | null
}

/**
 * The JXA program. `__ACTIVE__` is substituted with `true`/`false`: an active
 * sweep takes ~3s and briefly interrupts traffic, so live polling reads
 * `cachedScanResults` (sub-100ms) and only manual refreshes sweep the radio.
 *
 * JXA sends `console.log` to stderr, so the result is the script's final
 * expression, which osascript prints on stdout.
 */
function buildScript(active: boolean): string {
  return `
ObjC.import('CoreWLAN');
ObjC.import('Foundation');
(function () {
  function str(v) { try { return (v && v.isNil && !v.isNil()) ? ObjC.unwrap(v) : null; } catch (e) { return null; } }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  var out = { ok: false, interfaceName: null, powerOn: false, active: false, current: null, networks: [], error: null };
  try {
    var iface = $.CWWiFiClient.sharedWiFiClient.interface;
    if (!iface || iface.isNil()) { out.error = 'no-wifi-interface'; return JSON.stringify(out); }
    out.interfaceName = str(iface.interfaceName);
    try { out.powerOn = !!iface.powerOn; } catch (e) { out.powerOn = false; }
    function chan(ch) {
      try {
        if (!ch || ch.isNil()) return { channel: null, bandCode: null, widthCode: null };
        return { channel: num(ch.channelNumber), bandCode: num(ch.channelBand), widthCode: num(ch.channelWidth) };
      } catch (e) { return { channel: null, bandCode: null, widthCode: null }; }
    }
    var ic = chan(iface.wlanChannel);
    out.current = {
      ssid: str(iface.ssid), bssid: str(iface.bssid),
      rssi: num(iface.rssiValue), noise: num(iface.noiseMeasurement),
      txRate: num(iface.transmitRate), securityCode: num(iface.security),
      phyCode: num(iface.activePHYMode), countryCode: str(iface.countryCode),
      channel: ic.channel, bandCode: ic.bandCode, widthCode: ic.widthCode,
      mode: num(iface.interfaceMode)
    };
    var set = null;
    if (${active ? 'true' : 'false'}) {
      try { var err = Ref(); set = iface.scanForNetworksWithSSIDError($(), err); out.active = true; } catch (e) { out.error = String(e); }
    }
    if (!set || set.isNil()) { out.active = false; try { set = iface.cachedScanResults; } catch (e) {} }
    var arr = (set && !set.isNil()) ? ObjC.unwrap(set.allObjects) : [];
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      var c = chan(n.wlanChannel);
      var sec = [];
      for (var s = 0; s <= 15; s++) { try { if (n.supportsSecurity(s)) sec.push(s); } catch (e) {} }
      var phy = [];
      for (var p = 1; p <= 6; p++) { try { if (n.supportsPHYMode(p)) phy.push(p); } catch (e) {} }
      out.networks.push({
        ssid: str(n.ssid), bssid: str(n.bssid),
        rssi: num(n.rssiValue), noise: num(n.noiseMeasurement),
        channel: c.channel, bandCode: c.bandCode, widthCode: c.widthCode,
        countryCode: str(n.countryCode), beaconInterval: num(n.beaconInterval),
        ibss: !!n.ibss, securityCodes: sec, phyCodes: phy
      });
    }
    out.ok = true;
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
})()
`
}

const EMPTY: CoreWlanScan = {
  ok: false,
  interfaceName: null,
  powerOn: false,
  active: false,
  current: null,
  networks: [],
  error: 'unavailable',
}

/** Coerce the JXA payload into the declared shape; never trusts the bridge. */
export function parseCoreWlanOutput(stdout: string): CoreWlanScan {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ...EMPTY, error: 'bad-json' }
  }
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY, error: 'bad-json' }
  const o = parsed as Record<string, unknown>
  const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  const codes = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x)) : []

  const rawNetworks = Array.isArray(o.networks) ? o.networks : []
  const networks: RawCoreWlanNetwork[] = []
  for (const raw of rawNetworks.slice(0, 512)) {
    if (!raw || typeof raw !== 'object') continue
    const n = raw as Record<string, unknown>
    networks.push({
      ssid: strOrNull(n.ssid),
      bssid: strOrNull(n.bssid),
      rssi: numOrNull(n.rssi),
      // CoreWLAN reports 0 dBm when the radio has no noise reading for an AP.
      noise: numOrNull(n.noise) === 0 ? null : numOrNull(n.noise),
      channel: numOrNull(n.channel),
      bandCode: numOrNull(n.bandCode),
      widthCode: numOrNull(n.widthCode),
      countryCode: strOrNull(n.countryCode),
      beaconInterval: numOrNull(n.beaconInterval),
      ibss: n.ibss === true,
      securityCodes: codes(n.securityCodes),
      phyCodes: codes(n.phyCodes),
    })
  }

  let current: RawCoreWlanCurrent | null = null
  if (o.current && typeof o.current === 'object') {
    const c = o.current as Record<string, unknown>
    current = {
      ssid: strOrNull(c.ssid),
      bssid: strOrNull(c.bssid),
      rssi: numOrNull(c.rssi),
      noise: numOrNull(c.noise) === 0 ? null : numOrNull(c.noise),
      txRate: numOrNull(c.txRate),
      securityCode: numOrNull(c.securityCode),
      phyCode: numOrNull(c.phyCode),
      countryCode: strOrNull(c.countryCode),
      channel: numOrNull(c.channel),
      bandCode: numOrNull(c.bandCode),
      widthCode: numOrNull(c.widthCode),
      mode: numOrNull(c.mode),
    }
  }

  return {
    ok: o.ok === true,
    interfaceName: strOrNull(o.interfaceName),
    powerOn: o.powerOn === true,
    active: o.active === true,
    current,
    networks,
    error: strOrNull(o.error),
  }
}

// ─── Native addon ───────────────────────────────────────────

interface CoreWlanNative {
  scanJson(active: boolean): Promise<string>
  locationAuthStatus(): number
  locationServicesEnabled(): boolean
  requestLocationAuthorization(): void
}

let nativeChecked = false
let native: CoreWlanNative | null = null

/**
 * The in-process addon, or null when it isn't usable (non-macOS, not compiled,
 * ABI mismatch). Resolved once and cached; never throws.
 */
export function getCoreWlanNative(): CoreWlanNative | null {
  if (nativeChecked) return native
  nativeChecked = true
  native = null
  if (process.platform !== 'darwin') return null
  try {
    // Optional dependency: absent on Windows/Linux and on a macOS checkout
    // where the build step could not run.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loader = require('clarity-corewlan') as { load: () => CoreWlanNative | null }
    const mod = loader.load()
    if (mod && typeof mod.scanJson === 'function') native = mod
  } catch {
    native = null
  }
  return native
}

/** Test seam — forces the next `getCoreWlanNative()` to resolve again. */
export function resetCoreWlanNative(): void {
  nativeChecked = false
  native = null
}

/**
 * Map a raw CLAuthorizationStatus onto our status enum.
 *
 * Lives here, beside the function whose output it interprets. It was briefly in
 * `wifi-scanner`, but `network-security` needs it too and `wifi-scanner` already
 * imports `network-security` — so that placement made the two modules circular,
 * survivable only via a deferred `import()`. Both already depend on this module,
 * so here the dependency graph stays a tree.
 *
 * `restricted` reports as denied: it is a parental-controls / MDM state the user
 * cannot grant from Settings, so offering them the prompt would be a dead end.
 */
export function locationAccessFromAuthStatus(status: number): LocationAccessStatus {
  switch (status) {
    case 3: // authorizedAlways
    case 4: // authorizedWhenInUse
      return 'granted'
    case 1: // restricted
    case 2: // denied
      return 'denied'
    case 0: // notDetermined
      return 'not-determined'
    default:
      return 'unknown'
  }
}

/**
 * CLAuthorizationStatus for this process, or null when the addon is absent.
 * 0 notDetermined · 1 restricted · 2 denied · 3 authorizedAlways · 4 whenInUse
 */
export function coreWlanLocationAuthStatus(): number | null {
  const mod = getCoreWlanNative()
  if (!mod) return null
  try {
    return mod.locationAuthStatus()
  } catch {
    return null
  }
}

/** Whether Location Services is on system-wide. Null when the addon is absent. */
export function coreWlanLocationServicesEnabled(): boolean | null {
  const mod = getCoreWlanNative()
  if (!mod) return null
  try {
    return mod.locationServicesEnabled()
  } catch {
    return null
  }
}

/**
 * Raise the system Location prompt for this bundle. Returns false when there is
 * no addon to ask through — the caller then falls back to opening Settings.
 */
export function coreWlanRequestLocation(): boolean {
  const mod = getCoreWlanNative()
  if (!mod) return false
  try {
    mod.requestLocationAuthorization()
    return true
  } catch {
    return false
  }
}

/**
 * Run a CoreWLAN scan. `active` triggers a radio sweep (slow, complete);
 * otherwise the driver's cached neighbour list is read (fast, used for the
 * live signal poll). Never throws — a failure comes back as `ok: false`.
 *
 * Prefers the in-process addon; only it can return BSSIDs. See the module
 * header for why the osascript fallback cannot.
 */
export async function coreWlanScan(active: boolean): Promise<CoreWlanScan> {
  if (process.platform !== 'darwin') return { ...EMPTY, error: 'not-darwin' }

  const mod = getCoreWlanNative()
  if (mod) {
    try {
      const json = await mod.scanJson(active)
      const parsed = parseCoreWlanOutput(json)
      // A native scan that came back empty is still a real answer (radio off,
      // no neighbours). Only fall through when the bridge itself failed.
      if (parsed.ok) return parsed
    } catch {
      // Fall through to the JXA path below.
    }
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', buildScript(active)], {
      timeout: active ? 20_000 : 8_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return parseCoreWlanOutput(stdout)
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'osascript-failed' }
  }
}
