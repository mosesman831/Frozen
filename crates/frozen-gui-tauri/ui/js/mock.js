/* Mock backend for browser preview — used ONLY when window.__TAURI__ is absent.
   Implements every method the real FrozenSvc RPC exposes and pushes
   BlockListInfo-shaped state so pages can be designed/tested in plain Chrome. */
(function () {
  if (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.core) return;

  const now = () => Math.floor(Date.now() / 1000);
  const state = {
    rev: 41,
    blocks: [
      {
        id: 'b1', name: 'Distractions', enabled: true, active: true,
        allow_mode: false, block_all_internet: false, force_close: false,
        schedule_kind: 'always', schedule_grid: [], pomodoro_phase: null,
        rules: [
          { kind: 'domain', value: 'facebook.com', negated: false },
          { kind: 'domain', value: 'reddit.com', negated: false },
          { kind: 'wildcard', value: '*.youtube.com', negated: false },
          { kind: 'keyword', value: 'twitch', negated: false },
          { kind: 'app', value: 'notepad.exe', negated: false },
        ],
        lock: { type: 'none' },
        allowance_seconds: null, allowance_remaining: null, break_until: null,
      },
      {
        id: 'b2', name: 'Social', enabled: false, active: false,
        allow_mode: false, block_all_internet: false, force_close: false,
        schedule_kind: 'always', schedule_grid: [], pomodoro_phase: null,
        rules: [
          { kind: 'domain', value: 'twitter.com', negated: false },
          { kind: 'domain', value: 'x.com', negated: false },
          { kind: 'domain', value: 'instagram.com', negated: false },
        ],
        lock: { type: 'timer', until: now() + 5400 },
        allowance_seconds: null, allowance_remaining: null, break_until: null,
      },
      {
        id: 'b3', name: 'Pomodoro block', enabled: true, active: true,
        allow_mode: false, block_all_internet: false, force_close: true,
        schedule_kind: 'always', schedule_grid: [], pomodoro_phase: 'work',
        rules: [
          { kind: 'domain', value: 'youtube.com', negated: false },
          { kind: 'domain', value: 'news.ycombinator.com', negated: true },
        ],
        lock: { type: 'enforced' },
        allowance_seconds: null, allowance_remaining: null, break_until: null,
      },
      {
        id: 'b4', name: 'Nuclear', enabled: false, active: false,
        allow_mode: true, block_all_internet: true, force_close: false,
        schedule_kind: 'always', schedule_grid: [], pomodoro_phase: null,
        rules: [{ kind: 'domain', value: 'github.com', negated: false }],
        lock: { type: 'password', hash: '$argon2id$v=19$m=19456,t=2,p=1$MOCK$MOCK' },
        allowance_seconds: 1800, allowance_remaining: 1234, break_until: null,
      },
    ],
    flags: {
      stats_enabled: true, stats_enabled_incognito: false, ignore_incognito: false,
      force_allow_file: false, block_inactive: false, block_split: false,
      block_embedded: false, stats_strict: false, paused: false,
      pomodoro_phase: 'work', pomodoro_remaining_s: 1180,
      frozen_until: 0, frozen_locked: false,
    },
  };

  const stateCbs = [], statusCbs = [];
  const push = () => { state.rev++; stateCbs.forEach(f => { try { f(state) } catch (e) {} }); };
  const audit = [
    { ts: now() - 40, actor: 'svc', action: 'state.push', detail: 'rev 41' },
    { ts: now() - 300, actor: 'gui', action: 'block.start', detail: 'Distractions' },
    { ts: now() - 360, actor: 'svc', action: 'ext.enforce', detail: 'chrome.exe killed (locked)' },
    { ts: now() - 1200, actor: 'gui', action: 'lock.set', detail: 'Social timer' },
    { ts: now() - 3700, actor: 'svc', action: 'app.kill', detail: 'notepad.exe' },
    { ts: now() - 7200, actor: 'svc', action: 'pomodoro.phase', detail: 'work → break' },
    { ts: now() - 9000, actor: 'ext', action: 'block.hit', detail: 'reddit.com (Distractions)' },
    { ts: now() - 19000, actor: 'svc', action: 'frozen.end', detail: 'session ended' },
  ];
  const stats = {
    apps: [
      { day: today(), process: 'chrome.exe', seconds: 7420 },
      { day: today(), process: 'Code.exe', seconds: 5210 },
      { day: today(), process: 'notepad.exe', seconds: 300 },
      { day: yesterday(), process: 'chrome.exe', seconds: 9540 },
      { day: yesterday(), process: 'spotify.exe', seconds: 1800 },
    ],
    domains: [
      { day: today(), domain: 'github.com', seconds: 3200, visits: 41, blocked: 0 },
      { day: today(), domain: 'stackoverflow.com', seconds: 1100, visits: 18, blocked: 0 },
      { day: today(), domain: 'reddit.com', seconds: 0, visits: 12, blocked: 12 },
      { day: yesterday(), domain: 'youtube.com', seconds: 2600, visits: 9, blocked: 2 },
      { day: yesterday(), domain: 'docs.rs', seconds: 900, visits: 14, blocked: 0 },
    ],
    blocked: [
      { day: today(), kind: 'domain', target: 'reddit.com', attempts: 12 },
      { day: today(), kind: 'app', target: 'notepad.exe', attempts: 3 },
      { day: yesterday(), kind: 'domain', target: 'youtube.com', attempts: 2 },
    ],
  };
  function today() { return new Date().toISOString().slice(0, 10); }
  function yesterday() { return new Date(Date.now() - 864e5).toISOString().slice(0, 10); }

  const block = name => state.blocks.find(b => b.name === name);
  const ok = payload => Promise.resolve(payload || { ok: true });
  const err = msg => Promise.reject(new Error(msg));

  const methods = {
    status: () => ok({ uptime_s: 9321, rev: state.rev }),
    'list-blocks': () => ok({ blocks: state.blocks }),
    'add-block': p => { state.blocks.push({
        id: 'b' + (state.blocks.length + 1), name: p.name, enabled: false, active: false,
        allow_mode: false, block_all_internet: false, force_close: false,
        schedule_kind: 'always', schedule_grid: [], pomodoro_phase: null,
        rules: [], lock: { type: 'none' }, allowance_seconds: null,
        allowance_remaining: null, break_until: null }); push(); return ok(); },
    'remove-block': p => { state.blocks = state.blocks.filter(b => b.name !== p.name); push(); return ok(); },
    'add-rule': p => { block(p.block).rules.push({ kind: p.kind, value: p.value, negated: !!p.negated }); push(); return ok(); },
    'remove-rule': p => { const b = block(p.block); b.rules = b.rules.filter(r => r.value !== p.value); push(); return ok(); },
    'add-exception': p => { block(p.block).rules.push({ kind: 'domain', value: p.value, negated: true }); push(); return ok(); },
    'remove-exception': p => { const b = block(p.block); b.rules = b.rules.filter(r => r.value !== p.value); push(); return ok(); },
    start: p => { const b = block(p.name); b.enabled = true; b.active = true; push(); return ok(); },
    stop: p => { const b = block(p.name); if (b.lock.type !== 'none') return err(`LOCKED: block "${p.name}" is locked (${b.lock.type})`); b.enabled = false; b.active = false; push(); return ok(); },
    toggle: p => block(p.name).enabled ? methods.stop(p) : methods.start(p),
    pause: p => { state.flags.paused = true; push(); return ok(); },
    resume: () => { state.flags.paused = false; push(); return ok(); },
    lock: p => { block(p.block).lock = p.lock; push(); return ok(); },
    unlock: p => { const b = block(p.name); if (b.lock.type === 'enforced') return err('LOCKED: enforced lock cannot be unlocked'); b.lock = { type: 'none' }; push(); return ok({ token: 'MOCK-UNLOCK-TOKEN' }); },
    'start-delay-break': p => { block(p.name).break_until = now() + 300; push(); return ok(); },
    'start-random-break': () => ok({ challenge: 'MOCK-CHALLENGE', text: 'the quick brown fox jumps over the lazy dog 42', duration_s: 300 }),
    'complete-break': p => { if (p.text.trim() === 'the quick brown fox jumps over the lazy dog 42') { push(); return ok(); } return err('text does not match'); },
    'start-cause-break': p => { block(p.name).break_until = now() + 300; push(); return ok(); },
    'end-break': p => { block(p.name).break_until = null; push(); return ok(); },
    pomodoro: p => { if (p.action === 'start') { state.flags.pomodoro_phase = 'work'; state.flags.pomodoro_remaining_s = 1500; } else if (p.action === 'stop') { state.flags.pomodoro_phase = 'off'; state.flags.pomodoro_remaining_s = 0; } else if (p.action === 'pause') { state.flags.pomodoro_phase = 'paused'; } else if (p.action === 'resume') { state.flags.pomodoro_phase = 'work'; } else if (p.action === 'skip') { state.flags.pomodoro_phase = state.flags.pomodoro_phase === 'work' ? 'break' : 'work'; state.flags.pomodoro_remaining_s = 300; } push(); return ok(); },
    'frozen-start': p => { state.flags.frozen_until = now() + (p.for_s || 3600); state.flags.frozen_locked = p.lock && p.lock.type !== 'none'; push(); return p.lock && p.lock.type === 'random' ? ok({ generated: 'X7kP9vQm3wZaR8tYbN2cH5jF6dL4sG1e' }) : ok(); },
    'frozen-stop': p => { if (state.flags.frozen_locked && !p.credential) return err('credential required'); state.flags.frozen_until = 0; state.flags.frozen_locked = false; push(); return ok(); },
    'frozen-status': () => ok({ until: state.flags.frozen_until, locked: state.flags.frozen_locked }),
    stats: () => ok(stats),
    audit: () => ok({ audit }),
    'get-setting': () => ok({ value: null }),
    'set-setting': () => ok(),
    'reload-settings': () => ok(),
    'delete-stats': () => { stats.apps = []; stats.domains = []; stats.blocked = []; return ok(); },
  };

  window.FrozenMock = {
    invoke: (method, params) => {
      const fn = methods[method];
      if (!fn) return err(`unknown method ${method}`);
      return new Promise((res, rej) => setTimeout(() => fn(params || {}).then(res, rej), 60));
    },
    onState: f => { stateCbs.push(f); setTimeout(() => f(state), 100); },
    onStatus: f => { statusCbs.push(f); setTimeout(() => f({ connected: true, detail: 'mock backend' }), 50); },
  };
})();
