import { execFile } from 'child_process'
import { promisify } from 'util'
import type { LinkQuality } from '../../../shared/types'
import { isIpv4 } from '../../../shared/devices'

const execFileAsync = promisify(execFile)

/** Parse per-reply `time=` values out of macOS/Linux ping output. */
export function parsePingTimes(stdout: string): number[] {
  const times: number[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/time[=<]([0-9]+(?:\.[0-9]+)?)\s*ms/)
    if (m) {
      const t = Number(m[1])
      if (Number.isFinite(t)) times.push(t)
    }
  }
  return times
}

/** Parse `time=` values out of Windows ping output (`time=3ms`). */
export function parsePingTimesWin(stdout: string): number[] {
  const times: number[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/time=([0-9]+)ms/)
    if (m) {
      const t = Number(m[1])
      if (Number.isFinite(t)) times.push(t)
    }
  }
  return times
}

/** LinkQuality from a burst's raw times plus how many probes got no answer. */
export function computeLinkQuality(times: number[], sent: number): LinkQuality {
  const answered = times.length
  const loss = sent > 0 ? (sent - answered) / sent : null
  const measuredAt = Date.now()
  if (answered === 0) {
    return { latencyMs: null, avgMs: null, variabilityMs: null, packetLossPct: loss, measuredAt }
  }
  const min = Math.min(...times)
  const avg = times.reduce((a, b) => a + b, 0) / answered
  const variance = times.reduce((a, b) => a + (b - avg) ** 2, 0) / answered
  return {
    latencyMs: min,
    avgMs: avg,
    variabilityMs: Math.sqrt(variance),
    packetLossPct: loss,
    measuredAt,
  }
}

function pingArgs(count: number, ip: string, waitMs = 1000): string[] {
  if (process.platform === 'win32') {
    return ['-n', String(count), '-w', String(waitMs), ip]
  }
  if (process.platform === 'darwin') {
    return ['-c', String(count), '-W', String(waitMs), '-n', ip]
  }
  // Linux -W is whole seconds, so round up; there is no sub-second form.
  return ['-c', String(count), '-W', String(Math.max(1, Math.round(waitMs / 1000))), '-n', ip]
}

function parseTimesForPlatform(stdout: string): number[] {
  return process.platform === 'win32' ? parsePingTimesWin(stdout) : parsePingTimes(stdout)
}

/**
 * Run one ICMP burst. Strictly a plain echo — no probe of any port. Returns the
 * raw per-reply times; a device that never answers yields an empty array.
 */
export async function runPingBurst(ip: string, count = 1, waitMs = 1000): Promise<{ times: number[]; sent: number }> {
  if (!isIpv4(ip)) return { times: [], sent: 0 }
  try {
    const { stdout } = await execFileAsync('ping', pingArgs(count, ip, waitMs), {
      timeout: Math.max(5000, waitMs * count + 2000),
      encoding: 'utf-8',
    })
    return { times: parseTimesForPlatform(stdout), sent: count }
  } catch {
    // Non-zero exit simply means no replies — that's data, not an error.
    return { times: [], sent: count }
  }
}

/** Single quick echo; true when the device answered at all. */
export async function pingOnce(ip: string): Promise<boolean> {
  const { times } = await runPingBurst(ip, 1)
  return times.length > 0
}

/** A burst for the link-quality panel: min/avg/variability/loss. */
export async function measureBurst(ip: string, burst = 5): Promise<LinkQuality | null> {
  if (!isIpv4(ip)) return null
  const { times, sent } = await runPingBurst(ip, burst)
  return computeLinkQuality(times, sent)
}
