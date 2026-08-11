import { motion } from 'framer-motion'
import { CheckSquare, Files, HardDrive, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { formatBytes, formatNumber } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

const EASE = [0.16, 1, 0.3, 1] as const

function sizeDecimals(value: number): number {
  return value >= 100 ? 0 : value >= 10 ? 1 : 2
}

interface SummaryCardProps {
  icon: LucideIcon
  /** Numeric value to animate (bytes value without the unit, or a plain count). */
  value: number
  unit?: string
  label: string
  sub?: string
  color: string
  iconBg: string
  delay: number
}

function SummaryCard({ icon: Icon, value, unit, label, sub, color, iconBg, delay }: SummaryCardProps) {
  const animated = useAnimatedCounter(value)
  const display = unit
    ? animated.toFixed(sizeDecimals(value))
    : Math.round(animated).toLocaleString()

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: EASE }}
      className="rounded-2xl border p-4"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-default)' }}
    >
      <div
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: iconBg }}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className="font-mono text-[20px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {display}
        </p>
        {unit && <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {sub && (
        <p className="mt-0.5 text-[10.5px]" style={{ color: 'var(--text-faint)' }}>{sub}</p>
      )}
    </motion.div>
  )
}

interface CleanerSummaryCardsProps {
  totalSize: number
  itemCount: number
  categoryCount: number
  selectedSize: number
  selectedCount: number
}

/**
 * Compact "what can I clean / how much can I recover" cards shown once a scan
 * has produced results. Values animate in so the page feels responsive.
 */
export function CleanerSummaryCards({
  totalSize,
  itemCount,
  categoryCount,
  selectedSize,
  selectedCount
}: CleanerSummaryCardsProps) {
  const { t } = useTranslation('cleaner')

  const spaceStr = formatBytes(totalSize)
  const spaceValue = parseFloat(spaceStr) || 0
  const spaceUnit = spaceStr.replace(/^[\d.]+\s*/, '')

  const selectedStr = formatBytes(selectedSize)
  const selectedValue = parseFloat(selectedStr) || 0
  const selectedUnit = selectedStr.replace(/^[\d.]+\s*/, '')

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryCard
        icon={HardDrive}
        value={spaceValue}
        unit={spaceUnit}
        label={t('cardRecoverable')}
        color="#f59e0b"
        iconBg="rgba(245,158,11,0.10)"
        delay={0.05}
      />
      <SummaryCard
        icon={Files}
        value={itemCount}
        label={t('cardItems')}
        color="var(--text-secondary)"
        iconBg="var(--bg-subtle)"
        delay={0.12}
      />
      <SummaryCard
        icon={Layers}
        value={categoryCount}
        label={t('cardCategories')}
        color="var(--info)"
        iconBg="rgba(59,130,246,0.10)"
        delay={0.19}
      />
      <SummaryCard
        icon={CheckSquare}
        value={selectedValue}
        unit={selectedUnit}
        label={t('cardSelected')}
        sub={t('cardSelectedSub', { count: formatNumber(selectedCount) })}
        color="var(--success)"
        iconBg="rgba(34,197,94,0.10)"
        delay={0.26}
      />
    </div>
  )
}
