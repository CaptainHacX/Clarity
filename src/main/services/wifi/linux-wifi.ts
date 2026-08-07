/**
 * Linux Wi-Fi scanning.
 *
 * `nmcli` is the primary source because it is the only one that works without
 * root on a stock desktop: NetworkManager already holds the scan results, so
 * reading them needs no CAP_NET_ADMIN. It gives SSID, BSSID, mode, channel,
 * frequency, max rate and the security suites — everything except dBm (it
 * reports a 0-100 quality) and the 802.11 details.
 *
 * `iw dev <iface> scan dump` fills those in when the kernel lets an
 * unprivileged process read the cache: exact RSSI, beacon interval, the
 * regulatory country in the beacon, and the HT/VHT operating width. It is
 * strictly an enrichment pass — every field degrades to null when `iw` is
 * missing or refuses.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'

const execFileAsync = promisify(execFile)

export interface LinuxWifiNetwork {
  ssid: string | null
  bssid: string | null
  channel: number | null
  frequency: number | null
  signalDbm: number | null
  /** NetworkManager's 0-100 quality, when that is all we have. */
  signalPercent: number | null
  noiseDbm: number | null
  securityLabel: string | null
  securityShort: string | null
  rateMbps: number | null
  mode: 'infrastructure' | 'adhoc' | 'unknown'
  channelWidthMhz: number | null
  beaconIntervalMs: number | null
  countryCode: string | null
  phyModes: string[]
  isConnected: boolean
}

export interface LinuxWifiScan {
  ok: boolean
  interfaceName: string | null
  networks: LinuxWifiNetwork[]
  error: string | null
}

async function run(cmd: string, args: string[], timeout = 12_000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** Try the same binary from a few standard prefixes — distros disagree on /usr/bin vs /sbin. */
async function runAny(names: string[], args: string[], timeout = 12_000): Promise<string | null> {
  for (const name of names) {
    const out = await run(name, args, timeout)
    if (out !== null) return out
  }
  return null
}

// ─── nmcli terse parsing ────────────────────────────────────

/**
 * Split one `nmcli -t` record. Terse mode separates fields with `:` and
 * backslash-escapes any `:` or `\` inside a value — which every BSSID has.
 */
export function splitNmcliFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i]
      continue
    }
    if (ch === ':') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

/**
 * NetworkManager reports a 0-100 quality, not dBm. Its own mapping is roughly
 * linear over the -100..-50 dBm window, so this is the inverse of that.
 */
export function dbmFromNmcliSignal(percent: number | null): number | null {
  if (percent == null || !Number.isFinite(percent)) return null
  const clamped = Math.max(0, Math.min(100, percent))
  return Math.round(clamped / 2 - 100)
}

/** `WPA1 WPA2` / `WPA2 802.1X` / `` (open) → a display label plus a short tag. */
export function securityFromNmcli(raw: string | null | undefined): { label: string | null; short: string | null } {
  const value = (raw ?? '').trim()
  if (!value) return { label: 'Open', short: 'Open' }
  const upper = value.toUpperCase()
  const enterprise = upper.includes('802.1X') || upper.includes('EAP')
  const suffix = enterprise ? ' Enterprise' : ' Personal'
  if (upper.includes('WPA3') && upper.includes('WPA2')) return { label: `WPA2/WPA3${suffix}`, short: 'WPA3' }
  if (upper.includes('WPA3') || upper.includes('SAE')) return { label: `WPA3${suffix}`, short: 'WPA3' }
  if (upper.includes('OWE')) return { label: 'Enhanced Open (OWE)', short: 'OWE' }
  if (upper.includes('WPA2') && upper.includes('WPA1')) return { label: `WPA/WPA2${suffix}`, short: 'WPA2' }
  if (upper.includes('WPA2')) return { label: `WPA2${suffix}`, short: 'WPA2' }
  if (upper.includes('WPA1') || upper.includes('WPA')) return { label: `WPA${suffix}`, short: 'WPA' }
  if (upper.includes('WEP')) return { label: 'WEP', short: 'WEP' }
  return { label: value, short: value.split(/\s+/)[0] ?? null }
}

const NMCLI_FIELDS = 'ACTIVE,SSID,BSSID,MODE,CHAN,FREQ,RATE,SIGNAL,SECURITY'

/**
 * Parse `nmcli -t -f ACTIVE,SSID,BSSID,MODE,CHAN,FREQ,RATE,SIGNAL,SECURITY
 * device wifi list`. Rows with neither an SSID nor a BSSID are dropped.
 */
