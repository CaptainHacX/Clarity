import { create } from 'zustand'
import type {
  DevicesProbeResult,
  DevicesSnapshot,
  DeviceObservation,
  DeviceTagInput,
  LinkQuality,
  NetworkDevice,
  ServiceInspection,
} from '@shared/types'

const POLL_INTERVAL_MS = 5000
const MAX_HISTORY = 500
const STATUS_FILTER_KEY = 'clarity.devices.statusFilter'
const DEMO_MODE_KEY = 'clarity.devices.demoMode'

export type DeviceStatusFilter = 'all' | 'online' | 'offline'
export type DeviceDetailTab = 'general' | 'ports' | 'history' | 'local'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return allowed.includes(raw as T) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private-mode storage failures must never break the tool.
  }
}

interface DevicesStoreState {
  snapshot: DevicesSnapshot | null
  scanning: boolean
  error: string | null
  hasScanned: boolean
  selectedId: string | null
  detailTab: DeviceDetailTab
  query: string
  statusFilter: DeviceStatusFilter
  demoMode: boolean
  history: DeviceObservation[]
  /** Timestamp the user last opened the alert inbox, for the unread badge. */
  alertsSeenAt: number
  inspections: Record<string, ServiceInspection>
  inspecting: string[]
  manualScan: () => Promise<void>
  pollScan: () => Promise<void>
  setSelected: (id: string | null) => void
  setDetailTab: (tab: DeviceDetailTab) => void
  setQuery: (query: string) => void
  setStatusFilter: (filter: DeviceStatusFilter) => void
  toggleDemoMode: () => void
  markAlertsSeen: () => void
  tagDevice: (input: DeviceTagInput) => Promise<void>
  clearTag: (deviceId: string) => Promise<void>
  probeDevice: (ip: string) => Promise<void>
  measureLink: (ip: string) => Promise<void>
  inspectService: (ip: string, port: number) => Promise<ServiceInspection | null>
  reloadHistory: () => Promise<void>
  clearHistory: () => Promise<void>
  start: () => void
  stop: () => void
  reset: () => void
}

let timer: ReturnType<typeof setInterval> | null = null

function mergeHistory(history: DeviceObservation[], events: DeviceObservation[]): DeviceObservation[] {
  if (!events.length) return history
  const seen = new Set(history.map((e) => e.id))
  const fresh = events.filter((e) => !seen.has(e.id))
  if (!fresh.length) return history
  return [...fresh, ...history].sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY)
}

function mergeSnapshot(state: DevicesStoreState, snapshot: DevicesSnapshot): Partial<DevicesStoreState> {
  const selectedId =
    state.selectedId && snapshot.devices.some((d) => d.id === state.selectedId)
      ? state.selectedId
      : (snapshot.devices[0]?.id ?? null)
  return { selectedId, history: mergeHistory(state.history, snapshot.newEvents) }
}

function patchDevice(state: DevicesStoreState, id: string, patch: Partial<NetworkDevice>): Partial<DevicesStoreState> {
  if (!state.snapshot) return {}
  const devices = state.snapshot.devices.map((d) => (d.id === id ? { ...d, ...patch } : d))
  return { snapshot: { ...state.snapshot, devices } }
}

export const useDevicesStore = create<DevicesStoreState>((set, get) => ({
  snapshot: null,
  scanning: false,
  error: null,
  hasScanned: false,
  selectedId: null,
  detailTab: 'general',
  query: '',
  // The status filter sticks across tools and restarts; the search box
  // deliberately doesn't — a forgotten search term hides devices with nothing
  // on screen to explain why.
  statusFilter: readStored(STATUS_FILTER_KEY, ['all', 'online', 'offline'] as const, 'all'),
  demoMode: readStored(DEMO_MODE_KEY, ['true', 'false'] as const, 'false') === 'true',
  history: [],
  alertsSeenAt: 0,
  inspections: {},
  inspecting: [],

  manualScan: async () => {
    if (get().scanning) return
    set({ scanning: true, error: null })
    try {
      const snapshot = await window.clarity.devicesScan()
      set({ snapshot, ...mergeSnapshot(get(), snapshot), hasScanned: true })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Scan failed' })
    } finally {
      set({ scanning: false })
    }
  },

  pollScan: async () => {
    if (get().scanning) return
    try {
      const snapshot = await window.clarity.devicesScan()
      set({ snapshot, ...mergeSnapshot(get(), snapshot), hasScanned: true })
    } catch {
      // Background polling must never clobber state or surface error banners.
    }
  },

  setSelected: (id) => set({ selectedId: id, detailTab: 'general' }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setQuery: (query) => set({ query }),
  setStatusFilter: (statusFilter) => {
    persist(STATUS_FILTER_KEY, statusFilter)
    set({ statusFilter })
  },
  toggleDemoMode: () =>
    set((s) => {
      persist(DEMO_MODE_KEY, String(!s.demoMode))
      return { demoMode: !s.demoMode }
    }),
  markAlertsSeen: () => set({ alertsSeenAt: Date.now() }),

  tagDevice: async (input) => {
    const tag = await window.clarity.devicesTagSet(input)
    if (tag) set((state) => ({ ...patchDevice(state, input.deviceId, { tag }) }))
  },

  clearTag: async (deviceId) => {
    const ok = await window.clarity.devicesTagClear(deviceId)
    if (ok) set((state) => ({ ...patchDevice(state, deviceId, { tag: null }) }))
  },

  probeDevice: async (ip: string) => {
    const result: DevicesProbeResult | null = await window.clarity.devicesProbe(ip)
    if (!result) return
    set((state) => {
      const target = state.snapshot?.devices.find((d) => d.ipv4.includes(ip))
      if (!target) return {}
      return {
        ...patchDevice(state, target.id, {
          status: result.online ? 'online' : 'offline',
          linkQuality: result.linkQuality,
        }),
      }
    })
  },

  measureLink: async (ip: string) => {
    const quality: LinkQuality | null = await window.clarity.devicesMeasureLink({ ip, burst: 5 })
    set((state) => {
      const target = state.snapshot?.devices.find((d) => d.ipv4.includes(ip))
      if (!target || !quality) return {}
      return { ...patchDevice(state, target.id, { linkQuality: quality }) }
    })
  },

  inspectService: async (ip: string, port: number) => {
    const key = `${ip}:${port}`
    set((s) => ({ inspecting: s.inspecting.includes(key) ? s.inspecting : [...s.inspecting, key] }))
    try {
      const result = await window.clarity.devicesInspectService({ ip, port })
      if (result) set((s) => ({ inspections: { ...s.inspections, [key]: result } }))
      return result
    } catch {
      return null
    } finally {
      set((s) => ({ inspecting: s.inspecting.filter((x) => x !== key) }))
    }
  },

  reloadHistory: async () => {
    try {
      const history = await window.clarity.devicesHistoryGet()
      set({ history: history.slice(0, MAX_HISTORY) })
    } catch {
      // Non-critical; keep whatever we have.
    }
  },

  clearHistory: async () => {
    await window.clarity.devicesHistoryClear()
    set({ history: [] })
  },

  start: () => {
    if (timer) return
    timer = setInterval(() => {
      void get().pollScan()
    }, POLL_INTERVAL_MS)
  },

  stop: () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },

  reset: () => set({
    snapshot: null,
    scanning: false,
    error: null,
    hasScanned: false,
    selectedId: null,
    detailTab: 'general',
    query: '',
    history: [],
    inspections: {},
    inspecting: [],
  }),
}))
