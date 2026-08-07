/**
 * Runtime validation helpers for IPC inputs from the renderer process.
 * These guard against malformed or malicious data crossing the IPC boundary.
 */

import { app } from 'electron'
import { isAbsolute } from 'path'
import type { ScanHistoryEntry, WifiExportPayload, DeviceKind, DeviceTagInput, LinkQualityRequest, FullScanRequest } from '../../shared/types'
import type { DeletionQuery } from './deletion-log-store'

/** Validate that a partial settings object only contains expected keys and safe values */
export function validateSettingsPartial(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  const allowedTopKeys = new Set([
    'theme', 'language',
    'minimizeToTray', 'showNotificationOnComplete', 'showThreatNotifications',
    'runAtStartup', 'autoUpdate', 'autoRestart', 'updateCheckIntervalHours',
    'cleaner', 'exclusions', 'ignoredSoftwareUpdates', 'backupPath', 'backupMode',
    'windowsPackageManager', 'windowsPackageManagers',
    'schedule', 'schedules', 'gameMode', 'registryIgnoredTweaks', 'alerts'
  ])

  for (const key of Object.keys(obj)) {
    if (!allowedTopKeys.has(key)) return null
  }

  // Validate theme is one of the allowed values
  if ('theme' in obj && obj.theme !== undefined) {
    if (!['dark', 'light', 'system'].includes(obj.theme as string)) return null
  }

  // Validate language is a safe locale code string (e.g. 'en', 'zh-CN')
  if ('language' in obj && obj.language !== undefined) {
    if (typeof obj.language !== 'string' || obj.language.length > 10 || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(obj.language)) return null
  }

  // Validate boolean fields have correct types
  const boolKeys = ['minimizeToTray', 'showNotificationOnComplete', 'showThreatNotifications', 'runAtStartup', 'autoUpdate', 'autoRestart'] as const
  for (const bk of boolKeys) {
    if (bk in obj && obj[bk] !== undefined && typeof obj[bk] !== 'boolean') return null
  }

  // Validate updateCheckIntervalHours is a reasonable number
  if ('updateCheckIntervalHours' in obj && obj.updateCheckIntervalHours !== undefined) {
    if (typeof obj.updateCheckIntervalHours !== 'number' || obj.updateCheckIntervalHours < 1 || obj.updateCheckIntervalHours > 168) return null
  }

  // Validate windowsPackageManager is one of the allowed values
  if ('windowsPackageManager' in obj && obj.windowsPackageManager !== undefined) {
    if (!['winget', 'choco'].includes(obj.windowsPackageManager as string)) return null
  }

  // Validate windowsPackageManagers is an array of known manager names
  if ('windowsPackageManagers' in obj && obj.windowsPackageManagers !== undefined) {
    if (!Array.isArray(obj.windowsPackageManagers)) return null
    const known = ['winget', 'choco', 'scoop', 'npm']
    if (!obj.windowsPackageManagers.every((v: unknown) => typeof v === 'string' && known.includes(v))) return null
    if (obj.windowsPackageManagers.length > known.length) return null
  }

  // Validate exclusions is an array of safe strings if present
  if ('exclusions' in obj && obj.exclusions !== undefined) {
    if (!Array.isArray(obj.exclusions)) return null
    if (!obj.exclusions.every((v: unknown) => typeof v === 'string')) return null
    // Limit number of exclusions and individual length
    if (obj.exclusions.length > 200) return null
    if (obj.exclusions.some((v: string) => v.length > 500 || v.length === 0)) return null
    // Block path traversal sequences and UNC paths in exclusions
    if (obj.exclusions.some((v: string) => v.includes('..') || v.startsWith('\\\\'))) return null
  }

  // Validate ignoredSoftwareUpdates is an array of package-id strings if present
  if ('ignoredSoftwareUpdates' in obj && obj.ignoredSoftwareUpdates !== undefined) {
    if (!Array.isArray(obj.ignoredSoftwareUpdates)) return null
    if (!obj.ignoredSoftwareUpdates.every((v: unknown) => typeof v === 'string')) return null
    if (obj.ignoredSoftwareUpdates.length > 500) return null
    if (obj.ignoredSoftwareUpdates.some((v: string) => v.length > 200 || v.length === 0)) return null
  }

  // Validate backupPath: empty string means "use default", otherwise must be an absolute,
  // safe path. Reject relative paths so persisted settings match runtime behavior in
  // getBackupDir() (which only accepts absolute paths).
  if ('backupPath' in obj && obj.backupPath !== undefined) {
    if (typeof obj.backupPath !== 'string') return null
    if (obj.backupPath.length > 1000) return null
    if (obj.backupPath.includes('..')) return null
    if (obj.backupPath.length > 0 && !isAbsolute(obj.backupPath)) return null
  }

  // Validate backupMode is one of the allowed values
  if ('backupMode' in obj && obj.backupMode !== undefined) {
    if (!['targeted', 'full'].includes(obj.backupMode as string)) return null
  }

  // Validate schedule has expected shape if present
  if ('schedule' in obj && obj.schedule !== undefined) {
    const s = obj.schedule as Record<string, unknown>
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
    const allowedScheduleKeys = new Set(['enabled', 'frequency', 'day', 'hour'])
    for (const key of Object.keys(s)) {
      if (!allowedScheduleKeys.has(key)) return null
    }
    if ('enabled' in s && typeof s.enabled !== 'boolean') return null
    if ('hour' in s && (typeof s.hour !== 'number' || s.hour < 0 || s.hour > 23)) return null
    if ('day' in s && (typeof s.day !== 'number' || s.day < 0 || s.day > 6)) return null
    if ('frequency' in s && !['daily', 'weekly', 'monthly'].includes(s.frequency as string)) return null
  }

  // Validate schedules array if present
  if ('schedules' in obj && obj.schedules !== undefined) {
    if (!Array.isArray(obj.schedules)) return null
    if (obj.schedules.length > 10) return null
    const validTaskTypes = new Set([
      'cleaner:system', 'cleaner:browsers', 'cleaner:apps', 'cleaner:gaming',
      'cleaner:recycleBin', 'cleaner:databases', 'registry', 'drivers', 'software-update', 'cve-scan'
    ])
    const validFrequencies = new Set(['daily', 'weekly', 'monthly'])
    const validStatuses = new Set(['success', 'partial', 'failed', 'never'])
    for (const entry of obj.schedules) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
      const e = entry as Record<string, unknown>
      if (typeof e.id !== 'string' || e.id.length > 100) return null
      if (typeof e.name !== 'string' || e.name.length > 100) return null
      if (typeof e.enabled !== 'boolean') return null
      if (!validFrequencies.has(e.frequency as string)) return null
      if (typeof e.day !== 'number' || e.day < 0 || e.day > 31) return null
      if (typeof e.hour !== 'number' || e.hour < 0 || e.hour > 23) return null
      if (e.minute !== undefined && (typeof e.minute !== 'number' || e.minute < 0 || e.minute > 59)) return null
      if (!Array.isArray(e.tasks) || e.tasks.length > 20) return null
      if (!e.tasks.every((t: unknown) => typeof t === 'string' && validTaskTypes.has(t as string))) return null
      if (typeof e.autoApply !== 'boolean') return null
      if (e.lastRunAt !== null && (typeof e.lastRunAt !== 'string' || e.lastRunAt.length > 50)) return null
      if (!validStatuses.has(e.lastRunStatus as string)) return null
      if (typeof e.createdAt !== 'string' || e.createdAt.length > 50) return null
    }
  }

  // Validate cleaner has expected shape if present
  if ('cleaner' in obj && obj.cleaner !== undefined) {
    const c = obj.cleaner as Record<string, unknown>
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
    const allowedCleanerKeys = new Set([
      'skipRecentMinutes', 'secureDelete', 'closeBrowsersBeforeClean',
      'createRestorePoint', 'protectRecycleBin', 'keepDeletionLog'
    ])
    for (const key of Object.keys(c)) {
      if (!allowedCleanerKeys.has(key)) return null
    }
    if ('skipRecentMinutes' in c && (typeof c.skipRecentMinutes !== 'number' || c.skipRecentMinutes < 0 || c.skipRecentMinutes > 525600)) return null
    if ('secureDelete' in c && typeof c.secureDelete !== 'boolean') return null
    if ('closeBrowsersBeforeClean' in c && typeof c.closeBrowsersBeforeClean !== 'boolean') return null
    if ('createRestorePoint' in c && typeof c.createRestorePoint !== 'boolean') return null
    if ('protectRecycleBin' in c && typeof c.protectRecycleBin !== 'boolean') return null
    if ('keepDeletionLog' in c && typeof c.keepDeletionLog !== 'boolean') return null
  }

  // Validate registryIgnoredTweaks is an array of tweak-signature strings if present
  if ('registryIgnoredTweaks' in obj && obj.registryIgnoredTweaks !== undefined) {
    if (!Array.isArray(obj.registryIgnoredTweaks)) return null
    if (obj.registryIgnoredTweaks.length > 200) return null
    if (!obj.registryIgnoredTweaks.every((v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 1024)) return null
  }

  // Validate alerts has expected shape if present
  if ('alerts' in obj && obj.alerts !== undefined) {
    const a = obj.alerts as Record<string, unknown>
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return null
    const allowedAlertKeys = new Set([
      'enabled', 'showInApp', 'showSystem',
      'cpuUsageThreshold', 'cpuTempThreshold', 'memoryThreshold',
      'diskSpaceThresholdGb', 'batteryThreshold', 'cooldownMinutes'
    ])
    for (const key of Object.keys(a)) {
      if (!allowedAlertKeys.has(key)) return null
    }
    for (const boolKey of ['enabled', 'showInApp', 'showSystem'] as const) {
      if (boolKey in a && a[boolKey] !== undefined && typeof a[boolKey] !== 'boolean') return null
    }
    // Percent thresholds must be 1..100; disk GB 1..2000; cooldown 1..1440 minutes.
    const numKeys: Array<[string, number, number]> = [
      ['cpuUsageThreshold', 1, 100],
      ['cpuTempThreshold', 1, 125],
      ['memoryThreshold', 1, 100],
      ['diskSpaceThresholdGb', 1, 2000],
      ['batteryThreshold', 1, 100],
      ['cooldownMinutes', 1, 1440],
    ]
    for (const [key, min, max] of numKeys) {
      if (key in a && a[key] !== undefined) {
        if (typeof a[key] !== 'number' || !Number.isFinite(a[key]) || a[key] < min || a[key] > max) return null
      }
    }
  }

  // Validate gameMode has expected shape if present
  if ('gameMode' in obj && obj.gameMode !== undefined) {
    const g = obj.gameMode as Record<string, unknown>
    if (typeof g !== 'object' || g === null || Array.isArray(g)) return null
    const allowedGameModeKeys = new Set(['enabledOptimizations', 'customProcessKillList', 'autoDetect', 'autoDeactivate', 'customGameProcesses'])
    for (const key of Object.keys(g)) {
      if (!allowedGameModeKeys.has(key)) return null
    }
    if ('enabledOptimizations' in g) {
      if (!Array.isArray(g.enabledOptimizations)) return null
      if (g.enabledOptimizations.length > 30) return null
      const validOptIds = new Set([
        'svc-wsearch', 'svc-sysmain', 'svc-wuauserv', 'svc-spooler', 'svc-diagtrack',
        'proc-kill-browsers', 'proc-kill-chat', 'proc-kill-updaters', 'proc-kill-custom',
        'mem-clear-standby',
        'sys-focus-assist', 'sys-power-plan', 'sys-prevent-sleep',
        'sys-disable-game-bar', 'sys-disable-fse-opt', 'sys-disable-transparency',
        'net-flush-dns', 'net-disable-nagle'
      ])
      if (!g.enabledOptimizations.every((v: unknown) => typeof v === 'string' && validOptIds.has(v as string))) return null
    }
    if ('customProcessKillList' in g) {
      if (!Array.isArray(g.customProcessKillList)) return null
      if (g.customProcessKillList.length > 50) return null
      if (!g.customProcessKillList.every((v: unknown) =>
        typeof v === 'string' && v.length > 0 && v.length <= 100 &&
        /^[A-Za-z0-9._\- ]+$/.test(v)
      )) return null
    }
    if ('autoDetect' in g && typeof g.autoDetect !== 'boolean') return null
    if ('autoDeactivate' in g && typeof g.autoDeactivate !== 'boolean') return null
    if ('customGameProcesses' in g) {
      if (!Array.isArray(g.customGameProcesses)) return null
      if (g.customGameProcesses.length > 50) return null
      if (!g.customGameProcesses.every((v: unknown) =>
        typeof v === 'string' && v.length > 0 && v.length <= 100 &&
        /^[A-Za-z0-9._\- ]+$/.test(v)
      )) return null
    }
  }

  return obj
}

