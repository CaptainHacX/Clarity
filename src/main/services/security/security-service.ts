import * as si from 'systeminformation'
import { scanDevices } from '../device-scanner'
import { getFullCatalog } from './port-catalog'
import { probePorts, scanRange, assertLanTargetAny, isLanTargetAny } from './port-scanner'
import { buildFindings, computeSeverity } from './risk-engine'
import {
  loadSecuritySettings,
  saveSecuritySettings,
  validateSecuritySettings,
  loadSecurityResults,
  saveSecurityResults,
} from './security-store'
import { saveDeviceProbeResults, clearDeviceProbes } from '../device-probes-store'
import { appendDeviceHistory } from '../device-history-store'
import type {
  SecuritySettings,
  DeviceSecurityResult,
  CatalogProbeState,
  DevicePortEntry,
  SecuritySnapshot,
  SecurityScanJob,
  FullScanProgress,
  FullScanRequest,
  FullScanStartResult,
  DeviceKind,
  PortCatalogEntry,
} from '../../../shared/types'
import { isIpv4, isPrivateIpv4 } from '../../../shared/devices'

let _settings: SecuritySettings = loadSecuritySettings()
let _results: Record<string, DeviceSecurityResult> = loadSecurityResults()
let _job: SecurityScanJob = { state: 'idle', deviceCount: 0, checked: 0, total: 0 }
let _jobActive = false
let _hostIpv4s: string[] = []
let _lastScanAllAt = Date.now()
let _schedulerTimer: ReturnType<typeof setInterval> | null = null
const _fullScanTokens = new Map<string, { cancelled: boolean }>()

interface Target {
  id: string
  ip: string | null
  hostname: string | null
  kind: DeviceKind
  vendor: string | null
  mac: string | null
  serviceTypes: string[]
  tagName: string | null
  online: boolean
}

function defaultFullScan(): FullScanProgress {
  return { state: 'idle', from: 1, to: 1024, checked: 0, open: 0, current: null, startedAt: null, finishedAt: null, error: null }
}

function emptyTarget(id: string, ip: string | null): Target {
  return { id, ip, hostname: null, kind: 'unknown', vendor: null, mac: null, serviceTypes: [], tagName: null, online: true }
}

function emptyResult(t: Target): DeviceSecurityResult {
  return {
    deviceId: t.id,
    ip: t.ip ?? '',
    hostname: t.hostname,
    kind: t.kind,
    vendor: t.vendor,
    mac: t.mac,
    serviceTypes: t.serviceTypes,
    tagName: t.tagName,
    online: t.online,
    severity: 'untested',
    findings: [],
    catalog: [],
    openPorts: [],
    lastScannedAt: null,
    fullScan: defaultFullScan(),
  }
}

/** Carry the identity fields forward onto whatever record already exists. */
function withIdentity(result: DeviceSecurityResult, t: Target): DeviceSecurityResult {
  return {
    ...result,
    ip: t.ip ?? result.ip,
    hostname: t.hostname ?? result.hostname,
    kind: t.kind !== 'unknown' ? t.kind : result.kind,
    vendor: t.vendor ?? result.vendor,
    mac: t.mac ?? result.mac,
    serviceTypes: t.serviceTypes.length ? t.serviceTypes : result.serviceTypes,
    tagName: t.tagName ?? result.tagName,
  }
}

/**
 * Every private IPv4 bound to a real (non-virtual, non-internal) interface,
 * plus the scanner's reported primary IP. Kept as a set so a VPN or container
 * default route never causes the LAN guard to reject devices on the physical
 * LAN the tools actually discovered them on.
 */
async function collectHostIpv4s(extra: string | null): Promise<string[]> {
  const set = new Set<string>()
  if (extra && isPrivateIpv4(extra)) set.add(extra)
  try {
    const ifaces = await si.networkInterfaces()
    for (const i of ifaces) {
      if (i.internal || i.virtual) continue
      if (i.ip4 && isPrivateIpv4(i.ip4)) set.add(i.ip4)
    }
  } catch {
    // No interface info — the guard falls back to "private-only".
  }
  return [...set]
}

