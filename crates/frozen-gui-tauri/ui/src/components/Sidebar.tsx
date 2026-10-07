import { motion } from 'motion/react'
import {
  LayoutDashboard, Ban, Timer, BarChart3, ScrollText, Snowflake, SnowflakeIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { TextShimmer } from '@/components/motion/motion'

export type PageId = 'dashboard' | 'blocks' | 'focus' | 'stats' | 'audit'

export const PAGES: { id: PageId; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Overview & quick actions' },
  { id: 'blocks', label: 'Blocks', icon: Ban, hint: 'Block lists, rules, locks & breaks' },
  { id: 'focus', label: 'Focus', icon: Timer, hint: 'Pomodoro & Frozen mode' },
  { id: 'stats', label: 'Stats', icon: BarChart3, hint: 'Usage & blocked attempts' },
  { id: 'audit', label: 'Audit', icon: ScrollText, hint: 'Enforcement event log' },
]

export function Sidebar({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  const { status, state } = useStore()
  const frozen = !!state?.flags?.frozen_until && state.flags.frozen_until * 1000 > Date.now()

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.015]">
      {/* brand — also part of the window drag strip */}
      <div data-tauri-drag-region className="flex h-12 items-center gap-2.5 border-b border-white/[0.06] px-4 select-none">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-violet-600 shadow-[0_0_18px_-2px_rgba(124,108,240,.7)]">
          <Snowflake className="size-4 text-white" strokeWidth={2.4} />
        </div>
        <div className="flex flex-col">
          <span className="text-[13.5px] font-semibold tracking-tight text-foreground">Frozen</span>
          <span className="text-[10px] leading-none text-zinc-500">Distraction blocker</span>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          Workspace
        </div>
        {PAGES.map((p) => {
          const active = p.id === page
          const Icon = p.icon
          return (
            <button
              key={p.id}
              onClick={() => onNavigate(p.id)}
              className={cn(
                'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors cursor-pointer',
                active ? 'text-foreground' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg border border-white/[0.07] bg-white/[0.06]"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className={cn('relative z-10 size-4', active ? 'text-violet-300' : 'text-zinc-600 group-hover:text-zinc-400')} strokeWidth={1.8} />
              <span className="relative z-10 font-medium">{p.label}</span>
              {p.id === 'focus' && frozen && (
                <SnowflakeIcon className="relative z-10 ml-auto size-3 text-sky-400" />
              )}
            </button>
          )
        })}
      </nav>

      {/* service status footer */}
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          <span className="relative flex size-2">
            {status.connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            )}
            <span
              className={cn(
                'relative inline-flex size-2 rounded-full',
                status.connected ? 'bg-emerald-400' : 'bg-zinc-600',
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-medium text-zinc-300">
              {status.connected ? 'Service connected' : 'Disconnected'}
            </div>
            <div className="truncate text-[10px] text-zinc-600">
              {status.connected ? `rev ${state?.rev ?? '—'} · live` : status.detail || 'retrying…'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
