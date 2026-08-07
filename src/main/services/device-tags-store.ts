import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DeviceTag, DeviceKind } from '../../shared/types'
import { isPrivateMac } from '../../shared/devices'

const MAX_TAGS = 500

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged
      ? app.getPath('userData')
      : join(app.getPath('userData'), 'Clarity-Dev')
  }
  return _dataDir
}

function getTagsPath(): string {
  return join(getDataDir(), 'device-tags.json')
}

const DEVICE_KINDS: ReadonlySet<string> = new Set([
  'computer', 'phone', 'tablet', 'speaker', 'tv', 'printer', 'router',
  'media', 'camera', 'iot', 'unknown',
])

function isValidDeviceId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 64
}

export function validateDeviceTag(raw: unknown): DeviceTag | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const tag: DeviceTag = { muted: obj.muted === true }
  if (typeof obj.name === 'string' && obj.name.length > 0 && obj.name.length <= 80) {
    tag.name = obj.name
  }
  if (typeof obj.kind === 'string' && DEVICE_KINDS.has(obj.kind)) {
    tag.kind = obj.kind as DeviceKind
  }
  return tag
}

/** Parse the on-disk tag map, dropping malformed entries. */
export function loadDeviceTags(): Record<string, DeviceTag> {
  try {
    const path = getTagsPath()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, DeviceTag> = {}
    for (const [id, raw] of Object.entries(parsed)) {
      if (!isValidDeviceId(id)) continue
      const tag = validateDeviceTag(raw)
      if (tag) out[id] = tag
    }
    return out
  } catch {
    return {}
  }
}

export function saveDeviceTags(tags: Record<string, DeviceTag>): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getTagsPath()
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(tags), 'utf-8')
  renameSync(tmpPath, path)
}

/** Merge a tag update. Returns the updated device tag. */
export function setDeviceTag(deviceId: string, input: { name?: string | null; kind?: DeviceKind | null; muted?: boolean }): DeviceTag | null {
  if (!isValidDeviceId(deviceId)) return null
  const tags = loadDeviceTags()
  const existing = tags[deviceId] ?? { muted: false }
  const next: DeviceTag = { ...existing }
  if (input.name !== undefined) {
    next.name = typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim().slice(0, 80)
      : undefined
  }
  if (input.kind !== undefined) {
    next.kind = input.kind && DEVICE_KINDS.has(input.kind) ? input.kind : undefined
  }
  if (typeof input.muted === 'boolean') next.muted = input.muted
  if (next.muted === false && next.name === undefined && next.kind === undefined) {
    delete tags[deviceId]
  } else {
    tags[deviceId] = next
  }
  saveDeviceTags(tags)
  return tags[deviceId] ?? null
}

export function clearDeviceTag(deviceId: string): boolean {
  if (!isValidDeviceId(deviceId)) return false
  const tags = loadDeviceTags()
  if (!(deviceId in tags)) return false
  delete tags[deviceId]
  saveDeviceTags(tags)
  return true
}

/** Human label used when a private/randomized address has no vendor to look up. */
export function privateMacLabel(mac: string | null | undefined): string {
  return isPrivateMac(mac) ? 'Private address' : ''
}
