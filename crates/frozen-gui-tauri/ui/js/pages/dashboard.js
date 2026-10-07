/* dashboard.js — landing page: stat cards, block-list strip, global status,
   and the topbar pause/resume controls (this page owns #global-actions). */
(function () {
  // Self-ensure: page files may parse before app.js defines the registry.
  window.Pages = window.Pages || {
    defs: {},
    register(n, d) { this.defs[n] = d; },
  };

  const now = () => Math.floor(Date.now() / 1000);

  let statsCache = null;
  let statsRev = -1;
  let latestState = null;
  let stateAt = 0;            // Date.now() when the last state push arrived
  let ticker = null;

  /* ---------- derived ---------- */
  const activeBlocks = s => s.blocks.filter(b => b.active).length;
  const totalRules = s => s.blocks.reduce((n, b) => n + (b.rules ? b.rules.length : 0), 0);
  const blockedToday = () => {
    if (!statsCache) return '—';
    const day = new Date().toISOString().slice(0, 10);
    return statsCache.blocked
      .filter(r => r.day === day)
      .reduce((n, r) => n + r.attempts, 0);
  };

  const blockStatus = (b, paused) => {
    if (paused && b.active) return { label: 'Paused', cls: 'warn' };
    if (b.active) return { label: 'Active', cls: 'on' };
    if (b.enabled) return { label: 'Armed', cls: 'violet' };
    return { label: 'Off', cls: '' };
  };

  const lockChip = b => {
    const l = H.lockLabel(b.lock);
    if (!l) return '';
    let extra = '';
    if (b.lock.type === 'timer' && b.lock.until)
      extra = ` · ${H.fmtCountdown(b.lock.until)}`;
    if (b.lock.type === 'range' && b.lock.start_hm)
      extra = ` · ${H.esc(b.lock.start_hm)}–${H.esc(b.lock.end_hm)}`;
    return `<span class="pill violet lock-chip" title="Locked: ${H.esc(l)}">⚿ ${H.esc(l)}${extra}</span>`;
  };

  /* ---------- topbar global actions ---------- */
  function renderGlobalActions() {
    const host = document.getElementById('global-actions');
    if (!host) return;
    host.innerHTML = `
      <div class="ga-wrap">
        <button class="btn ghost sm" id="ga-pause">❚❚ Pause</button>
        <div class="ga-menu" id="ga-menu">
          <button data-s="300">5 minutes</button>
          <button data-s="600">10 minutes</button>
          <button data-s="1800">30 minutes</button>
        </div>
        <button class="btn violet sm" id="ga-resume" style="display:none">▶ Resume</button>
      </div>`;
    const menu = host.querySelector('#ga-menu');
    const pauseBtn = host.querySelector('#ga-pause');
    pauseBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        menu.classList.remove('open');
        H.call('pause', { for_s: +b.dataset.s }, `Paused for ${b.textContent}`);
      }));
    host.querySelector('#ga-resume').addEventListener('click', () =>
      H.call('resume', {}, 'Resumed'));
  }

  function updateGlobalActions(paused) {
    const p = document.getElementById('ga-pause');
    const r = document.getElementById('ga-resume');
    if (!p || !r) return;
    p.style.display = paused ? 'none' : '';
    r.style.display = paused ? '' : 'none';
    r.innerHTML = '▶ Resume';
    if (paused) { const m = document.getElementById('ga-menu'); if (m) m.classList.remove('open'); }
  }

  /* ---------- page ---------- */
  function statCard(ico, icoCls, num, label, sub, grad) {
    return `
      <div class="card stat-card">
        <div class="stat-ico ${icoCls}">${ico}</div>
        <div class="stat-num ${grad ? 'grad-text' : ''}">${num}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<div class="stat-sub faint">${sub}</div>` : ''}
      </div>`;
  }

  function pomodoroChip(s) {
    const ph = s.flags.pomodoro_phase;
    const rem = (s.flags.pomodoro_remaining_s || 0);
    if (!ph || ph === 'off')
      return `<span class="pill">No pomodoro</span>`;
    const label = ph === 'work' ? 'Focus' : ph === 'break' ? 'Break' : ph;
    const cls = ph === 'work' ? 'on' : ph === 'break' ? 'violet' : 'warn';
    return `<span class="pill ${cls} pomo-chip">◉ ${label} <b data-pomodoro-cd>${H.fmtDur(rem)}</b></span>`;
  }

  function blockCard(b, paused) {
    const st = blockStatus(b, paused);
    const running = !!b.active;
    return `
      <div class="blcard ${running ? 'running' : ''}" data-name="${H.esc(b.name)}">
        <div class="blcard-top">
          <span class="bl-name">${H.esc(b.name)}</span>
          <span class="pill ${st.cls}">${st.label}</span>
        </div>
        <div class="blcard-mid">
          ${lockChip(b)}
          <span class="mut bl-rules">${(b.rules || []).length} rule${(b.rules || []).length === 1 ? '' : 's'}</span>
        </div>
        <div class="blcard-actions">
          <label class="sw" title="Enabled">
            <input type="checkbox" class="sw-in" ${b.enabled ? 'checked' : ''} data-act="toggle">
            <span class="sw-track"><span class="sw-thumb"></span></span>
          </label>
          <button class="btn ${running ? 'ghost' : 'primary'} sm" data-act="${running ? 'stop' : 'start'}">
            ${running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>`;
  }

  function render(el, s) {
    const paused = !!s.flags.paused;
    const frozen = s.flags.frozen_until && s.flags.frozen_until > now();
    const blocksHtml = s.blocks.length
      ? s.blocks.map(b => blockCard(b, paused)).join('')
      : `<div class="empty-state">
           <div class="empty-ico">◆</div>
           <div class="empty-title">No block lists yet</div>
           <div class="mut">Create your first list on the Blocks page.</div>
         </div>`;

    const pomoSub = s.flags.pomodoro_phase && s.flags.pomodoro_phase !== 'off'
      ? `${H.esc(s.flags.pomodoro_phase)} phase`
      : 'idle';

    el.innerHTML = `
      <div class="stat-grid">
        ${statCard('▲', 'ico-violet', activeBlocks(s), 'Active blocks', `${s.blocks.length} total`, true)}
        ${statCard('≡', 'ico-blue', totalRules(s), 'Rules enforced', 'across all lists', true)}
        ${statCard('✕', 'ico-pink', blockedToday(), 'Blocked today', 'attempts stopped', true)}
        ${statCard('◎', 'ico-orange', s.flags.pomodoro_phase && s.flags.pomodoro_phase !== 'off'
            ? `<span data-pomodoro-cd>${H.fmtDur(s.flags.pomodoro_remaining_s || 0)}</span>` : '—',
            'Pomodoro', pomoSub, false)}
      </div>

      <div class="card gstatus">
        <div class="gstatus-row">
          <div class="gstatus-item">
            <span class="gstatus-label">Status</span>
            <span class="pill ${paused ? 'warn' : 'on'}">${paused ? 'Paused' : 'Running'}</span>
          </div>
          <div class="gstatus-item">
            <span class="gstatus-label">Pomodoro</span>
            ${pomodoroChip(s)}
          </div>
          <div class="gstatus-item">
            <span class="gstatus-label">Frozen</span>
            ${frozen
              ? `<span class="pill bad">Frozen · <b data-until="${s.flags.frozen_until}">${H.fmtCountdown(s.flags.frozen_until)}</b></span>`
              : '<span class="pill">off</span>'}
          </div>
          <div class="gstatus-item grow"></div>
          <div class="gstatus-item">
            <span class="gstatus-label">State</span>
            <span class="pill">rev ${s.rev}</span>
          </div>
        </div>
      </div>

      <h3 class="strip-title">Block lists</h3>
      <div class="blstrip">${blocksHtml}</div>`;

    // wire per-card actions
    el.querySelectorAll('.blcard').forEach(card => {
      const name = card.dataset.name;
      card.querySelector('.sw-in').addEventListener('change', () =>
        H.call('toggle', { name }));
      card.querySelector('[data-act]').addEventListener('click', e => {
        const act = e.currentTarget.dataset.act;
        H.call(act, { name });
      });
      card.addEventListener('click', e => {
        if (e.target.closest('button,label,input')) return;
        document.querySelector('.nav-item[data-page="blocks"]')?.click();
      });
    });

    updateGlobalActions(paused);
  }

  /* ---------- live tick: countdowns inside this page ---------- */
  function tick(el) {
    if (!latestState || !el.isConnected) return;
    const t = now();
    el.querySelectorAll('[data-until]').forEach(n => {
      n.textContent = H.fmtCountdown(+n.dataset.until);
    });
    const base = latestState.flags.pomodoro_remaining_s || 0;
    const elapsed = Math.floor((Date.now() - stateAt) / 1000);
    const left = Math.max(0, base - elapsed);
    el.querySelectorAll('[data-pomodoro-cd]').forEach(n => {
      n.textContent = H.fmtDur(left);
    });
  }

  Pages.register('dashboard', {
    title: 'Dashboard',
    sub: 'Everything at a glance',
    mount(el) {
      renderGlobalActions();
      el.innerHTML = '<div class="mut" style="padding:24px 2px">Connecting to the service…</div>';
      Frozen.invoke('stats', { days: 1 }).then(s => { statsCache = s; statsRev = -1; }).catch(() => {});
      if (!ticker) ticker = setInterval(() => {
        const page = document.getElementById('page-dashboard');
        if (page) tick(page);
      }, 1000);
    },
    update(el, state) {
      latestState = state;
      stateAt = Date.now();
      if (state.rev !== statsRev) {
        statsRev = state.rev;
        Frozen.invoke('stats', { days: 1 }).then(s => { statsCache = s; render(el, state); }).catch(() => render(el, state));
      } else {
        render(el, state);
      }
    },
  });
})();
