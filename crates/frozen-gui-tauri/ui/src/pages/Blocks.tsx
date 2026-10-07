import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Ban, Plus, Trash2, Lock as LockIcon, Unlock, Play, Square,
  Coffee, Dices, HeartPulse, X, ChevronRight, MoreHorizontal, EyeOff,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { NumberField } from '@/components/ui/number-field'
import { Separator } from '@/components/ui/misc'
import { Empty } from '@/components/ui/empty'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle,
} from '@/components/ui/dialog'
import { cn, fmtCountdown, lockLabel } from '@/lib/utils'
import type { BlockInfo, Lock, RuleKind } from '@/lib/types'

const RULE_KINDS: { value: RuleKind; label: string; hint: string }[] = [
  { value: 'domain', label: 'Domain', hint: 'example.com' },
  { value: 'wildcard', label: 'Wildcard', hint: '*.example.com' },
  { value: 'url', label: 'URL', hint: 'example.com/path' },
  { value: 'keyword', label: 'Keyword', hint: 'any page containing it' },
  { value: 'regex', label: 'Regex', hint: 'regular expression' },
  { value: 'path', label: 'Path', hint: 'match on URL path' },
  { value: 'title', label: 'Title', hint: 'page title contains' },
  { value: 'app', label: 'App', hint: 'program.exe' },
  { value: 'folder', label: 'Folder', hint: 'block apps in folder' },
  { value: 'yt_channel', label: 'YT channel', hint: '@channel handle' },
]

const LOCK_KINDS = [
  { value: 'none', label: 'None', desc: 'Can toggle freely' },
  { value: 'timer', label: 'Timer', desc: 'Locked until a deadline' },
  { value: 'range', label: 'Time range', desc: 'Locked during daily hours' },
  { value: 'password', label: 'Password', desc: 'Unlock with a phrase' },
  { value: 'random_text', label: 'Random text', desc: 'Type shown text to unlock' },
  { value: 'restart', label: 'Restart', desc: 'Only a reboot unlocks' },
  { value: 'allowance', label: 'Allowance', desc: 'Daily budget while locked' },
  { value: 'enforced', label: 'Enforced', desc: 'No escape until schedule ends' },
  { value: 'frozen', label: 'Frozen', desc: 'Locked while Frozen mode runs' },
]

