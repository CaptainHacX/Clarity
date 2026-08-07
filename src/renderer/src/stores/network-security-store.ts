import { create } from 'zustand'
import type { NetworkSecurityStatus } from '@shared/types'
import { triggerLocationPrompt } from '@/lib/location-prompt'

interface NetworkSecurityState {
  status: NetworkSecurityStatus | null
  scanning: boolean
  error: string | null
  hasScanned: boolean
  scan: () => Promise<void>
  requestLocation: () => Promise<'granted' | 'settings' | 'failed'>
  reset: () => void
}

export const useNetworkSecurityStore = create<NetworkSecurityState>((set, get) => ({
  status: null,
  scanning: false,
  error: null,
  hasScanned: false,
  scan: async () => {
    if (get().scanning) return
    set({ scanning: true, error: null })
    try {
      const status = await window.clarity.networkSecurityScan()
      set({ status, scanning: false, hasScanned: true })
    } catch (err) {
      set({ scanning: false, error: err instanceof Error ? err.message : 'Scan failed' })
    }
  },
  requestLocation: async () => {
    if (get().scanning) return 'failed'
    set({ scanning: true, error: null })
    try {
      // Raise the CoreLocation prompt the same way the Wi-Fi tool does, then
      // re-read the collected status. If the permission still hasn't landed,
      // drop the user into Location Settings instead of leaving them stuck.
      await triggerLocationPrompt()
      const status = await window.clarity.networkSecurityRequestLocation()
      set({ status, scanning: false, hasScanned: true })
      if (status.locationAccess === 'granted') return 'granted'
      const opened = await window.clarity.networkSecurityOpenLocationSettings()
      return opened ? 'settings' : 'failed'
    } catch (err) {
      set({ scanning: false, error: err instanceof Error ? err.message : 'Scan failed' })
      return 'failed'
    }
  },
  reset: () => set({ status: null, scanning: false, error: null, hasScanned: false }),
}))

export function refreshNetworkSecurity(): void {
  window.clarity?.networkSecurityScan?.().then((status) => {
    useNetworkSecurityStore.setState({ status, hasScanned: true })
  }).catch(() => {})
}
