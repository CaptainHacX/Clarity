import { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play, RefreshCw, Activity } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { SystemInfoHeader } from '@/components/perf/SystemInfoHeader'
import { TimeSeriesChart } from '@/components/perf/TimeSeriesChart'
import { AlertBanner } from '@/components/perf/AlertBanner'
import { DiskHealthPanel } from '@/components/perf/DiskHealthPanel'
import { DiskVolumesPanel } from '@/components/perf/DiskVolumesPanel'
import { ThermalBatteryPanel } from '@/components/perf/ThermalBatteryPanel'
import { ProcessTable } from '@/components/perf/ProcessTable'
import { usePerfStore, REFRESH_INTERVAL_OPTIONS_MS } from '@/stores/perf-store'
import { formatBytes, formatSpeed } from '@/lib/utils'
import { cn } from '@/lib/utils'

const CHART_COLORS = {
  cpu: '#f59e0b',
  memory: '#3b82f6',
  disk: '#22c55e',
  network: '#8b5cf6'
}

function formatRelative(epochMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - epochMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function cpuBarColor(pct: number): string {
  if (pct >= 50) return '#ef4444'
  if (pct >= 20) return '#f59e0b'
  return '#22c55e'
}

function PerCoreCard() {
  const { t } = useTranslation('performance')
  const perCore = usePerfStore((s) => s.currentSnapshot?.cpu.perCore)

  return (
    <div className="glass-card flex flex-col rounded-2xl p-5">
      <div className="mb-3 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {t('perCoreTitle')}
      </div>
      {!perCore || perCore.length === 0 ? (
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('noDataPlaceholder')}
        </span>
      ) : (
        <div className="flex flex-col gap-1.5">
          {perCore.map((load, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {t('perCoreLabel', { index: i + 1 })}
              </span>
              <div className="h-1.5 flex-1 rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, load)}%`, background: cpuBarColor(load) }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                {load.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SwapCard() {
  const { t } = useTranslation('performance')
  const swap = usePerfStore((s) => s.currentSnapshot?.swap)
  const hasData = !!swap && swap.totalBytes > 0
  const pct = hasData ? swap.percent : 0

  return (
    <div className="glass-card flex flex-col justify-center gap-3 rounded-2xl p-5">
      <div className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {t('swapTitle')}
      </div>
      {hasData ? (
        <>
          <div className="flex items-end gap-1.5">
            <span className="text-[30px] font-bold tracking-tight" style={{ color: pct >= 80 ? '#ef4444' : 'var(--text-primary)' }}>
              {pct.toFixed(0)}
            </span>
            <span className="mb-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, pct)}%`, background: pct >= 80 ? '#ef4444' : '#22c55e' }}
            />
          </div>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('swapDetail', { used: formatBytes(swap.usedBytes, 1), total: formatBytes(swap.totalBytes, 1) })}
          </span>
        </>
      ) : (
        <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('noDataPlaceholder')}
        </span>
      )}
    </div>
  )
}

export function PerformanceMonitorPage() {
  const { t } = useTranslation('performance')
  const systemInfo = usePerfStore((s) => s.systemInfo)
  const snapshot = usePerfStore((s) => s.currentSnapshot)
  const history = usePerfStore((s) => s.history)
  const isMonitoring = usePerfStore((s) => s.isMonitoring)
  const refreshIntervalMs = usePerfStore((s) => s.refreshIntervalMs)
  const lastUpdated = usePerfStore((s) => s.lastUpdated)
  const isRefreshing = usePerfStore((s) => s.isRefreshing)
  const diskVolumes = usePerfStore((s) => s.diskVolumes)
  const setSystemInfo = usePerfStore((s) => s.setSystemInfo)
  const pushSnapshot = usePerfStore((s) => s.pushSnapshot)
  const setProcessList = usePerfStore((s) => s.setProcessList)
  const setDiskVolumes = usePerfStore((s) => s.setDiskVolumes)
  const diskHealth = usePerfStore((s) => s.diskHealth)
  const setDiskHealth = usePerfStore((s) => s.setDiskHealth)
  const hardwareHealth = usePerfStore((s) => s.hardwareHealth)
  const setHardwareHealth = usePerfStore((s) => s.setHardwareHealth)
  const setMonitoring = usePerfStore((s) => s.setMonitoring)
  const setRefreshInterval = usePerfStore((s) => s.setRefreshInterval)
  const setRefreshing = usePerfStore((s) => s.setRefreshing)
  const reset = usePerfStore((s) => s.reset)

  const [paused, setPaused] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Start monitoring on mount
  useEffect(() => {
    let snapshotUnsub: (() => void) | undefined
    let processUnsub: (() => void) | undefined
    let volumeUnsub: (() => void) | undefined
    let hardwareUnsub: (() => void) | undefined

    const start = async () => {
      try {
        const [info, disks, hardwareHealth] = await Promise.all([
          window.clarity.perfGetSystemInfo(),
          window.clarity.perfGetDiskHealth(),
          window.clarity.perfGetHardwareHealth()
        ])
        setSystemInfo(info)
        setDiskHealth(disks)
        setHardwareHealth(hardwareHealth)

        snapshotUnsub = window.clarity.onPerfSnapshot((data) => {
          pushSnapshot(data)
        })

        processUnsub = window.clarity.onPerfProcessList((data) => {
          setProcessList(data.processes, data.totalCount)
        })

        volumeUnsub = window.clarity.onPerfDiskVolumes((data) => {
          setDiskVolumes(data)
        })

        hardwareUnsub = window.clarity.onPerfHardwareHealth((data) => {
          setHardwareHealth(data)
        })

        await window.clarity.perfStartMonitoring(usePerfStore.getState().refreshIntervalMs)
        setMonitoring(true)
      } catch {
        toast.error(t('failedToStartToast'))
      }
    }

    start()

    return () => {
      snapshotUnsub?.()
      processUnsub?.()
      volumeUnsub?.()
      hardwareUnsub?.()
      window.clarity.perfStopMonitoring().catch(() => {})
      reset()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tick once a second so the "last updated" readout stays fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const togglePause = useCallback(async () => {
    if (paused) {
      await window.clarity.perfStartMonitoring(usePerfStore.getState().refreshIntervalMs)
      setPaused(false)
      setMonitoring(true)
    } else {
      await window.clarity.perfStopMonitoring()
      setPaused(true)
      setMonitoring(false)
    }
  }, [paused])

  const changeInterval = useCallback((ms: number) => {
    setRefreshInterval(ms)
    if (isMonitoring) {
      window.clarity.perfSetRefreshInterval(ms).catch(() => {})
    }
  }, [isMonitoring])

  const handleRefreshNow = useCallback(async () => {
    if (paused || isRefreshing) return
    setRefreshing(true)
    try {
      await window.clarity.perfRefreshNow()
    } catch {
      toast.error(t('failedToStartToast'))
    } finally {
      setRefreshing(false)
    }
  }, [paused, isRefreshing])

  const intervalOptions: Array<{ label: string; ms: number }> = REFRESH_INTERVAL_OPTIONS_MS.map((ms) => ({
    label: ms >= 60_000 ? (ms >= 300_000 ? (ms >= 900_000 ? '15m' : '5m') : '1m') : '5s',
    ms
  }))

  const lastUpdatedLabel = paused
    ? t('monitoringPaused')
    : lastUpdated
      ? t('lastUpdated', { time: formatRelative(lastUpdated, now) })
      : '--'

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <>
            {/* Refresh interval */}
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] font-medium md:inline" style={{ color: 'var(--text-muted)' }}>
                {t('refreshIntervalLabel')}
              </span>
              <div
                className="flex rounded-lg p-0.5"
                style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
              >
                {intervalOptions.map((opt) => (
                  <button
                    key={opt.ms}
                    onClick={() => changeInterval(opt.ms)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors'
                    )}
                    style={{
                      color: refreshIntervalMs === opt.ms ? 'var(--accent)' : 'var(--text-muted)',
                      background: refreshIntervalMs === opt.ms ? 'var(--accent-muted-bg)' : 'transparent'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Refresh Now */}
            <button
              onClick={handleRefreshNow}
              disabled={paused || isRefreshing}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
              style={{
                background: 'var(--bg-subtle-2)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-medium)'
              }}
              title={t('refreshNow')}
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline">{t('refreshNow')}</span>
            </button>

            {/* Pause/Resume */}
            <button
              onClick={togglePause}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{
                background: paused ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle-2)',
                color: paused ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${paused ? 'rgba(34,197,94,0.2)' : 'var(--border-medium)'}`
              }}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? t('resume') : t('pause')}
            </button>
          </>
        }
      />

      {/* Paused banner */}
      {paused && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-3 animate-fade-in"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <Activity className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={2} />
          <span className="flex-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('pausedBannerHint')}
          </span>
          <button
            onClick={togglePause}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
          >
            {t('resume')}
          </button>
        </div>
      )}

      {/* Last updated */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('updatedLabel')}:
        </span>
        <span className={cn('text-[11px] font-semibold font-mono', paused && 'text-amber-500')} style={{ color: paused ? '#f59e0b' : 'var(--text-secondary)' }}>
          {lastUpdatedLabel}
        </span>
        {isMonitoring && !paused && (
          <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#22c55e' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          </span>
        )}
      </div>

      <SystemInfoHeader info={systemInfo} uptime={snapshot?.uptime ?? 0} />

      <AlertBanner snapshot={snapshot} history={history} />

      {/* Gauges */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <GaugeCard
          label={t('gaugeCpu')}
          percent={snapshot ? snapshot.cpu.overall : null}
          detail={
            snapshot
              ? t('cpuThreadsDetail', { count: snapshot.cpu.perCore.length })
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeMemory')}
          percent={snapshot ? snapshot.memory.percent : null}
          detail={
            snapshot
              ? t('memoryDetail', {
                  used: formatBytes(snapshot.memory.usedBytes, 1),
                  total: formatBytes(snapshot.memory.totalBytes, 1)
                })
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeDiskIo')}
          percent={snapshot ? Math.min(100, ((snapshot.disk.readBytesPerSec + snapshot.disk.writeBytesPerSec) / (200 * 1024 * 1024)) * 100) : null}
          detail={
            snapshot
              ? t('diskIoDetail', { read: formatSpeed(snapshot.disk.readBytesPerSec), write: formatSpeed(snapshot.disk.writeBytesPerSec) })
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeNetwork')}
          percent={snapshot ? Math.min(100, ((snapshot.network.rxBytesPerSec + snapshot.network.txBytesPerSec) / (125 * 1024 * 1024)) * 100) : null}
          detail={
            snapshot
              ? t('networkDetail', { rx: formatSpeed(snapshot.network.rxBytesPerSec), tx: formatSpeed(snapshot.network.txBytesPerSec) })
              : t('noDataPlaceholder')
          }
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TimeSeriesChart history={history} dataKey="cpu" label={t('chartCpuUsage')} color={CHART_COLORS.cpu} />
        <TimeSeriesChart history={history} dataKey="memory" label={t('chartMemoryUsage')} color={CHART_COLORS.memory} />
        <TimeSeriesChart history={history} dataKey="disk" label={t('chartDiskIo')} color={CHART_COLORS.disk} accentColor="#ef4444" />
        <TimeSeriesChart history={history} dataKey="network" label={t('chartNetwork')} color={CHART_COLORS.network} accentColor="#ec4899" />
      </div>

      {/* Per-core + Swap */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PerCoreCard />
        <SwapCard />
      </div>

      {/* Thermal & Battery */}
      <ThermalBatteryPanel health={hardwareHealth} platform={systemInfo?.platform} />

      {/* Disk Volumes */}
      <DiskVolumesPanel volumes={diskVolumes} />

      {/* Disk Health */}
      <DiskHealthPanel disks={diskHealth} />

      {/* Process Table */}
      <ProcessTable />
    </div>
  )
}