/**
 * Validate that an IPC argument is a string array within reasonable bounds.
 * Returns the validated array (filtered to strings only) or an empty array on invalid input.
 */
export function validateStringArray(
  input: unknown,
  maxItems: number = 10_000,
  maxItemLength: number = 1024
): string[] | null {
  if (!Array.isArray(input)) return null
  if (input.length > maxItems) return null
  if (!input.every((v: unknown) => typeof v === 'string' && v.length <= maxItemLength)) return null
  return input as string[]
}

/** Validate a scan history entry has the expected shape and reasonable size */
export function validateHistoryEntry(input: unknown): ScanHistoryEntry | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  if (typeof obj.id !== 'string' || obj.id.length > 100) return null
  if (!['cleaner', 'registry', 'debloater', 'network', 'drivers', 'malware', 'privacy', 'startup', 'services', 'software-update', 'cve-scan'].includes(obj.type as string)) return null
  if (typeof obj.timestamp !== 'string' || obj.timestamp.length > 50) return null
  if (typeof obj.duration !== 'number' || obj.duration < 0) return null
  if (typeof obj.totalItemsFound !== 'number') return null
  if (typeof obj.totalItemsCleaned !== 'number') return null
  if (typeof obj.totalItemsSkipped !== 'number') return null
  if (typeof obj.totalSpaceSaved !== 'number') return null
  if (typeof obj.errorCount !== 'number') return null
  if (!Array.isArray(obj.categories)) return null
  // Limit categories array size to prevent disk-fill attacks
  if (obj.categories.length > 50) return null
  // Optional deletion-log window — absent on entries from older versions
  if (obj.cleanedFrom !== undefined && (typeof obj.cleanedFrom !== 'string' || obj.cleanedFrom.length > 50)) return null
  if (obj.cleanedTo !== undefined && (typeof obj.cleanedTo !== 'string' || obj.cleanedTo.length > 50)) return null

  return obj as unknown as ScanHistoryEntry
}

