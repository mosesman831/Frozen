import { useEffect, useState } from 'react'
import { Activity, Ban, Play, Pause, Snowflake, Timer, ShieldCheck, CircleAlert } from 'lucide-react'
import { useStore, useNow } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SlidingNumber, BlurFade, AnimatedCircularProgress, BorderTrail } from '@/components/motion/motion'
import { cn, fmtCountdown, fmtDur, lockLabel } from '@/lib/utils'
import type { PageId } from '@/components/Sidebar'
import { invoke } from '@/lib/bridge'

interface StatusInfo {
  blocks_active?: number
  blocks_total?: number
  helper_connected?: boolean
  ext_clients?: number
}

export default function Dashboard({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { state, status, rev, call } = useStore()
  const now = useNow()
  const [info, setInfo] = useState<StatusInfo | null>(null)

  useEffect(() => {
    let live = true
    invoke<StatusInfo>('status').then((s) => live && setInfo(s))
    return () => { live = false }
  }, [rev])

  const blocks = state?.blocks ?? []
  const flags = state?.flags ?? {}
  const active = blocks.filter((b) => b.active)
  const pausedUntil = flags.paused_until && flags.paused ? flags.paused_until : 0
  const paused = pausedUntil ? pausedUntil * 1000 > now : !!flags.paused
  const frozenUntil = flags.frozen_until && flags.frozen_until * 1000 > now ? flags.frozen_until : 0
  const rawPhase = flags.pomodoro_phase
  const pomoPhase = rawPhase && rawPhase !== 'off' ? rawPhase : null
  const pomoRemaining = flags.pomodoro_remaining_s ?? 0

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      {/* frozen / paused banner */}
      {(frozenUntil > 0 || paused) && (
        <BlurFade>
          <div
            className={cn(
              'relative flex items-center gap-3 rounded-xl border px-4 py-3',
              frozenUntil
                ? 'border-sky-500/25 bg-sky-500/[0.07]'
                : 'border-amber-500/25 bg-amber-500/[0.07]',
            )}
          >
            {frozenUntil ? <Snowflake className="size-4 text-sky-400" /> : <Pause className="size-4 text-amber-400" />}
            <div className="flex-1 text-[13px]">
              <span className="font-medium text-foreground">
                {frozenUntil ? 'Frozen mode is on' : 'Blocking is paused'}
              </span>
              <span className="text-zinc-400">
                {' — '}
                {frozenUntil ? `until ${new Date(frozenUntil * 1000).toLocaleTimeString()}` : pausedUntil ? `resumes in ${fmtCountdown(pausedUntil)}` : 'indefinitely'}
              </span>
            </div>
            {paused && (
              <Button size="sm" variant="outline" onClick={() => call('resume', {}, 'Resumed')}>
                Resume now
              </Button>
            )}
          </div>
        </BlurFade>
      )}

      {/* stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          delay={0}
          icon={<ShieldCheck className="size-4" />}
          label="Active blocks"
          value={<SlidingNumber value={active.length} />}
          sub={`of ${blocks.length} lists`}
          tone={active.length ? 'good' : 'muted'}
        />
        <StatCard
          delay={0.05}
          icon={<Ban className="size-4" />}
          label="Rules enforced"
          value={<SlidingNumber value={blocks.reduce((n, b) => n + (b.active ? b.rules.length : 0), 0)} />}
          sub="across active lists"
          tone="muted"
        />
        <StatCard
          delay={0.1}
          icon={<Timer className="size-4" />}
          label="Pomodoro"
          value={pomoPhase ? fmtDur(pomoRemaining) : 'idle'}
          sub={pomoPhase ? `${pomoPhase} phase` : 'no session'}
          tone={pomoPhase ? 'accent' : 'muted'}
        />
        <StatCard
          delay={0.15}
          icon={<Snowflake className="size-4" />}
          label="Frozen"
          value={frozenUntil ? fmtCountdown(frozenUntil) : 'off'}
          sub={frozenUntil ? 'until unlock' : 'lockdown idle'}
          tone={frozenUntil ? 'sky' : 'muted'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* block lists overview */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Block lists</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('blocks')}>
              Manage →
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {blocks.length === 0 && (
              <div className="py-8 text-center text-[13px] text-zinc-500">
                No block lists yet — create one from the Blocks page.
              </div>
            )}
            {blocks.map((b, i) => (
              <BlurFade key={b.id || b.name} delay={0.05 * i}>
                <button
                  onClick={() => onNavigate('blocks')}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04] cursor-pointer outline-none"
                >
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      b.active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.6)]' : 'bg-zinc-700',
                    )}
                  />
                  <span className="flex-1 truncate text-[13px] font-medium text-zinc-200">{b.name}</span>
                  <span className="text-[11px] tabular-nums text-zinc-600">{b.rules.length} rules</span>
                  {lockLabel(b.lock) && <Badge variant="warn">{lockLabel(b.lock)}</Badge>}
                  <Badge variant={b.active ? 'on' : 'off'}>{b.active ? 'active' : 'off'}</Badge>
                </button>
              </BlurFade>
            ))}
          </CardContent>
        </Card>

        {/* health + quick actions */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="relative">
            <BorderTrail size={80} />
            <CardHeader>
              <CardTitle>Enforcement</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-5">
              <AnimatedCircularProgress
                value={status.connected ? (info?.ext_clients ?? 0) : 0}
                max={Math.max(1, info?.ext_clients ?? 1)}
                size={104}
                strokeWidth={7}
                label={status.connected ? 'on' : 'off'}
                sublabel="watchdog"
              />
              <ul className="flex-1 space-y-2 text-[12px]">
                <Health ok={status.connected} label="Service link" />
                <Health ok={!!info?.helper_connected} label="User helper" />
                <Health ok={(info?.ext_clients ?? 0) > 0} label={`${info?.ext_clients ?? 0} browser bridge${(info?.ext_clients ?? 0) === 1 ? '' : 's'}`} warn />
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => onNavigate('focus')}
              >
                <Timer /> Start focus
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => onNavigate('blocks')}
              >
                <Ban /> New block
              </Button>
              {paused ? (
                <Button variant="secondary" className="justify-start" onClick={() => call('resume', {}, 'Resumed')}>
                  <Play /> Resume
                </Button>
              ) : (
                <Button variant="secondary" className="justify-start" onClick={() => call('pause', { for_s: 300 }, 'Paused 5m')}>
                  <Pause /> Pause 5m
                </Button>
              )}
              <Button variant="secondary" className="justify-start" onClick={() => onNavigate('stats')}>
                <Activity /> View stats
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon, label, value, sub, delay, tone = 'muted',
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub: string
  delay: number
  tone?: 'muted' | 'good' | 'accent' | 'sky'
}) {
  const toneCls =
    tone === 'good' ? 'text-emerald-400' : tone === 'accent' ? 'text-violet-300' : tone === 'sky' ? 'text-sky-400' : 'text-zinc-400'
  return (
    <BlurFade delay={delay}>
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className={cn('mb-2 flex size-7 items-center justify-center rounded-lg bg-white/[0.05]', toneCls)}>
            {icon}
          </div>
          <div className="text-[26px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
            {value}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">{label}</span>
            <span className="text-[10.5px] text-zinc-600">{sub}</span>
          </div>
        </CardContent>
      </Card>
    </BlurFade>
  )
}

function Health({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <ShieldCheck className="size-3.5 text-emerald-400" />
      ) : (
        <CircleAlert className={cn('size-3.5', warn ? 'text-amber-400' : 'text-red-400')} />
      )}
      <span className={ok ? 'text-zinc-300' : warn ? 'text-amber-300' : 'text-red-300'}>{label}</span>
    </li>
  )
}
