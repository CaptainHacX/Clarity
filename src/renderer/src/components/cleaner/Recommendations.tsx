import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes, formatNumber } from '@/lib/utils'
import type { CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

export interface CleanerCategoryMeta {
  type: CleanerType
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
}

interface CleanerRecommendationsProps {
  categories: CleanerCategoryMeta[]
  results: ScanResult[]
  onReview: (type: CleanerType) => void
  onClean: (type: CleanerType) => void
}

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Conservative, data-driven suggestions shown after a scan. Only categories
 * that actually contain cleanable items are suggested; "Clean" routes through
 * the normal confirmation dialog so nothing is ever removed without consent.
 */
export function CleanerRecommendations({ categories, results, onReview, onClean }: CleanerRecommendationsProps) {
  const { t } = useTranslation('cleaner')

  const recommendations = useMemo(() => {
    return categories
      .map((cat) => {
        const catResults = results.filter((r) => r.category === cat.type)
        const size = catResults.reduce((s, r) => s + r.totalSize, 0)
        const count = catResults.reduce((s, r) => s + r.itemCount, 0)
        return { cat, size, count }
      })
      .filter((r) => r.size > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
  }, [categories, results])

  if (recommendations.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mb-5 rounded-2xl border p-4"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-default)' }}
      aria-label={t('recommendationsTitle')}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: 'rgba(245,158,11,0.10)' }}
          aria-hidden="true"
        >
          <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={1.8} />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('recommendationsTitle')}
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('recommendationsDescription')}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {recommendations.map((rec, i) => {
          const Icon = rec.cat.icon
          return (
            <motion.div
              key={rec.cat.type}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 + i * 0.06, duration: 0.35, ease: EASE }}
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--bg-hover)' }}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} strokeWidth={1.8} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t(rec.cat.labelKey)}
                </p>
                <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('recommendationSafe', { count: formatNumber(rec.count) })}
                </p>
              </div>

              <span className="shrink-0 font-mono text-[13px] font-semibold text-amber-500">
                {formatBytes(rec.size)}
              </span>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => onReview(rec.cat.type)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}
                >
                  {t('recommendationReview')}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  onClick={() => onClean(rec.cat.type)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    color: 'var(--text-on-accent)'
                  }}
                >
                  {t('cleanButton')}
                </button>
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.section>
  )
}