/**
 * Validate a deletion-log query. Returns a normalized query, or null when the
 * input is malformed. An empty object is valid and means "everything".
 */
export function validateDeletionQuery(input: unknown): DeletionQuery | null {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  const allowedKeys = new Set(['from', 'to', 'origin', 'offset', 'limit'])
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) return null
  }

  const query: DeletionQuery = {}
  if (obj.origin !== undefined) {
    if (!['local', 'cloud', 'cli'].includes(obj.origin as string)) return null
    query.origin = obj.origin as DeletionQuery['origin']
  }
  for (const key of ['from', 'to'] as const) {
    const val = obj[key]
    if (val === undefined) continue
    if (typeof val !== 'string' || val.length > 50 || Number.isNaN(Date.parse(val))) return null
    query[key] = val
  }
  for (const key of ['offset', 'limit'] as const) {
    const val = obj[key]
    if (val === undefined) continue
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return null
    query[key] = val
  }
  return query
}

/**
 * Validate a Wi-Fi export payload sent from the renderer before writing it to
 * disk. Bounds every array so a compromised renderer can't fill the disk.
 */
export function validateWifiExportPayload(input: unknown): WifiExportPayload | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  if (typeof obj.exportedAt !== 'number' || !Number.isFinite(obj.exportedAt)) return null
  if (typeof obj.generatedBy !== 'string' || obj.generatedBy.length > 100) return null
  if (obj.connected !== null && (typeof obj.connected !== 'object' || Array.isArray(obj.connected))) return null
  if (!Array.isArray(obj.networks) || obj.networks.length > 1000) return null
  if (obj.samples === null || typeof obj.samples !== 'object' || Array.isArray(obj.samples)) return null
  const sampleKeys = Object.keys(obj.samples)
  if (sampleKeys.length > 1000) return null
  for (const key of sampleKeys) {
    if (key.length > 200) return null
    const series = (obj.samples as Record<string, unknown>)[key]
    if (!Array.isArray(series) || series.length > 500) return null
    for (const point of series) {
      if (point === null || typeof point !== 'object' || Array.isArray(point)) return null
      const p = point as Record<string, unknown>
      if (typeof p.t !== 'number' || !Number.isFinite(p.t)) return null
    }
  }
  return obj as unknown as WifiExportPayload
}

