import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DevicePortEntry, DevicePortState } from '../../shared/types'

const MAX_PORTS_PER_DEVICE = 500

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'Clarity-Dev')
  }
  return _dataDir
}

function getProbesPath(): string {
  return join(getDataDir(), 'device-probes.json')
}

export interface DeviceProbeResult {
  ports: DevicePortEntry[]
  scannedAt: number
}

export function validatePortEntry(raw: unknown): DevicePortEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.port !== 'number' || !Number.isInteger(obj.port) || obj.port < 1 || obj.port > 65535) return null
  const state = obj.state as DevicePortState
  if (state !== 'open' && state !== 'closed' && state !== 'filtered') return null
  return {
    port: obj.port,
    service: typeof obj.service === 'string' && obj.service.length <= 80 ? obj.service : null,
    state,
    risk: obj.risk === true,
  }
}

export function loadDeviceProbes(): Record<string, DeviceProbeResult> {
  try {
    const path = getProbesPath()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, DeviceProbeResult> = {}
    for (const [id, raw] of Object.entries(parsed)) {
      if (id.length === 0 || id.length > 64) continue
      const obj = raw as Record<string, unknown>
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
      if (typeof obj.scannedAt !== 'number' || !Number.isFinite(obj.scannedAt)) continue
      if (!Array.isArray(obj.ports)) continue
      const ports: DevicePortEntry[] = []
      for (const p of obj.ports) {
        const v = validatePortEntry(p)
        if (v) ports.push(v)
      }
      out[id] = { ports, scannedAt: obj.scannedAt }
    }
    return out
  } catch {
    return {}
  }
}

export function saveDeviceProbeResults(deviceId: string, ports: DevicePortEntry[]): void {
  const valid = ports.filter((p) => validatePortEntry(p)).slice(0, MAX_PORTS_PER_DEVICE)
  const all = loadDeviceProbes()
  all[deviceId] = { ports: valid, scannedAt: Date.now() }
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getProbesPath()
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(all), 'utf-8')
  renameSync(tmpPath, path)
}

/** Forget every stored probe result (used by the Security tool's Reset). */
export function clearDeviceProbes(): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getProbesPath()
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, '{}', 'utf-8')
  renameSync(tmpPath, path)
}
