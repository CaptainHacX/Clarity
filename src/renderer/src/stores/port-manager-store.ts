import { create } from 'zustand'
import type { PortKillResult, PortScanResult } from '@shared/types'

type PortFilter = 'all' | 'listening' | 'tcp' | 'udp'

interface PortManagerState {
  status: 'idle' | 'scanning' | 'complete' | 'error'
  error: string | null
  result: PortScanResult | null
  filter: PortFilter
  search: string
  selectedPids: Set<number>
  killInFlight: Set<number>

  scan: () => Promise<void>
  setFilter: (filter: PortFilter) => void
  setSearch: (search: string) => void
  togglePid: (pid: number) => void
  selectAll: () => void
  deselectAll: () => void
  killSelected: () => Promise<PortKillResult>
  reset: () => void
}

export const usePortManagerStore = create<PortManagerState>((set, get) => ({
  status: 'idle',
  error: null,
  result: null,
  filter: 'all',
  search: '',
  selectedPids: new Set(),
  killInFlight: new Set(),

  scan: async () => {
    set({ status: 'scanning', error: null })
    try {
      const result = await window.clarity.portScan()
      if (result.error) {
        set({ status: 'error', error: result.error, result })
        return
      }
      const selectedPids = new Set<number>()
      for (const pid of get().selectedPids) selectedPids.add(pid)
      set({ status: 'complete', result, selectedPids })
    } catch {
      set({ status: 'error', error: 'Something went wrong. Please try again.' })
    }
  },

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),

  togglePid: (pid) =>
    set((s) => {
      const next = new Set(s.selectedPids)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return { selectedPids: next }
    }),
  selectAll: () => {
    const result = get().result
    if (!result) return
    const pids = new Set<number>()
    for (const entry of result.ports) {
      if (entry.pid != null) pids.add(entry.pid)
    }
    set({ selectedPids: pids })
  },
  deselectAll: () => set({ selectedPids: new Set() }),

  killSelected: async () => {
    const pids = [...get().selectedPids]
    if (pids.length === 0) {
      return { success: false, pid: null, processName: null, freedPorts: [] }
    }

    set((s) => ({ killInFlight: new Set([...s.killInFlight, ...pids]) }))
    let failed = false
    let error: string | undefined
    let requiresAdmin = false
    let freedPorts: number[] = []

    for (const pid of pids) {
      try {
        const res = await window.clarity.portKill(pid)
        if (!res.success) {
          failed = true
          error = res.error || 'Something went wrong. Please try again.'
          if (res.requiresAdmin) requiresAdmin = true
        } else {
          freedPorts = freedPorts.concat(res.freedPorts)
        }
      } catch {
        failed = true
        error = 'Something went wrong. Please try again.'
      }
    }

    // Re-scan to reflect the new state of the system.
    await get().scan()

    set((s) => {
      const inFlight = new Set(s.killInFlight)
      for (const pid of pids) inFlight.delete(pid)
      return { killInFlight: inFlight }
    })

    if (failed) {
      return { success: false, pid: null, processName: null, freedPorts, error, requiresAdmin }
    }
    return { success: true, pid: null, processName: null, freedPorts }
  },

  reset: () =>
    set({
      status: 'idle',
      error: null,
      result: null,
      selectedPids: new Set(),
      killInFlight: new Set(),
    }),
}))
