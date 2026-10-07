import * as React from 'react'
import { Command } from 'cmdk'
import {
  LayoutDashboard, Ban, Timer, BarChart3, ScrollText, Plus, Pause, Play,
  Snowflake, Search, RefreshCw,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import type { PageId } from './Sidebar'

// Kokonut-style action search bar + cmdk command palette.
export function CommandMenu({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onNavigate: (p: PageId) => void
}) {
  const { state, call } = useStore()
  const paused = !!state?.flags?.paused

  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Frozen actions"
      className="fixed left-1/2 top-[22%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-white/[0.09] bg-[#131316]/95 shadow-2xl shadow-black/60 backdrop-blur-2xl"
    >
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3.5">
        <Search className="size-4 text-zinc-500" />
        <Command.Input
          autoFocus
          placeholder="Type a command or search…"
          className="h-11 w-full bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-zinc-600"
        />
        <kbd className="kbd">esc</kbd>
      </div>
      <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
        <Command.Empty className="py-8 text-center text-[12.5px] text-zinc-500">
          No results.
        </Command.Empty>

        <Command.Group
          heading={<span className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Navigate</span>}
        >
          {(
            [
              ['dashboard', LayoutDashboard, 'Dashboard'],
              ['blocks', Ban, 'Blocks'],
              ['focus', Timer, 'Focus'],
              ['stats', BarChart3, 'Stats'],
              ['audit', ScrollText, 'Audit log'],
            ] as const
          ).map(([id, Icon, label]) => (
            <CmdItem key={id} onSelect={run(() => onNavigate(id))}>
              <Icon /> {label}
            </CmdItem>
          ))}
        </Command.Group>

        <Command.Group
          heading={<span className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Actions</span>}
        >
          {paused ? (
            <CmdItem onSelect={run(() => call('resume', {}, 'Resumed'))}>
              <Play /> Resume blocking
            </CmdItem>
          ) : (
            <>
              <CmdItem onSelect={run(() => call('pause', { for_s: 300 }, 'Paused 5m'))}>
                <Pause /> Pause blocking — 5 minutes
              </CmdItem>
              <CmdItem onSelect={run(() => call('pause', { for_s: 900 }, 'Paused 15m'))}>
                <Pause /> Pause blocking — 15 minutes
              </CmdItem>
              <CmdItem onSelect={run(() => call('pause', { for_s: 3600 }, 'Paused 1h'))}>
                <Pause /> Pause blocking — 1 hour
              </CmdItem>
            </>
          )}
          <CmdItem onSelect={run(() => onNavigate('blocks'))}>
            <Plus /> New block list…
          </CmdItem>
          <CmdItem onSelect={run(() => call('pomodoro', { action: 'start', preset: 'classic' }, 'Pomodoro started'))}>
            <Timer /> Start pomodoro (classic)
          </CmdItem>
          <CmdItem onSelect={run(() => call('pomodoro', { action: 'stop' }, 'Pomodoro stopped'))}>
            <Timer /> Stop pomodoro
          </CmdItem>
          <CmdItem onSelect={run(() => onNavigate('focus'))}>
            <Snowflake /> Frozen mode…
          </CmdItem>
          <CmdItem onSelect={run(() => call('reload-settings', {}, 'Settings reloaded'))}>
            <RefreshCw /> Reload settings
          </CmdItem>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}

function CmdItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-zinc-300 outline-none data-[selected=true]:bg-white/[0.07] data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:text-zinc-500"
    >
      {children}
    </Command.Item>
  )
}
