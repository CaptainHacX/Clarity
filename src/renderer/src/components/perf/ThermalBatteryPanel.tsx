import { useTranslation } from 'react-i18next'
import { Thermometer, Battery, BatteryCharging, Zap, Cpu, CircuitBoard, Gauge } from 'lucide-react'
import type { HardwareHealthSnapshot } from '@shared/types'
import { cn, formatBytes } from '@/lib/utils'
import { CapabilityBadge, type CapabilityState } from './CapabilityBadge'

interface ThermalBatteryPanelProps {
  health: HardwareHealthSnapshot | null
  /** Node platform ("win32" | "darwin" | "linux") used to derive sensor capability. */
  platform?: string
}

function tempColor(temp: number): string {
  if (temp >= 90) return '#ef4444'
  if (temp >= 80) return '#f59e0b'
  return '#22c55e'
}

function formatTimeRemaining(sec: number): string {
  const mins = Math.round(sec / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function Stat({ label, value, warn, icon }: { label: string; value: string; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        {icon && <span style={{ color: warn ? '#f59e0b' : 'var(--text-muted)' }}>{icon}</span>}
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <span className="text-[15px] font-bold" style={{ color: warn ? '#f59e0b' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, badge }: { icon: React.ElementType; title: string; badge?: CapabilityState }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
        <Icon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
      </div>
      <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</div>
      {badge && <CapabilityBadge state={badge} />}
    </div>
  )
}

export function ThermalBatteryPanel({ health, platform }: ThermalBatteryPanelProps) {
  const { t } = useTranslation('performance')
  if (!health) return null

  const cpuTemp = health.cpuTemperature
  const battery = health.battery
  const gpus = health.gpus

  const cpuBadge: CapabilityState =
    cpuTemp !== null ? 'supported' : platform === 'darwin' ? 'permission-required' : 'unavailable'
  const gpuBadge: CapabilityState =
    gpus.some((g) => g.temperature !== null || g.loadPercent !== null)
      ? 'supported'
      : gpus.length > 0
        ? 'permission-required'
        : 'unavailable'
  const batteryBadge: CapabilityState =
    battery !== null ? (battery.percent !== null ? 'supported' : 'permission-required') : 'unavailable'

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('hardwareHealthTitle')}
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* CPU temperature */}
        <div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
          <SectionTitle icon={Cpu} title={t('cpuTemperature')} badge={cpuBadge} />

          {cpuTemp !== null ? (
            <>
              <div className="flex items-end gap-1.5">
                <span className="text-[30px] font-bold tracking-tight" style={{ color: tempColor(cpuTemp) }}>
                  {cpuTemp}
                </span>
                <span className="mb-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>°C</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (cpuTemp / 100) * 100)}%`,
                    background: tempColor(cpuTemp)
                  }}
                />
              </div>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {cpuTemp >= 90
                  ? t('thermalCriticalHint')
                  : cpuTemp >= 80
                    ? t('thermalWarmHint')
                    : t('thermalNormalHint')}
              </span>
            </>
          ) : (
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {cpuBadge === 'permission-required'
                ? t('capabilityHintPermission')
                : t('sensorNotAvailable')}
            </span>
          )}
        </div>

        {/* Battery */}
        <div
          className={cn(
            'glass-card flex flex-col gap-3 rounded-2xl p-5',
            battery === null && 'md:col-span-1 xl:col-span-2'
          )}
        >
          <SectionTitle
            icon={battery?.isCharging ? BatteryCharging : Battery}
            title={t('batteryTitle')}
            badge={batteryBadge}
          />
          {battery?.isCharging && (
            <div className="flex items-center gap-1 rounded-md px-2 py-0.5" style={{ background: 'rgba(34,197,94,0.1)' }}>
              <Zap className="h-3 w-3 text-green-400" />
              <span className="text-[10px] font-semibold text-green-400">{t('batteryCharging')}</span>
            </div>
          )}

          {battery !== null && battery.percent !== null ? (
            <div className="flex items-center gap-4">
              <div className="flex items-end gap-1.5">
                <span
                  className="text-[30px] font-bold tracking-tight"
                  style={{ color: battery.percent <= 20 ? '#ef4444' : 'var(--text-primary)' }}
                >
                  {battery.percent}
                </span>
                <span className="mb-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-muted)' }}>%</span>
              </div>
              <div className="flex-1">
                <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${battery.percent}%`,
                      background: battery.percent <= 20 ? '#ef4444' : '#22c55e'
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {battery === null ? t('noBattery') : t('sensorNotAvailable')}
            </span>
          )}

          {battery !== null && battery.percent !== null && (
            <div className="grid grid-cols-2 gap-3 rounded-xl p-3 sm:grid-cols-4" style={{ background: 'var(--bg-subtle)' }}>
              <Stat
                label={t('batteryHealth')}
                value={battery.healthPercent !== null ? `${battery.healthPercent}%` : '--'}
                warn={battery.healthPercent !== null && battery.healthPercent < 80}
              />
              <Stat
                label={t('batteryCycleCount')}
                value={battery.cycleCount !== null ? String(battery.cycleCount) : '--'}
              />
              <Stat
                label={t('batteryTimeRemaining')}
                value={battery.timeRemainingSec !== null ? formatTimeRemaining(battery.timeRemainingSec) : '--'}
              />
              <Stat
                label={t('batteryPowerSource')}
                value={battery.acConnected === null ? '--' : battery.acConnected ? t('batteryPowerAc') : t('batteryPowerBattery')}
              />
            </div>
          )}
        </div>

        {/* GPU */}
        <div
          className={cn(
            'glass-card flex flex-col gap-3 rounded-2xl p-5',
            battery === null && 'md:col-span-2 xl:col-span-1'
          )}
        >
          <SectionTitle icon={CircuitBoard} title={t('gpuTemperatures')} badge={gpuBadge} />

          {gpus.length > 0 ? (
            <div className="flex flex-col gap-3">
              {gpus.map((gpu) => (
                <div key={gpu.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {gpu.name}
                    </span>
                    {gpu.temperature !== null ? (
                      <span className="flex items-center gap-1">
                        <Thermometer className="h-3.5 w-3.5" style={{ color: tempColor(gpu.temperature) }} />
                        <span className="text-[13px] font-bold" style={{ color: tempColor(gpu.temperature) }}>
                          {gpu.temperature}°C
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                        {t('sensorNotAvailable')}
                      </span>
                    )}
                  </div>

                  {gpu.loadPercent !== null && (
                    <div className="flex items-center gap-2">
                      <Gauge className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
                      <div className="h-1 flex-1 rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, gpu.loadPercent)}%`,
                            background: tempColor(gpu.loadPercent)
                          }}
                        />
                      </div>
                      <span className="w-9 text-right text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {Math.round(gpu.loadPercent)}%
                      </span>
                    </div>
                  )}

                  {gpu.vramBytes !== null && (
                    <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      <span className="font-semibold uppercase tracking-wide">{t('gpuVram')}</span>
                      <span className="font-mono">{formatBytes(gpu.vramBytes, 1)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {gpuBadge === 'permission-required' ? t('capabilityHintPermission') : t('gpuTempNotAvailable')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
