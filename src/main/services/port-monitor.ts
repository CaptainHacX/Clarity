/**
 * Port Manager service.
 *
 * Enumerates the TCP/UDP ports currently in use and the process owning each
 * one (PID, command line, user, best-effort service name), and terminates a
 * process to free the ports it holds.
 *
 * Linux + macOS only. The IPC layer guards against Windows.
 *
 * Security notes:
 *  - All termination goes through `process.kill(pid, signal)` with a validated
 *    numeric PID. No user input is ever interpolated into a shell command.
 *  - Critical system processes and Clarity itself can never be killed.
 *  - Terminate uses SIGTERM first (graceful) and only escalates to SIGKILL if
 *    the process is still alive after a short grace period.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import * as si from 'systeminformation'
import type {
  PortEntry,
  PortScanResult,
  PortKillResult
} from '../../shared/types'

const execFileAsync = promisify(execFile)

// ── Critical processes that must never be terminated ──────────────
// Mirrors the guard in perf-monitor.ipc.ts.
export const PROTECTED_PROCESS_NAMES = new Set([
  // Windows
  'csrss.exe', 'smss.exe', 'wininit.exe', 'services.exe', 'lsass.exe',
  'lsaiso.exe', 'svchost.exe', 'winlogon.exe', 'dwm.exe', 'explorer.exe',
  'ntoskrnl.exe', 'system', 'registry', 'memory compression',
  // macOS
  'launchd', 'kernel_task', 'windowserver',
  // Linux
  'systemd', 'init', 'kthreadd', 'gdm', 'sddm', 'lightdm', 'xorg', 'xwayland',
])

/** Smallest PID we will ever consider terminating (blocks PID 0-4 kernel/system). */
const MIN_KILL_PID = 5

/** How long to wait for a graceful (SIGTERM) exit before escalating to SIGKILL. */
const GRACE_PERIOD_MS = 2500
/** Extra time to wait for SIGKILL to take effect before giving up. */
const FORCE_PERIOD_MS = 2000
/** Poll interval while waiting for a process to exit. */
const POLL_INTERVAL_MS = 200
/** Cap on remote peers recorded per row, so huge connection sets stay compact. */
const MAX_REMOTE_SUMMARY = 8

// ── Normalized socket / process shapes (pure, testable) ──────────

export interface NormalizedSocket {
  protocol: 'tcp' | 'udp'
  localAddress: string
  localPort: number
  peerAddress: string
  peerPort: string
  state: string
  pid: number | null
  processPath: string | null
}

export interface ProcessInfo {
  pid: number
  name: string
  command: string
  params: string
  user: string
}

/** Map a raw protocol string (tcp4/tcp6/udp46/…) to its family. */
export function normalizeProtocol(protocol: string | null | undefined): 'tcp' | 'udp' | null {
  if (!protocol) return null
  const p = protocol.toLowerCase()
  if (p.startsWith('tcp')) return 'tcp'
  if (p.startsWith('udp')) return 'udp'
  return null
}

/**
 * True when a socket is a "bound" port that accepts traffic — i.e. something
 * the user would want to free with a kill:
 *  - TCP sockets in LISTEN state.
 *  - UDP sockets not tied to a peer (lsof reports these with a `*` peer).
 */
export function isListenerSocket(sock: { protocol: 'tcp' | 'udp'; state: string; peerPort: string; peerAddress: string }): boolean {
  if (sock.protocol === 'tcp') return sock.state.toUpperCase() === 'LISTEN'
  // UDP has no LISTEN state; a socket bound without a peer is an open port.
  return sock.peerPort === '*' || sock.peerAddress === '*' || sock.peerAddress === '0.0.0.0' || sock.peerAddress === '::'
}

function basenameOf(p: string | null): string | null {
  if (!p) return null
  const cleaned = p.replace(/\\/g, '/')
  return cleaned.split('/').filter(Boolean).pop() ?? null
}

function parsePort(value: string | number | undefined | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 65535 ? value : null
  if (typeof value !== 'string') return null
  if (!/^\d+$/.test(value.trim())) return null
  const n = parseInt(value, 10)
  return n >= 0 && n <= 65535 ? n : null
}