async function enumerateTargets(): Promise<{ targets: Target[]; hostIpv4s: string[] }> {
  const snap = await scanDevices()
  const hostIpv4 = snap.host.ipv4[0] ?? null
  const hostIpv4s = await collectHostIpv4s(hostIpv4)
  const targets = snap.devices.map((d) => ({
    id: d.id,
    ip: d.ipv4[0] ?? null,
    hostname: d.hostname,
    kind: d.kind,
    vendor: d.vendor,
    mac: d.mac,
    serviceTypes: d.services.map((s) => s.type),
    tagName: d.tag?.name ?? null,
    online: d.status === 'online',
  }))
  return { targets, hostIpv4s }
}

/** Make sure `_hostIpv4s` is populated before a LAN guard consults it. */
async function ensureHostIpv4s(): Promise<void> {
  if (_hostIpv4s.length > 0) return
  try {
    _hostIpv4s = await collectHostIpv4s(null)
  } catch {
    _hostIpv4s = []
  }
}

function portObservation(deviceId: string, kind: 'port_opened' | 'port_closed', port: number, service: string | null): {
  id: string
  at: number
  deviceId: string
  kind: 'port_opened' | 'port_closed'
  text: string
} {
  return {
    id: `${kind}-${deviceId}-${port}-${Date.now()}`,
    at: Date.now(),
    deviceId,
    kind,
    text: `Port ${port} ${kind === 'port_opened' ? 'opened' : 'closed'}${service ? ` (${service})` : ''}`,
  }
}

async function scanTarget(target: Target, catalog: PortCatalogEntry[]): Promise<void> {
  const prev = _results[target.id]
  if (!target.ip || !isIpv4(target.ip) || !target.online) {
    _results[target.id] = prev
      ? withIdentity({ ...prev, online: target.online, severity: target.online ? prev.severity : prev.severity }, target)
      : emptyResult(target)
    return
  }
  assertLanTargetAny(target.ip, _hostIpv4s)

  const outcomes = await probePorts(target.ip, catalog.map((e) => e.port))
  const stateByPort = new Map(outcomes.map((o) => [o.port, o.state]))
  const states: CatalogProbeState[] = catalog.map((e) => ({
    port: e.port,
    service: e.service,
    state: stateByPort.get(e.port) ?? 'filtered',
    risk: e.risk as CatalogProbeState['risk'],
    category: e.category,
    custom: e.custom ?? false,
  }))
  const openPorts: DevicePortEntry[] = states
    .filter((s) => s.state === 'open')
    .map((s) => ({ port: s.port, service: s.service, state: 'open', risk: s.risk !== 'none' }))
  const openEntries = catalog.filter((e) => stateByPort.get(e.port) === 'open')
  const findings = buildFindings(openEntries)
  const severity = computeSeverity(findings, true)

  const prevOpen = new Set((prev?.openPorts ?? []).map((p) => p.port))
  const nowOpen = new Set(openPorts.map((p) => p.port))
  const events: ReturnType<typeof portObservation>[] = []
  // A first observation isn't a change — only record transitions.
  if (prev?.lastScannedAt != null) {
    for (const p of openPorts) if (!prevOpen.has(p.port)) events.push(portObservation(target.id, 'port_opened', p.port, p.service))
    for (const p of prev?.openPorts ?? []) if (!nowOpen.has(p.port)) events.push(portObservation(target.id, 'port_closed', p.port, p.service))
  }
  if (events.length > 0) appendDeviceHistory(events)

  _results[target.id] = {
    deviceId: target.id,
    ip: target.ip,
    hostname: target.hostname,
    kind: target.kind,
    vendor: target.vendor,
    mac: target.mac,
    serviceTypes: target.serviceTypes,
    tagName: target.tagName,
    online: true,
    severity,
    findings,
    catalog: states,
    openPorts,
    lastScannedAt: Date.now(),
    fullScan: prev?.fullScan ?? defaultFullScan(),
  }
  saveDeviceProbeResults(target.id, openPorts)
}

