import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatSpeed } from '@/lib/utils'
import type { PerfSnapshot } from '@shared/types'

interface TimeSeriesChartProps {
  history: PerfSnapshot[]
  dataKey: 'cpu' | 'memory' | 'disk' | 'network'
  label: string
  color: string
  /** Secondary line color (write / upload). Only used for disk & network. */
  accentColor?: string
}

// Cap the number of data points rendered to avoid Recharts SVG thrashing
const MAX_CHART_POINTS = 120

export const TimeSeriesChart = memo(function TimeSeriesChart({ history, dataKey, label, color, accentColor = '#ef4444' }: TimeSeriesChartProps) {
  const { t } = useTranslation('performance')

  const data = useMemo(() => {
    const step = history.length > MAX_CHART_POINTS ? Math.ceil(history.length / MAX_CHART_POINTS) : 1
    const result: Array<Record<string, number>> = []
    for (let i = 0; i < history.length; i += step) {
      const s = history[i]
      if (dataKey === 'cpu') {
        result.push({ t: result.length, value: s.cpu.overall })
      } else if (dataKey === 'memory') {
        result.push({ t: result.length, value: s.memory.percent })
      } else if (dataKey === 'disk') {
        result.push({
          t: result.length,
          read: s.disk.readBytesPerSec / (1024 * 1024),
          write: s.disk.writeBytesPerSec / (1024 * 1024)
        })
      } else {
        result.push({
          t: result.length,
          read: s.network.rxBytesPerSec / (1024 * 1024),
          write: s.network.txBytesPerSec / (1024 * 1024)
        })
      }
    }
    return result
  }, [history, dataKey])

  const dual = dataKey === 'disk' || dataKey === 'network'
  const last = history[history.length - 1]
  const gradientId = `gradient-${dataKey}`
  const accentGradientId = `gradient-${dataKey}-accent`

  const currentLabel = useMemo(() => {
    if (!last) return '--'
    if (dataKey === 'cpu') return `${last.cpu.overall.toFixed(1)}${t('chartPercentUnit')}`
    if (dataKey === 'memory') return `${last.memory.percent.toFixed(1)}${t('chartPercentUnit')}`
    const r = dataKey === 'disk' ? last.disk.readBytesPerSec : last.network.rxBytesPerSec
    const w = dataKey === 'disk' ? last.disk.writeBytesPerSec : last.network.txBytesPerSec
    return `↓ ${formatSpeed(r)}  ↑ ${formatSpeed(w)}`
  }, [last, dataKey, t])

  return (
    <div
      className="glass-card flex flex-col rounded-2xl p-4"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-[12px] font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
          {currentLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            {dual && (
              <linearGradient id={accentGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
              </linearGradient>
            )}
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={dual ? ['auto', 'auto'] : [0, 100]} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              fontSize: '12px',
              color: 'var(--text-primary)'
            }}
            labelFormatter={() => ''}
            formatter={(val) =>
              dual
                ? [`${Number(val).toFixed(1)} ${t('chartDiskUnit')}`]
                : [`${Number(val).toFixed(1)}${t('chartPercentUnit')}`]
            }
          />
          {dual ? (
            <>
              <Area
                type="monotone"
                dataKey="read"
                stroke={color}
                fill={`url(#${gradientId})`}
                strokeWidth={1.5}
                isAnimationActive={false}
                name={dataKey === 'disk' ? t('chartDiskReadName') : t('chartNetworkRx')}
              />
              <Area
                type="monotone"
                dataKey="write"
                stroke={accentColor}
                fill={`url(#${accentGradientId})`}
                strokeWidth={1.5}
                isAnimationActive={false}
                name={dataKey === 'disk' ? t('chartDiskWriteName') : t('chartNetworkTx')}
              />
            </>
          ) : (
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={`url(#${gradientId})`}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
})
