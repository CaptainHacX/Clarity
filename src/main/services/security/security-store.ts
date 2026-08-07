import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  isIpv4,
} from '../../../shared/devices'
import type {
  SecuritySettings,
  CustomPortSetting,
  DeviceSecurityResult,
  CatalogProbeState,
  DevicePortEntry,
  PortFinding,
  SecuritySeverity,
  FullScanProgress,
  DeviceKind,
} from '../../../shared/types'

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'Clarity-Dev')
  }
  return _dataDir
}

function getSettingsPath(): string {
  return join(getDataDir(), 'security-settings.json')
}

function getResultsPath(): string {
  return join(getDataDir(), 'security-results.json')
}

function writeJsonAtomic(path: string, value: unknown): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(value), 'utf-8')
  renameSync(tmpPath, path)
}

// ─── Settings ──────────────────────────────────────────────

const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  autoProbeEnabled: false,
  autoProbeIntervalHours: 6,
  customPorts: [],
  inspectAutomatically: true,
}

export function validateCustomPort(raw: unknown): CustomPortSetting | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
  const description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 80) : ''
  return { port: obj.port, description }
}

export function validateSecuritySettings(raw: unknown): SecuritySettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SECURITY_SETTINGS, customPorts: [] }
  const obj = raw as Record<string, unknown>
  const out: SecuritySettings = { ...DEFAULT_SECURITY_SETTINGS, customPorts: [] }
  if (typeof obj.autoProbeEnabled === 'boolean') out.autoProbeEnabled = obj.autoProbeEnabled
  if (typeof obj.autoProbeIntervalHours === 'number' && Number.isFinite(obj.autoProbeIntervalHours)) {
    out.autoProbeIntervalHours = Math.min(Math.max(Math.round(obj.autoProbeIntervalHours), 1), 168)
  }
  if (Array.isArray(obj.customPorts)) {
    const seen = new Set<number>()
    for (const c of obj.customPorts) {
      const v = validateCustomPort(c)
      if (v && !seen.has(v.port)) {
        seen.add(v.port)
        out.customPorts.push(v)
      }
    }
    out.customPorts = out.customPorts.slice(0, 200)
  }
  if (typeof obj.inspectAutomatically === 'boolean') out.inspectAutomatically = obj.inspectAutomatically
  return out
}

export function loadSecuritySettings(): SecuritySettings {
  try {
    const path = getSettingsPath()
    if (!existsSync(path)) return { ...DEFAULT_SECURITY_SETTINGS }
    return validateSecuritySettings(JSON.parse(readFileSync(path, 'utf-8')) as unknown)
  } catch {
    return { ...DEFAULT_SECURITY_SETTINGS }
  }
}

export function saveSecuritySettings(settings: SecuritySettings): void {
  writeJsonAtomic(getSettingsPath(), validateSecuritySettings(settings))
}

// ─── Results ───────────────────────────────────────────────

const SEVERITIES: ReadonlySet<string> = new Set(['high', 'medium', 'low', 'untested'])
const PORT_STATES: ReadonlySet<string> = new Set(['open', 'closed', 'filtered'])
const RISK_TIERS: ReadonlySet<string> = new Set(['none', 'medium', 'high'])
const CATEGORIES: ReadonlySet<string> = new Set(['remote-access', 'file-sharing', 'web-iot', 'discovery', 'media', 'dev', 'database', 'custom'])
const FULL_SCAN_STATES: ReadonlySet<string> = new Set(['idle', 'running', 'done', 'cancelled', 'error'])

function validDeviceId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 64
}

function validateFinding(raw: unknown): PortFinding | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
  if (typeof obj.risk !== 'string' || !RISK_TIERS.has(obj.risk)) return null
  const str = (s: unknown) => (typeof s === 'string' ? s.slice(0, 300) : '')
  return {
    port: obj.port,
    service: str(obj.service),
    risk: obj.risk as PortFinding['risk'],
    title: str(obj.title),
    explanation: str(obj.explanation),
    advice: str(obj.advice),
  }
}

function validateCatalogState(raw: unknown): CatalogProbeState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
  if (typeof obj.state !== 'string' || !PORT_STATES.has(obj.state)) return null
  return {
    port: obj.port,
    service: typeof obj.service === 'string' ? obj.service.slice(0, 80) : '',
    state: obj.state as CatalogProbeState['state'],
    risk: RISK_TIERS.has(String(obj.risk)) ? (obj.risk as CatalogProbeState['risk']) : 'none',
    category: CATEGORIES.has(String(obj.category)) ? (obj.category as CatalogProbeState['category']) : 'custom',
    custom: obj.custom === true,
  }
}

