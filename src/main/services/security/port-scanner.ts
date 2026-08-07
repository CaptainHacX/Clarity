import { connect } from 'net'
import type { DevicePortState } from '../../../shared/types'
import { isPrivateIpv4 } from '../../../shared/devices'

export const CATALOG_CONNECT_TIMEOUT_MS = 600
export const FULL_SCAN_CONNECT_TIMEOUT_MS = 350
export const CATALOG_CONCURRENCY = 12
export const FULL_SCAN_CONCURRENCY = 24

/** Same-subnet check for two IPv4s: /24 for 192.168.* and 169.254.*, /16 elsewhere. */
export function sameSubnet(ip: string, hostIpv4: string): boolean {
  if (ip === hostIpv4) return true
  const a = ip.split('.')
  const h = hostIpv4.split('.')
  if (a[0] === '192' || a[0] === '169') {
    return a[0] === h[0] && a[1] === h[1] && a[2] === h[2]
  }
  return a[0] === h[0] && a[1] === h[1]
}

/**
 * Strict LAN-only guard used by the scanner engine. A target must be a private
 * IPv4 address, and when trusted host addresses are known it must sit on the
 * same subnet as at least one of them (10/8 and 172.16/12 by /16, 192.168/16
 * and 169.254/16 by /16 class match) so scans can never be pointed at the
 * wider internet. Accepting a list of host addresses keeps the guard correct
 * when the default route is a VPN/virtual interface while the real LAN is
 * reachable through another physical interface.
 */
export function isLanTargetAny(ip: string, hostIpv4s: ReadonlyArray<string | null | undefined>): boolean {
  if (!isPrivateIpv4(ip)) return false
  const privateHosts = hostIpv4s.filter((h): h is string => typeof h === 'string' && isPrivateIpv4(h))
  if (privateHosts.length === 0) return true
  return privateHosts.some((h) => sameSubnet(ip, h))
}

export function isLanTarget(ip: string, hostIpv4: string | null | undefined): boolean {
  return isLanTargetAny(ip, [hostIpv4])
}

export function assertLanTarget(ip: string, hostIpv4: string | null | undefined): void {
  if (!isLanTarget(ip, hostIpv4)) {
    throw new Error(`Refusing to scan ${ip}: only LAN addresses are allowed`)
  }
}

export function assertLanTargetAny(ip: string, hostIpv4s: ReadonlyArray<string | null | undefined>): void {
  if (!isLanTargetAny(ip, hostIpv4s)) {
    throw new Error(`Refusing to scan ${ip}: only LAN addresses are allowed`)
  }
}

export function probePort(ip: string, port: number, timeoutMs = CATALOG_CONNECT_TIMEOUT_MS): Promise<DevicePortState> {
  return new Promise((resolve) => {
    let socket: ReturnType<typeof connect> | null = null
    let settled = false
    const done = (state: DevicePortState) => {
      if (settled) return
      settled = true
      try {
        socket?.destroy()
      } catch {
        // ignore
      }
      resolve(state)
    }
    try {
      socket = connect({ host: ip, port, family: 4 })
    } catch {
      done('filtered')
      return
    }
    socket.setTimeout(timeoutMs, () => done('filtered'))
    socket.once('connect', () => done('open'))
    socket.once('error', (err: NodeJS.ErrnoException) => {
      done(err.code === 'ECONNREFUSED' ? 'closed' : 'filtered')
    })
  })
}

export interface ProbeOutcome {
  port: number
  state: DevicePortState
}

/**
 * Probe a list of ports against one host with bounded concurrency. Slow hosts
 * can take `concurrency * timeoutMs`; this is the rate limiter for Scan All.
 */
export async function probePorts(
  ip: string,
  ports: readonly number[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<ProbeOutcome[]> {
  const concurrency = Math.max(1, opts.concurrency ?? CATALOG_CONCURRENCY)
  const timeoutMs = opts.timeoutMs ?? CATALOG_CONNECT_TIMEOUT_MS
  const outcomes: ProbeOutcome[] = new Array(ports.length)
  let next = 0

  async function worker() {
    while (next < ports.length) {
      const i = next++
      const port = ports[i]
      outcomes[i] = { port, state: await probePort(ip, port, timeoutMs) }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker))
  return outcomes
}

export interface ScanRangeOptions {
  timeoutMs?: number
  concurrency?: number
  /** Called as ports are resolved; return false to abort. */
  onProgress?: (info: { checked: number; open: number; current: number | null }) => void
  isCancelled?: () => boolean
}

export interface ScanRangeResult {
  open: number[]
  closed: number
  filtered: number
  checked: number
  aborted: boolean
}

/** Port-scan a contiguous range (e.g. 1–1024 or 1–65535). Open ports only are reported. */
export async function scanRange(ip: string, from: number, to: number, opts: ScanRangeOptions = {}): Promise<ScanRangeResult> {
  const concurrency = Math.max(1, opts.concurrency ?? FULL_SCAN_CONCURRENCY)
  const timeoutMs = opts.timeoutMs ?? FULL_SCAN_CONNECT_TIMEOUT_MS
  const open: number[] = []
  let closed = 0
  let filtered = 0
  let checked = 0
  let aborted = false

  let nextPort = from
  async function worker() {
    while (nextPort <= to && !aborted) {
      if (opts.isCancelled?.()) {
        aborted = true
        return
      }
      const port = nextPort++
      const state = await probePort(ip, port, timeoutMs)
      if (state === 'open') open.push(port)
      else if (state === 'closed') closed += 1
      else filtered += 1
      checked += 1
      opts.onProgress?.({ checked, open: open.length, current: port })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  open.sort((a, b) => a - b)
  return { open, closed, filtered, checked, aborted }
}