export function parseNmcliWifiList(stdout: string): LinuxWifiNetwork[] {
  const out: LinuxWifiNetwork[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const f = splitNmcliFields(line)
    if (f.length < 9) continue
    const [active, ssidRaw, bssidRaw, modeRaw, chanRaw, freqRaw, rateRaw, signalRaw, securityRaw] = f
    const ssid = ssidRaw && ssidRaw !== '--' ? ssidRaw : null
    const bssid = bssidRaw && bssidRaw !== '--' ? bssidRaw.toLowerCase() : null
    if (!ssid && !bssid) continue
    const channel = Number.parseInt(chanRaw ?? '', 10)
    const frequency = Number.parseInt((freqRaw ?? '').replace(/[^\d]/g, ''), 10)
    const rate = Number.parseInt((rateRaw ?? '').replace(/[^\d]/g, ''), 10)
    const signal = Number.parseInt(signalRaw ?? '', 10)
    const security = securityFromNmcli(securityRaw)
    const mode = /adhoc|ad-hoc|ibss/i.test(modeRaw ?? '')
      ? 'adhoc'
      : /infra/i.test(modeRaw ?? '')
        ? 'infrastructure'
        : 'unknown'
    out.push({
      ssid,
      bssid,
      channel: Number.isFinite(channel) ? channel : null,
      frequency: Number.isFinite(frequency) ? frequency : null,
      signalDbm: dbmFromNmcliSignal(Number.isFinite(signal) ? signal : null),
      signalPercent: Number.isFinite(signal) ? signal : null,
      noiseDbm: null,
      securityLabel: security.label,
      securityShort: security.short,
      rateMbps: Number.isFinite(rate) ? rate : null,
      mode,
      channelWidthMhz: null,
      beaconIntervalMs: null,
      countryCode: null,
      phyModes: [],
      isConnected: (active ?? '').toLowerCase() === 'yes',
    })
  }
  return out
}

// ─── `iw scan dump` enrichment ──────────────────────────────

export interface IwScanEntry {
  bssid: string
  ssid: string | null
  signalDbm: number | null
  frequency: number | null
  beaconIntervalMs: number | null
  countryCode: string | null
  channelWidthMhz: number | null
  phyModes: string[]
}

/**
 * Parse `iw dev <iface> scan dump`. Records start with `BSS xx:xx:…`; every
 * field is optional because what a driver reports varies by chipset.
 */
export function parseIwScan(stdout: string): IwScanEntry[] {
  const out: IwScanEntry[] = []
  let cur: IwScanEntry | null = null
  const push = (): void => {
    if (cur) out.push(cur)
    cur = null
  }
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    const bssMatch = /^BSS\s+([0-9a-fA-F:]{17})/.exec(line)
    if (bssMatch) {
      push()
      cur = {
        bssid: bssMatch[1].toLowerCase(),
        ssid: null,
        signalDbm: null,
        frequency: null,
        beaconIntervalMs: null,
        countryCode: null,
        channelWidthMhz: null,
        phyModes: [],
      }
      continue
    }
    if (!cur) continue
    let m: RegExpExecArray | null
    if ((m = /^SSID:\s?(.*)$/.exec(line))) {
      cur.ssid = m[1].length > 0 ? m[1] : null
    } else if ((m = /^signal:\s*(-?\d+(?:\.\d+)?)\s*dBm/.exec(line))) {
      cur.signalDbm = Math.round(Number(m[1]))
    } else if ((m = /^freq:\s*(\d+)/.exec(line))) {
      cur.frequency = Number(m[1])
    } else if ((m = /^beacon interval:\s*(\d+)\s*TUs?/i.exec(line))) {
      // A TU is 1024 µs; every UI in the world rounds it to milliseconds.
      cur.beaconIntervalMs = Math.round((Number(m[1]) * 1024) / 1000)
    } else if ((m = /^Country:\s*([A-Z]{2})/.exec(line))) {
      cur.countryCode = m[1]
    } else if (/^\s*\* channel width: .*160 MHz/.test(rawLine)) {
      cur.channelWidthMhz = 160
    } else if (/^\s*\* channel width: .*80\+80/.test(rawLine)) {
      cur.channelWidthMhz = 160
    } else if (/^\s*\* channel width: .*80 MHz/.test(rawLine)) {
      cur.channelWidthMhz = 80
    } else if (/STA channel width: (any|40 MHz)/.test(line)) {
      if (cur.channelWidthMhz == null) cur.channelWidthMhz = 40
    } else if (/^HT capabilities:|^HT Capabilities/.test(line)) {
      if (!cur.phyModes.includes('802.11n')) cur.phyModes.push('802.11n')
      if (cur.channelWidthMhz == null) cur.channelWidthMhz = 20
    } else if (/^VHT capabilities:|^VHT Capabilities/.test(line)) {
      if (!cur.phyModes.includes('802.11ac')) cur.phyModes.push('802.11ac')
    } else if (/^HE capabilities|HE Iftype/.test(line)) {
      if (!cur.phyModes.includes('802.11ax')) cur.phyModes.push('802.11ax')
    }
  }
  push()
  return out
}

