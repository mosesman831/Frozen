import { useState } from 'react'
import { Snowflake, Timer, Play, Square, SkipForward, Pause as PauseIcon, Coffee } from 'lucide-react'
import { useStore, useNow } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented'
import { NumberField } from '@/components/ui/number-field'
import { Meter } from '@/components/ui/meter'
import { AnimatedCircularProgress, BlurFade, BorderTrail, TextShimmer } from '@/components/motion/motion'
import { cn, fmtCountdown, fmtDur } from '@/lib/utils'

const POMO_PRESETS = [
  { value: 'classic', label: 'Classic 25/5' },
  { value: 'long', label: 'Long 50/10' },
  { value: 'sprint', label: 'Sprint 15/3' },
]

const PHASE_LABEL: Record<string, string> = {
  work: 'Focus', short: 'Short break', long: 'Long break',
}

export default function Focus() {
  const { state, call } = useStore()
  const now = useNow()
  const flags = state?.flags ?? {}
  const frozenUntil = flags.frozen_until && flags.frozen_until * 1000 > now ? flags.frozen_until : 0
  const rawPhase = flags.pomodoro_phase as string | null
  const pomoPhase = rawPhase && rawPhase !== 'off' ? rawPhase : null
  const pomoRemaining = flags.pomodoro_remaining_s ?? 0
  const phaseMax = pomoPhase === 'work' ? 1500 : pomoPhase === 'long' ? 900 : 300

  const [preset, setPreset] = useState('classic')
  const [frozenMins, setFrozenMins] = useState(45)
  const [frozenLock, setFrozenLock] = useState('none')
  const [credential, setCredential] = useState('')

  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
      {/* ---------------- Frozen mode ---------------- */}
      <BlurFade>
        <Card className={cn('relative h-full overflow-hidden', frozenUntil && 'border-sky-500/20 bg-sky-500/[0.03]')}>
          {frozenUntil > 0 && <BorderTrail size={70} />}
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Snowflake className="size-3.5 text-sky-400" /> Frozen mode
            </CardTitle>
            {frozenUntil > 0 && <Badge variant="blue">active</Badge>}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-zinc-500">
              Locks the whole computer — full-screen overlay, blocked-input enforcement, the works.
            </p>

            {frozenUntil ? (
              <div className="flex items-center gap-5">
                <AnimatedCircularProgress
                  value={Math.max(0, frozenUntil - Math.floor(now / 1000))}
                  max={3600}
                  size={110}
                  label={<span className="text-sky-300">{fmtCountdown(frozenUntil)}</span>}
                  sublabel="remaining"
                />
                <div className="flex-1 space-y-2 text-[12.5px]">
                  <p className="text-zinc-300">
                    Until <span className="font-medium text-foreground">{new Date(frozenUntil * 1000).toLocaleTimeString()}</span>
                  </p>
                  <p className="text-zinc-500">{flags.frozen_locked ? 'Input lockdown on' : 'Overlay only'}</p>
                  <Button
                    variant="destructive" size="sm"
                    onClick={() => call('frozen-stop', { credential: '' }, 'Frozen ended')}
                  >
                    <Square /> End early
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Duration</span>
                    <NumberField value={frozenMins} onValueChange={setFrozenMins} min={1} max={720} suffix="min" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Unlock by</span>
                    <Select
                      value={frozenLock}
                      onValueChange={setFrozenLock}
                      options={[
                        { value: 'none', label: 'Timer only' },
                        { value: 'password', label: 'Password' },
                        { value: 'random_text', label: 'Random text' },
                      ]}
                    />
                  </label>
                </div>
                {frozenLock !== 'none' && (
                  <Input
                    type="password"
                    placeholder={frozenLock === 'password' ? 'password to unlock' : 'unused credential'}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                  />
                )}
                <Button
                  className="w-full"
                  onClick={() =>
                    call('frozen-start', { for_s: frozenMins * 60, lock: frozenLock === 'none' ? { type: 'none' } : { type: frozenLock, credential } }, `Frozen for ${frozenMins}m`)
                  }
                >
                  <Snowflake /> Freeze {fmtDur(frozenMins * 60)}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </BlurFade>

      {/* ---------------- Pomodoro ---------------- */}
      <BlurFade delay={0.06}>
        <Card className="relative h-full overflow-hidden">
          {pomoPhase === 'work' && <BorderTrail size={70} />}
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Timer className="size-3.5 text-violet-300" /> Pomodoro
            </CardTitle>
            {pomoPhase && <Badge variant="violet">{PHASE_LABEL[pomoPhase] ?? pomoPhase}</Badge>}
          </CardHeader>
          <CardContent className="space-y-4">
            {pomoPhase ? (
              <div className="flex items-center gap-5">
                <AnimatedCircularProgress
                  value={pomoRemaining}
                  max={phaseMax}
                  size={110}
                  label={<TextShimmer className="text-lg">{fmtDur(pomoRemaining)}</TextShimmer>}
                  sublabel={PHASE_LABEL[pomoPhase] ?? pomoPhase}
                />
                <div className="flex-1 space-y-2">
                  <p className="text-[12.5px] text-zinc-400">
                    Phase-bound lists flip on automatically during work phases.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => call('pomodoro', { action: 'skip' })}>
                      <SkipForward /> Skip phase
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => call('pomodoro', { action: 'pause' })}>
                      <PauseIcon /> Pause
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => call('pomodoro', { action: 'stop' }, 'Pomodoro stopped')}>
                      <Square /> Stop
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <SegmentedControl
                  value={preset}
                  onValueChange={setPreset}
                  options={POMO_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                  className="w-full justify-between"
                />
                <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-zinc-500">
                  <PresetInfo preset={preset} />
                </div>
                <Button className="w-full" onClick={() => call('pomodoro', { action: 'start', preset }, 'Pomodoro started')}>
                  <Play /> Start {preset}
                </Button>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11.5px] text-zinc-500">
                  <Coffee className="size-3.5 shrink-0" />
                  Phase-bound blocks activate only during work phases.
                </div>
              </div>
            )}

            {/* phase progress strip */}
            {pomoPhase && (
              <Meter
                value={phaseMax - pomoRemaining}
                max={phaseMax}
                label={PHASE_LABEL[pomoPhase] ?? pomoPhase}
                valueLabel={fmtDur(pomoRemaining)}
              />
            )}
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  )
}

function PresetInfo({ preset }: { preset: string }) {
  const map: Record<string, [number, number, number]> = {
    classic: [25, 5, 15],
    long: [50, 10, 30],
    sprint: [15, 3, 10],
  }
  const [w, s, l] = map[preset] ?? map.classic
  return (
    <>
      <div><span className="block text-[15px] font-semibold text-foreground tabular-nums">{w}m</span>focus</div>
      <div><span className="block text-[15px] font-semibold text-foreground tabular-nums">{s}m</span>break</div>
      <div><span className="block text-[15px] font-semibold text-foreground tabular-nums">{l}m</span>long</div>
    </>
  )
}
