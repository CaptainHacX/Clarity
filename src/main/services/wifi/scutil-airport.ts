/**
 * The connected network's real identity on macOS, without Location Services.
 *
 * CoreWLAN withholds `CWInterface.ssid` and `.bssid` until the app is granted
 * Location, which leaves the tool unable to say *which* of two access points on
 * the same channel you are actually joined to — and unable to show a BSSID at
 * all. The system configuration store keeps the driver's own record of the
 * joined network under `State:/Network/Interface/<iface>/AirPort`, and that
 * record is not redacted: it carries the SSID, the BSSID, the channel, the RSSI
 * and the beacon interval as the radio saw them.
 *
 * The record is an `NSKeyedArchiver` blob, so `scutil` hands over the bytes and
 * Foundation's own unarchiver (through JXA) turns them back into values —
 * rather than this file guessing at a binary plist layout.
 */
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface ScutilAirportRecord {
  ssid: string | null
  bssid: string | null
  channel: number | null
  rssi: number | null
  noise: number | null
  beaconIntervalMs: number | null
  countryCode: string | null
}

/** Pull the archived scan record out of `scutil`'s text output. */
export function extractCachedScanRecordHex(stdout: string): string | null {
  const m = /CachedScanRecord\s*:\s*<data>\s*0x([0-9a-fA-F]+)/.exec(stdout)
  if (!m) return null
  const hex = m[1]
  // An odd-length or absurdly large blob isn't something we should hand on.
  if (hex.length % 2 !== 0 || hex.length > 4_000_000) return null
  return hex.toLowerCase()
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Coerce the JXA payload. Empty strings and the redacted placeholders macOS
 * substitutes are treated as "not available" rather than as values.
 */
export function parseAirportRecord(json: string): ScutilAirportRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (typeof o.error === 'string') return null

  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    if (!t || t === '<redacted>' || t === '02:00:00:00:00:00') return null
    return t
  }
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const record: ScutilAirportRecord = {
    ssid: str(o.SSID_STR),
    bssid: str(o.BSSID)?.toLowerCase() ?? null,
    channel: num(o.CHANNEL),
    rssi: num(o.RSSI),
    noise: num(o.NOISE) === 0 ? null : num(o.NOISE),
    beaconIntervalMs: num(o.BEACON_INT),
    countryCode: str(o.IE_KEY_80211D_COUNTRY_CODE),
  }
  // Nothing usable came back — say so rather than handing out an empty shell.
  if (!record.ssid && !record.bssid && record.channel == null) return null
  return record
}

/** Run `scutil` with one `show` command on stdin. */
function runScutil(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('/usr/sbin/scutil', [], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // already gone
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 5000)
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8')
      if (out.length > 8 * 1024 * 1024) finish(out)
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      finish(out)
    })
    try {
      child.stdin?.end(`show ${key}\n`)
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

function buildUnarchiveScript(base64: string): string {
  return `
ObjC.import('Foundation');
(function () {
  try {
    var d = $.NSData.alloc.initWithBase64EncodedStringOptions($('${base64}'), 0);
    if (!d || d.isNil()) return JSON.stringify({ error: 'bad-data' });
    var rec = $.NSKeyedUnarchiver.unarchiveObjectWithData(d);
    if (!rec || rec.isNil()) return JSON.stringify({ error: 'unarchive-failed' });
    var keys = ['SSID_STR', 'BSSID', 'CHANNEL', 'RSSI', 'NOISE', 'BEACON_INT', 'IE_KEY_80211D_COUNTRY_CODE'];
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      try {
        var v = rec.objectForKey(keys[i]);
        out[keys[i]] = (v && !v.isNil()) ? ObjC.unwrap(v) : null;
      } catch (e) { out[keys[i]] = null; }
    }
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()
`
}

/**
 * Read the driver's record of the network `iface` is joined to. Never throws;
 * an unavailable record comes back as null and the caller falls back to
 * matching the connection by channel.
 */
export async function readConnectedAirportRecord(iface: string): Promise<ScutilAirportRecord | null> {
  if (process.platform !== 'darwin') return null
  if (!/^[a-z0-9]{2,15}$/i.test(iface)) return null

  const stdout = await runScutil(`State:/Network/Interface/${iface}/AirPort`)
  if (!stdout) return null
  const hex = extractCachedScanRecordHex(stdout)
  if (!hex) return null

  const base64 = Buffer.from(hex, 'hex').toString('base64')
  // The script is built by interpolation, so refuse anything that isn't the
  // base64 alphabet before it gets near the shell.
  if (!BASE64_RE.test(base64)) return null

  try {
    const { stdout: json } = await execFileAsync(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', buildUnarchiveScript(base64)],
      { timeout: 8000, maxBuffer: 1024 * 1024 },
    )
    return parseAirportRecord(json)
  } catch {
    return null
  }
}
