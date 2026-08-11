import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  HardDrive,
  Sparkles,
  FileStack,
  Search,
  Database,
  Trash2,
  Zap,
  Shield,
  CheckCircle2,
  Wifi,
  Loader2,
  Cpu,
  Check,
  Download,
  Server,
  Gamepad2,
  BarChart3,
  MemoryStick,
  ArrowRight,
  Activity,
  Gauge,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatCard } from '@/components/shared/StatCard'
import { HealthScore } from '@/components/shared/HealthScore'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { ProactiveAlertsCard } from '@/components/dashboard/ProactiveAlertsCard'
import { cn, formatBytes, formatDate, formatNumber } from '@/lib/utils'
import { useStatsStore } from '@/stores/stats-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { useServiceStore } from '@/stores/service-store'
import { useStartupStore } from '@/stores/startup-store'
import { useGameModeStore } from '@/stores/game-mode-store'
import { useAlertStore } from '@/stores/alert-store'
import type { DriveInfo, ScanResult, CleanResult, PerfQuickStats, PerfSystemInfo, ActivityEntry } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { CleanerType } from '@shared/enums'
import { usePlatform } from '@/hooks/usePlatform'

const EASE = [0.16, 1, 0.3, 1] as const

type OneClickPhase = 'idle' | 'scanning' | 'cleaning' | 'done'

interface OneClickResult {
  spaceRecovered: number
  filesCleaned: number
  registryFixed: number
  driversRemoved: number
  threatsFound: number
  threatsQuarantined: number
  privacyScore: number
  privacyIssues: number
  startupHighImpact: number
  updatesAvailable: number
}

const CLEANER_SCAN_FNS: { type: CleanerType; scan: () => Promise<ScanResult[]>; clean: (ids: string[]) => Promise<CleanResult> }[] = [
  { type: CleanerType.System, scan: () => window.clarity.systemScan(), clean: (ids) => window.clarity.systemClean(ids) },
  { type: CleanerType.Browser, scan: () => window.clarity.browserScan(), clean: (ids) => window.clarity.browserClean(ids) },
  { type: CleanerType.App, scan: () => window.clarity.appScan(), clean: (ids) => window.clarity.appClean(ids) },
  { type: CleanerType.Gaming, scan: () => window.clarity.gamingScan(), clean: (ids) => window.clarity.gamingClean(ids) },
  { type: CleanerType.RecycleBin, scan: () => window.clarity.recycleBinScan(), clean: () => window.clarity.recycleBinClean() },
  { type: CleanerType.Environment, scan: () => window.clarity.environmentScan(), clean: (ids) => window.clarity.environmentClean(ids) },
  { type: CleanerType.Database, scan: () => window.clarity.databaseScan(), clean: (ids) => window.clarity.databaseClean(ids) },
]

const ACTIVITY_ICONS: Record<ActivityEntry['type'], LucideIcon> = {
  clean: Sparkles,
  registry: Database,
  startup: Zap,
  scan: Search,
  drivers: Cpu,
  network: Wifi,
}

