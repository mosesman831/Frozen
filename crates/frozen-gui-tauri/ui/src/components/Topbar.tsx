import { Pause, Play, Search, ChevronDown } from 'lucide-react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { PAGES, type PageId } from './Sidebar'

export function Topbar({ page, onOpenCommand }: { page: PageId; onOpenCommand: () => void }) {
  const { state, call } = useStore()
  const meta = PAGES.find((p) => p.id === page)!
  const paused = !!state?.flags?.paused

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#0a0a0d]/60 px-5 backdrop-blur-md">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{meta.label}</h1>
        <p className="hidden text-[11.5px] text-zinc-500 sm:block">{meta.hint}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* command palette trigger */}
        <button
          onClick={onOpenCommand}
          className="flex h-7.5 w-56 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-[12px] text-zinc-500 transition-colors hover:border-white/[0.14] hover:text-zinc-400 cursor-pointer outline-none"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search actions…</span>
          <kbd className="kbd">⌘K</kbd>
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
      </div>
    </header>
  )
}
