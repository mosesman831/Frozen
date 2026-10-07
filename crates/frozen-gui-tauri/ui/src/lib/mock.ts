// In-browser mock of FrozenSvc for `vite dev` previews. Mirrors rpc/snapshot.
import type { BlockInfo, BlockListInfo, BridgeStatus, AuditEntry } from './types'

const now = () => Math.floor(Date.now() / 1000)

const mkBlock = (o: Partial<BlockInfo> & { id: string; name: string }): BlockInfo => ({
  enabled: false, allow_mode: false, block_all_internet: false,
  rules: [], lock: { type: 'none' }, active: false, ...o,
})

const state: BlockListInfo = {
  rev: 41,
  flags: {
    paused: false,
    pomodoro_phase: null,
    pomodoro_remaining_s: 0,
    frozen_until: null,
    frozen_locked: false,
    stats_enabled: true,
  },
  blocks: [
    mkBlock({
      id: 'b1', name: 'Distractions', enabled: true, active: true,
      rules: [
        { kind: 'domain', value: 'facebook.com', negated: false },
        { kind: 'domain', value: 'instagram.com', negated: false },
        { kind: 'wildcard', value: '*.reddit.com', negated: false },
        { kind: 'keyword', value: 'tiktok', negated: false },
        { kind: 'yt_channel', value: '@MrBeast', negated: false },
      ],
      exceptions: ['reddit.com/r/productivity'],
      lock: { type: 'timer', until: now() + 5400 },
      allowance_seconds: 1800,
      allowance_remaining: 942,
    }),
    mkBlock({
      id: 'b2', name: 'PomoWork', enabled: true, active: false,
      rules: [
        { kind: 'domain', value: 'youtube.com', negated: false },
        { kind: 'app', value: 'discord.exe', negated: false },
      ],
      pomodoro_phase: 'work',
    }),
    mkBlock({
      id: 'b3', name: 'AppBlock', enabled: true, active: true,
      rules: [{ kind: 'app', value: 'notepad.exe', negated: false }],
      lock: { type: 'enforced' },
    }),
    mkBlock({
      id: 'b4', name: 'Nuclear', enabled: false, active: false,
      rules: [{ kind: 'wildcard', value: '*', negated: false }],
      block_all_internet: true,
      lock: { type: 'random_text', len: 48, perfect: true },
    }),
  ],
}

const auditLog: AuditEntry[] = []
const addAudit = (actor: string, action: string, detail: string) =>
  auditLog.unshift({ ts: now(), actor, action, detail })
addAudit('svc', 'block.start', 'Distractions')
addAudit('svc', 'ext.enforce', 'chrome killed: extension absent')
addAudit('gui', 'block.rule_add', 'youtube.com')
addAudit('svc', 'lock.timer', 'Distractions until 17:32')
addAudit('svc', 'frozen.start', 'until=45m lock=none')
addAudit('svc', 'app.kill', 'notepad.exe')
addAudit('svc', 'pomodoro.phase', 'work → short')

let status: BridgeStatus = { connected: true, detail: 'service connected' }
let pomoTimer: ReturnType<typeof setInterval> | null = null

export function mockSnapshot() {
  return { status, state: JSON.parse(JSON.stringify(state)) as BlockListInfo }
}

const bump = () => { state.rev += 1 }
const find = (name?: string) => state.blocks.find((b) => b.name === name)