// ── Component ────────────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { features, platform } = usePlatform()
  const stats = useStatsStore((s) => s.stats)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const historyStore = useHistoryStore()
  const scanStore = useScanStore()
  const updaterHasChecked = useUpdaterStore((s) => s.hasChecked)
  const serviceHasScanned = useServiceStore((s) => s.hasScanned)
  const startupItems = useStartupStore((s) => s.items)
  const gameModeActive = useGameModeStore((s) => s.active)
  const gameModeActivatedAt = useGameModeStore((s) => s.activatedAt)
  const markAlertsRead = useAlertStore((s) => s.markRead)
  const cleanStartRef = useRef<number>(0)
  const navigate = useNavigate()
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [phase, setPhase] = useState<OneClickPhase>('idle')
  const [phaseLabel, setPhaseLabel] = useState('')
  const [result, setResult] = useState<OneClickResult | null>(null)
  const [showQuickConfirm, setShowQuickConfirm] = useState(false)
  const [showFullConfirm, setShowFullConfirm] = useState(false)
  const [stepProgress, setStepProgress] = useState({ current: 0, total: 0 })

  // ── Lightweight system metrics (no heavy process polling) ──
  const [perf, setPerf] = useState<PerfQuickStats | null>(null)
  // Rolling samples (cpu/mem %) for the lightweight performance charts.
  // Polled every 3s via os.cpus()/os.freemem() — near-zero cost.
  const [trend, setTrend] = useState<Array<{ cpu: number; mem: number }>>([])
  // One-shot system info (CPU model, OS, memory) — cached in main.
  const [systemInfo, setSystemInfo] = useState<PerfSystemInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    // Initial sample seeds the CPU diff; first result will read 0%
    window.clarity?.perfQuickStats?.().catch(() => {})
    window.clarity?.perfGetSystemInfo?.().then((info) => { if (!cancelled) setSystemInfo(info) }).catch(() => {})
    const poll = async () => {
      try {
        const data = await window.clarity?.perfQuickStats?.()
        if (!cancelled && data) {
          setPerf(data)
          setTrend((prev) => [...prev.slice(-59), { cpu: data.cpuPercent, mem: data.memPercent }])
        }
      } catch { /* best effort */ }
    }
    // Poll every 3s — uses only os.cpus()/os.freemem(), near-zero cost
    const iv = setInterval(poll, 3000)
    // First real read after 1s (gives CPU diff time to accumulate)
    const initial = setTimeout(poll, 1000)
    return () => { cancelled = true; clearInterval(iv); clearTimeout(initial) }
  }, [])

  // ── Game Mode elapsed timer ────────────────────────────────
  const [gmElapsed, setGmElapsed] = useState(0)
  useEffect(() => {
    if (!gameModeActive || !gameModeActivatedAt) { setGmElapsed(0); return }
    const start = new Date(gameModeActivatedAt).getTime()
    const tick = () => setGmElapsed(Date.now() - start)
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [gameModeActive, gameModeActivatedAt])

  // Viewing the dashboard clears the unread-alert badge.
  useEffect(() => { markAlertsRead() }, [markAlertsRead])

  const refreshDrives = useCallback(() => {
    window.clarity?.diskDrives?.().then(setDrives).catch(() => {})
  }, [])

  useEffect(() => { refreshDrives() }, [refreshDrives])

  // ── Health score ───────────────────────────────────────────

  const toolCoverage = (() => {
    const entries = historyStore.entries
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    const recentEntries = entries.filter((e) => new Date(e.timestamp).getTime() > twoWeeksAgo)
    const recentTypes = new Set(recentEntries.map((e) => e.type))
    const allTypes = new Set(entries.map((e) => e.type))

    const historyTools = [
      { key: 'cleaner' as const, label: t('toolLabelCleaner'), icon: Search, color: '#f59e0b' },
      ...(features.registry ? [{ key: 'registry' as const, label: t('toolLabelRegistry'), icon: Database, color: '#3b82f6' }] : []),
      ...(features.drivers ? [{ key: 'drivers' as const, label: t('toolLabelDrivers'), icon: Cpu, color: '#a855f7' }] : [])
    ]

    const historyResults = historyTools.map((t) => ({
      ...t,
      usedRecently: recentTypes.has(t.key),
      usedEver: allTypes.has(t.key)
    }))

    const sessionTools = [
      { key: 'updater', label: t('toolLabelUpdater'), icon: Download, color: '#06b6d4', active: updaterHasChecked },
      { key: 'services', label: t('toolLabelServices'), icon: Server, color: '#ec4899', active: serviceHasScanned },
      { key: 'startup', label: t('toolLabelStartup'), icon: Zap, color: '#22c55e', active: startupItems.length > 0 }
    ]

    const sessionResults = sessionTools.map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.icon,
      color: t.color,
      usedRecently: t.active,
      usedEver: t.active
    }))

    return [...historyResults, ...sessionResults]
  })()

  const toolRoutes: Record<string, string> = {
    cleaner: '/cleaner',
    registry: '/registry',
    drivers: '/drivers',
    updater: '/updates',
    services: '/services',
    startup: '/startup'
  }

  const healthScore = (() => {
    const totalTools = toolCoverage.length
    const doneTools = toolCoverage.filter((t) => t.usedRecently).length
    let score = Math.round((doneTools / totalTools) * 60)

    if (drives.length > 0) {
      const worstUsage = Math.max(...drives.map((d) => d.usedSpace / d.totalSize))
      if (worstUsage > 0.7) {
        score -= Math.min(20, Math.round((worstUsage - 0.7) / 0.3 * 20))
      }
    }

    if (stats.lastScanDate) {
      const daysSinceScan = (Date.now() - new Date(stats.lastScanDate).getTime()) / (1000 * 60 * 60 * 24)
      score -= Math.min(20, Math.round(daysSinceScan * (20 / 7)))
    } else {
      score -= 10
    }

    if (stats.lastScanDate) score += 40
    return Math.max(0, Math.min(100, score))
  })()

  const healthStatus = (() => {
    if (healthScore >= 71) return { label: t('healthStatusExcellent'), color: '#22c55e' }
    if (healthScore >= 41) return { label: t('healthStatusGood'), color: '#f59e0b' }
    return { label: t('healthStatusAttention'), color: '#ef4444' }
  })()

  const healthInsight = (() => {
    if (healthScore < 41) return t('healthInsightPoor')
    if (drives.length > 0 && Math.max(...drives.map((d) => d.usedSpace / d.totalSize)) > 0.8) return t('healthInsightDiskFull')
    const daysSince = stats.lastScanDate
      ? (Date.now() - new Date(stats.lastScanDate).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity
    if (daysSince > 7) return t('healthInsightStale')
    return t('healthInsightHealthy')
  })()

  // ── One-click clean callbacks (unchanged logic) ────────────

  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)

  const runCleaners = useCallback(async (): Promise<{ space: number; files: number }> => {
    const excluded = scanStore.excludedSubcategories
    let totalSpace = 0
    let totalFiles = 0

    for (const { type, scan, clean } of CLEANER_SCAN_FNS) {
      if (type === CleanerType.RecycleBin && protectRecycleBin) continue
      try {
        setPhaseLabel(t('phaseLabelScanningType', { type }))
        const results = await scan()
        const selectedIds = results
          .filter((r) => !excluded.has(r.subcategory))
          .flatMap((r) => r.items.map((i) => i.id))
        if (selectedIds.length > 0) {
          setPhaseLabel(t('phaseLabelCleaningType', { type }))
          const res = await clean(selectedIds)
          totalSpace += res.totalCleaned || 0
          totalFiles += res.filesDeleted || 0
        }
      } catch {
        toast.error(t('toastFailedToCleanType', { type }))
      }
    }
    return { space: totalSpace, files: totalFiles }
  }, [scanStore.excludedSubcategories, protectRecycleBin, t])

  const runRegistry = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelScanningRegistry'))
      const entries = await window.clarity.registryScan()
      if (!Array.isArray(entries)) return 0
      const selectedIds = entries.filter((e) => e?.selected).map((e) => e.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel(t('phaseLabelFixingRegistry'))
      const res = await window.clarity.registryFix(selectedIds)
      return res?.fixed ?? 0
    } catch {
      toast.error(t('toastRegistryScanFailed'))
      return 0
    }
  }, [t])

  const runMalwareScan = useCallback(async (): Promise<{ found: number; quarantined: number }> => {
    try {
      setPhaseLabel(t('phaseLabelScanningMalware'))
      const result = await window.clarity.malwareScan()
      if (result.threats.length === 0) return { found: 0, quarantined: 0 }
      setPhaseLabel(t('phaseLabelQuarantiningThreats'))
      const paths = result.threats.map((t) => t.path)
      const meta = result.threats.map((t) => ({
        path: t.path,
        detectionName: t.detectionName,
        severity: t.severity,
        source: t.source,
        details: t.details
      }))
      const actionResult = await window.clarity.malwareQuarantine(paths, meta)
      return { found: result.threats.length, quarantined: actionResult.succeeded }
    } catch {
      toast.error(t('toastMalwareScanFailed'))
      return { found: 0, quarantined: 0 }
    }
  }, [t])

  const runPrivacyCheck = useCallback(async (): Promise<{ score: number; issues: number }> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingPrivacy'))
      const state = await window.clarity.privacyScan()
      return { score: state.score, issues: state.total - state.protected }
    } catch {
      toast.error(t('toastPrivacyCheckFailed'))
      return { score: 0, issues: 0 }
    }
  }, [t])

  const runStartupCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingStartup'))
      const items = await window.clarity.startupList()
      return items.filter((i) => i.enabled && i.impact === 'high').length
    } catch {
      toast.error(t('toastStartupCheckFailed'))
      return 0
    }
  }, [t])

  const runSoftwareUpdateCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingSoftwareUpdates'))
      const result = await window.clarity.softwareUpdateCheck()
      return result.apps.length
    } catch {
      toast.error(t('toastSoftwareUpdateCheckFailed'))
      return 0
    }
  }, [t])

  const runDrivers = useCallback(async (): Promise<{ removed: number; space: number }> => {
    try {
      setPhaseLabel(t('phaseLabelScanningDrivers'))
      const scanResult = await window.clarity.driverScan()
      const stalePackages = scanResult.packages.filter((p) => !p.isCurrent && p.selected)
      if (stalePackages.length === 0) return { removed: 0, space: 0 }
      setPhaseLabel(t('phaseLabelRemovingStaleDrivers'))
      const cleanResult = await window.clarity.driverClean(stalePackages.map((p) => p.publishedName))
      return { removed: cleanResult.removed, space: cleanResult.spaceRecovered }
    } catch {
      toast.error(t('toastDriverCleanupFailed'))
      return { removed: 0, space: 0 }
    }
  }, [t])

  const handleQuickClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    setStepProgress({ current: 0, total: 2 })

    setPhase('cleaning')
    setStepProgress({ current: 1, total: 2 })
    const { space, files } = await runCleaners()
    setStepProgress({ current: 2, total: 2 })
    const regFixed = features.registry ? await runRegistry() : 0

    const oneClickResult: OneClickResult = {
      spaceRecovered: space, filesCleaned: files, registryFixed: regFixed,
      driversRemoved: 0, threatsFound: 0, threatsQuarantined: 0,
      privacyScore: 0, privacyIssues: 0, startupHighImpact: 0, updatesAvailable: 0
    }

    const totalItems = files + regFixed
    if (totalItems > 0) {
      await historyStore.addEntry({
        id: Date.now().toString(), type: 'cleaner', timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current, totalItemsFound: totalItems,
        totalItemsCleaned: totalItems, totalItemsSkipped: 0, totalSpaceSaved: space,
        categories: [
          ...(files > 0 ? [{ name: 'Quick Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }] : []),
          ...(regFixed > 0 ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }] : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
    refreshDrives()
  }, [phase, runCleaners, runRegistry, historyStore, recomputeStats, features])

  const handleFullClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    const totalSteps = 5 + (features.registry ? 1 : 0) + (features.drivers ? 1 : 0)
    let step = 0
    setStepProgress({ current: step, total: totalSteps })

    setPhase('cleaning')
    setStepProgress({ current: ++step, total: totalSteps })
    const { space, files } = await runCleaners()
    let regFixed = 0
    if (features.registry) { setStepProgress({ current: ++step, total: totalSteps }); regFixed = await runRegistry() }
    let drivers = { removed: 0, space: 0 }
    if (features.drivers) { setStepProgress({ current: ++step, total: totalSteps }); drivers = await runDrivers() }

    setStepProgress({ current: ++step, total: totalSteps })
    const malware = await runMalwareScan()
    setStepProgress({ current: ++step, total: totalSteps })
    const privacy = await runPrivacyCheck()
    setStepProgress({ current: ++step, total: totalSteps })
    const startupHighImpact = await runStartupCheck()
    setStepProgress({ current: ++step, total: totalSteps })
    const updatesAvailable = await runSoftwareUpdateCheck()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space + drivers.space, filesCleaned: files, registryFixed: regFixed,
      driversRemoved: drivers.removed, threatsFound: malware.found,
      threatsQuarantined: malware.quarantined, privacyScore: privacy.score,
      privacyIssues: privacy.issues, startupHighImpact, updatesAvailable
    }

    const totalItems = files + regFixed + drivers.removed + malware.quarantined
    if (totalItems > 0 || malware.found > 0) {
      await historyStore.addEntry({
        id: Date.now().toString(), type: 'cleaner', timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems + malware.found, totalItemsCleaned: totalItems,
        totalItemsSkipped: 0, totalSpaceSaved: space + drivers.space,
        categories: [
          ...(files > 0 ? [{ name: 'Full Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }] : []),
          ...(regFixed > 0 ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }] : []),
          ...(drivers.removed > 0 ? [{ name: 'Stale Drivers', itemsFound: drivers.removed, itemsCleaned: drivers.removed, spaceSaved: drivers.space }] : []),
          ...(malware.quarantined > 0 ? [{ name: 'Malware', itemsFound: malware.found, itemsCleaned: malware.quarantined, spaceSaved: 0 }] : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
    refreshDrives()
  }, [phase, runCleaners, runRegistry, runDrivers, runMalwareScan, runPrivacyCheck, runStartupCheck, runSoftwareUpdateCheck, historyStore, recomputeStats, features])

  const isRunning = phase === 'scanning' || phase === 'cleaning'

  // ── Helpers ────────────────────────────────────────────────

  const cpuPct = perf?.cpuPercent ?? 0
  const ramPct = perf?.memPercent ?? 0
  const diskPct = drives.length > 0
    ? Math.round((drives.reduce((s, d) => s + d.usedSpace, 0) / drives.reduce((s, d) => s + d.totalSize, 0)) * 100)
    : 0
  const totalFree = drives.reduce((s, d) => s + d.freeSpace, 0)

  function formatGmElapsed(ms: number): string {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const recentActivity = stats.recentActivity.slice(0, 6)

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div
            className="flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }}
            />
            <span className="text-[12px] font-medium text-zinc-300">{t('headerStatusOnline')}</span>
          </div>
        }
      />

      <div className="flex-1 space-y-8 px-0 pb-8">
        {/* ── 1 · System Health ─────────────────────────── */}
        <Section index={0}>
          <SectionHeading icon={Activity} title={t('sectionHealth')} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Health score */}
            <div className="glass-card glass-card-hover flex flex-col items-center justify-center rounded-2xl px-6 py-7">
              <HealthScore score={healthScore} size="lg" />
              <span
                className="mt-4 text-[13px] font-bold tracking-wide"
                style={{ color: healthStatus.color, textShadow: `0 0 18px ${healthStatus.color}30` }}
              >
                {healthStatus.label}
              </span>
              <p className="mt-2 max-w-[230px] text-center text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {healthInsight}
              </p>
            </div>

            {/* Maintenance coverage */}
            <div className="glass-card flex flex-col rounded-2xl px-5 py-5">
              <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('coverageHeading')}</h3>
              <p className="mb-4 mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('coverageHint')}</p>
              <div className="grid flex-1 grid-cols-1 content-start gap-2 sm:grid-cols-2">
                {toolCoverage.map((tool) => {
                  const Icon = tool.icon
                  const route = toolRoutes[tool.key]
                  return (
                    <div
                      key={tool.key}
                      className="group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all hover:brightness-125"
                      style={{
                        background: tool.usedRecently ? tool.color + '14' : 'var(--bg-subtle)',
                        border: `1px solid ${tool.usedRecently ? tool.color + '28' : 'var(--border-subtle)'}`
                      }}
                      title={`${tool.label}: ${tool.usedRecently ? t('toolTipUsedRecently') : tool.usedEver ? t('toolTipNotUsedRecently') : t('toolTipNeverUsed')}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => route && navigate(route)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && route) navigate(route) }}
                    >
                      <span className="relative shrink-0">
                        <Icon className="h-4 w-4" style={{ color: tool.usedRecently ? tool.color : 'var(--text-faint)' }} strokeWidth={1.8} />
                        {tool.usedRecently && (
                          <span
                            className="absolute -right-1 -top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full"
                            style={{ background: '#22c55e' }}
                          >
                            <Check className="h-1.5 w-1.5 text-white" strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span
                        className="flex-1 truncate text-[12px] font-medium"
                        style={{ color: tool.usedRecently ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      >
                        {tool.label}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div
                className="mt-4 flex items-center justify-between rounded-xl px-3.5 py-2.5"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('statusLastScan')}
                </span>
                <span className="text-[12px] font-semibold text-zinc-300">
                  {stats.lastScanDate ? formatDate(stats.lastScanDate) : t('statusLastScanNever')}
                </span>
              </div>
            </div>

            {/* Proactive alerts */}
            <ProactiveAlertsCard />
          </div>
        </Section>

        {/* ── 2 · System Overview ──────────────────────── */}
        <Section index={1}>
          <SectionHeading icon={Gauge} title={t('sectionOverview')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <GaugeCard
              label={t('gaugeCpu')}
              percent={Math.round(cpuPct)}
              detail={systemInfo ? `${systemInfo.cpuCores} ${t('overviewCoresSuffix')}` : '—'}
            />
            <GaugeCard
              label={t('gaugeRam')}
              percent={Math.round(ramPct)}
              detail={perf ? `${formatBytes(perf.memUsedBytes)} / ${formatBytes(perf.memTotalBytes)}` : '—'}
            />
            <GaugeCard
              label={t('gaugeDisk')}
              percent={diskPct}
              detail={drives.length > 0 ? `${formatBytes(totalFree)} ${t('gaugeDiskFree')}` : '—'}
            />

            {/* System info */}
            <div className="glass-card glass-card-hover flex flex-col rounded-2xl px-5 py-5">
              <div className="mb-2 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
                  <Cpu className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                </div>
                <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('overviewSystem')}</h3>
              </div>
              <div className="flex flex-1 flex-col justify-center divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                <InfoRow label={t('overviewProcessor')} value={systemInfo?.cpuModel || '—'} />
                <InfoRow
                  label={t('overviewCores')}
                  value={systemInfo ? `${systemInfo.cpuCores} / ${systemInfo.cpuThreads}` : '—'}
                />
                <InfoRow label={t('overviewMemory')} value={systemInfo ? formatBytes(systemInfo.totalMemBytes) : '—'} />
                <InfoRow label={t('overviewOs')} value={systemInfo?.osVersion || '—'} />
              </div>
            </div>
          </div>
        </Section>

        {/* ── 3 · Performance ──────────────────────────── */}
        <Section index={2}>
          <SectionHeading icon={BarChart3} title={t('sectionPerformance')} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TrendCard title={t('chartCpuTitle')} color="#f59e0b" hasData={trend.length >= 2}>
              <TrendChart data={trend} dataKey="cpu" color="#f59e0b" unit="%" />
            </TrendCard>
            <TrendCard title={t('chartMemoryTitle')} color="#3b82f6" hasData={trend.length >= 2}>
              <TrendChart data={trend} dataKey="mem" color="#3b82f6" unit="%" />
            </TrendCard>
          </div>
        </Section>

        {/* ── 4 · Cleanup Summary ──────────────────────── */}
        <Section index={3}>
          <SectionHeading icon={Trash2} title={t('sectionCleanup')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={HardDrive} label={t('statSpaceRecovered')} value={stats.totalSpaceSaved} displayValue={formatBytes(stats.totalSpaceSaved)} variant="accent" />
            <StatCard icon={FileStack} label={t('statFilesCleaned')} value={stats.totalFilesCleaned} variant="success" />
            <StatCard icon={BarChart3} label={t('statTotalScans')} value={stats.totalScans} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Storage overview */}
            <div className="glass-card rounded-2xl px-5 py-5">
              <h3 className="mb-4 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('storageOverviewHeading')}</h3>
              <div className="space-y-5">
                {drives.length === 0 && (
                  <p className="py-4 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {t('storageOverviewEmpty')}
                  </p>
                )}
                {drives.map((drive) => (
                  <DriveBar key={drive.letter} drive={drive} platform={platform} />
                ))}
              </div>
            </div>

            {/* Recent activity */}
            <div className="glass-card rounded-2xl px-5 py-5">
              <h3 className="mb-4 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('recentActivityHeading')}</h3>
              {recentActivity.length === 0 ? (
                <p className="py-4 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('recentActivityEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentActivity.map((entry) => {
                    const Icon = ACTIVITY_ICONS[entry.type] ?? Search
                    return (
                      <li
                        key={entry.id}
                        className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                        style={{ background: 'var(--bg-subtle)' }}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-subtle-2)' }}>
                          <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-300">
                          {entry.message}
                        </span>
                        <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          {formatDate(entry.timestamp)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </Section>

        {/* ── 5 · Quick Actions ────────────────────────── */}
        <Section index={4}>
          <SectionHeading icon={Zap} title={t('sectionActions')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Quick Clean */}
            <button
              onClick={() => setShowQuickConfirm(true)}
              disabled={isRunning}
              className={cn(
                'glass-card glass-card-hover glow-amber group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60',
              )}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  boxShadow: '0 0 20px rgba(245,158,11,0.2)'
                }}
              >
                <Sparkles className="h-5 w-5" style={{ color: 'var(--text-on-accent)' }} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-zinc-200">{t('quickCleanTitle')}</p>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {features.registry ? t('quickCleanDescriptionWithRegistry') : t('quickCleanDescriptionWithoutRegistry')}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                style={{ color: 'var(--text-faint)' }}
                strokeWidth={1.8}
              />
            </button>

            {/* Full Clean */}
            <button
              onClick={() => setShowFullConfirm(true)}
              disabled={isRunning}
              className={cn(
                'glass-card glass-card-hover glow-blue group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60',
              )}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  boxShadow: '0 0 20px rgba(59,130,246,0.2)'
                }}
              >
                <Shield className="h-5 w-5 text-white" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-zinc-200">{t('fullCleanTitle')}</p>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {features.registry ? t('fullCleanDescriptionWithRegistry') : t('fullCleanDescriptionWithoutRegistry')}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                style={{ color: 'var(--text-faint)' }}
                strokeWidth={1.8}
              />
            </button>
          </div>

          {/* Game Mode (Windows) */}
          {features.gameMode && (
            <button
              onClick={() => navigate('/game-mode')}
              className="glass-card glass-card-hover group relative mt-4 flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all"
              style={{
                animation: gameModeActive ? 'game-mode-pulse 2.5s ease-in-out infinite' : undefined,
                borderColor: gameModeActive ? 'rgba(6,182,212,0.25)' : undefined,
                background: gameModeActive
                  ? 'linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(139,92,246,0.04) 100%)'
                  : undefined,
              }}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: gameModeActive
                    ? 'linear-gradient(135deg, #06b6d4, #8b5cf6)'
                    : 'var(--bg-hover)',
                  border: `1px solid ${gameModeActive ? '#06b6d4' : 'var(--border-strong)'}`
                }}
              >
                <Gamepad2 className="h-5 w-5" style={{ color: gameModeActive ? '#fff' : 'var(--text-muted)' }} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold tracking-[0.15em]" style={{ color: gameModeActive ? '#06b6d4' : 'var(--text-secondary)' }}>
                  {gameModeActive ? t('gameModeActive') : t('gameModeReady')}
                </p>
                <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  {gameModeActive ? t('gameModeRunning') : t('gameModeClickToOpen')}
                </p>
              </div>
              {gameModeActive && gameModeActivatedAt && (
                <span className="shrink-0 font-mono text-lg font-semibold tabular-nums" style={{ color: '#06b6d4' }}>
                  {formatGmElapsed(gmElapsed)}
                </span>
              )}
              <ArrowRight
                className="h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                style={{ color: 'var(--text-faint)' }}
                strokeWidth={1.8}
              />
            </button>
          )}

          {/* ── Progress / result banner ────────────────── */}
          {isRunning && (
            <div
              className="glass-card mt-4 rounded-2xl px-5 py-4"
              style={{ borderColor: 'rgba(245,158,11,0.15)' }}
            >
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
                <span className="flex-1 text-[13px] text-zinc-400">{phaseLabel || t('progressWorking')}</span>
                {stepProgress.total > 0 && (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {stepProgress.current}/{stepProgress.total}
                  </span>
                )}
              </div>
              {stepProgress.total > 0 && (
                <div className="mt-2.5 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(stepProgress.current / stepProgress.total) * 100}%`, background: 'var(--accent)' }}
                  />
                </div>
              )}
            </div>
          )}

          {phase === 'done' && result && (
            <div
              className="glass-card mt-4 rounded-2xl p-4"
              style={{ background: 'rgba(34,197,94,0.04)', borderColor: 'rgba(34,197,94,0.12)' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} />
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">{t('resultCleanupComplete')}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    {result.spaceRecovered > 0 && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultSpaceRecovered', { size: formatBytes(result.spaceRecovered) })}</p>}
                    {result.filesCleaned > 0 && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultFilesCleaned', { count: formatNumber(result.filesCleaned) })}</p>}
                    {result.registryFixed > 0 && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultRegistryFixed', { count: result.registryFixed })}</p>}
                    {result.driversRemoved > 0 && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultDriversRemoved', { count: result.driversRemoved })}</p>}
                    {result.threatsFound > 0 && (
                      result.threatsQuarantined > 0 ? (
                        <button onClick={() => navigate('/malware', { state: { tab: 'quarantine' } })} className="text-[12px] hover:underline" style={{ color: '#22c55e' }}>
                          {t(result.threatsQuarantined !== 1 ? 'resultThreatsQuarantinedPlural' : 'resultThreatsQuarantined', { count: result.threatsQuarantined })} &rarr;
                        </button>
                      ) : (
                        <p className="text-[12px]" style={{ color: '#ef4444' }}>
                          {t(result.threatsQuarantined !== 1 ? 'resultThreatsQuarantinedPlural' : 'resultThreatsQuarantined', { count: result.threatsQuarantined })}
                        </p>
                      )
                    )}
                    {result.threatsFound === 0 && result.privacyScore > 0 && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultNoThreatsFound')}</p>}
                    {result.privacyIssues > 0 && (
                      <button onClick={() => navigate('/hardening')} className="text-[12px] hover:underline" style={{ color: '#3b82f6' }}>
                        {t(result.privacyIssues !== 1 ? 'resultPrivacyImprovementsPlural' : 'resultPrivacyImprovements', { count: result.privacyIssues })} &rarr;
                      </button>
                    )}
                    {result.startupHighImpact > 0 && (
                      <button onClick={() => navigate('/startup')} className="text-[12px] hover:underline" style={{ color: '#3b82f6' }}>
                        {t(result.startupHighImpact !== 1 ? 'resultStartupHighImpactPlural' : 'resultStartupHighImpact', { count: result.startupHighImpact })} &rarr;
                      </button>
                    )}
                    {result.updatesAvailable > 0 && (
                      <button onClick={() => navigate('/updates')} className="text-[12px] hover:underline" style={{ color: '#3b82f6' }}>
                        {t(result.updatesAvailable !== 1 ? 'resultSoftwareUpdatesPlural' : 'resultSoftwareUpdates', { count: result.updatesAvailable })} &rarr;
                      </button>
                    )}
                    {result.spaceRecovered === 0 && result.filesCleaned === 0 && result.registryFixed === 0 && result.driversRemoved === 0 && result.threatsFound === 0 && result.privacyIssues === 0 && result.startupHighImpact === 0 && result.updatesAvailable === 0 && (
                      <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{t('resultSystemAlreadyClean')}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={showQuickConfirm}
        onConfirm={() => { setShowQuickConfirm(false); handleQuickClean() }}
        onCancel={() => setShowQuickConfirm(false)}
        title={t('quickCleanConfirmTitle')}
        description={features.registry ? t('quickCleanConfirmDescriptionWithRegistry') : t('quickCleanConfirmDescriptionWithoutRegistry')}
        confirmLabel={t('quickCleanConfirmLabel')}
        variant="warning"
      />

      <ConfirmDialog
        open={showFullConfirm}
        onConfirm={() => { setShowFullConfirm(false); handleFullClean() }}
        onCancel={() => setShowFullConfirm(false)}
        title={t('fullCleanConfirmTitle')}
        description={features.registry ? t('fullCleanConfirmDescriptionWithRegistry') : t('fullCleanConfirmDescriptionWithoutRegistry')}
        confirmLabel={t('fullCleanConfirmLabel')}
        variant="warning"
      />
    </div>
  )
}

// ── Section wrapper (staggered entrance) ─────────────────────

function Section({ children, index }: { children: React.ReactNode; index: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.06 * index }}
    >
      {children}
    </motion.section>
  )
}

// ── Section heading ──────────────────────────────────────────

function SectionHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>
        {title}
      </h2>
      <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
    </div>
  )
}

// ── Info row (system overview) ───────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="shrink-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="truncate text-[12px] font-medium text-zinc-200" title={value}>{value}</span>
    </div>
  )
}

// ── Trend chart card ─────────────────────────────────────────

function TrendCard({ title, color, hasData, children }: { title: string; color: string; hasData: boolean; children: React.ReactNode }) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="glass-card glass-card-hover rounded-2xl px-5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-zinc-200">{title}</h3>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{t('chartSampleEvery')}</span>
          <span
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide"
            style={{ background: 'var(--bg-subtle-2)', color }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: color }} />
            {t('chartLive')}
          </span>
        </div>
      </div>
      {hasData ? children : (
        <div className="flex h-[120px] items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {t('chartNoData')}
        </div>
      )}
    </div>
  )
}

// ── Lightweight trend chart (recharts) ───────────────────────

function TrendChart({ data, dataKey, color, unit }: {
  data: Array<{ cpu: number; mem: number }>
  dataKey: 'cpu' | 'mem'
  color: string
  unit: string
}) {
  const chartData = data.map((d, i) => ({ i, value: d[dataKey] }))
  const gradientId = `dash-trend-${dataKey}`

  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={[0, 100]} />
        <Tooltip
          contentStyle={{
            background: '#1e1e24',
            border: '1px solid var(--border-strong)',
            borderRadius: '10px',
            fontSize: '12px',
            color: 'var(--text-primary)'
          }}
          labelFormatter={() => ''}
          formatter={(val) => [`${Number(val).toFixed(0)}${unit}`]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          fill={`url(#${gradientId})`}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Drive Bar ────────────────────────────────────────────────

function DriveBar({ drive, platform }: { drive: DriveInfo; platform: string }) {
  const usedPercent = (drive.usedSpace / drive.totalSize) * 100
  const barColor = usedPercent > 90 ? '#ef4444' : usedPercent > 75 ? '#f59e0b' : '#22c55e'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.6} />
          <span className="text-[13px] font-medium text-zinc-300">
            {platform === 'win32' ? `${drive.letter}: ${drive.label}` : `${drive.letter} ${drive.label}`}
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {formatBytes(drive.usedSpace)} / {formatBytes(drive.totalSize)}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${usedPercent}%`,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
            boxShadow: `0 0 8px ${barColor}30`
          }}
        />
      </div>
    </div>
  )
}
