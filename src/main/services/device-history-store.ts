import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DeviceObservation, DeviceEventKind } from '../../shared/types'

const MAX_EVENTS = 2000
const MAX_TEXT_LEN = 200

const EVENT_KINDS: ReadonlySet<string> = new Set([
  'online', 'offline', 'ipv4', 'hostname', 'vendor', 'kind',
  'port_opened', 'port_closed', 'tag', 'mute',
])

let _dataDir: string | null = null
let _cache: DeviceObservation[] | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'Clarity-Dev')
  }
  return _dataDir
}

function getHistoryPath(): string {
  return join(getDataDir(), 'device-history.json')
}

export function validateObservation(raw: unknown): DeviceObservation | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0 || obj.id.length > 64) return null
  if (typeof obj.deviceId !== 'string' || obj.deviceId.length === 0 || obj.deviceId.length > 64) return null
  if (typeof obj.at !== 'number' || !Number.isFinite(obj.at)) return null
  if (typeof obj.kind !== 'string' || !EVENT_KINDS.has(obj.kind)) return null
  if (typeof obj.text !== 'string' || obj.text.length > MAX_TEXT_LEN) return null
  return {
    id: obj.id,
    at: obj.at,
    deviceId: obj.deviceId,
    kind: obj.kind as DeviceEventKind,
    text: obj.text.slice(0, MAX_TEXT_LEN),
  }
}

export function loadDeviceHistory(): DeviceObservation[] {
  if (_cache) return _cache
  try {
    const path = getHistoryPath()
    if (!existsSync(path)) return []
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    const events: DeviceObservation[] = []
    for (const raw of parsed) {
      const e = validateObservation(raw)
      if (e) events.push(e)
    }
    _cache = events.sort((a, b) => b.at - a.at)
    return _cache
  } catch {
    return []
  }
}

function persist(): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getHistoryPath()
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(_cache ?? []), 'utf-8')
  renameSync(tmpPath, path)
}

/** Append new observations (newest-last input is fine). Capped + persisted. */
export function appendDeviceHistory(events: DeviceObservation[]): void {
  const history = loadDeviceHistory()
  for (const e of events) {
    const v = validateObservation(e)
    if (v) history.push(v)
  }
  history.sort((a, b) => b.at - a.at)
  if (history.length > MAX_EVENTS) history.length = MAX_EVENTS
  _cache = history
  persist()
}

export function clearDeviceHistory(): void {
  _cache = []
  persist()
}

/** Observations for one device, newest first. */
export function deviceHistoryFor(deviceId: string): DeviceObservation[] {
  return loadDeviceHistory().filter((e) => e.deviceId === deviceId)
}
