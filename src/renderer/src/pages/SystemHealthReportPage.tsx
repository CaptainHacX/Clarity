import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  Loader2,
  RefreshCw,
  Copy,
  Download,
  ClipboardCheck,
  Cpu,
  BatteryCharging,
  HardDrive,
  Wifi,
  Bell,
  Info,
  Activity,
  MemoryStick,
  Monitor,
  Boxes,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { HealthScore } from '@/components/shared/HealthScore'
import type { HealthCheckStatus, SystemHealthReport } from '@shared/types'

const STATUS_COLOR: Record<HealthCheckStatus, string> = {
  ok: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
}

export function SystemHealthReportPage() {
  const { t } = useTranslation('healthReport')
  const [report, setReport] = useState<SystemHealthReport | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await window.clarity.healthReportGenerate()
      setReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('generateError'))
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    if (!report) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyMarkdown = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report.markdown)
      setCopied(true)
      toast.success(t('copiedToast'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('copyFailedToast'))
    }
  }

  const download = (kind: 'md' | 'json') => {
    if (!report) return
    const content = kind === 'md' ? report.markdown : JSON.stringify(report, null, 2)
    const blob = new Blob([content], { type: kind === 'md' ? 'text/markdown' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clarity-health-report-${new Date().toISOString().slice(0, 10)}.${kind}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const yesNo = (v: boolean | null | undefined) => (v == null ? t('unknown') : v ? t('yes') : t('no'))
  const orNa = (v: string | number | null | undefined): string => (v == null || v === '' ? t('na') : String(v))

  const totalFreeGb = report?.disk.reduce((s, d) => s + d.freeGb, 0).toFixed(1)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
            {t('generateButton')}
          </button>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {generating && !report && (
        <div className="glass-card flex items-center justify-center gap-3 rounded-2xl py-16 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          {t('generating')}
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <SummaryCard
              icon={Cpu}
              label={t('sumCpu')}
              value={report.system.cpuModel}
              sub={t('coresThreads', { cores: report.system.cpuCores, threads: report.system.cpuThreads })}
            />
            <SummaryCard
              icon={MemoryStick}
              label={t('sumMemory')}
              value={`${report.memory.usedGb} / ${report.memory.totalGb} GB`}
              sub={t('memoryUsedPct') + `: ${report.memory.usedPercent}%`}
            />
            <SummaryCard
              icon={Monitor}
              label={t('sumGpu')}
              value={report.gpu[0]?.model || t('na')}
              sub={report.gpu[0] ? `${report.gpu[0].vramGb} GB` : undefined}
            />
            <SummaryCard
              icon={BatteryCharging}
              label={t('sumTemp')}
              value={report.health.cpuTemperatureC != null ? `${report.health.cpuTemperatureC} °C` : t('na')}
              sub={report.health.batteryPresent ? `${report.health.batteryPercent ?? '—'}% ${t('batteryLevel')}` : t('noBattery')}
            />
            <SummaryCard
              icon={HardDrive}
              label={t('sumDisk')}
              value={report.disk.length ? `${totalFreeGb} GB` : t('na')}
              sub={report.disk.length ? t('volumesCount', { count: report.disk.length }) : t('na')}
            />
            <SummaryCard
              icon={ShieldCheck}
              label={t('sumHealth')}
              value={`${report.summary.score}/100`}
              sub={t(`status.${report.summary.checks.find((c) => c.status !== 'ok')?.status ?? 'ok'}`)}
              valueColor={STATUS_COLOR[report.summary.checks.find((c) => c.status !== 'ok')?.status ?? 'ok']}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void copyMarkdown()}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            >
              {copied ? <ClipboardCheck className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" strokeWidth={1.8} />}
              {t('copyButton')}
            </button>
            <button
              onClick={() => download('md')}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            >
              <FileText className="h-4 w-4" strokeWidth={1.8} />
              {t('downloadMd')}
            </button>
            <button
              onClick={() => download('json')}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            >
              <Download className="h-4 w-4" strokeWidth={1.8} />
              {t('downloadJson')}
            </button>
          </div>

          {/* Health summary */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
              {t('healthSection')}
            </h3>
            <div className="flex flex-col items-center gap-6 md:flex-row md:items-center">
              <HealthScore score={report.summary.score} size="sm" />
              <div className="flex w-full flex-1 flex-col gap-2">
                {report.summary.checks.length === 0 ? (
                  <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('na')}</p>
                ) : (
                  report.summary.checks.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center justify-between gap-4 rounded-xl px-4 py-2 text-[13px]"
                      style={{ background: 'var(--bg-subtle)' }}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />
                        <span className="font-medium text-zinc-200">{t(`check.${c.key}`)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span style={{ color: 'var(--text-muted)' }}>{c.detail}</span>
                        <Badge status={c.status}>{t(`status.${c.status}`)}</Badge>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* System */}
          <Section icon={Info} title={t('systemSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('hostname')} v={report.system.hostname} />
              <Row k={t('osLabel')} v={report.system.os} />
              <Row k={t('osBuild')} v={orNa(report.system.osBuild)} />
              <Row k={t('osCodename')} v={orNa(report.system.osCodename)} />
              <Row k={t('kernel')} v={report.system.kernel} />
              <Row k={t('architecture')} v={report.system.arch} />
              <Row k={t('osUefi')} v={yesNo(report.system.osUefi)} />
              <Row k={t('osHypervisor')} v={yesNo(report.system.osHypervisor)} />
              <Row k={t('hardware')} v={`${report.system.manufacturer} ${report.system.model}`} />
              <Row k={t('bios')} v={orNa(`${report.system.biosVendor} ${report.system.biosVersion}`.trim())} />
              <Row k={t('uptime')} v={`${report.system.uptimeHours} h`} />
              <Row k={t('timezone')} v={orNa(report.system.timezoneName || report.system.timezone)} />
              <Row k={t('clarityVersion')} v={report.app.version} />
            </dl>
          </Section>

          {/* CPU & Load */}
          <Section icon={Activity} title={t('cpuSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('cpuModel')} v={report.system.cpuModel} />
              <Row k={t('cpuCores')} v={t('coresThreads', { cores: report.system.cpuCores, threads: report.system.cpuThreads })} />
              <Row k={t('cpuSpeed')} v={report.system.cpuSpeedGhZ != null ? `${report.system.cpuSpeedGhZ} GHz` : t('na')} />
              <Row k={t('cpuMaxSpeed')} v={report.system.cpuMaxSpeedGhZ != null ? `${report.system.cpuMaxSpeedGhZ} GHz` : t('na')} />
              <Row k={t('cpuCache')} v={report.system.cpuCacheL3Mb != null ? `${report.system.cpuCacheL3Mb} MB` : t('na')} />
              <Row k={t('cpuVirtualization')} v={yesNo(report.system.cpuVirtualization)} />
              <Row k={t('currentCpuLoad')} v={report.system.currentCpuLoad != null ? `${report.system.currentCpuLoad}%` : t('na')} />
              <Row
                k={t('loadAverage')}
                v={`${report.system.loadAverage1 ?? '—'}% / ${report.system.loadAverage5 ?? '—'}% / ${report.system.loadAverage15 ?? '—'}%`}
              />
            </dl>
          </Section>

          {/* Memory & Swap */}
          <Section icon={MemoryStick} title={t('memorySection')}>
            <Meter
              label={`${t('memoryUsedPct')}: ${report.memory.usedPercent}%`}
              percent={report.memory.usedPercent}
            />
            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('memoryTotal')} v={`${report.memory.totalGb} GB`} />
              <Row k={t('memoryUsed')} v={`${report.memory.usedGb} GB`} />
              <Row k={t('memoryFree')} v={`${report.memory.freeGb} GB`} />
              <Row k={t('memoryActive')} v={`${report.memory.activeGb} GB`} />
              <Row k={t('swapTotal')} v={`${report.memory.swapTotalGb} GB`} />
              <Row k={t('swapUsed')} v={`${report.memory.swapUsedGb} GB (${report.memory.swapPercent}%)`} />
            </dl>
          </Section>

          {/* GPU */}
          <Section icon={Monitor} title={t('gpuSection')}>
            {report.gpu.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('noGpus')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {report.gpu.map((g, i) => (
                  <div key={i} className="rounded-xl p-4" style={{ background: 'var(--bg-subtle)' }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-zinc-200">{g.model}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{g.vendor}</span>
                    </div>
                    <dl className="flex flex-col gap-1.5 text-[12px]">
                      <Row k={t('gpuVram')} v={g.vramGb > 0 ? `${g.vramGb} GB` : t('gpuVramMb')} />
                      <Row k={t('gpuBus')} v={orNa(g.bus)} />
                      <Row k={t('gpuDriver')} v={orNa(g.driverVersion)} />
                      <Row k={t('gpuTemp')} v={g.temperatureC != null ? `${g.temperatureC} °C` : t('na')} />
                      <Row k={t('gpuUtilization')} v={g.utilizationPct != null ? `${g.utilizationPct}%` : t('na')} />
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Processes */}
          <Section icon={Boxes} title={t('processesSection')}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={t('processTotal')} value={report.processes.total} />
              <StatTile label={t('processRunning')} value={report.processes.running} color="#22c55e" />
              <StatTile label={t('processSleeping')} value={report.processes.sleeping} color="#3b82f6" />
              <StatTile label={t('processBlocked')} value={report.processes.blocked} color="#f59e0b" />
            </div>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row
                k={t('topCpu')}
                v={report.processes.topCpu ? `${report.processes.topCpu.name} · ${t('pid', { pid: report.processes.topCpu.pid })} · ${report.processes.topCpu.percent}%` : t('na')}
              />
              <Row
                k={t('topMem')}
                v={report.processes.topMem ? `${report.processes.topMem.name} · ${t('pid', { pid: report.processes.topMem.pid })} · ${report.processes.topMem.percent}%` : t('na')}
              />
            </dl>
          </Section>

          {/* Thermal & Battery */}
          <Section icon={BatteryCharging} title={t('thermalSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('cpuTemp')} v={report.health.cpuTemperatureC != null ? `${report.health.cpuTemperatureC} °C` : t('na')} />
              <Row k={t('batteryLevel')} v={report.health.batteryPresent ? `${report.health.batteryPercent ?? '—'}%` : t('noBattery')} />
              <Row k={t('batteryHealth')} v={report.health.batteryPresent ? `${report.health.batteryHealthPercent ?? '—'}%` : t('noBattery')} />
              <Row k={t('charging')} v={report.health.batteryPresent ? (report.health.batteryCharging ? t('yes') : t('no')) : t('noBattery')} />
              <Row k={t('batteryCycles')} v={report.health.batteryPresent ? orNa(report.health.batteryCycleCount) : t('noBattery')} />
              <Row k={t('batteryRemaining')} v={report.health.batteryPresent ? (report.health.batteryTimeRemainingMin != null ? `${report.health.batteryTimeRemainingMin} ${t('min')}` : t('na')) : t('noBattery')} />
              <Row k={t('batteryAc')} v={report.health.batteryPresent ? yesNo(report.health.batteryAcConnected) : t('noBattery')} />
              <Row k={t('batteryVoltage')} v={report.health.batteryPresent ? (report.health.batteryVoltageV != null ? `${report.health.batteryVoltageV} V` : t('na')) : t('noBattery')} />
              <Row k={t('batteryType')} v={report.health.batteryPresent ? orNa(report.health.batteryType) : t('noBattery')} />
            </dl>
          </Section>

          {/* Disk */}
          <Section icon={HardDrive} title={t('diskSection')}>
            {report.disk.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('noDisks')}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {report.disk.map((d) => (
                  <div key={d.mount}>
                    <div className="mb-1 flex items-center justify-between text-[13px]">
                      <span className="font-medium text-zinc-200">
                        {d.mount} <span className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>({d.type})</span>
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {d.freeGb} GB free · {d.totalGb} GB ({d.percent}% used)
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, d.percent)}%`,
                          background: d.percent >= 90 ? '#ef4444' : d.percent >= 75 ? '#f59e0b' : '#22c55e',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Network Security */}
          <Section icon={Wifi} title={t('networkSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('wifiSecurity')} v={t(`security.${report.network.wifiSecurity}`)} />
              <Row k={t('wifiSecurityDetail')} v={orNa(report.network.wifiSecurityDetail)} />
              <Row k={t('wifiSsid')} v={orNa(report.network.wifiSsid)} />
              <Row k={t('wifiChannel')} v={report.network.wifiChannel != null ? String(report.network.wifiChannel) : t('na')} />
              <Row k={t('wifiSignal')} v={report.network.wifiSignalPct != null ? `${report.network.wifiSignalPct}%` : t('na')} />
              <Row k={t('vpnStatus')} v={report.network.vpnDetected ? t('vpnOn') : t('vpnOff')} />
              <Row k={t('vpnInterfaces')} v={report.network.vpnInterfaces.length ? report.network.vpnInterfaces.join(', ') : t('na')} />
              <Row k={t('gateway')} v={report.network.gateway ?? t('na')} />
              <Row k={t('ipv4Label')} v={report.network.ipv4 ?? t('na')} />
              <Row k={t('ipv6Label')} v={report.network.ipv6 ?? t('na')} />
              <Row k={t('interfaceCount')} v={String(report.network.interfaceCount)} />
              <Row k={t('nearbyNetworks')} v={String(report.network.nearbyNetworks)} />
              <Row k={t('locationAccess')} v={t(`location.${report.network.locationAccess}`)} />
            </dl>
          </Section>

          {/* Recent Alerts */}
          <Section icon={Bell} title={t('alertsSection')}>
            {report.alerts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('noAlerts')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {report.alerts.slice(-10).reverse().map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: 'var(--bg-subtle)' }}>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6' }}
                    />
                    <span className="flex-1 truncate text-zinc-200">{a.title}</span>
                    <span style={{ color: 'var(--text-faint)' }}>{new Date(a.timestamp).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: typeof Cpu
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: 'var(--text-muted)' }} />
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{label}</p>
      </div>
      <p className="mt-2 truncate text-[14px] font-semibold text-zinc-100" style={valueColor ? { color: valueColor } : undefined} title={value}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Info; title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
      <dd className="truncate font-medium text-zinc-200">{v}</dd>
    </div>
  )
}

function Meter({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="font-medium text-zinc-200">{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, percent)}%`,
            background: percent >= 90 ? '#ef4444' : percent >= 75 ? '#f59e0b' : '#22c55e',
          }}
        />
      </div>
    </div>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[20px] font-bold leading-none" style={{ color: color ?? 'var(--text-primary)' }}>{value}</p>
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}

function Badge({ status, children }: { status: HealthCheckStatus; children: React.ReactNode }) {
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: STATUS_COLOR[status],
        background: `${STATUS_COLOR[status]}1a`,
        border: `1px solid ${STATUS_COLOR[status]}40`,
      }}
    >
      {children}
    </span>
  )
}
