import { useEffect, useState } from 'react'
import { Pause, Play, Search, ChevronDown, Minus, Square, Minimize2, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isTauri } from '@/lib/bridge'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { PAGES, type PageId } from './Sidebar'

function tauriWindow() {
  return (window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => any } } }).__TAURI__?.window?.getCurrentWindow?.()
}

export function Topbar({ page, onOpenCommand }: { page: PageId; onOpenCommand: () => void }) {
  const { state, call } = useStore()
  const meta = PAGES.find((p) => p.id === page)!
  const paused = !!state?.flags?.paused
  const [max, setMax] = useState(false)

  useEffect(() => {
    tauriWindow()?.isMaximized?.().then(setMax).catch(() => {})
  }, [])

  const toggleMax = () => {
    const w = tauriWindow()
    if (!w) return
    w.toggleMaximize().then(() => w.isMaximized?.().then(setMax)).catch(() => {})
  }

  return (
    <header className="relative flex h-12 shrink-0 items-center border-b border-white/[0.06] bg-[#0a0a0d]/60 backdrop-blur-md">
      {/* drag layer — everything non-interactive sits on this */}
      <div data-tauri-drag-region onDoubleClick={toggleMax} className="absolute inset-0 flex items-center px-5 select-none">
        <div className="min-w-0">
          <h1 className="text-[14.5px] font-semibold tracking-tight text-foreground">{meta.label}</h1>
          <p className="hidden text-[11px] leading-tight text-zinc-500 sm:block">{meta.hint}</p>
        </div>
      </div>

      <div className="relative z-10 ml-auto flex items-center gap-2 px-3">
        {/* command palette trigger */}
        <button
          onClick={onOpenCommand}
          className="flex h-7.5 w-56 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-[12px] text-zinc-500 transition-colors hover:border-white/[0.14] hover:text-zinc-400 cursor-pointer outline-none"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search actions…</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>

        {paused ? (
          <Button variant="outline" size="sm" onClick={() => call('resume', {}, 'Resumed')}>
            <Play /> Resume blocking
          </Button>
        ) : (
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="sm" />}>
              <Pause /> Pause <ChevronDown />
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Pause all blocking</MenuLabel>
              {[300, 900, 1800, 3600].map((s) => (
                <MenuItem key={s} onClick={() => call('pause', { for_s: s }, `Paused ${s / 60}m`)}>
                  for {s / 60} minute{s / 60 > 1 ? 's' : ''}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => call('pause', {}, 'Paused')}>Indefinitely</MenuItem>
            </MenuContent>
          </Menu>
        )}

        {isTauri && (
          <div className="ml-1.5 flex items-center gap-0.5 border-l border-white/[0.07] pl-2.5">
            <button
              onClick={() => tauriWindow()?.minimize?.()}
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
              aria-label="Minimize"
            >
              <Minus className="size-3.5" strokeWidth={1.8} />
            </button>
            <button
              onClick={toggleMax}
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
              aria-label={max ? 'Restore' : 'Maximize'}
            >
              {max ? <Minimize2 className="size-3" strokeWidth={1.8} /> : <Square className="size-3" strokeWidth={1.8} />}
            </button>
            <button
              onClick={() => tauriWindow()?.close?.()}
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-[#e81123] hover:text-white"
              aria-label="Close"
            >
              <X className="size-3.5" strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