/**
 * Validate a device-tag update. Bounds every string; only known kinds pass.
 */
export function validateDeviceTagInput(input: unknown): DeviceTagInput | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.deviceId !== 'string' || obj.deviceId.length === 0 || obj.deviceId.length > 64) return null
  const out: DeviceTagInput = { deviceId: obj.deviceId }
  if (obj.name !== undefined && obj.name !== null) {
    if (typeof obj.name !== 'string' || obj.name.length > 80) return null
    out.name = obj.name
  }
  if (obj.kind !== undefined && obj.kind !== null) {
    const allowed: ReadonlySet<string> = new Set([
      'computer', 'phone', 'tablet', 'speaker', 'tv', 'printer', 'router',
      'media', 'camera', 'iot', 'unknown',
    ])
    if (typeof obj.kind !== 'string' || !allowed.has(obj.kind)) return null
    out.kind = obj.kind as DeviceKind
  }
  if (obj.muted !== undefined) {
    if (typeof obj.muted !== 'boolean') return null
    out.muted = obj.muted
  }
  return out
}

/** Validate a link-quality request (an IP plus an optional bounded burst). */
export function validateLinkQualityRequest(input: unknown): LinkQualityRequest | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.ip !== 'string' || obj.ip.length === 0 || obj.ip.length > 45) return null
  const out: LinkQualityRequest = { ip: obj.ip }
  if (obj.burst !== undefined) {
    if (typeof obj.burst !== 'number' || !Number.isInteger(obj.burst) || obj.burst < 1 || obj.burst > 20) return null
    out.burst = obj.burst
  }
  return out
}

/** Validate a probe-device request: just a bounded IP string. */
export function validateProbeDeviceRequest(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 45) return null
  return input
}

/** Validate a full-scan request: a bounded IP plus a 1..65535 port range. */
export function validateFullScanRequest(input: unknown): FullScanRequest | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.ip !== 'string' || obj.ip.length === 0 || obj.ip.length > 45) return null
  const from = obj.from
  const to = obj.to
  if (typeof from !== 'number' || !Number.isInteger(from)) return null
  if (typeof to !== 'number' || !Number.isInteger(to)) return null
  if (from < 1 || to > 65535 || from > to) return null
  return { ip: obj.ip, from, to }
}

/** Validate a security-settings patch: must be a plain object (service clamps values). */
export function validateSecuritySettingsPatch(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

