import { create } from 'zustand'
import type { LocationAccessStatus, WifiScanSnapshot, WifiSignalSample } from '@shared/types'
import { wifiNetworkKey } from '@shared/wifi'
import { triggerLocationPrompt } from '@/lib/location-prompt'

export type WifiSortBy = 'signal' | 'name' | 'channel' | 'security'
export type WifiSortDir = 'asc' | 'desc'

const MAX_SAMPLES = 120
const POLL_INTERVAL_MS = 3000

interface WifiStoreState {
  snapshot: WifiScanSnapshot | null
  /** Detailed scans (radio sweep) — shown on the rescan button. */
  detailedScanning: boolean
  error: string | null
  hasScanned: boolean
  selectedKey: string | null
  samples: Record<string, WifiSignalSample[]>
  sortBy: WifiSortBy
  sortDir: WifiSortDir
  /** Masks SSIDs and BSSIDs so a screenshot is safe to share. */
  demoMode: boolean
  locationAccess: LocationAccessStatus
  detailedScan: () => Promise<void>
  pollScan: () => Promise<void>
  setSelected: (key: string | null) => void
  setSort: (sortBy: WifiSortBy, sortDir: WifiSortDir) => void
  toggleDemoMode: () => void
  requestLocation: () => Promise<'granted' | 'prompted' | 'settings' | 'failed'>
  start: () => void
  stop: () => void
  reset: () => void
}

let timer: ReturnType<typeof setInterval> | null = null

function mergeSnapshot(state: WifiStoreState, snapshot: WifiScanSnapshot): Partial<WifiStoreState> {
  const nextSamples: Record<string, WifiSignalSample[]> = { ...state.samples }
  const liveKeys = new Set<string>()
  for (const network of snapshot.networks) {
    const key = wifiNetworkKey(network)
    liveKeys.add(key)
    const series = (nextSamples[key] ?? []).slice(-(MAX_SAMPLES - 1))
    series.push({ t: snapshot.collectedAt, signalDbm: network.signalDbm, noiseDbm: network.noiseDbm })
    nextSamples[key] = series
  }
  // Drop buffers for networks that have been gone a while, so a laptop carried
  // around a building doesn't accumulate history for every AP it ever passed.
  for (const key of Object.keys(nextSamples)) {
    if (liveKeys.has(key)) continue
    const last = nextSamples[key]?.[nextSamples[key].length - 1]
    if (!last || snapshot.collectedAt - last.t > 10 * 60_000) delete nextSamples[key]
  }

  let selectedKey = state.selectedKey
  if (selectedKey == null || !snapshot.networks.some((n) => wifiNetworkKey(n) === selectedKey)) {
    const connected = snapshot.networks.find((n) => n.isConnected)
    const first = connected ?? snapshot.networks[0]
    selectedKey = first ? wifiNetworkKey(first) : null
  }
  return { samples: nextSamples, selectedKey, locationAccess: snapshot.locationAccess }
}

export const useWifiStore = create<WifiStoreState>((set, get) => ({
  snapshot: null,
  detailedScanning: false,
  error: null,
  hasScanned: false,
  selectedKey: null,
  samples: {},
  sortBy: 'signal',
  sortDir: 'desc',
  demoMode: false,
  locationAccess: 'unknown',

  detailedScan: async () => {
    if (get().detailedScanning) return
    set({ detailedScanning: true, error: null })
    try {
      const snapshot = await window.clarity.wifiScan(true)
      set({ snapshot, ...mergeSnapshot(get(), snapshot), hasScanned: true })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Scan failed' })
    } finally {
      set({ detailedScanning: false })
    }
  },

  pollScan: async () => {
    if (get().detailedScanning) return
    try {
      const snapshot = await window.clarity.wifiScan(false)
      set({ snapshot, ...mergeSnapshot(get(), snapshot), hasScanned: true })
    } catch {
      // Background polling must never clobber state or surface error banners.
    }
  },

  setSelected: (key) => set({ selectedKey: key }),
  setSort: (sortBy, sortDir) => set({ sortBy, sortDir }),
  toggleDemoMode: () => set((s) => ({ demoMode: !s.demoMode })),

  /**
   * Walk the whole permission path in one press: prompt if the system will
   * still show one, re-scan to see whether BSSIDs appeared, and only fall back
   * to opening Location Settings when the prompt can no longer be raised
   * (because the user already answered it once).
   */
  requestLocation: async () => {
    try {
      await triggerLocationPrompt()
      const status = await window.clarity.wifiLocationStatus()
      if (status === 'granted') {
        set({ locationAccess: 'granted' })
        await get().detailedScan()
        return 'granted'
      }
      const opened = await window.clarity.networkSecurityOpenLocationSettings()
      return opened ? 'settings' : 'prompted'
    } catch {
      return 'failed'
    }
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
    detailedScanning: false,
    error: null,
    hasScanned: false,
    selectedKey: null,
    samples: {},
    sortBy: 'signal',
    sortDir: 'desc',
    demoMode: false,
    locationAccess: 'unknown',
  }),
}))