function parsePid(value: string | number | undefined | null): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  if (!/^\d+$/.test(value.trim())) return null
  const n = parseInt(value, 10)
  return n > 0 ? n : null
}

/**
 * Aggregate raw sockets into one row per (protocol, port, pid).
 *
 * Listening/bound sockets always produce a row. Connected sockets sharing the
 * same local port and PID are merged into a single row with a connection count
 * and a compact list of distinct remote peers.
 */
export function buildPortEntries(
  sockets: NormalizedSocket[],
  processMap: Map<number, ProcessInfo>
): PortEntry[] {
  interface Group {
    protocol: 'tcp' | 'udp'
    port: number
    localAddresses: Set<string>
    pid: number | null
    processPath: string | null
    isListener: boolean
    states: string[]
    count: number
    remotes: Set<string>
  }

  const groups = new Map<string, Group>()

  for (const sock of sockets) {
    const port = sock.localPort
    if (port === null || port <= 0 || port > 65535) continue
    const key = `${sock.protocol}:${port}:${sock.pid ?? 'kernel'}`
    let group = groups.get(key)
    if (!group) {
      group = {
        protocol: sock.protocol,
        port,
        localAddresses: new Set(),
        pid: sock.pid,
        processPath: sock.processPath,
        isListener: false,
        states: [],
        count: 0,
        remotes: new Set(),
      }
      groups.set(key, group)
    }
    group.localAddresses.add(sock.localAddress)
    if (isListenerSocket(sock)) group.isListener = true
    if (sock.state) group.states.push(sock.state.toUpperCase())
    group.count += 1
    if (sock.peerPort && sock.peerPort !== '*' && sock.peerPort !== '0') {
      group.remotes.add(`${sock.peerAddress}:${sock.peerPort}`)
    } else if (sock.peerAddress && sock.peerAddress !== '*') {
      group.remotes.add(sock.peerAddress)
    }
  }

  const entries: PortEntry[] = []

  for (const group of groups.values()) {
    const info = group.pid != null ? processMap.get(group.pid) : undefined
    const displayState = group.isListener
      ? 'LISTEN'
      : dominantState(group.states)

    const remotes = [...group.remotes].sort()
    const remoteSummary = remotes.slice(0, MAX_REMOTE_SUMMARY)
    if (remotes.length > MAX_REMOTE_SUMMARY) {
      remoteSummary.push(`+${remotes.length - MAX_REMOTE_SUMMARY} more`)
    }

    const ownedByOther = group.pid != null && info != null && info.user !== '' && !isCurrentUser(info.user)

    entries.push({
      protocol: group.protocol,
      port: group.port,
      localAddress: [...group.localAddresses][0] ?? '*',
      state: displayState,
      pid: group.pid,
      processName: info?.name ?? basenameOf(group.processPath),
      command: info ? buildCommandLine(info) : group.processPath,
      user: info?.user ?? null,
      serviceName: null, // resolved lazily by resolveServiceNames()
      connectionCount: group.count,
      remoteSummary,
      isListener: group.isListener,
      killRequiresAdmin: ownedByOther,
    })
  }

  // Listeners/bound ports first, then by port number.
  entries.sort((a, b) => {
    if (a.isListener !== b.isListener) return a.isListener ? -1 : 1
    if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol)
    return a.port - b.port
  })

  return entries
}

function buildCommandLine(info: ProcessInfo): string {
  const params = (info.params ?? '').trim()
  const cmd = (info.command ?? '').trim()
  return params ? `${cmd} ${params}` : cmd
}

function dominantState(states: string[]): string {
  if (states.length === 0) return 'UNKNOWN'
  const counts = new Map<string, number>()
  for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1)
  let best = 'UNKNOWN'
  let bestCount = 0
  for (const [state, n] of counts) {
    if (state === 'UNKNOWN') continue
    if (n > bestCount) {
      best = state
      bestCount = n
    }
  }
  return bestCount > 0 ? best : 'UNKNOWN'
}

