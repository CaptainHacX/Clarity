import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import type { LocalListener } from '../../../shared/types'

const execFileAsync = promisify(execFile)

export interface RawListenerLine {
  port: number
  process: string | null
  pid: number | null
  address: string
  protocol: 'tcp' | 'udp'
}

function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.') || addr === 'localhost'
}

function isWildcard(addr: string): boolean {
  return addr === '*' || addr === '0.0.0.0' || addr === '::' || addr === '[::]'
}

/** Parse one `lsof -nP -iTCP/-iUDP` line into (process, pid, addr:port). */
export function parseLsofLine(line: string): RawListenerLine | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 8) return null
  const process = parts[0] ?? null
  const pid = Number(parts[1])
  // The protocol token is its own column; NAME follows it and may itself span
  // two columns (e.g. `*:7000 (LISTEN)`).
  const protoIdx = parts.findIndex((p) => /^(TCP|UDP)$/i.test(p))
  if (protoIdx === -1) return null
  const protocol = parts[protoIdx]!.toLowerCase() as 'tcp' | 'udp'
  let addrPort = parts.slice(protoIdx + 1).join(' ').replace(/\s*\([^)]*\)\s*$/, '')
  if (!addrPort.includes(':')) return null
  // NAME is `<addr>:<port>` — IPv6 literals are bracketed.
  if (addrPort.startsWith('[')) {
    const end = addrPort.indexOf(']:')
    if (end === -1) return null
    addrPort = `${addrPort.slice(1, end)}:${addrPort.slice(end + 2)}`
  }
  const idx = addrPort.lastIndexOf(':')
  if (idx === -1) return null
  const address = addrPort.slice(0, idx)
  const port = Number(addrPort.slice(idx + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    port,
    process: process && process !== 'COMMAND' ? process : null,
    pid: Number.isFinite(pid) ? pid : null,
    address,
    protocol,
  }
}

/** Parse `netstat -ano` (Windows) — pid is the trailing column. */
export function parseNetstatLine(line: string): RawListenerLine | null {
  // TCP rows carry a LISTENING state column; UDP rows do not.
  const m = line.match(/^\s*(TCP|UDP)\s+(\S+):(\d+)\s+(\S+)\s+(?:(\S+)\s+)?(\d+)\s*$/)
  if (!m) return null
  if (m[1] === 'TCP' && m[5] !== 'LISTENING') return null
  const raw = m[2]!
  const port = Number(m[3])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    port,
    process: null,
    pid: Number(m[6]),
    address: raw === '0.0.0.0' || raw === '[::]' ? '*' : raw,
    protocol: m[1]!.toLowerCase() as 'tcp' | 'udp',
  }
}

function isLineStartingWithDigitOrWildcard(line: string): boolean {
  return /^[\s\S]*\d+:\d+/.test(line)
}

export async function runLsof(): Promise<RawListenerLine[]> {
  const out: RawListenerLine[] = []
  for (const args of [['-nP', '-iTCP', '-sTCP:LISTEN'], ['-nP', '-iUDP']]) {
    try {
      const { stdout } = await execFileAsync('lsof', args, { timeout: 5000, encoding: 'utf-8' })
      for (const line of stdout.split(/\r?\n/)) {
        const parsed = parseLsofLine(line)
        if (parsed) out.push(parsed)
      }
    } catch { /* lsof missing — graceful */ }
  }
  return out
}

export async function runNetstat(): Promise<RawListenerLine[]> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano'], { timeout: 5000, encoding: 'utf-8' })
    const out: RawListenerLine[] = []
    for (const line of stdout.split(/\r?\n/)) {
      if (!isLineStartingWithDigitOrWildcard(line)) continue
      const parsed = parseNetstatLine(line)
      if (parsed) out.push(parsed)
    }
    return out
  } catch {
    return []
  }
}

/** Read /etc/hosts — name(s) that point at a loopback address. */
export function readHostsLoopbackNames(): string[] {
  try {
    const names = new Set<string>()
    for (const line of readFileSync('/etc/hosts', 'utf-8').split(/\r?\n/)) {
      const clean = line.replace(/#.*$/, '').trim()
      if (!clean) continue
      const parts = clean.split(/\s+/)
      const addr = parts[0]?.toLowerCase()
      if (addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.')) {
        for (const p of parts.slice(1)) if (p) names.add(p)
      }
    }
    return [...names]
  } catch {
    return []
  }
}

export interface ListenersResult {
  listeners: LocalListener[]
  ok: boolean
  error?: string
}

/**
 * Which ports are listening on this Mac, grouped so the UI can separate
 * loopback-only listeners from anything the network can reach. Reads what the
 * system already knows — no probing, no privileges.
 */
export async function collectLocalListeners(): Promise<ListenersResult> {
  try {
    const raw = process.platform === 'win32' ? await runNetstat() : await runLsof()
    const loopbackNames = readHostsLoopbackNames()

    // Group by (port, process, pid) so one listener across interfaces = one row.
    const byPort = new Map<number, { process: string | null; pid: number | null; addrs: Set<string>; protocols: Set<string> }>()
    for (const r of raw) {
      let group = byPort.get(r.port)
      if (!group) {
        group = { process: r.process, pid: r.pid, addrs: new Set(), protocols: new Set() }
        byPort.set(r.port, group)
      }
      if (!group.process && r.process) group.process = r.process
      if (group.pid === null && r.pid !== null) group.pid = r.pid
      group.addrs.add(r.address)
      group.protocols.add(r.protocol)
    }

    const listeners: LocalListener[] = [...byPort.entries()]
      .map(([port, g]) => {
        const addresses = [...g.addrs]
        const wildcard = addresses.some(isWildcard)
        const hostNames = wildcard || addresses.some(isLoopbackAddress) ? loopbackNames : []
        return {
          port,
          process: g.process,
          pid: g.pid,
          loopbackOnly: addresses.every((a) => isLoopbackAddress(a)),
          addresses,
          hostNames: hostNames.slice(0, 8),
        }
      })
      .sort((a, b) => a.port - b.port)

    return { listeners, ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'listeners failed'
    return { listeners: [], ok: false, error: msg.slice(0, 200) }
  }
}
