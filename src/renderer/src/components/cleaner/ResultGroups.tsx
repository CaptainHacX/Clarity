import { Fragment, useMemo } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatBytes, formatNumber } from '@/lib/utils'
import type { ScanResult } from '@shared/types'

/** Check whether a path looks like an absolute filesystem path (not a label like "Recycle Bin" or "PATH → …"). */
const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

export type CleanerSortMode = 'default' | 'size'

interface CleanerResultGroupsProps {
  results: ScanResult[]
  selected: Set<string>
  expanded: Set<string>
  query: string
  sortMode: CleanerSortMode
  onToggleGroup: (key: string) => void
  onToggleSubcategory: (result: ScanResult) => void
  onToggleItem: (id: string) => void
  onOpenLocation: (path: string) => void
}

/**
 * Renders a category's scan results as expandable, selectable subcategory rows,
 * grouped by their optional group label. All selection/deletion behaviour is
 * delegated up to the caller so the store remains the single source of truth.
 */
export function CleanerResultGroups({
  results,
  selected,
  expanded,
  query,
  sortMode,
  onToggleGroup,
  onToggleSubcategory,
  onToggleItem,
  onOpenLocation
}: CleanerResultGroupsProps) {
  const { t } = useTranslation('cleaner')
  const q = query.trim().toLowerCase()

  const sections = useMemo(() => {
    const ungrouped = results.filter((r) => !r.group)
    const groupedMap = new Map<string, ScanResult[]>()
    for (const r of results) {
      if (!r.group) continue
      if (!groupedMap.has(r.group)) groupedMap.set(r.group, [])
      groupedMap.get(r.group)!.push(r)
    }
    const sections: { label?: string; items: ScanResult[] }[] = []
    if (ungrouped.length > 0) sections.push({ items: ungrouped })
    for (const [label, items] of groupedMap) sections.push({ label, items })
    if (sortMode === 'size') {
      sections.forEach((s) => s.items.sort((a, b) => b.totalSize - a.totalSize))
    }
    return sections
  }, [results, sortMode])

  return (
    <div className="animate-fade-in">
      {sections.map((section) => {
        const sectionSize = section.items.reduce((s, r) => s + r.totalSize, 0)
        return (
          <Fragment key={section.label || '_ungrouped'}>
            {section.label && (
              <div className="mt-4 mb-2 flex items-center gap-2 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {section.label}
                </span>
                <div className="h-px flex-1" style={{ background: 'var(--bg-hover-2)' }} />
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(sectionSize)}
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              {section.items.map((result) => {
                const groupKey = `${result.category}:${result.subcategory}`
                const isExpanded = expanded.has(groupKey)
                const selectedInGroup = result.items.filter((item) => selected.has(item.id)).length
                const allSelected = selectedInGroup === result.items.length
                const someSelected = selectedInGroup > 0 && !allSelected

                const filteredItems = q
                  ? result.items.filter((item) => item.path.toLowerCase().includes(q))
                  : result.items
                const visibleItems = filteredItems.slice(0, 50)
                const hiddenByQuery = q && filteredItems.length < result.items.length

                return (
                  <div
                    key={result.subcategory}
                    className="overflow-hidden rounded-xl"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
                  >
                    {/* Group header */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-label={result.subcategory}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors"
                      onClick={() => onToggleGroup(groupKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onToggleGroup(groupKey)
                        }
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Subcategory select (checkbox) */}
                      <label
                        className="flex cursor-pointer items-center"
                        aria-label={result.subcategory}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={allSelected || someSelected}
                          onChange={() => onToggleSubcategory(result)}
                          aria-label={result.subcategory}
                        />
                        <div
                          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]"
                          style={{
                            background: allSelected || someSelected ? 'var(--accent)' : 'var(--bg-hover-2)',
                            border: allSelected || someSelected ? 'none' : '1.5px solid var(--border-stronger)'
                          }}
                          aria-hidden="true"
                        >
                          {allSelected && (
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6l2.5 2.5 4.5-5" stroke="var(--text-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {someSelected && (
                            <div className="h-[2px] w-2 rounded-full" style={{ background: 'var(--text-on-accent)' }} />
                          )}
                        </div>
                      </label>

                      {/* Expand arrow */}
                      <ChevronRight
                        className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isExpanded && 'rotate-90')}
                        style={{ color: 'var(--text-muted)' }}
                        strokeWidth={2}
                        aria-hidden="true"
                      />

                      {/* Folder icon */}
                      <Folder
                        className="h-4 w-4 shrink-0"
                        style={{ color: allSelected ? 'var(--accent)' : 'var(--text-muted)' }}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />

                      {/* Label */}
                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{result.subcategory}</span>
                      </div>

                      {/* Stats */}
                      <span
                        className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px]"
                        style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                      >
                        {t(result.itemCount === 1 ? 'itemCount' : 'itemCountPlural', { count: formatNumber(result.itemCount) })}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                        {formatBytes(result.totalSize)}
                      </span>

                      {/* Open location */}
                      {result.items.length > 0 && isAbsolutePath(result.items[0].path) && (
                        <button
                          type="button"
                          title={t('openLocation')}
                          aria-label={t('openLocation')}
                          className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-hover-2)]"
                          onClick={(e) => { e.stopPropagation(); onOpenLocation(result.items[0].path) }}
                        >
                          <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/* Expanded item list */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        {visibleItems.map((item) => {
                          const checked = selected.has(item.id)
                          const pathLabel = item.path.split(/[/\\]/).slice(-2).join('/') || item.path
                          return (
                            <label
                              key={item.id}
                              className="flex cursor-pointer items-center gap-3 px-4 py-2 pl-14 transition-colors"
                              style={{ background: checked ? 'rgba(245,158,11,0.03)' : 'transparent' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.05)' : 'var(--bg-subtle)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.03)' : 'transparent' }}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() => onToggleItem(item.id)}
                                aria-label={item.path}
                              />
                              <div
                                className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px]"
                                style={{
                                  background: checked ? 'var(--accent)' : 'var(--bg-hover-2)',
                                  border: checked ? 'none' : '1.5px solid var(--border-stronger)'
                                }}
                                aria-hidden="true"
                              >
                                {checked && (
                                  <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
                                    <path d="M2.5 6l2.5 2.5 4.5-5" stroke="var(--text-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                              <span className="min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                                {pathLabel}
                              </span>
                              <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {formatBytes(item.size)}
                              </span>
                              {isAbsolutePath(item.path) && (
                                <button
                                  type="button"
                                  title={t('openLocation')}
                                  aria-label={t('openLocation')}
                                  className="shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--bg-hover-2)]"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLocation(item.path) }}
                                >
                                  <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                                </button>
                              )}
                            </label>
                          )
                        })}

                        {hiddenByQuery && (
                          <div className="px-4 py-2.5 pl-14 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {t('itemsHiddenBySearch', { shown: formatNumber(filteredItems.length), total: formatNumber(result.items.length) })}
                          </div>
                        )}
                        {!q && result.items.length > 50 && (
                          <div className="px-4 py-2.5 pl-14 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {t('moreItems', { count: formatNumber(result.items.length - 50) })}
                          </div>
                        )}
                        {visibleItems.length === 0 && (
                          <div className="px-4 py-3 pl-14 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {t('noMatchingItems')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