function isCurrentUser(user: string): boolean {
  const effective = process.env.USER ?? process.env.LOGNAME ?? ''
  if (effective && user === effective) return true
  // On macOS, systeminformation reports uid-based names like "_spotlight".
  // Processes we own are usually the login user; treat uid-string prefixes as "other".
  return false
}

export function isProtectedProcessName(name: string | null | undefined): boolean {
  if (!name) return false
  return PROTECTED_PROCESS_NAMES.has(name.toLowerCase())
}

/**
 * Validate a PID before terminating. Returns an error string, or null when safe.
 */
export function validateKillPid(pid: unknown): string | null {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return 'Invalid process ID'
  }
  if (pid < MIN_KILL_PID) {
    return 'Cannot kill critical system process'
  }
  if (pid === process.pid) {
    return 'Cannot kill own process'
  }
  return null
}

// ── Service name resolution (best effort, per-scan cached) ───────

const SYSTEMD_UNIT_RE = /([^/]+\.(?:service|socket|mount|scope|slice))$/i

async function resolveLinuxServiceNames(pids: number[], cache: Map<number, string | null>): Promise<void> {
  await Promise.all(pids.map(async (pid) => {
    if (cache.has(pid)) return
    cache.set(pid, null)
    try {
      const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf-8')
      const match = cgroup.match(SYSTEMD_UNIT_RE)
      cache.set(pid, match?.[1] ?? null)
    } catch {
      cache.set(pid, null)
    }
  }))
}

async function resolveMacosServiceNames(pids: number[], cache: Map<number, string | null>): Promise<void> {
  const remaining = pids.filter((p) => !cache.has(p))
  for (const pid of remaining) cache.set(pid, null)
  if (remaining.length === 0) return

  try {
    const { stdout } = await execFileAsync('launchctl', ['list'], { timeout: 5000, encoding: 'utf-8' })
    // launchctl list output: PID\tStatus\tLabel  (PID may be "-" for not running)
    const byPid = new Map<number, string>()
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
        byPid.set(parseInt(parts[0], 10), parts.slice(2).join(' '))
      }
    }
    for (const pid of remaining) {
      cache.set(pid, byPid.get(pid) ?? null)
    }
  } catch {
    // launchctl unavailable or empty — leave resolved names as null
  }
}

async function resolveServiceNames(
  pids: (number | null)[],
  cache: Map<number, string | null>
): Promise<Map<number, string | null>> {
  const unique = [...new Set(pids.filter((p): p is number => p != null))]
  if (process.platform === 'linux') {
    await resolveLinuxServiceNames(unique, cache)
  } else if (process.platform === 'darwin') {
    await resolveMacosServiceNames(unique, cache)
  }
  return cache
}

// ── Scanning ──────────────────────────────────────────────

function buildProcessMap(procList: si.Systeminformation.ProcessesProcessData[]): Map<number, ProcessInfo> {
  const map = new Map<number, ProcessInfo>()
  for (const p of procList) {
    map.set(p.pid, {
      pid: p.pid,
      name: p.name || '',
      command: p.command || '',
      params: p.params || '',
      user: p.user || '',
    })
  }
  return map
}

/** Fetch all sockets and normalize them into a testable shape. */
export async function fetchSockets(): Promise<NormalizedSocket[]> {
  const raw = await si.networkConnections()
  const out: NormalizedSocket[] = []
  for (const r of raw) {
    const protocol = normalizeProtocol(r.protocol)
    if (!protocol) continue
    const localPort = parsePort(r.localPort)
    if (localPort === null) continue
    out.push({
      protocol,
      localAddress: r.localAddress || '*',
      localPort,
      peerAddress: r.peerAddress || '*',
      peerPort: r.peerPort || '',
      state: (r.state || 'UNKNOWN').toUpperCase(),
      pid: parsePid(r.pid),
      processPath: typeof r.process === 'string' && r.process ? r.process : null,
    })
  }
  return out
}

/**
 * Full scan: sockets + process metadata + service names.
 */
