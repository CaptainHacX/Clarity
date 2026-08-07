import { create } from 'zustand'
import type {
  DeviceSecurityResult,
  FullScanProgress,
  FullScanRequest,
  FullScanStartResult,
  SecuritySeverity,
  SecuritySettings,
  SecuritySnapshot,
} from '@shared/types'

const RESULTS_POLL_MS = 1200
const STATUS_POLL_MS = 700

export type SecurityView = 'device' | 'service'

interface SecurityStoreState {
  snapshot: SecuritySnapshot | null
  settings: SecuritySettings | null
  scanning: boolean
  /** IPs with a single-device probe in flight, so rows can show their own spinner. */
  probing: string[]
  error: string | null
  selectedId: string | null
  view: SecurityView
  scanAll: () => Promise<void>
  scanDevice: (ip: string) => Promise<boolean>
  setSelected: (id: string | null) => void
  setView: (view: SecurityView) => void
  fullScanStart: (request: FullScanRequest) => Promise<FullScanStartResult>
  fullScanCancel: (ip: string) => Promise<void>
  fullScanStatus: (ip: string) => Promise<FullScanProgress | null>
  pollFullScan: (ip: string) => void
  loadSettings: () => Promise<void>
  reload: () => Promise<void>
  updateSettings: (patch: Partial<SecuritySettings>) => Promise<void>
  reset: () => Promise<void>
  start: () => void
  stop: () => void
}

let timer: ReturnType<typeof setInterval> | null = null
let fullScanTimer: ReturnType<typeof setInterval> | null = null
let settingsLoaded = false

function mergeSnapshot(state: SecurityStoreState, snapshot: SecuritySnapshot): Partial<SecurityStoreState> {
  const selectedId =
    state.selectedId && snapshot.devices.some((d) => d.deviceId === state.selectedId)
      ? state.selectedId
      : (snapshot.devices[0]?.deviceId ?? null)
  return { selectedId }
}

const SEVERITY_TIER: Record<SecuritySeverity, number> = { high: 3, medium: 2, low: 1, untested: 0 }

/** Pick the highest-risk online device to auto-open in the Risk Inspector. */
function pickAutoInspect(snapshot: SecuritySnapshot, settings: SecuritySettings | null): string | null {
  if (!settings?.inspectAutomatically) return null
  let best: DeviceSecurityResult | null = null
  for (const d of snapshot.devices) {
    if (!d.online || d.severity === 'untested') continue
    if (!best || SEVERITY_TIER[d.severity] > SEVERITY_TIER[best.severity]) best = d
  }
  return best?.deviceId ?? null
}

function patchResult(state: SecurityStoreState, deviceId: string, patch: Partial<DeviceSecurityResult>): Partial<SecurityStoreState> {
  if (!state.snapshot) return {}
  const devices = state.snapshot.devices.map((d) => (d.deviceId === deviceId ? { ...d, ...patch } : d))
  return { snapshot: { ...state.snapshot, devices } }
}

export const useSecurityStore = create<SecurityStoreState>((set, get) => ({
  snapshot: null,
  settings: null,
  scanning: false,
  probing: [],
  error: null,
  selectedId: null,
  view: 'device',

  scanAll: async () => {
    if (get().scanning) return
    set({ scanning: true, error: null })
    try {
      const snapshot = await window.clarity.securityScanAll()
      set((state) => {
        const autoId = pickAutoInspect(snapshot, get().settings)
        const selectedId = autoId ?? mergeSnapshot(state, snapshot).selectedId
        return { snapshot, selectedId }
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Scan failed' })
    } finally {
      set({ scanning: false })
    }
  },

  scanDevice: async (ip: string) => {
    if (!ip) return false
    set((s) => ({ probing: s.probing.includes(ip) ? s.probing : [...s.probing, ip] }))
    try {
      const result = await window.clarity.securityScanDevice(ip)
      if (!result) return false
      set((state) => ({ ...patchResult(state, result.deviceId, result) }))
      return true
    } catch {
      return false
    } finally {
      set((s) => ({ probing: s.probing.filter((x) => x !== ip) }))
    }
  },

  setSelected: (id) => set({ selectedId: id }),
  setView: (view) => set({ view }),

  fullScanStart: async (request) => {
    try {
      const result = await window.clarity.securityFullScanStart(request)
      if (result?.ok) get().pollFullScan(request.ip)
      return result ?? { ok: false, error: 'The scanner did not respond.' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The scanner did not respond.' }
    }
  },

  fullScanCancel: async (ip) => {
    await window.clarity.securityFullScanCancel(ip)
  },

  fullScanStatus: (ip) => window.clarity.securityFullScanStatus(ip),

  loadSettings: async () => {
    try {
      const settings = await window.clarity.securitySettingsGet()
      set({ settings })
      settingsLoaded = true
    } catch {
      // Non-critical; keep whatever we have.
    }
  },

  pollFullScan: (ip: string) => {
    if (fullScanTimer) clearInterval(fullScanTimer)
    fullScanTimer = setInterval(() => {
      void (async () => {
        const status = await window.clarity.securityFullScanStatus(ip)
        if (!status) return
        set((state) => {
          if (!state.snapshot) return {}
          const device = state.snapshot.devices.find((d) => d.ip === ip)
          if (!device) return {}
          return patchResult(state, device.deviceId, { fullScan: status })
        })
        if (status.state !== 'running') {
          if (fullScanTimer) clearInterval(fullScanTimer)
          fullScanTimer = null
          // Pick up the ports the sweep found.
          void get().reload()
        }
      })()
    }, STATUS_POLL_MS)
  },

  reload: async () => {
    try {
      const snapshot = await window.clarity.securityResultsGet()
      set({ snapshot, ...mergeSnapshot(get(), snapshot) })
    } catch {
      // Non-critical; keep whatever we have.
    }
  },

  updateSettings: async (patch) => {
    const next = await window.clarity.securitySettingsSet(patch)
    if (next) set({ settings: next })
  },

  reset: async () => {
    await window.clarity.securityClearResults()
    set({ snapshot: null, selectedId: null })
    await get().reload()
  },

  start: () => {
    if (!settingsLoaded) {
      void get().loadSettings()
    }
    if (timer) return
    timer = setInterval(() => {
      void get().reload()
    }, RESULTS_POLL_MS)
  },

  stop: () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (fullScanTimer) {
      clearInterval(fullScanTimer)
      fullScanTimer = null
    }
  },
}))