/** Parse `iw reg get` for the regulatory domain the radio is operating under. */
export function parseIwRegCountry(stdout: string): string | null {
  const m = /country\s+([A-Z]{2}):/i.exec(stdout)
  return m ? m[1].toUpperCase() : null
}

/**
 * Parse `/proc/net/wireless`. Column 3 (`level`) is the connected link's RSSI
 * and column 4 (`noise`) the floor — the only noise figure Linux exposes.
 */
export function parseProcNetWireless(text: string): Map<string, { signalDbm: number | null; noiseDbm: number | null }> {
  const out = new Map<string, { signalDbm: number | null; noiseDbm: number | null }>()
  for (const line of text.split('\n')) {
    const m = /^\s*([\w.-]+):\s*\d+\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(line)
    if (!m) continue
    const level = Number(m[3])
    const noise = Number(m[4])
    out.set(m[1], {
      signalDbm: Number.isFinite(level) && level !== 0 ? Math.round(level) : null,
      noiseDbm: Number.isFinite(noise) && noise !== 0 ? Math.round(noise) : null,
    })
  }
  return out
}

/** Parse `iw dev` for the first wireless interface name. */
export function parseIwDevInterface(stdout: string): string | null {
  const m = /^\s*Interface\s+(\S+)/m.exec(stdout)
  return m ? m[1] : null
}

async function findWirelessInterface(): Promise<string | null> {
  const iwDev = await runAny(['/usr/sbin/iw', '/sbin/iw', 'iw'], ['dev'], 5000)
  if (iwDev) {
    const name = parseIwDevInterface(iwDev)
    if (name) return name
  }
  const nm = await runAny(['/usr/bin/nmcli', 'nmcli'], ['-t', '-f', 'DEVICE,TYPE', 'device', 'status'], 5000)
  if (nm) {
    for (const line of nm.split('\n')) {
      const f = splitNmcliFields(line)
      if (f[1] === 'wifi' && f[0]) return f[0]
    }
  }
  try {
    const text = await readFile('/proc/net/wireless', 'utf-8')
    for (const [iface] of parseProcNetWireless(text)) return iface
  } catch {
    // No wireless subsystem.
  }
  return null
}

/**
 * Collect every visible network. `active` asks NetworkManager for a fresh
 * radio sweep; the poll path reuses the cache so the tool can refresh signal
 * every few seconds without hammering the radio.
 */
export async function linuxWifiScan(active: boolean): Promise<LinuxWifiScan> {
  if (process.platform !== 'linux') return { ok: false, interfaceName: null, networks: [], error: 'not-linux' }

  const iface = await findWirelessInterface()
  const nmcliOut = await runAny(
    ['/usr/bin/nmcli', 'nmcli'],
    ['-t', '-f', NMCLI_FIELDS, 'device', 'wifi', 'list', '--rescan', active ? 'yes' : 'no'],
    active ? 25_000 : 10_000,
  )
  if (nmcliOut === null) {
    return { ok: false, interfaceName: iface, networks: [], error: 'nmcli-unavailable' }
  }
  const networks = parseNmcliWifiList(nmcliOut)

  // Enrichment — every one of these is optional.
  const [iwScanOut, regOut, procWireless] = await Promise.all([
    iface ? runAny(['/usr/sbin/iw', '/sbin/iw', 'iw'], ['dev', iface, 'scan', 'dump'], 10_000) : Promise.resolve(null),
    runAny(['/usr/sbin/iw', '/sbin/iw', 'iw'], ['reg', 'get'], 5000),
    readFile('/proc/net/wireless', 'utf-8').catch(() => null),
  ])

  const regCountry = regOut ? parseIwRegCountry(regOut) : null
  const iwByBssid = new Map<string, IwScanEntry>()
  if (iwScanOut) {
    for (const entry of parseIwScan(iwScanOut)) iwByBssid.set(entry.bssid, entry)
  }
  const linkStats = procWireless ? parseProcNetWireless(procWireless) : new Map()
  const ifaceStats = iface ? linkStats.get(iface) : undefined

  for (const net of networks) {
    const iw = net.bssid ? iwByBssid.get(net.bssid) : undefined
    if (iw) {
      if (iw.signalDbm != null) net.signalDbm = iw.signalDbm
      if (iw.frequency != null && net.frequency == null) net.frequency = iw.frequency
      net.beaconIntervalMs = iw.beaconIntervalMs
      net.countryCode = iw.countryCode ?? regCountry
      net.channelWidthMhz = iw.channelWidthMhz
      net.phyModes = iw.phyModes
    } else if (regCountry) {
      net.countryCode = regCountry
    }
    if (net.isConnected && ifaceStats) {
      if (ifaceStats.signalDbm != null) net.signalDbm = ifaceStats.signalDbm
      net.noiseDbm = ifaceStats.noiseDbm
    }
  }

  return { ok: true, interfaceName: iface, networks, error: null }
}
