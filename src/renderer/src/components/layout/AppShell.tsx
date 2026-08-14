import { useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { AdminBanner } from './AdminBanner'

// Fine grain behind the whole window. The frosted panels (light theme) blur it,
// so the sharp→frosted contrast at every card edge makes the glass obvious.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

export function AppShell({ children }: { children: React.ReactNode }) {
  const handleSkip = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    const el = document.getElementById('main-content')
    if (el) { el.focus(); el.scrollIntoView() }
  }, [])

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      {/* Ambient aurora + grain — behind everything so glass has depth to diffuse */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -left-[140px] -top-[120px] h-[620px] w-[620px] rounded-full blur-[170px]"
          style={{ background: 'var(--glow-amber)' }}
        />
        <div
          className="absolute -bottom-[100px] -right-[120px] h-[560px] w-[560px] rounded-full blur-[150px]"
          style={{ background: 'var(--glow-blue)' }}
        />
        <div
          className="absolute left-[36%] top-[6%] h-[460px] w-[460px] rounded-full blur-[160px]"
          style={{ background: 'var(--glow-rose)' }}
        />
        <div
          className="app-grain absolute inset-0"
          style={{ backgroundImage: GRAIN }}
        />
      </div>

      <a href="#" className="skip-nav" onClick={handleSkip}>Skip to main content</a>
      <Sidebar />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Invisible drag region for moving window (top edge) */}
        <div className="drag-region h-8 shrink-0" />
        {/* Window controls float in top right */}
        <WindowControls />
        <AdminBanner />
        <main id="main-content" tabIndex={-1} className="relative flex-1 overflow-y-auto px-10 pb-10 pt-2 outline-none">
          {children}
        </main>
      </div>
    </div>
  )
}

function WindowControls() {
  return (
    <div className="no-drag fixed right-0 top-0 z-50 flex" role="toolbar" aria-label="Window controls">
      <button
        onClick={() => window.clarity.windowMinimize()}
        aria-label="Minimize window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.clarity.windowMaximize()}
        aria-label="Maximize window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.clarity.windowClose()}
        aria-label="Close window"
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-red-500 hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  )
}
