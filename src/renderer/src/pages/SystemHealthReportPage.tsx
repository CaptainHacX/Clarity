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
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import type { SystemHealthReport } from '@shared/types'

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryCard icon={Cpu} label={t('sumCpu')} value={report.system.cpuModel} sub={`${report.system.cpuCores}c / ${report.system.cpuThreads}t`} />
            <SummaryCard icon={Info} label={t('sumMemory')} value={`${report.system.totalMemGb} GB`} sub={report.system.os} />
            <SummaryCard
              icon={BatteryCharging}
              label={t('sumTemp')}
              value={report.health.cpuTemperatureC != null ? `${report.health.cpuTemperatureC} °C` : t('na')}
              sub={report.health.batteryPresent ? `${report.health.batteryPercent ?? '—'}% battery` : t('noBattery')}
            />
            <SummaryCard
              icon={HardDrive}
              label={t('sumDisk')}
              value={report.disk.length ? `${report.disk.reduce((s, d) => s + d.freeGb, 0).toFixed(1)} GB free` : t('na')}
              sub={report.disk.length ? `${report.disk.length} volume(s)` : t('na')}
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

          {/* Rendered sections */}
          <Section icon={Info} title={t('systemSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('hostname')} v={report.system.hostname} />
              <Row k={t('osLabel')} v={report.system.os} />
              <Row k={t('kernel')} v={report.system.kernel} />
              <Row k={t('uptime')} v={`${report.system.uptimeHours} h`} />
              <Row k={t('hardware')} v={`${report.system.manufacturer} ${report.system.model}`} />
              <Row k={t('clarityVersion')} v={report.app.version} />
            </dl>
          </Section>

          <Section icon={BatteryCharging} title={t('thermalSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('cpuTemp')} v={report.health.cpuTemperatureC != null ? `${report.health.cpuTemperatureC} °C` : t('na')} />
              <Row k={t('batteryLevel')} v={report.health.batteryPresent ? `${report.health.batteryPercent ?? '—'}%` : t('noBattery')} />
              <Row k={t('batteryHealth')} v={report.health.batteryPresent ? `${report.health.batteryHealthPercent ?? '—'}%` : t('noBattery')} />
              <Row k={t('charging')} v={report.health.batteryPresent ? (report.health.batteryCharging ? t('yes') : t('no')) : t('noBattery')} />
            </dl>
          </Section>

          <Section icon={HardDrive} title={t('diskSection')}>
            {report.disk.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('noDisks')}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {report.disk.map((d) => (
                  <div key={d.mount}>
                    <div className="mb-1 flex items-center justify-between text-[13px]">
                      <span className="font-medium text-zinc-200">{d.mount}</span>
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

          <Section icon={Wifi} title={t('networkSection')}>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
              <Row k={t('wifiSecurity')} v={t(`security.${report.network.wifiSecurity}`)} />
              <Row k={t('vpnStatus')} v={report.network.vpnDetected ? t('vpnOn') : t('vpnOff')} />
              <Row k={t('gateway')} v={report.network.gateway ?? t('na')} />
              <Row k={t('ipv4Label')} v={report.network.ipv4 ?? t('na')} />
            </dl>
          </Section>

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

function SummaryCard({ icon: Icon, label, value, sub }: { icon: typeof Cpu; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: 'var(--text-muted)' }} />
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{label}</p>
      </div>
      <p className="mt-2 truncate text-[14px] font-semibold text-zinc-100" title={value}>{value}</p>
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