export async function mockInvoke(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 40))
  const M: Record<string, () => unknown> = {
    status: () => ({ blocks_active: state.blocks.filter((b) => b.active).length, blocks_total: state.blocks.length, rev: state.rev, helper_connected: true, ext_clients: 1 }),
    'list-blocks': () => JSON.parse(JSON.stringify(state.blocks)),
    'add-block': () => {
      const name = String(params.name || 'New list')
      state.blocks.push(mkBlock({ id: 'b' + (state.blocks.length + 1), name }))
      bump(); addAudit('gui', 'block.create', name); return {}
    },
    'remove-block': () => {
      state.blocks = state.blocks.filter((b) => b.name !== params.name)
      bump(); addAudit('gui', 'block.delete', String(params.name)); return {}
    },
    start: () => { const b = find(String(params.name)); if (b) { if (b.lock.type === 'enforced' || b.lock.type === 'frozen') throw new Error('LOCKED: cannot start a locked block'); b.enabled = true; b.active = true; bump(); addAudit('gui', 'block.start', b.name) } return {} },
    stop: () => { const b = find(String(params.name)); if (b) { if (b.lock.type === 'enforced' || b.lock.type === 'frozen') throw new Error('LOCKED: cannot stop a locked block'); b.enabled = false; b.active = false; bump(); addAudit('gui', 'block.stop', b.name) } return {} },
    toggle: () => { const b = find(String(params.name)); if (b) { if (b.lock.type === 'enforced' || b.lock.type === 'frozen') throw new Error('LOCKED: locked block'); b.enabled = !b.enabled; b.active = b.enabled; bump(); addAudit('gui', 'block.toggle', b.name) } return {} },
    'add-rule': () => { const b = find(String(params.block)); if (b) { b.rules.push({ kind: (params.kind || 'domain') as never, value: String(params.value || ''), negated: !!params.negated }); bump(); addAudit('gui', 'block.rule_add', String(params.value)) } return {} },
    'remove-rule': () => { const b = find(String(params.block)); if (b) { b.rules = b.rules.filter((r) => r.value !== params.value); bump(); addAudit('gui', 'block.rule_del', String(params.value)) } return {} },
    'add-exception': () => { const b = find(String(params.block)); if (b) { b.exceptions = [...(b.exceptions || []), String(params.value || '')]; bump() } return {} },
    pause: () => { state.flags.paused = true; state.flags.paused_until = now() + Number(params.for_s || 300); bump(); addAudit('gui', 'pause', String(params.for_s)) ; return {} },
    resume: () => { state.flags.paused = false; state.flags.paused_until = 0; bump(); addAudit('gui', 'resume', '') ; return {} },
    lock: () => { const b = find(String(params.block)); if (b) { b.lock = params.lock as never; bump(); addAudit('gui', 'lock.set', b.name) } return {} },
    unlock: () => { const b = find(String(params.name)); if (b) { b.lock = { type: 'none' }; bump(); addAudit('gui', 'lock.clear', b.name) } return { token: 'mock-token-5m' } },
    'start-delay-break': () => { const b = find(String(params.name)); if (b) { b.break_until = now() + Number(params.duration_m || 5) * 60; bump(); addAudit('gui', 'break.delay', b.name) } return {} },
    'start-random-break': () => ({ challenge: 'the quick brown fox jumps over the lazy dog', text: undefined, duration_s: Number(params.duration_m || 5) * 60 }),
    'complete-break': () => { const b = find(String(params.name)); if (b) { b.break_until = now() + 300; bump() } return {} },
    'start-cause-break': () => { const b = find(String(params.name)); if (b) { b.break_until = now() + 300; bump(); addAudit('gui', 'break.cause', String(params.reason || '')) } return {} },
    'end-break': () => { const b = find(String(params.name)); if (b) { b.break_until = null; bump() } return {} },
    audit: () => ({ audit: auditLog.slice(0, Number(params.last || 300)) }),
    stats: () => ({
      apps: [{ name: 'chrome.exe', seconds: 8421 }, { name: 'code.exe', seconds: 5302 }, { name: 'spotify.exe', seconds: 1410 }],
      domains: [{ name: 'github.com', seconds: 3210 }, { name: 'stackoverflow.com', seconds: 1832 }, { name: 'reddit.com', seconds: 400 }],
      blocked: [{ name: 'reddit.com', count: 15 }, { name: 'youtube.com', count: 7 }, { name: 'facebook.com', count: 4 }],
      days: params.days,
    }),
    'delete-stats': () => ({ deleted: true }),
    pomodoro: () => {
      const a = String(params.action || 'status')
      if (a === 'start') {
        state.flags.pomodoro_phase = 'work'; state.flags.pomodoro_remaining_s = 1500
        if (pomoTimer) clearInterval(pomoTimer)
        pomoTimer = setInterval(() => {
          if ((state.flags.pomodoro_remaining_s || 0) > 0) { state.flags.pomodoro_remaining_s = (state.flags.pomodoro_remaining_s || 1) - 1; bump() }
        }, 1000)
      } else if (a === 'stop') { state.flags.pomodoro_phase = null; state.flags.pomodoro_remaining_s = 0; if (pomoTimer) clearInterval(pomoTimer) }
      else if (a === 'skip') { state.flags.pomodoro_phase = 'short'; state.flags.pomodoro_remaining_s = 300 }
      else if (a === 'pause') { state.flags.pomodoro_phase = (state.flags.pomodoro_phase || 'work') }
      bump(); addAudit('gui', 'pomodoro.' + a, '')
      return { phase: state.flags.pomodoro_phase, remaining_s: state.flags.pomodoro_remaining_s }
    },
    'frozen-start': () => { state.flags.frozen_until = now() + Number(params.for_s || 2700); bump(); addAudit('gui', 'frozen.start', String(params.for_s)); return {} },
    'frozen-stop': () => { state.flags.frozen_until = null; bump(); addAudit('gui', 'frozen.stop', ''); return {} },
    'frozen-status': () => ({ until: state.flags.frozen_until, locked: state.flags.frozen_locked }),
    'set-setting': () => ({}), 'get-setting': () => ({}), 'reload-settings': () => ({}),
  }
  const fn = M[method]
  if (!fn) throw new Error('unknown method: ' + method)
  return fn()
}