export async function scanAll(): Promise<SecuritySnapshot> {
  if (_jobActive) return getSecuritySnapshot()
  _jobActive = true
  try {
    const { targets, hostIpv4s } = await enumerateTargets()
    _hostIpv4s = hostIpv4s
    const catalog = getFullCatalog(_settings.customPorts)
    _job = { state: 'running', deviceCount: targets.length, checked: 0, total: targets.length }

    // Seed every target immediately so the dashboard can render the full device
    // list (with its real identity) while the probes are still running, instead
    // of showing nothing until the sweep finishes.
    for (const t of targets) {
      const prev = _results[t.id]
      _results[t.id] = prev ? withIdentity(prev, t) : emptyResult(t)
    }

    let checked = 0
    for (const target of targets) {
      try {
        await scanTarget(target, catalog)
      } catch {
        // keep going; one bad target must not fail the sweep
      }
      checked += 1
      _job.checked = checked
    }
    _job = { ..._job, state: 'done' }
    _lastScanAllAt = Date.now()
    saveSecurityResults(_results)
  } finally {
    _jobActive = false
  }
  return getSecuritySnapshot()
}

export async function scanDeviceByIp(ip: string): Promise<DeviceSecurityResult | null> {
  if (!isIpv4(ip)) return null
  const { targets, hostIpv4s } = await enumerateTargets()
  _hostIpv4s = hostIpv4s
  const target = targets.find((t) => t.ip === ip)
  if (!target) return null
  const catalog = getFullCatalog(_settings.customPorts)
  await scanTarget(target, catalog)
  saveSecurityResults(_results)
  return _results[target.id] ?? null
}

function resultIdForIp(ip: string): string {
  for (const r of Object.values(_results)) {
    if (r.ip === ip) return r.deviceId
  }
  return `ip:${ip}`
}

/**
 * Begin a full port sweep of one device.
 *
 * This resolves as soon as the sweep is *running*, not when it finishes. It
 * used to await the whole thing, so a 1-65535 pass held the IPC call open for
 * minutes: the button sat spinning, the live progress bar never got a chance to
 * poll, and any hiccup surfaced as a bare "Scan failed". Now the reason comes
 * back with the rejection, and progress is readable from the first second.
 */
export async function startFullScan(req: FullScanRequest): Promise<FullScanStartResult> {
  const { ip, from, to } = req
  if (!ip) return { ok: false, error: 'This device has no IPv4 address to scan.' }
  if (!isIpv4(ip)) return { ok: false, error: `"${ip}" is not a valid IPv4 address.` }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) {
    return { ok: false, error: 'Port range must be between 1 and 65535, low to high.' }
  }
  if (_fullScanTokens.has(ip)) return { ok: false, error: 'A full scan is already running for this device.' }

  await ensureHostIpv4s()
  if (!isLanTargetAny(ip, _hostIpv4s)) {
    // The LAN list can be stale right after a network change — re-derive it from
    // the live device scan once before refusing.
    try {
      const { hostIpv4s } = await enumerateTargets()
      _hostIpv4s = hostIpv4s
    } catch {
      // Keep whatever we had.
    }
    if (!isLanTargetAny(ip, _hostIpv4s)) {
      return { ok: false, error: `${ip} is not on your local network — Clarity only scans the LAN.` }
    }
  }

  const id = resultIdForIp(ip)
  const now = Date.now()
  const base = _results[id] ?? emptyResult(emptyTarget(id, ip))
  _results[id] = {
    ...base,
    ip,
    online: true,
    fullScan: { state: 'running', from, to, checked: 0, open: 0, current: null, startedAt: now, finishedAt: null, error: null },
  }
  saveSecurityResults(_results)

  const token = { cancelled: false }
  _fullScanTokens.set(ip, token)
  void runFullScan(id, ip, from, to, now, token)
  return { ok: true, error: null }
}