export async function scanPorts(): Promise<PortScanResult> {
  const start = Date.now()
  const result: PortScanResult = { ports: [], totalPorts: 0, listeners: 0, connections: 0, duration: 0 }

  try {
    const [sockets, procData] = await Promise.all([
      fetchSockets(),
      si.processes(),
    ])
    const processMap = buildProcessMap(procData.list)
    const entries = buildPortEntries(sockets, processMap)

    const serviceCache = new Map<number, string | null>()
    const pids = entries.map((e) => e.pid)
    await resolveServiceNames(pids, serviceCache)
    for (const entry of entries) {
      if (entry.pid != null) entry.serviceName = serviceCache.get(entry.pid) ?? null
    }

    result.ports = entries
    result.totalPorts = entries.length
    result.listeners = entries.filter((e) => e.isListener).length
    result.connections = entries.reduce((sum, e) => sum + e.connectionCount, 0)
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Failed to scan ports'
  }

  result.duration = Date.now() - start
  return result
}

// ── Termination ───────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // EPERM means the process exists but is owned by another user.
    return err?.code === 'EPERM'
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await sleep(POLL_INTERVAL_MS)
  }
  return !isProcessAlive(pid)
}

async function portsOwnedBy(pid: number): Promise<Set<number>> {
  try {
    const sockets = await fetchSockets()
    const ports = new Set<number>()
    for (const sock of sockets) {
      if (sock.pid === pid) ports.add(sock.localPort)
    }
    return ports
  } catch {
    return new Set()
  }
}

async function processNameFor(pid: number): Promise<string | null> {
  try {
    const procData = await si.processes()
    const p = procData.list.find((x) => x.pid === pid)
    return p?.name ?? null
  } catch {
    return null
  }
}

/**
 * Terminate the process owning a port so the port can be reused.
 *
 * Order of operations:
 *   1. Validate the PID (never PID 0-4, never Clarity itself).
 *   2. Look up the process name and refuse protected system processes.
 *   3. Record the ports the process currently owns.
 *   4. SIGTERM (graceful), wait up to GRACE_PERIOD_MS.
 *   5. If still alive, SIGKILL, wait up to FORCE_PERIOD_MS.
 *   6. Re-scan and report which ports were actually freed.
 */
export async function killPortProcess(pid: number): Promise<PortKillResult> {
  const validationError = validateKillPid(pid)
  if (validationError) {
    return { success: false, pid, processName: null, freedPorts: [], error: validationError }
  }

  const processName = await processNameFor(pid)
  if (isProtectedProcessName(processName)) {
    return {
      success: false,
      pid,
      processName,
      freedPorts: [],
      error: `Cannot kill protected system process (${processName})`,
    }
  }

  const ownedPorts = await portsOwnedBy(pid)

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err: any) {
    if (err?.code === 'ESRCH') {
      // Already gone — nothing to do; everything it owned is already free.
      return { success: true, pid, processName, freedPorts: [...ownedPorts] }
    }
    if (err?.code === 'EPERM') {
      return {
        success: false,
        pid,
        processName,
        freedPorts: [],
        error: 'Access denied. Run Clarity as an administrator (or root) to end this process.',
        requiresAdmin: true,
      }
    }
    return {
      success: false,
      pid,
      processName,
      freedPorts: [],
      error: err instanceof Error ? err.message : 'Failed to terminate process',
    }
  }

  const exited = await waitForExit(pid, GRACE_PERIOD_MS)
  if (!exited) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (err: any) {
      if (err?.code === 'ESRCH') {
        // It exited during the grace window.
        return { success: true, pid, processName, freedPorts: [...ownedPorts] }
      }
      if (err?.code === 'EPERM') {
        return {
          success: false,
          pid,
          processName,
          freedPorts: [],
          error: 'Access denied. Run Clarity as an administrator (or root) to end this process.',
          requiresAdmin: true,
        }
      }
      return {
        success: false,
        pid,
        processName,
        freedPorts: [],
        error: err instanceof Error ? err.message : 'Failed to terminate process',
      }
    }
    await waitForExit(pid, FORCE_PERIOD_MS)
  }

  // Determine which ports were actually freed (process may have been a fork
  // of a parent that re-binds, or the port may be held by another PID).
  const stillOwned = await portsOwnedBy(pid)
  const freedPorts = [...ownedPorts].filter((p) => !stillOwned.has(p))

  return { success: true, pid, processName, freedPorts }
}
