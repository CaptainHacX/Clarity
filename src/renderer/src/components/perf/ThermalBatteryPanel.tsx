import { useTranslation } from 'react-i18next'
import { Thermometer, Battery, BatteryCharging, Zap, Cpu, CircuitBoard } from 'lucide-react'
import type { HardwareHealthSnapshot } from '@shared/types'
import { cn } from '@/lib/utils'

interface ThermalBatteryPanelProps {
  health: HardwareHealthSnapshot | null
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

export function ThermalBatteryPanel({ health }: ThermalBatteryPanelProps) {
  const { t } = useTranslation('performance')
  if (!health) return null

  const cpuTemp = health.cpuTemperature
  const battery = health.battery
  const gpus = health.gpuTemperatures
  const hasAnyData =
    cpuTemp !== null ||
    (battery !== null && battery.percent !== null) ||
    gpus.some((g) => g.temperature !== null)

  return (
    <div className="mb-6">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold text-zinc-400">{t('hardwareHealthTitle')}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* CPU temperature */}
        <div
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
              <Cpu className="h-4 w-4 text-zinc-400" />
            </div>
            <div className="text-[13px] font-semibold text-white">{t('cpuTemperature')}</div>
          </div>

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
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('sensorNotAvailable')}
            </span>
          )}
        </div>

        {/* Battery */}
        <div
          className={cn(
            'flex flex-col gap-3 rounded-2xl p-5',
            battery === null && 'md:col-span-1 xl:col-span-2'
          )}
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
              {battery?.isCharging ? (
                <BatteryCharging className="h-4 w-4 text-green-400" />
              ) : (
                <Battery className="h-4 w-4 text-zinc-400" />
              )}
            </div>
            <div className="text-[13px] font-semibold text-white">{t('batteryTitle')}</div>
            {battery?.isCharging && (
              <div className="flex items-center gap-1 rounded-md px-2 py-0.5" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <Zap className="h-3 w-3 text-green-400" />
                <span className="text-[10px] font-semibold text-green-400">{t('batteryCharging')}</span>
              </div>
            )}
          </div>

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
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
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

        {/* GPU temperatures */}
        <div
          className={cn(
            'flex flex-col gap-3 rounded-2xl p-5',
            battery === null && 'md:col-span-2 xl:col-span-1'
          )}
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-subtle-2)' }}>
              <CircuitBoard className="h-4 w-4 text-zinc-400" />
            </div>
            <div className="text-[13px] font-semibold text-white">{t('gpuTemperatures')}</div>
          </div>

          {gpus.length > 0 ? (
            <div className="flex flex-col gap-2">
              {gpus.map((gpu) => (
                <div key={gpu.name} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
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
              ))}
            </div>
          ) : (
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('gpuTempNotAvailable')}
            </span>
          )}
        </div>
      </div>

      {!hasAnyData && (
        <p className="mt-3 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('hardwareHealthUnavailableHint')}
        </p>
      )}
    </div>
  )
}
