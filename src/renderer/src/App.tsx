import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RTL_LANGUAGES } from './lib/languages'
import { useScheduledScan } from './hooks/useScheduledScan'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { CleanerPage } from './pages/CleanerPage'
import { RegistryPage } from './pages/RegistryPage'
import { ContextMenuCleanerPage } from './pages/ContextMenuCleanerPage'
import { StartupPage } from './pages/StartupPage'
import { DebloaterPage } from './pages/DebloaterPage'
import { SoftwareUpdaterPage } from './pages/SoftwareUpdaterPage'
import { DriverManagerPage } from './pages/DriverManagerPage'
import { DiskAnalyzerPage } from './pages/DiskAnalyzerPage'
import { DuplicateFinderPage } from './pages/DuplicateFinderPage'
import { LargeFileFinderPage } from './pages/LargeFileFinderPage'
import { EmptyFolderCleanerPage } from './pages/EmptyFolderCleanerPage'
import { FileShredderPage } from './pages/FileShredderPage'
import { PortManagerPage } from './pages/PortManagerPage'
import { DiskRepairPage } from './pages/DiskRepairPage'
import { DiskMaintenancePage } from './pages/DiskMaintenancePage'
import { SettingsPage } from './pages/SettingsPage'
import { NetworkCleanupPage } from './pages/NetworkCleanupPage'
import { NetworkSecurityPage } from './pages/NetworkSecurityPage'
import { WifiPage } from './pages/WifiPage'
import { DevicesPage } from './pages/DevicesPage'
import { SecurityPage } from './pages/SecurityPage'
import { SystemHealthReportPage } from './pages/SystemHealthReportPage'
import { MalwareScannerPage } from './pages/MalwareScannerPage'
import { ThreatMonitorPage } from './pages/ThreatMonitorPage'
import { PrivacyShieldPage } from './pages/PrivacyShieldPage'
import { HistoryPage } from './pages/HistoryPage'
import { PerformanceMonitorPage } from './pages/PerformanceMonitorPage'
import { UninstallerPage } from './pages/UninstallerPage'
import { ServiceManagerPage } from './pages/ServiceManagerPage'
import { FirewallAuditPage } from './pages/FirewallAuditPage'
import { SchedulesPage } from './pages/SchedulesPage'
import { GameModePage } from './pages/GameModePage'
import { CveScannerPage } from './pages/CveScannerPage'
import { AboutPage } from './pages/AboutPage'
import { Onboarding } from './components/Onboarding'
import { useStatsStore } from './stores/stats-store'
import { useHistoryStore } from './stores/history-store'
import { useAppUpdateStore } from './stores/app-update-store'
import { useBackgroundScans } from './hooks/useBackgroundScans'
import { usePlatformLoader, PlatformContext } from './hooks/usePlatform'
import { initGameModeStore } from './stores/game-mode-store'
import { useSettingsStore } from './stores/settings-store'