export default function Blocks() {
  const { state } = useStore()
  const blocks = state?.blocks ?? []
  const [sel, setSel] = useState<string | null>(null)
  const selected = blocks.find((b) => b.name === sel) ?? blocks[0]

  return (
    <div className="flex h-full">
      {/* list rail */}
      <div className="flex w-60 shrink-0 flex-col border-r border-white/[0.06]">
        <div className="flex items-center justify-between px-3.5 pt-4 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Lists</span>
          <NewBlockButton />
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
          {blocks.map((b) => {
            const isSel = selected?.name === b.name
            return (
              <button
                key={b.id || b.name}
                onClick={() => setSel(b.name)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer outline-none',
                  isSel ? 'bg-white/[0.06] text-foreground' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
                )}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', b.active ? 'bg-emerald-400' : 'bg-zinc-700')} />
                <span className="flex-1 truncate text-[13px] font-medium">{b.name}</span>
                {b.lock.type !== 'none' && <LockIcon className="size-3 text-zinc-600" />}
                {isSel && <ChevronRight className="size-3.5 text-zinc-600" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? <BlockDetail block={selected} key={selected.name} /> : (
          <Empty
            icon={Ban}
            title="No block lists"
            description="Create a block list to start blocking sites and apps."
            action={<NewBlockButton label="Create block list" />}
          />
        )}
      </div>
    </div>
  )
}

function NewBlockButton({ label }: { label?: string }) {
  const { call } = useStore()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {label ? (
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> {label}</Button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-foreground cursor-pointer outline-none"
        >
          <Plus className="size-4" />
        </button>
      )}
      {open && (
        <DialogContent>
          <DialogTitle>New block list</DialogTitle>
          <DialogDescription>Group rules under one switch — e.g. "Social" or "Games".</DialogDescription>
          <div className="mt-4">
            <Input
              autoFocus
              placeholder="List name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  call('add-block', { name: name.trim() }, `Created ${name.trim()}`)
                  setOpen(false); setName('')
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => { call('add-block', { name: name.trim() }, `Created ${name.trim()}`); setOpen(false); setName('') }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

function BlockDetail({ block }: { block: BlockInfo }) {
  const { call } = useStore()
  const locked = block.lock.type !== 'none'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {/* header card */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn(
            'flex size-10 items-center justify-center rounded-xl',
            block.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.05] text-zinc-500',
          )}>
            <Ban className="size-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold text-foreground">{block.name}</h2>
              {lockLabel(block.lock) && <Badge variant="warn">{lockLabel(block.lock)}</Badge>}
              {block.break_until && block.break_until * 1000 > Date.now() && (
                <Badge variant="blue">break · {fmtCountdown(block.break_until)}</Badge>
              )}
            </div>
            <p className="text-[12px] text-zinc-500">
              {block.rules.length} rule{block.rules.length === 1 ? '' : 's'}
              {block.exceptions?.length ? ` · ${block.exceptions.length} exception${block.exceptions.length === 1 ? '' : 's'}` : ''}
              {block.allowance_seconds ? ` · ${fmtCountdown(Math.floor(Date.now() / 1000) + (block.allowance_remaining ?? 0))} allowance left` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-[11px] font-medium', block.enabled ? 'text-emerald-400' : 'text-zinc-500')}>
              {block.enabled ? 'On' : 'Off'}
            </span>
            <Switch
              checked={block.enabled}
              onCheckedChange={() => call('toggle', { name: block.name })}
              disabled={locked}
            />
            <ActionsMenu block={block} />
          </div>
        </CardContent>
      </Card>

      {/* add rule */}
      <AddRuleCard block={block} />

      {/* rules table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between py-3">
          <CardTitle>Rules</CardTitle>
          <span className="text-[11px] text-zinc-600">{block.rules.length}</span>
        </CardHeader>
        <CardContent className="p-0">
          {block.rules.length === 0 ? (
            <Empty icon={Ban} title="No rules" description="Add a domain, keyword or app above." className="py-8" />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left">
                  <th className="h-8 px-4 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Kind</th>
                  <th className="h-8 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Value</th>
                  <th className="h-8 w-10 px-3" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {block.rules.map((r) => (
                    <motion.tr
                      key={r.kind + r.value}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025]"
                    >
                      <td className="px-4 py-2">
                        <Badge variant={r.negated ? 'violet' : 'default'}>{r.kind}</Badge>
                      </td>
                      <td className="max-w-0 truncate px-3 py-2 font-mono text-[12.5px] text-zinc-300">{r.value}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => call('remove-rule', { block: block.name, value: r.value }, `Removed ${r.value}`)}
                          className="rounded p-1 text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-red-400 cursor-pointer outline-none"
                        >
                          <X className="size-3.5" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* exceptions */}
      <ExceptionsCard block={block} />
    </div>
  )
}

function ActionsMenu({ block }: { block: BlockInfo }) {
  const { call } = useStore()
  const [lockOpen, setLockOpen] = useState(false)
  const [breakOpen, setBreakOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const locked = block.lock.type !== 'none'
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <button className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-foreground cursor-pointer outline-none" />
          }
        >
          <MoreHorizontal className="size-4" />
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{block.name}</MenuLabel>
          <MenuItem onClick={() => call(block.enabled ? 'stop' : 'start', { name: block.name }, block.enabled ? 'Stopped' : 'Started')} disabled={locked}>
            {block.enabled ? <Square /> : <Play />} {block.enabled ? 'Stop' : 'Start'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => setLockOpen(true)}><LockIcon /> Change lock…</MenuItem>
          {locked && (
            <MenuItem onClick={() => call('unlock', { name: block.name, credential: '' }, 'Unlock token issued (5m)')}>
              <Unlock /> Unlock…
            </MenuItem>
          )}
          <MenuItem onClick={() => setBreakOpen(true)}><Coffee /> Take a break…</MenuItem>
          {block.break_until && block.break_until * 1000 > Date.now() && (
            <MenuItem onClick={() => call('end-break', { name: block.name }, 'Break ended')}>
              <EyeOff /> End break early
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem className="text-red-400 [&_svg]:text-red-400/70" onClick={() => setDelOpen(true)}>
            <Trash2 /> Delete list…
          </MenuItem>
        </MenuContent>
      </Menu>

      <LockDialog block={block} open={lockOpen} onOpenChange={setLockOpen} />
      <BreakDialog block={block} open={breakOpen} onOpenChange={setBreakOpen} />
      <DeleteDialog block={block} open={delOpen} onOpenChange={setDelOpen} />
    </>
  )
}

function AddRuleCard({ block }: { block: BlockInfo }) {
  const { call } = useStore()
  const [kind, setKind] = useState<RuleKind>('domain')
  const [value, setValue] = useState('')
  const [negated, setNegated] = useState(false)
  const hint = RULE_KINDS.find((k) => k.value === kind)?.hint ?? ''

  const submit = () => {
    if (!value.trim()) return
    call('add-rule', { block: block.name, kind, value: value.trim(), negated }, `Rule added: ${value.trim()}`)
    setValue('')
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-2 p-3">
        <Select
          value={kind}
          onValueChange={(v) => setKind(v as RuleKind)}
          options={RULE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          className="w-36"
        />
        <Input
          className="flex-1 font-mono text-[12.5px]"
          placeholder={hint}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <label className="flex items-center gap-1.5 text-[11.5px] text-zinc-500 whitespace-nowrap cursor-pointer">
          <Switch checked={negated} onCheckedChange={setNegated} className="scale-90" />
          negated
        </label>
        <Button size="sm" onClick={submit} disabled={!value.trim()}>
          <Plus /> Add
        </Button>
      </CardContent>
    </Card>
  )
}

function ExceptionsCard({ block }: { block: BlockInfo }) {
  const { call } = useStore()
  const [value, setValue] = useState('')
  const exceptions = block.exceptions ?? []
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle>Exceptions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {exceptions.length === 0 ? (
          <p className="text-[12px] text-zinc-600">Nothing whitelisted inside this block.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {exceptions.map((e) => (
              <span key={e} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[11.5px] text-zinc-300">
                {e}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Input
            className="h-7 flex-1 font-mono text-[12px]"
            placeholder="allow this value even when blocked"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) {
                call('add-exception', { block: block.name, value: value.trim() }, 'Exception added')
                setValue('')
              }
            }}
          />
          <Button
            size="sm" variant="secondary"
            disabled={!value.trim()}
            onClick={() => { call('add-exception', { block: block.name, value: value.trim() }, 'Exception added'); setValue('') }}
          >
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LockDialog({ block, open, onOpenChange }: { block: BlockInfo; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { call } = useStore()
  const [kind, setKind] = useState(block.lock.type)
  const [mins, setMins] = useState(60)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [password, setPassword] = useState('')
  const [len, setLen] = useState(32)
  const [perfect, setPerfect] = useState(false)
  const [allowMins, setAllowMins] = useState(30)

  const build = (): Lock => {
    switch (kind) {
      case 'timer': return { type: 'timer', until: Math.floor(Date.now() / 1000) + mins * 60 }
      case 'range': return { type: 'range', start_hm: start, end_hm: end }
      case 'password': return { type: 'password', hash: password }
      case 'random_text': return { type: 'random_text', len, perfect }
      case 'allowance': return { type: 'allowance', seconds: allowMins * 60 }
      default: return { type: kind } as Lock
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent>
          <DialogTitle>Lock — {block.name}</DialogTitle>
          <DialogDescription>
            A locked block can't be stopped or edited off until the lock clears.
          </DialogDescription>
          <div className="mt-4 space-y-3">
            <Select
              value={kind}
              onValueChange={setKind}
              options={LOCK_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            />
            <p className="text-[12px] text-zinc-500">{LOCK_KINDS.find((k) => k.value === kind)?.desc}</p>
            <Separator />

            {kind === 'timer' && (
              <Field label="Locked for"><NumberField value={mins} onValueChange={setMins} min={1} max={60 * 24} suffix="min" /></Field>
            )}
            {kind === 'range' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Until"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              </div>
            )}
            {kind === 'password' && (
              <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="phrase to unlock" /></Field>
            )}
            {kind === 'random_text' && (
              <div className="space-y-3">
                <Field label="Text length"><NumberField value={len} onValueChange={setLen} min={8} max={128} /></Field>
                <label className="flex items-center gap-2 text-[12.5px] text-zinc-400 cursor-pointer">
                  <Switch checked={perfect} onCheckedChange={setPerfect} /> Perfect mode — one typo restarts
                </label>
              </div>
            )}
            {kind === 'allowance' && (
              <Field label="Daily allowance"><NumberField value={allowMins} onValueChange={setAllowMins} min={1} max={600} suffix="min" /></Field>
            )}
            {kind === 'enforced' && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-[12px] leading-relaxed text-red-300">
                Enforced has no unlock path — nothing (password, break, support code) lifts it before the schedule ends.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => { call('lock', { block: block.name, lock: build() }, `Lock set: ${kind}`); onOpenChange(false) }}
              variant={kind === 'enforced' ? 'destructive' : 'default'}
            >
              Apply lock
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

function BreakDialog({ block, open, onOpenChange }: { block: BlockInfo; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { call } = useStore()
  const [mode, setMode] = useState<'delay' | 'random' | 'cause'>('delay')
  const [waitM, setWaitM] = useState(10)
  const [durM, setDurM] = useState(10)
  const [reason, setReason] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const start = async () => {
    if (mode === 'delay') {
      await call('start-delay-break', { name: block.name, wait_s: waitM * 60, duration_m: durM }, `Break in ${waitM}m`)
      onOpenChange(false)
    } else if (mode === 'cause') {
      await call('start-cause-break', { name: block.name, reason: reason || 'needed' }, 'Cause break started')
      onOpenChange(false)
    } else {
      try {
        const r = (await call<{ challenge?: string }>('start-random-break', { name: block.name, duration_m: durM, len: 32, perfect: false })) ?? undefined
        if (r?.challenge) setChallenge(r.challenge)
        else onOpenChange(false)
      } catch { /* toasted */ }
    }
  }

  const complete = () => {
    call('complete-break', { name: block.name, challenge, text: typed }, challenge && typed === challenge ? 'Break started' : undefined)
    setChallenge(null); setTyped(''); onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setChallenge(null); setTyped('') } }}>
      {open && (
        <DialogContent>
          <DialogTitle>Break — {block.name}</DialogTitle>
          <DialogDescription>Temporarily lift this block. Locked blocks may veto breaks.</DialogDescription>
          <div className="mt-4 space-y-3">
            {!challenge ? (
              <>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-1">
                  {(
                    [
                      ['delay', Coffee, 'Delay'],
                      ['random', Dices, 'Random text'],
                      ['cause', HeartPulse, 'Cause'],
                    ] as const
                  ).map(([v, Icon, l]) => (
                    <button
                      key={v}
                      onClick={() => setMode(v)}
                      className={cn(
                        'flex h-9 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer outline-none',
                        mode === v ? 'bg-white/[0.09] text-foreground' : 'text-zinc-500 hover:text-zinc-300',
                      )}
                    >
                      <Icon className="size-3.5" /> {l}
                    </button>
                  ))}
                </div>
                {mode === 'delay' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Starts in"><NumberField value={waitM} onValueChange={setWaitM} min={0} max={120} suffix="min" /></Field>
                    <Field label="Lasts"><NumberField value={durM} onValueChange={setDurM} min={1} max={120} suffix="min" /></Field>
                  </div>
                )}
                {mode === 'random' && (
                  <Field label="Break length"><NumberField value={durM} onValueChange={setDurM} min={1} max={120} suffix="min" /></Field>
                )}
                {mode === 'cause' && (
                  <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why do you need it?" /></Field>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-[12px] text-zinc-400">Type the text below exactly to open the break:</p>
                <div className="select-none rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 font-mono text-[13px] leading-relaxed text-violet-300">
                  {challenge}
                </div>
                <Input
                  autoFocus
                  className="font-mono"
                  placeholder="type it here"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onPaste={(e) => e.preventDefault()}
                  onKeyDown={(e) => e.key === 'Enter' && typed === challenge && complete()}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {challenge ? (
              <Button disabled={typed !== challenge} onClick={complete}>Start break</Button>
            ) : (
              <Button onClick={start}>Start</Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

function DeleteDialog({ block, open, onOpenChange }: { block: BlockInfo; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { call } = useStore()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent>
          <DialogTitle>Delete {block.name}?</DialogTitle>
          <DialogDescription>
            Removes the list and all {block.rules.length} rules. This can't be undone.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { call('remove-block', { name: block.name }, 'Deleted'); onOpenChange(false) }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