async function runFullScan(
  id: string,
  ip: string,
  from: number,
  to: number,
  startedAt: number,
  token: { cancelled: boolean },
): Promise<void> {
  const recordError = (message: string): void => {
    const cur = _results[id]
    if (!cur) return
    _results[id] = { ...cur, fullScan: { ...cur.fullScan, state: 'error', error: message, finishedAt: Date.now() } }
    saveSecurityResults(_results)
  }

  try {
    const prevOpen = new Set((_results[id]?.openPorts ?? []).map((p) => p.port))
    const catalog = getFullCatalog(_settings.customPorts)
    const result = await scanRange(ip, from, to, {
      onProgress: (p) => {
        const cur = _results[id]
        if (!cur) return
        _results[id] = { ...cur, fullScan: { ...cur.fullScan, checked: p.checked, open: p.open, current: p.current } }
      },
      isCancelled: () => token.cancelled,
    })

    const openEntries = result.open.map((port) => {
      const known = catalog.find((e) => e.port === port)
      return { port, service: known?.service ?? null, state: 'open' as const, risk: known ? known.risk !== 'none' : false }
    })
    const events: ReturnType<typeof portObservation>[] = []
    for (const p of openEntries) if (!prevOpen.has(p.port)) events.push(portObservation(id, 'port_opened', p.port, p.service))
    if (events.length > 0) appendDeviceHistory(events)

    const cur = _results[id]
    if (cur) {
      const merged = [...cur.openPorts, ...openEntries]
      const seen = new Set<number>()
      const deduped = merged.filter((p) => (seen.has(p.port) ? false : (seen.add(p.port), true)))
      _results[id] = {
        ...cur,
        openPorts: deduped.slice(0, 500),
        fullScan: {
          state: result.aborted ? 'cancelled' : 'done',
          from,
          to,
          checked: result.checked,
          open: result.open.length,
          current: null,
          startedAt,
          finishedAt: Date.now(),
          error: null,
        },
      }
      saveDeviceProbeResults(id, _results[id].openPorts)
      saveSecurityResults(_results)
    }
  } catch (err) {
    recordError(err instanceof Error ? err.message : 'Full scan failed')
  } finally {
    _fullScanTokens.delete(ip)
  }
}

export function cancelFullScan(ip: string): void {
  const token = _fullScanTokens.get(ip)
  if (token) token.cancelled = true
}

export function getFullScanStatus(ip: string): FullScanProgress {
  for (const r of Object.values(_results)) {
    if (r.ip === ip) return { ...r.fullScan }
  }
  return defaultFullScan()
}

export function getSecuritySnapshot(): SecuritySnapshot {
  return {
    devices: Object.values(_results).map((r) => ({ ...r, fullScan: { ...r.fullScan } })),
    job: { ..._job },
    scannedAt: Date.now(),
  }
}

export function getSecuritySettings(): SecuritySettings {
  return { ..._settings, customPorts: _settings.customPorts.map((c) => ({ ...c })) }
}

export function setSecuritySettings(patch: Partial<SecuritySettings>): SecuritySettings {
  _settings = validateSecuritySettings({ ..._settings, ...patch })
  saveSecuritySettings(_settings)
  return getSecuritySettings()
}

export function resetSecurityResults(): void {
  _results = {}
  _job = { state: 'idle', deviceCount: 0, checked: 0, total: 0 }
  for (const t of _fullScanTokens.keys()) _fullScanTokens.delete(t)
  saveSecurityResults({})
  clearDeviceProbes()
}

// ─── Scheduled scans ───────────────────────────────────────

export function startSecurityScheduler(): void {
  if (_schedulerTimer) return
  _schedulerTimer = setInterval(() => {
    try {
      const s = getSecuritySettings()
      if (!s.autoProbeEnabled) return
      if (_jobActive) return
      const intervalMs = Math.min(Math.max(s.autoProbeIntervalHours, 1), 168) * 3600_000
      if (Date.now() - _lastScanAllAt < intervalMs) return
      void scanAll()
    } catch {
      // never let the scheduler crash the app
    }
  }, 60_000)
}

export function stopSecurityScheduler(): void {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer)
    _schedulerTimer = null
  }
}
