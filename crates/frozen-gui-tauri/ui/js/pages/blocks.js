/* blocks.js — flagship two-pane page: block list rail + detail pane with
   rules, exceptions, locks and breaks. */
(function () {
  // Self-ensure: page files may parse before app.js defines the registry.
  window.Pages = window.Pages || {
    defs: {},
    register(n, d) { this.defs[n] = d; },
  };

  const now = () => Math.floor(Date.now() / 1000);

  let selected = null;        // selected block name (RPC keys off name)
  let latestState = null;
  let ticker = null;

  const RULE_KINDS = [
    ['domain', 'Domain'], ['wildcard', 'Wildcard'], ['url', 'URL'],
    ['keyword', 'Keyword'], ['regex', 'Regex'], ['path', 'Path'],
    ['title', 'Window title'], ['app', 'App'], ['folder', 'Folder'],
    ['yt_channel', 'YouTube channel'],
  ];
  const KIND_HINT = {
    domain: 'e.g. reddit.com', wildcard: 'e.g. *.youtube.com',
    url: 'exact URL', keyword: 'matches anywhere', regex: 'regular expression',
    path: 'URL path pattern', title: 'window title match',
    app: 'e.g. notepad.exe', folder: 'folder path', yt_channel: 'channel name / id',
  };
  const LOCK_KINDS = [
    ['none', 'No lock', 'Anyone can stop or edit this list.'],
    ['timer', 'Timer', 'Locked until a deadline — pick minutes.'],
    ['range', 'Time range', 'Locked outside a daily window.'],
    ['password', 'Password', 'Unlock only with a password.'],
    ['random', 'Random text', 'Type a random string to unlock.'],
    ['restart', 'Restart', 'Unlock requires a PC restart.'],
    ['allowance', 'Allowance', 'Limited browsing budget per day.'],
    ['enforced', 'Enforced', 'Cannot be unlocked at all.'],
    ['frozen', 'Frozen', 'Locked while Frozen mode is on.'],
  ];
  const lockGlyph = t => ({
    timer: '⏱', range: '⌚', password: '⚿', random_text: '✱', random: '✱',
    restart: '⟳', allowance: '◔', enforced: '⛔', frozen: '❆',
  }[t] || '⚿');

  const find = s => s.blocks.find(b => b.name === selected)
    || s.blocks[0] || null;

  const statusOf = (b, paused) => {
    if (paused && b.active) return { label: 'Paused', cls: 'warn' };
    if (b.active) return { label: 'Active', cls: 'on' };
    if (b.enabled) return { label: 'Armed', cls: 'violet' };
    return { label: 'Off', cls: '' };
  };

  function lockPill(b) {
    const l = H.lockLabel(b.lock);
    if (!l) return '<span class="pill">No lock</span>';
    let extra = '';
    if (b.lock.type === 'timer' && b.lock.until)
      extra = ` · <b data-until="${b.lock.until}">${H.fmtCountdown(b.lock.until)}</b>`;
    if (b.lock.type === 'range' && b.lock.start_hm)
      extra = ` · ${H.esc(b.lock.start_hm)}–${H.esc(b.lock.end_hm)}`;
    if (b.lock.type === 'allowance' && b.lock.seconds)
      extra = ` · ${H.fmtDur(b.lock.seconds)}/day`;
    return `<span class="pill violet">${lockGlyph(b.lock.type)} ${H.esc(l)}${extra}</span>`;
  }

  /* ================= left rail ================= */

  function railItem(b, paused) {
    const st = statusOf(b, paused);
    const rules = (b.rules || []).length;
    const locked = !!H.lockLabel(b.lock);
    return `
      <button class="bl-item ${b.name === selected ? 'sel' : ''} ${b.active ? 'running' : ''}"
              data-name="${H.esc(b.name)}">
        <span class="bl-dot ${st.cls}"></span>
        <span class="bl-item-body">
          <span class="bl-item-name">${H.esc(b.name)}</span>
          <span class="bl-item-meta">
            ${locked ? `<span class="meta-lock">${lockGlyph(b.lock.type)} ${H.esc(H.lockLabel(b.lock))}</span>` : ''}
            <span>${rules} rule${rules === 1 ? '' : 's'}</span>
          </span>
        </span>
        <span class="pill ${st.cls}">${st.label}</span>
      </button>`;
  }

  /* ================= detail pane ================= */

  function badges(b) {
    const out = [];
    if (b.allow_mode) out.push('<span class="pill violet">Allow list</span>');
    if (b.block_all_internet) out.push('<span class="pill bad">All internet</span>');
    if (b.force_close) out.push('<span class="pill warn">Force close</span>');
    if (b.pomodoro_phase) out.push(`<span class="pill">◉ ${H.esc(b.pomodoro_phase)}</span>`);
    if (b.schedule_kind && b.schedule_kind !== 'always')
      out.push(`<span class="pill">${H.esc(b.schedule_kind)}</span>`);
    return out.join('');
  }

  function rulesTable(b) {
    const rules = b.rules || [];
    if (!rules.length)
      return `<div class="empty-inline">No rules yet — add the first below.</div>`;
    return `
      <table class="tbl rules-tbl">
        <thead><tr><th style="width:150px">Kind</th><th>Value</th>
          <th style="width:90px">Mode</th><th style="width:44px"></th></tr></thead>
        <tbody>${rules.map(r => `
          <tr>
            <td><span class="kind-badge k-${H.esc(r.kind)}">${H.esc(r.kind)}</span></td>
            <td class="mono val">${H.esc(r.value)}</td>
            <td>${r.negated
              ? '<span class="pill violet">except</span>'
              : '<span class="pill">block</span>'}</td>
            <td><button class="row-x" data-rm="${H.esc(r.value)}" title="Remove">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function exceptionsCard(b) {
    const ex = (b.rules || []).filter(r => r.negated);
    return `
      <div class="card">
        <h3>Exceptions</h3>
        ${ex.length
          ? `<div class="ex-list">${ex.map(r => `
              <span class="ex-chip" title="${H.esc(r.kind)}">
                <span class="mono">${H.esc(r.value)}</span>
                <button class="row-x" data-rm="${H.esc(r.value)}" title="Remove">✕</button>
              </span>`).join('')}</div>`
          : `<div class="empty-inline">Nothing exempted — rules apply without exceptions.</div>`}
        <div class="add-row">
          <input class="field" id="ex-value" placeholder="Allow this anyway — e.g. docs.google.com">
          <button class="btn sm" id="ex-add">Add</button>
        </div>
      </div>`;
  }

  function lockCard(b) {
    const locked = !!H.lockLabel(b.lock);
    return `
      <div class="card">
        <h3>Lock</h3>
        <div class="lock-row">
          ${lockPill(b)}
          <span class="grow"></span>
          ${locked ? '<button class="btn ghost sm" id="lock-unlock">Unlock</button>' : ''}
          <button class="btn sm" id="lock-set">${locked ? 'Change lock' : 'Set lock'}</button>
        </div>
        <div class="faint lock-hint">Locks stop you from editing or disabling this list while it runs.</div>
      </div>`;
  }

  function breaksCard(b) {
    const onBreak = b.break_until && b.break_until > now();
    const allow = b.allowance_seconds
      ? `<div class="allowance">
           <div class="allowance-top">
             <span class="gstatus-label">Daily allowance</span>
             <span class="mut mono"><b>${H.fmtDur(b.allowance_remaining || 0)}</b> of ${H.fmtDur(b.allowance_seconds)} left</span>
           </div>
           <div class="allowance-bar">
             <div class="allowance-fill" style="width:${Math.max(0, Math.min(100,
               100 * (b.allowance_remaining || 0) / b.allowance_seconds))}%"></div>
           </div>
         </div>`
      : '';
    return `
      <div class="card">
        <h3>Breaks</h3>
        ${onBreak ? `
          <div class="break-live">
            <span class="pill on">On break</span>
            <span class="mut">ends in <b data-until="${b.break_until}">${H.fmtCountdown(b.break_until)}</b></span>
            <span class="grow"></span>
            <button class="btn sm danger" id="br-end">End break</button>
          </div>` : `
          <div class="break-btns">
            <button class="btn ghost sm" id="br-delay">⏱ Delay break</button>
            <button class="btn ghost sm" id="br-random">✱ Random text break</button>
            <button class="btn ghost sm" id="br-cause">❆ Cause break</button>
          </div>
          <div class="faint break-hint">Delay: unlocks after a 60s wait · Random: type a generated string · Cause: break for a reason.</div>`}
        ${allow}
      </div>`;
  }

  function detail(b, paused) {
    if (!b) return `
      <div class="detail-empty">
        <div class="empty-ico">■</div>
        <div class="empty-title">No list selected</div>
        <div class="mut">Pick a list on the left, or create one.</div>
      </div>`;
    const st = statusOf(b, paused);
    const running = !!b.active;
    return `
      <div class="detail-head">
        <div class="detail-title">
          <h2>${H.esc(b.name)}</h2>
          <div class="detail-pills">
            <span class="pill ${st.cls}">${st.label}</span>
            ${badges(b)}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn ${running ? 'ghost' : 'primary'} sm" id="d-toggle">${running ? 'Stop' : 'Start'}</button>
          <button class="btn danger sm" id="d-delete">Delete</button>
        </div>
      </div>

      <div class="card">
        <h3>Rules</h3>
        ${rulesTable(b)}
        <div class="add-row">
          <select class="sel" id="rule-kind">${RULE_KINDS.map(([k, l]) =>
            `<option value="${k}">${l}</option>`).join('')}</select>
          <input class="field grow" id="rule-value" placeholder="${H.esc(KIND_HINT.domain)}">
          <button class="btn sm" id="rule-add">Add rule</button>
        </div>
      </div>

      ${exceptionsCard(b)}
      ${lockCard(b)}
      ${breaksCard(b)}`;
  }

  /* ================= modals ================= */

  function modalNewList() {
    const m = H.modal(`
      <h2>New block list</h2>
      <input class="field" id="nl-name" placeholder="List name — e.g. Social media" style="width:100%">
      <div class="row">
        <button class="btn ghost sm" data-x>Cancel</button>
        <button class="btn primary sm" id="nl-create">Create</button>
      </div>`);
    const input = m.root.querySelector('#nl-name');
    input.focus();
    m.root.querySelector('[data-x]').addEventListener('click', m.close);
    const go = () => {
      const v = input.value.trim();
      if (!v) { H.toast('Name required', 'err'); return; }
      m.close();
      H.call('add-block', { name: v }, 'List created').then(() => {
        selected = v;
        const el = document.getElementById('page-blocks');
        if (el && latestState) render(el, latestState);
      });
    };
    m.root.querySelector('#nl-create').addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function modalDelete(b) {
    const m = H.modal(`
      <h2>Delete “${H.esc(b.name)}”?</h2>
      <p class="mut">${(b.rules || []).length} rule${(b.rules || []).length === 1 ? '' : 's'} will be removed. This can't be undone.</p>
      <div class="row">
        <button class="btn ghost sm" data-x>Cancel</button>
        <button class="btn danger sm" id="del-ok">Delete list</button>
      </div>`);
    m.root.querySelector('[data-x]').addEventListener('click', m.close);
    m.root.querySelector('#del-ok').addEventListener('click', () => {
      m.close();
      H.call('remove-block', { name: b.name }, 'List deleted')
        .then(() => { if (selected === b.name) selected = null; });
    });
  }

  function lockArgs(kind) {
    switch (kind) {
      case 'timer': return `
        <div class="lk-args"><label>Locked for</label>
          <input class="field" id="lk-min" type="number" min="1" value="60" style="width:110px">
          <span class="mut">minutes</span></div>`;
      case 'range': return `
        <div class="lk-args"><label>Allow editing</label>
          <input class="field" id="lk-start" type="time" value="18:00">
          <span class="mut">to</span>
          <input class="field" id="lk-end" type="time" value="20:00"></div>`;
      case 'password': return `
        <div class="lk-args"><label>Password</label>
          <input class="field" id="lk-pass" type="password" placeholder="choose a password" style="flex:1"></div>`;
      case 'random': return `
        <div class="lk-args"><label>Text length</label>
          <input class="field" id="lk-len" type="number" min="8" value="60" style="width:110px">
          <label class="lk-check"><input type="checkbox" id="lk-perfect"> perfect typing required</label></div>`;
      case 'allowance': return `
        <div class="lk-args"><label>Daily budget</label>
          <input class="field" id="lk-allow" type="number" min="1" value="30" style="width:110px">
          <span class="mut">minutes / day</span></div>`;
      case 'enforced': return `<div class="lk-warn">Enforced locks cannot be removed — not even by you.</div>`;
      case 'frozen': return `<div class="lk-warn">Locked for as long as Frozen mode runs.</div>`;
      case 'restart': return `<div class="lk-warn">Unlocking requires a full PC restart.</div>`;
      default: return '';
    }
  }

  function buildLock(kind) {
    switch (kind) {
      case 'timer': {
        const min = Math.max(1, +document.getElementById('lk-min').value || 0);
        return { type: 'timer', until: now() + min * 60 };
      }
      case 'range': return {
        type: 'range',
        start_hm: document.getElementById('lk-start').value,
        end_hm: document.getElementById('lk-end').value,
      };
      case 'password': {
        const pw = document.getElementById('lk-pass').value;
        if (!pw) return null;
        return { type: 'password', password: pw };
      }
      case 'random': return {
        type: 'random',
        len: Math.max(8, +document.getElementById('lk-len').value || 60),
        perfect: document.getElementById('lk-perfect').checked,
      };
      case 'allowance': {
        const min = Math.max(1, +document.getElementById('lk-allow').value || 0);
        return { type: 'allowance', seconds: min * 60 };
      }
      default: return { type: kind };
    }
  }

  function modalLock(b) {
    let kind = b.lock && b.lock.type !== 'none' ? b.lock.type : 'timer';
    if (kind === 'random_text') kind = 'random';
    const m = H.modal(`
      <h2>Lock “${H.esc(b.name)}”</h2>
      <div class="lk-list">${LOCK_KINDS.map(([k, label, hint]) => `
        <button class="lk-kind ${k === kind ? 'sel' : ''}" data-k="${k}">
          <span class="lk-ico">${lockGlyph(k)}</span>
          <span class="lk-body"><b>${label}</b><span class="faint">${hint}</span></span>
        </button>`).join('')}</div>
      <div id="lk-args">${lockArgs(kind)}</div>
      <div class="row">
        <button class="btn ghost sm" data-x>Cancel</button>
        <button class="btn primary sm" id="lk-apply">Apply lock</button>
      </div>`);
    m.root.querySelectorAll('.lk-kind').forEach(btn =>
      btn.addEventListener('click', () => {
        kind = btn.dataset.k;
        m.root.querySelectorAll('.lk-kind').forEach(x => x.classList.toggle('sel', x === btn));
        m.root.querySelector('#lk-args').innerHTML = lockArgs(kind);
      }));
    m.root.querySelector('[data-x]').addEventListener('click', m.close);
    m.root.querySelector('#lk-apply').addEventListener('click', () => {
      const lock = buildLock(kind);
      if (!lock) { H.toast('Fill in the lock options', 'err'); return; }
      m.close();
      H.call('lock', { block: b.name, lock }, kind === 'none' ? 'Lock removed' : 'Lock applied');
    });
  }

  function modalUnlock(b) {
    const needsCred = ['password', 'random_text', 'random', 'range', 'timer', 'restart', 'allowance', 'frozen']
      .includes(b.lock && b.lock.type);
    const m = H.modal(`
      <h2>Unlock “${H.esc(b.name)}”</h2>
      ${needsCred ? `
        <input class="field" id="ul-cred" type="password" placeholder="Credential" style="width:100%">`
        : `<p class="mut">This lock opens without a credential.</p>`}
      <div class="row">
        <button class="btn ghost sm" data-x>Cancel</button>
        <button class="btn primary sm" id="ul-go">Unlock</button>
      </div>
      <div id="ul-result"></div>`);
    m.root.querySelector('[data-x]').addEventListener('click', m.close);
    const cred = m.root.querySelector('#ul-cred');
    if (cred) cred.focus();
    const go = () => {
      H.call('unlock', { name: b.name, credential: cred ? cred.value : '' })
        .then(r => {
          const res = m.root.querySelector('#ul-result');
          if (res && r && r.token)
            res.innerHTML = `<div class="ul-token">Unlocked — token <b class="mono">${H.esc(r.token)}</b> valid for ~5 min.</div>`;
          else m.close();
        })
        .catch(() => {});
    };
    m.root.querySelector('#ul-go').addEventListener('click', go);
    if (cred) cred.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function modalCauseBreak(b) {
    const m = H.modal(`
      <h2>Break for a reason</h2>
      <input class="field" id="cb-reason" placeholder="Why do you need this? — e.g. homework research" style="width:100%">
      <div class="row">
        <button class="btn ghost sm" data-x>Cancel</button>
        <button class="btn primary sm" id="cb-go">Start break</button>
      </div>`);
    const input = m.root.querySelector('#cb-reason');
    input.focus();
    m.root.querySelector('[data-x]').addEventListener('click', m.close);
    const go = () => {
      const v = input.value.trim();
      if (!v) { H.toast('Give a reason', 'err'); return; }
      m.close();
      H.call('start-cause-break', { name: b.name, reason: v }, 'Break started');
    };
    m.root.querySelector('#cb-go').addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function modalRandomBreak(b) {
    H.call('start-random-break', { name: b.name, duration_m: 5, len: 60 }, 'Challenge issued')
      .then(r => {
        if (!r || !r.text) return;
        const m = H.modal(`
          <h2>Type the text to unlock a ${H.fmtDur(r.duration_s || 300)} break</h2>
          <div class="rb-text mono">${H.esc(r.text)}</div>
          <input class="field" id="rb-in" placeholder="type it exactly" style="width:100%" autocomplete="off">
          <div class="row">
            <button class="btn ghost sm" data-x>Cancel</button>
            <button class="btn primary sm" id="rb-go">Confirm break</button>
          </div>`);
        const input = m.root.querySelector('#rb-in');
        input.focus();
        m.root.querySelector('[data-x]').addEventListener('click', m.close);
        const go = () => {
          H.call('complete-break', { challenge: r.challenge, text: input.value }, 'Break started')
            .then(() => m.close())
            .catch(() => input.classList.add('shake'));
        };
        m.root.querySelector('#rb-go').addEventListener('click', go);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      })
      .catch(() => {});
  }

  /* ================= wire events after each render ================= */

  function wire(el, state) {
    const b = find(state);
    if (!b) return;

    const t = el.querySelector('#d-toggle');
    if (t) t.addEventListener('click', () =>
      H.call(b.active ? 'stop' : 'start', { name: b.name }));
    const del = el.querySelector('#d-delete');
    if (del) del.addEventListener('click', () => modalDelete(b));

    const kindSel = el.querySelector('#rule-kind');
    const valIn = el.querySelector('#rule-value');
    if (kindSel && valIn)
      kindSel.addEventListener('change', () => {
        valIn.placeholder = KIND_HINT[kindSel.value] || 'value';
        valIn.focus();
      });
    const addBtn = el.querySelector('#rule-add');
    if (addBtn) {
      const add = () => {
        const v = valIn.value.trim();
        if (!v) { H.toast('Value required', 'err'); return; }
        H.call('add-rule', { block: b.name, kind: kindSel.value, value: v, negated: false }, 'Rule added');
        valIn.value = '';
      };
      addBtn.addEventListener('click', add);
      valIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    }
    const exIn = el.querySelector('#ex-value');
    const exBtn = el.querySelector('#ex-add');
    if (exBtn) {
      const add = () => {
        const v = exIn.value.trim();
        if (!v) { H.toast('Value required', 'err'); return; }
        H.call('add-exception', { block: b.name, value: v }, 'Exception added');
        exIn.value = '';
      };
      exBtn.addEventListener('click', add);
      exIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    }
    el.querySelectorAll('[data-rm]').forEach(x =>
      x.addEventListener('click', () =>
        H.call('remove-rule', { block: b.name, value: x.dataset.rm }, 'Removed')));

    const ls = el.querySelector('#lock-set');
    if (ls) ls.addEventListener('click', () => modalLock(b));
    const lu = el.querySelector('#lock-unlock');
    if (lu) lu.addEventListener('click', () => modalUnlock(b));

    const bd = el.querySelector('#br-delay');
    if (bd) bd.addEventListener('click', () =>
      H.call('start-delay-break', { name: b.name, wait_s: 60, duration_m: 5 }, 'Delay break armed'));
    const br = el.querySelector('#br-random');
    if (br) br.addEventListener('click', () => modalRandomBreak(b));
    const bc = el.querySelector('#br-cause');
    if (bc) bc.addEventListener('click', () => modalCauseBreak(b));
    const be = el.querySelector('#br-end');
    if (be) be.addEventListener('click', () =>
      H.call('end-break', { name: b.name }, 'Break ended'));
  }

  function renderDetail(el, state) {
    const pane = el.querySelector('#blocks-detail');
    if (pane) pane.innerHTML = detail(find(state), state.flags.paused);
    wire(el, state);
    tick(el);
  }

  function render(el, state) {
    const paused = !!state.flags.paused;
    if (selected && !state.blocks.some(b => b.name === selected)) selected = null;
    if (!selected && state.blocks.length) selected = state.blocks[0].name;

    const rail = el.querySelector('#blocks-rail .rail-list');
    if (rail) rail.innerHTML = state.blocks.map(b => railItem(b, paused)).join('')
      || `<div class="empty-inline" style="padding:18px 6px">No lists yet.</div>`;
    renderDetail(el, state);
  }

  function tick(el) {
    if (!latestState || !el.isConnected) return;
    el.querySelectorAll('[data-until]').forEach(n => {
      n.textContent = H.fmtCountdown(+n.dataset.until);
    });
  }

  Pages.register('blocks', {
    title: 'Blocks',
    sub: 'Lists, rules, locks and breaks',
    mount(el) {
      el.innerHTML = `
        <div class="blocks-layout">
          <div id="blocks-rail">
            <div class="rail-head">
              <h3 class="card-title">Block lists</h3>
              <button class="btn primary sm" id="new-list">+ New list</button>
            </div>
            <div class="rail-list"></div>
          </div>
          <div id="blocks-detail"></div>
        </div>`;
      el.querySelector('#new-list').addEventListener('click', modalNewList);
      // Delegated selection — rail rows are re-rendered on every state push.
      el.querySelector('.rail-list').addEventListener('click', e => {
        const item = e.target.closest('.bl-item');
        if (!item) return;
        selected = item.dataset.name;
        el.querySelectorAll('.bl-item').forEach(x => x.classList.toggle('sel', x === item));
        if (latestState) renderDetail(el, latestState);
      });
      if (!ticker) ticker = setInterval(() => {
        const page = document.getElementById('page-blocks');
        if (page) tick(page);
      }, 1000);
    },
    update(el, state) {
      latestState = state;
      render(el, state);
    },
  });
})();