function validatePortEntry(raw: unknown): DevicePortEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
  if (typeof obj.state !== 'string' || !PORT_STATES.has(obj.state)) return null
  return {
    port: obj.port,
    service: typeof obj.service === 'string' ? obj.service.slice(0, 80) : null,
    state: obj.state as DevicePortEntry['state'],
    risk: obj.risk === true,
  }
}

function validateFullScan(raw: unknown): FullScanProgress {
  const dflt: FullScanProgress = { state: 'idle', from: 1, to: 1024, checked: 0, open: 0, current: null, startedAt: null, finishedAt: null, error: null }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return dflt
  const obj = raw as Record<string, unknown>
  const out: FullScanProgress = { ...dflt }
  if (typeof obj.state === 'string' && FULL_SCAN_STATES.has(obj.state)) out.state = obj.state as FullScanProgress['state']
  if (typeof obj.from === 'number') out.from = obj.from
  if (typeof obj.to === 'number') out.to = obj.to
  if (typeof obj.checked === 'number') out.checked = obj.checked
  if (typeof obj.open === 'number') out.open = obj.open
  if (typeof obj.current === 'number') out.current = obj.current
  if (typeof obj.startedAt === 'number') out.startedAt = obj.startedAt
  if (typeof obj.finishedAt === 'number') out.finishedAt = obj.finishedAt
  if (typeof obj.error === 'string') out.error = obj.error.slice(0, 300)
  return out
}

export function validateSecurityResult(raw: unknown): DeviceSecurityResult | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.deviceId !== 'string' || !validDeviceId(obj.deviceId)) return null
  if (typeof obj.ip !== 'string' || !isIpv4(obj.ip)) return null
  const severity = SEVERITIES.has(String(obj.severity)) ? (obj.severity as SecuritySeverity) : 'untested'
  const catalog: CatalogProbeState[] = []
  if (Array.isArray(obj.catalog)) for (const c of obj.catalog) { const v = validateCatalogState(c); if (v) catalog.push(v) }
  const openPorts: DevicePortEntry[] = []
  if (Array.isArray(obj.openPorts)) for (const p of obj.openPorts) { const v = validatePortEntry(p); if (v) openPorts.push(v) }
  const findings: PortFinding[] = []
  if (Array.isArray(obj.findings)) for (const f of obj.findings) { const v = validateFinding(f); if (v) findings.push(v) }
  const serviceTypes: string[] = []
  if (Array.isArray(obj.serviceTypes)) {
    for (const s of obj.serviceTypes.slice(0, 40)) {
      if (typeof s === 'string' && s.length > 0 && s.length <= 80) serviceTypes.push(s)
    }
  }
  return {
    deviceId: obj.deviceId,
    ip: obj.ip,
    hostname: typeof obj.hostname === 'string' ? obj.hostname.slice(0, 120) : null,
    kind: typeof obj.kind === 'string' && obj.kind.length > 0 ? (obj.kind as DeviceKind) : 'unknown',
    vendor: typeof obj.vendor === 'string' ? obj.vendor.slice(0, 120) : null,
    mac: typeof obj.mac === 'string' ? obj.mac.slice(0, 32) : null,
    serviceTypes,
    tagName: typeof obj.tagName === 'string' ? obj.tagName.slice(0, 80) : null,
    online: obj.online === true,
    severity,
    findings,
    catalog,
    openPorts,
    lastScannedAt: typeof obj.lastScannedAt === 'number' ? obj.lastScannedAt : null,
    fullScan: validateFullScan(obj.fullScan),
  }
}

export function loadSecurityResults(): Record<string, DeviceSecurityResult> {
  try {
    const path = getResultsPath()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, DeviceSecurityResult> = {}
    for (const [id, raw] of Object.entries(parsed)) {
      if (!validDeviceId(id)) continue
      const r = validateSecurityResult(raw)
      if (r && r.deviceId === id) out[id] = r
    }
    return out
  } catch {
    return {}
  }
}

export function saveSecurityResults(results: Record<string, DeviceSecurityResult>): void {
  writeJsonAtomic(getResultsPath(), results)
}
