import { useEffect, useMemo, useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { useStore } from '@/lib/store'
import { invoke } from '@/lib/bridge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { Empty } from '@/components/ui/empty'
import { AnimatedList, AnimatedListItem } from '@/components/motion/motion'
import { cn } from '@/lib/utils'
import type { AuditEntry } from '@/lib/types'

const ACTOR_TONE: Record<string, string> = {
  svc: 'default', gui: 'violet', nmh: 'blue', ext: 'blue', helper: 'warn', cli: 'outline',
}

function actorVariant(actor: string): 'default' | 'violet' | 'blue' | 'warn' | 'outline' {
  const base = actor.split('.')[0].toLowerCase()
  return (ACTOR_TONE[base] as never) ?? 'default'
}

export default function Audit() {
  const { rev } = useStore()
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let live = true
    invoke<{ audit?: AuditEntry[] }>('audit', { last: 300 }).then((d) => {
      if (!live) return
      const a = d?.audit ?? (Array.isArray(d) ? (d as unknown as AuditEntry[]) : [])
      setEntries(a)
    })
    return () => { live = false }
  }, [rev])

  const filtered = useMemo(() => {
    if (!entries) return null
    const f = filter.trim().toLowerCase()
    if (!f) return entries
    return entries.filter((e) => `${e.actor} ${e.action} ${e.detail}`.toLowerCase().includes(f))
  }, [entries, filter])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
        <Input
          className="pl-8"
          placeholder="Filter events… (action, actor, detail)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between py-3.5">
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-3.5 text-violet-300" /> Event log
          </CardTitle>
          <span className="text-[11px] text-zinc-600">{filtered?.length ?? '—'} entries</span>
        </CardHeader>
        <CardContent className="p-0">
          {!filtered ? (
            <div className="space-y-2 p-5">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Empty icon={ScrollText} title="No audit events" description="Actions across the service, extension and GUI land here." className="py-10" />
          ) : (
            <AnimatedList>
              {filtered.map((e, i) => (
                <AnimatedListItem key={`${e.ts}-${i}`}>
                  <div className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2 last:border-0 hover:bg-white/[0.02]">
                    <span className="w-[76px] shrink-0 font-mono text-[11px] tabular-nums text-zinc-600">
                      {new Date(e.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <Badge variant={actorVariant(e.actor)} className="w-16 shrink-0 justify-center">
                      {e.actor}
                    </Badge>
                    <span className={cn('shrink-0 font-mono text-[12px]', e.action.includes('kill') || e.action.includes('enforce') ? 'text-red-400' : 'text-violet-300')}>
                      {e.action}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-400">{e.detail}</span>
                  </div>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
