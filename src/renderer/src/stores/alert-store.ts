import { create } from 'zustand'
import { toast } from 'sonner'
import type { AlertEvent } from '@shared/types'
import { useSettingsStore } from './settings-store'

interface AlertState {
  events: AlertEvent[]
  loaded: boolean
  unreadCount: number
  load: () => Promise<void>
  clear: () => Promise<void>
  markRead: () => void
}

export const useAlertStore = create<AlertState>((set, get) => ({
  events: [],
  loaded: false,
  unreadCount: 0,
  load: async () => {
    try {
      const events = await window.clarity.alertsGetHistory()
      set({ events, loaded: true, unreadCount: 0 })
    } catch {
      set({ events: [], loaded: true })
    }
  },
  clear: async () => {
    try {
      await window.clarity.alertsClearHistory()
    } catch { /* best effort */ }
    set({ events: [], unreadCount: 0 })
  },
  markRead: () => set({ unreadCount: 0 }),
}))

// Wire up live push events from the main process and surface new alerts as
// in-app toasts when the user has them enabled.
let _listenerRegistered = false
if (typeof window !== 'undefined' && window.clarity && !_listenerRegistered) {
  _listenerRegistered = true
  useAlertStore.getState().load()

  window.clarity.onAlertEvent((event) => {
    const state = useAlertStore.getState()
    setStateWithEvent(event)
    const config = useSettingsStore.getState().settings.alerts
    if (config?.showInApp) {
      toast(event.title, {
        description: event.message,
        duration: 6000,
      })
    }
  })
}

function setStateWithEvent(event: AlertEvent): void {
  const { events, loaded } = useAlertStore.getState()
  // Deduplicate by id in case of a late delivery racing the initial history fetch.
  const merged = events.filter((e) => e.id !== event.id)
  const next = [...merged, event].slice(-50)
  useAlertStore.setState({
    events: next,
    unreadCount: loaded ? (useAlertStore.getState().unreadCount + 1) : 0,
  })
}
