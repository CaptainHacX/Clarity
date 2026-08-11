import { create } from 'zustand'
import type { PerfSystemInfo, PerfSnapshot, PerfProcess, DiskSmartInfo, DiskVolumeUsage, HardwareHealthSnapshot } from '@shared/types'

const MAX_HISTORY = 900 // 15 minutes at 1s intervals
const CHART_THROTTLE_MS = 2000 // Only update chart-facing history every 2s

export const REFRESH_INTERVAL_OPTIONS_MS = [5000, 60_000, 300_000, 900_000] as const
export const DEFAULT_REFRESH_INTERVAL_MS = 5000

interface PerfState {
  systemInfo: PerfSystemInfo | null
  currentSnapshot: PerfSnapshot | null
  /** Ring buffer backing store — mutated in place to avoid GC pressure */
  _ringBuffer: PerfSnapshot[]
  _ringWriteIndex: number
  _ringSize: number
  /**
   * Snapshot of the ring buffer exposed to React — only updated every CHART_THROTTLE_MS
   * to avoid re-rendering charts on every 1s tick.
   */
  history: PerfSnapshot[]
  _lastHistoryFlush: number
  processList: PerfProcess[]
  processCount: number
  diskVolumes: DiskVolumeUsage[]
  isMonitoring: boolean
  /** Data collection cadence in ms. 0 means paused. */
  refreshIntervalMs: number
  /** Epoch ms of the most recent data push from the main process. */
  lastUpdated: number | null
  /** True while a manual "Refresh Now" is in flight. */
  isRefreshing: boolean
  processFilter: string
  processSortColumn: 'cpuPercent' | 'memBytes' | 'memPercent' | 'name' | 'pid' | 'user'
  processSortDir: 'asc' | 'desc'
  diskHealth: DiskSmartInfo[]
  hardwareHealth: HardwareHealthSnapshot | null

  setSystemInfo: (info: PerfSystemInfo) => void
  pushSnapshot: (snap: PerfSnapshot) => void
  setProcessList: (processes: PerfProcess[], totalCount: number) => void
  setDiskVolumes: (volumes: DiskVolumeUsage[]) => void
  setMonitoring: (on: boolean) => void
  setRefreshInterval: (ms: number) => void
  setRefreshing: (refreshing: boolean) => void
  setProcessFilter: (filter: string) => void
  setProcessSort: (column: PerfState['processSortColumn']) => void
  setDiskHealth: (disks: DiskSmartInfo[]) => void
  setHardwareHealth: (health: HardwareHealthSnapshot) => void
  reset: () => void
}

function ringToArray(buf: PerfSnapshot[], writeIdx: number, size: number): PerfSnapshot[] {
  if (size === 0) return []
  if (size <= buf.length) {
    // Buffer not yet wrapped — just slice
    const start = writeIdx - size
    if (start >= 0) return buf.slice(start, writeIdx)
    // Wrapped — concat tail + head
    return buf.slice(buf.length + start).concat(buf.slice(0, writeIdx))
  }
  return buf.slice(0, size)
}

export const usePerfStore = create<PerfState>((set, get) => ({
  systemInfo: null,
  currentSnapshot: null,
  _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
  _ringWriteIndex: 0,
  _ringSize: 0,
  history: [],
  _lastHistoryFlush: 0,
  processList: [],
  processCount: 0,
  diskVolumes: [],
  isMonitoring: false,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  lastUpdated: null,
  isRefreshing: false,
  processFilter: '',
  processSortColumn: 'cpuPercent',
  processSortDir: 'desc',
  diskHealth: [],
  hardwareHealth: null,

  setSystemInfo: (info) => set({ systemInfo: info }),

  pushSnapshot: (snap) => {
    const state = get()
    const buf = state._ringBuffer
    const idx = state._ringWriteIndex
    buf[idx] = snap
    const nextIdx = (idx + 1) % MAX_HISTORY
    const nextSize = Math.min(state._ringSize + 1, MAX_HISTORY)

    const now = Date.now()
    const shouldFlush = now - state._lastHistoryFlush >= CHART_THROTTLE_MS

    if (shouldFlush) {
      set({
        currentSnapshot: snap,
        lastUpdated: now,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize,
        history: ringToArray(buf, nextIdx, nextSize),
        _lastHistoryFlush: now
      })
    } else {
      set({
        currentSnapshot: snap,
        lastUpdated: now,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize
      })
    }
  },

  setProcessList: (processes, totalCount) =>
    set({ processList: processes, processCount: totalCount }),

  setDiskVolumes: (volumes) => set({ diskVolumes: volumes }),

  setMonitoring: (on) => set({ isMonitoring: on }),

  setRefreshInterval: (ms) => set({ refreshIntervalMs: ms }),

  setRefreshing: (refreshing) => set({ isRefreshing: refreshing }),

  setProcessFilter: (filter) => set({ processFilter: filter }),

  setDiskHealth: (disks) => set({ diskHealth: disks }),

  setHardwareHealth: (health) => set({ hardwareHealth: health }),

  setProcessSort: (column) => {
    const { processSortColumn, processSortDir } = get()
    if (processSortColumn === column) {
      set({ processSortDir: processSortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ processSortColumn: column, processSortDir: 'desc' })
    }
  },

  reset: () =>
    set({
      currentSnapshot: null,
      _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
      _ringWriteIndex: 0,
      _ringSize: 0,
      history: [],
      _lastHistoryFlush: 0,
      processList: [],
      processCount: 0,
      diskVolumes: [],
      isMonitoring: false,
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      lastUpdated: null,
      isRefreshing: false,
      processFilter: '',
      diskHealth: [],
      hardwareHealth: null
    })
}))