export function App() {
  const { i18n } = useTranslation()
  const loadHistory = useHistoryStore((s) => s.load)
  const historyLoaded = useHistoryStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const theme = useSettingsStore((s) => s.settings.theme)

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement
    const apply = (mode: 'dark' | 'light') => {
      root.classList.remove('dark', 'light')
      root.classList.add(mode)
    }
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      apply(theme ?? 'dark')
    }
  }, [theme])

  // Sync RTL direction based on current language
  useEffect(() => {
    document.documentElement.dir = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr'
  }, [i18n.language])

  useEffect(() => {
    const p = window.clarity?.onboardingGet?.()
    if (p) {
      p.then((done) => {
        setShowOnboarding(!done)
        setOnboardingChecked(true)
      }).catch((err) => {
        // Fail open — a broken check must not lock the user out of the app —
        // but say so, since it also means onboarding is skipped silently.
        console.error('[onboarding] could not read completion state:', err)
        setOnboardingChecked(true)
      })
    } else {
      setOnboardingChecked(true)
    }
  }, [])

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)
    try {
      await window.clarity?.onboardingSet?.(true)
    } catch (err) {
      // Swallowing this is what let the wizard come back on every launch with
      // nothing to go on (issue #269). The main process forwards renderer
      // console errors into clarity.log.
      console.error('[onboarding] failed to persist completion:', err)
    }
  }

  useEffect(() => {
    if (!historyLoaded) loadHistory()
  }, [historyLoaded, loadHistory])

  useEffect(() => {
    if (historyLoaded) recomputeStats()
  }, [historyLoaded, recomputeStats])

  const platformInfo = usePlatformLoader()

  useScheduledScan()

  // Run software-update & driver-update scans silently in the background
  useBackgroundScans()

  // Initialize app update checker on mount
  const initAppUpdate = useAppUpdateStore((s) => s.init)
  useEffect(() => {
    const cleanup = initAppUpdate()
    return cleanup
  }, [initAppUpdate])

  // Hydrate Game Mode status so the sidebar badge works on all pages
  useEffect(() => { initGameModeStore() }, [])

  if (!onboardingChecked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#09090b' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="" alt="" className="h-16 w-16 rounded-2xl" style={{ visibility: 'hidden' }} />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
        </div>
      </div>
    )
  }

  return (
    <PlatformContext value={platformInfo}>
    <HashRouter>
      <PageTitleUpdater />
      <TrayNavigationBridge />
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cleaner" element={<CleanerPage />} />
          <Route path="/registry" element={<RegistryPage />} />
          <Route path="/context-menu" element={<ContextMenuCleanerPage />} />
          <Route path="/startup" element={<StartupPage />} />
          <Route path="/disk" element={<DiskAnalyzerPage />} />
          <Route path="/duplicates" element={<DuplicateFinderPage />} />
          <Route path="/large-files" element={<LargeFileFinderPage />} />
          <Route path="/empty-folders" element={<EmptyFolderCleanerPage />} />
          <Route path="/file-shredder" element={<FileShredderPage />} />
          <Route path="/port-manager" element={<PortManagerPage />} />
          <Route path="/disk-repair" element={<DiskRepairPage />} />
          <Route path="/disk-maintenance" element={<DiskMaintenancePage />} />
          <Route path="/network" element={<NetworkCleanupPage />} />
          <Route path="/network-security" element={<NetworkSecurityPage />} />
          <Route path="/wifi" element={<WifiPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/health-report" element={<SystemHealthReportPage />} />
          <Route path="/malware" element={<MalwareScannerPage />} />
          <Route path="/threat-monitor" element={<ThreatMonitorPage />} />
          <Route path="/cve" element={<CveScannerPage />} />
          <Route path="/game-mode" element={<GameModePage />} />
          <Route path="/performance" element={<PerformanceMonitorPage />} />
          <Route path="/uninstaller" element={<UninstallerPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* Standalone pages */}
          <Route path="/privacy" element={<PrivacyShieldPage />} />
          <Route path="/services" element={<ServiceManagerPage />} />
          <Route path="/firewall" element={<FirewallAuditPage />} />
          <Route path="/debloater" element={<DebloaterPage />} />
          <Route path="/updates" element={<SoftwareUpdaterPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          {/* Legacy redirect */}
          <Route path="/hardening" element={<Navigate to="/privacy" replace />} />
          <Route path="/updater" element={<SoftwareUpdaterPage />} />
          <Route path="/drivers" element={<DriverManagerPage />} />
        </Routes>
      </AppShell>
      <Toaster
        position="bottom-right"
        theme={theme === 'system' ? 'system' : theme}
        toastOptions={{
          style: {
            background: 'var(--toast-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--border-strong)',
            color: 'var(--toast-text)',
            boxShadow: 'var(--toast-shadow)'
          }
        }}
      />
    </HashRouter>
    </PlatformContext>
  )
}

// Maps routes to page titles for the window/tab title.
// Uses sidebar i18n keys where possible; nested routes use plain strings
// so each page gets its own distinct title for screen readers / OS window switcher.
const ROUTE_TITLES: Record<string, { key: string; ns?: string } | string> = {
  '/': { key: 'dashboard' },
  '/cleaner': { key: 'cleaner' },
  '/registry': { key: 'registry' },
  '/startup': { key: 'startup' },
  '/disk': 'Disk Analyzer',
  '/duplicates': 'Duplicate Finder',
  '/large-files': 'Large File Finder',
  '/empty-folders': 'Empty Folder Cleaner',
  '/file-shredder': 'File Shredder',
  '/port-manager': 'Port Manager',
  '/disk-repair': 'Disk Repair',
  '/disk-maintenance': 'Disk Maintenance',
  '/network': { key: 'network' },
  '/network-security': 'WiFi & Network Security',
  '/wifi': 'Wi-Fi',
  '/devices': 'Devices',
  '/security': 'Security',
  '/health-report': 'System Health Report',
  '/malware': { key: 'malwareScanner' },
  '/threat-monitor': { key: 'threatMonitor' },
  '/cve': { key: 'cveScanner' },
  '/game-mode': { key: 'gameMode' },
  '/performance': { key: 'performance' },
  '/uninstaller': 'Uninstaller',
  '/history': { key: 'history' },
  '/settings': { key: 'settings' },
  '/about': 'About',
  '/privacy': 'Privacy',
  '/services': 'Services',
  '/firewall': 'Firewall Audit',
  '/debloater': 'Bloatware Remover',
  '/updates': 'Software Updates',
  '/schedules': { key: 'schedules' },
  '/drivers': 'Driver Updates',
}

// Routes the tray is allowed to ask us to open (mirrors TRAY_NAV_ITEMS in main).
const TRAY_NAV_ROUTES = new Set(['/', '/cleaner', '/malware', '/performance', '/settings'])

/**
 * Listens for tray-driven navigation (e.g. "Open → Cleaner") and moves the
 * hash router to the requested page. The route list is validated on receipt —
 * the tray must never be able to point the window at an arbitrary hash.
 */
function TrayNavigationBridge() {
  useEffect(() => {
    const unsub = window.clarity?.onTrayNavigate?.((route) => {
      if (typeof route !== 'string') return
      if (!TRAY_NAV_ROUTES.has(route)) return
      window.location.hash = `#${route}`
    })
    return () => { unsub?.() }
  }, [])
  return null
}

function PageTitleUpdater() {
  const location = useLocation()
  const { t } = useTranslation('sidebar')
  useEffect(() => {
    const entry = ROUTE_TITLES[location.pathname]
    let name: string | null = null
    if (typeof entry === 'string') {
      name = entry
    } else if (entry) {
      name = t(entry.key)
    }
    document.title = name ? `${name} - Clarity` : 'Clarity'
  }, [location.pathname, t])
  return null
}
