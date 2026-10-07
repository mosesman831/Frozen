/* Focus page — Frozen mode + Pomodoro cockpit. */
(() => {
  const PHASES = { work: 'Work', break: 'Break', long_break: 'Long break', paused: 'Paused', off: 'Off' };
  const PRESETS = [
    { id: 'classic', label: 'Classic', hint: '25 / 5' },
    { id: 'long', label: 'Long', hint: '50 / 10' },
    { id: 'sprint', label: 'Sprint', hint: '15 / 3' },
  ];

  let preset = 'classic';
  let lastState = null;
  let root = null;
  let ticker = null;
  let pomoSnapshot = { rem: 0, at: 0 }; // local ticking between state pushes

  const q = sel => root.querySelector(sel);
  const now = () => Math.floor(Date.now() / 1000);

  /* ---------- actions ---------- */

  function copyText(text) {
    const done = () => H.toast('Copied to clipboard', 'ok');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { H.toast('Copy failed — select the text manually', 'err'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function showGeneratedModal(text) {
    const m = H.modal(`
      <h2>Recovery phrase</h2>
      <p class="mut" style="font-size:13px">This phrase ends Frozen mode early. It is shown <b>once</b> —
      store it somewhere you cannot reach while frozen.</p>
      <div class="gen-text mono num">${H.esc(text)}</div>
      <div class="row">
        <button class="btn ghost" data-x="copy">Copy</button>
        <button class="btn primary" data-x="done">I saved it</button>
      </div>`);
    m.root.querySelector('[data-x=copy]').onclick = () => copyText(text);
    m.root.querySelector('[data-x=done]').onclick = () => m.close();
  }

  function credentialModal() {
    const m = H.modal(`
      <h2>End Frozen mode</h2>
      <p class="mut" style="font-size:13px">Enter the lock credential — your password, or the
      recovery phrase that was shown when Frozen started.</p>
      <input class="field" data-x="cred" type="password" placeholder="Password or recovery phrase"
             autocomplete="off" style="width:100%;margin-top:12px">
      <div class="row">
        <button class="btn ghost" data-x="cancel">Cancel</button>
        <button class="btn danger" data-x="end">End early</button>
      </div>`);
    const input = m.root.querySelector('[data-x=cred]');
    const submit = () => {
      const cred = input.value.trim();
      if (!cred) { input.focus(); return; }
      H.call('frozen-stop', { credential: cred })
        .then(() => { m.close(); H.toast('Frozen mode ended', 'ok'); })
        .catch(() => { input.select(); });
    };
    m.root.querySelector('[data-x=end]').onclick = submit;
    m.root.querySelector('[data-x=cancel]').onclick = () => m.close();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 30);
  }

  function startFrozen() {
    const mins = parseFloat(q('#frz-mins').value);
    if (!mins || mins <= 0) { H.toast('Enter a duration in minutes', 'err'); q('#frz-mins').focus(); return; }
    const kind = q('#frz-lock').value;
    let lock = { type: 'none' };
    if (kind === 'password') {
      const pw = q('#frz-cred').value;
      if (!pw) { H.toast('Set a lock password', 'err'); q('#frz-cred').focus(); return; }
      lock = { type: 'password', password: pw };
    } else if (kind === 'random') {
      const len = parseInt(q('#frz-cred').value, 10);
      if (!len || len < 4) { H.toast('Phrase length must be at least 4', 'err'); q('#frz-cred').focus(); return; }
      lock = { type: 'random', len };
    }
    H.call('frozen-start', { for_s: Math.round(mins * 60), lock })
      .then(reply => {
        if (reply && reply.generated) showGeneratedModal(reply.generated);
      })
      .catch(() => {});
  }

  function endFrozen() {
    const locked = lastState && lastState.flags && lastState.flags.frozen_locked;
    if (locked) { credentialModal(); return; }
    H.call('frozen-stop', {}).then(() => H.toast('Frozen mode ended', 'ok')).catch(() => {});
  }

  function pomo(action) {
    const params = { action };
    if (action === 'start') params.preset = preset;
    H.call('pomodoro', params).catch(() => {});
  }

  /* ---------- render ---------- */

  function updateFrozen(flags) {
    const until = flags.frozen_until || 0;
    const frozen = until > now();
    const pill = q('#frz-pill');
    const big = q('#frz-big');
    const sub = q('#frz-sub');
    const form = q('#frz-form');
    const endWrap = q('#frz-end');

    if (frozen) {
      pill.className = 'pill grad-fill';
      pill.textContent = 'Frozen';
      big.textContent = H.fmtCountdown(until);
      const lockTxt = flags.frozen_locked ? 'Locked — credential required to end early' : 'No lock — you can end early';
      sub.innerHTML = `${H.esc(lockTxt)} · until <span class="num">${H.fmtClock(until)}</span>`;
      form.style.display = 'none';
      endWrap.style.display = '';
    } else {
      pill.className = 'pill';
      pill.textContent = 'Standby';
      const mins = Math.max(0, parseFloat(q('#frz-mins').value) || 0);
      big.innerHTML = `<span class="faint">${mins ? H.fmtCountdown(now() + mins * 60) : '--:--'}</span>`;
      sub.textContent = 'Whole-computer lockout. Nothing runs, nothing opens.';
      form.style.display = '';
      endWrap.style.display = 'none';
    }
  }

  function updatePomo(flags) {
    const phase = flags.pomodoro_phase || 'off';
    const big = q('#pm-big');
    const phaseEl = q('#pm-phase');
    const live = phase === 'work' || phase === 'break' || phase === 'long_break' || phase === 'paused';

    phaseEl.className = 'pm-phase ' + (live ? 'grad-text' : 'faint');
    phaseEl.textContent = PHASES[phase] || phase;
    phaseEl.dataset.phase = phase;

    if (phase === 'paused') {
      // flags give remaining; keep it frozen while paused
      pomoSnapshot = { rem: flags.pomodoro_remaining_s || 0, at: Date.now(), paused: true };
    } else {
      pomoSnapshot = { rem: flags.pomodoro_remaining_s || 0, at: Date.now(), paused: false };
    }
    renderPomoClock();

    q('#pm-start').disabled = phase !== 'off';
    q('#pm-skip').disabled = !(phase === 'work' || phase === 'break' || phase === 'long_break');
    q('#pm-pause').disabled = !(phase === 'work' || phase === 'break' || phase === 'long_break');
    q('#pm-resume').disabled = phase !== 'paused';
    q('#pm-stop').disabled = phase === 'off';
    q('#pm-pause').style.display = phase === 'paused' ? 'none' : '';
    q('#pm-resume').style.display = phase === 'paused' ? '' : 'none';

    root.querySelectorAll('.chip').forEach(c => {
      c.disabled = phase !== 'off';
      c.classList.toggle('sel', c.dataset.p === preset);
    });
  }

  function renderPomoClock() {
    const el = q('#pm-big');
    if (!el) return;
    const phase = q('#pm-phase').dataset.phase || 'off';
    if (phase === 'off') {
      const mins = { classic: 25, long: 50, sprint: 15 }[preset] || 25;
      el.innerHTML = `<span class="faint">${String(mins).padStart(2, '0')}:00</span>`;
      return;
    }
    let rem = pomoSnapshot.rem;
    if (!pomoSnapshot.paused) rem = Math.max(0, rem - (Date.now() - pomoSnapshot.at) / 1000);
    const s = Math.round(rem);
    const m = Math.floor(s / 60), ss = s % 60;
    el.textContent = String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  function updateBound(blocks) {
    const tb = q('#bound-rows');
    const bound = (blocks || []).filter(b => b.pomodoro_phase != null);
    if (!bound.length) {
      tb.innerHTML = `<tr><td colspan="4" class="empty-cell"><span class="glyph">◆</span>No lists bound to a phase</td></tr>`;
      q('#bound-count').textContent = '';
      return;
    }
    q('#bound-count').textContent = bound.length + ' bound';
    tb.innerHTML = bound.map(b => `
      <tr>
        <td class="bname">${H.esc(b.name)}</td>
        <td><span class="pill ${b.pomodoro_phase === 'work' ? 'violet' : 'plain'}">${H.esc(b.pomodoro_phase.replace('_', ' '))}</span></td>
        <td><span class="pill ${b.enabled ? 'on' : ''}">${b.enabled ? 'enabled' : 'off'}</span></td>
        <td class="mut">${H.esc(H.lockLabel(b.lock))}</td>
      </tr>`).join('');
  }

  /* ---------- registration ---------- */

  Pages.register('focus', {
    title: 'Focus',
    sub: 'Frozen mode lockout and pomodoro session control',

    mount(el) {
      root = el;
      el.innerHTML = `
        <div class="focus-heroes">
          <div class="card hero frozen-hero">
            <h3>Frozen mode</h3>
            <div class="hero-top">
              <div>
                <div class="hero-big num" id="frz-big"><span class="faint" style="font-weight:600">—</span></div>
                <div class="hero-sub mut" id="frz-sub">Whole-computer lockout. Nothing runs, nothing opens.</div>
              </div>
              <span class="pill" id="frz-pill">Standby</span>
            </div>
            <div class="hero-form" id="frz-form">
              <label class="ctl">
                <span class="lbl">Duration</span>
                <span class="in-wrap"><input class="field num" id="frz-mins" type="number" min="1" step="1" value="45"><span class="unit">min</span></span>
              </label>
              <label class="ctl">
                <span class="lbl">Lock</span>
                <select class="sel" id="frz-lock">
                  <option value="none">No lock — can end early</option>
                  <option value="password">Password</option>
                  <option value="random">Random phrase</option>
                </select>
              </label>
              <label class="ctl" id="frz-cred-wrap" style="display:none">
                <span class="lbl" id="frz-cred-lbl">Credential</span>
                <input class="field" id="frz-cred" type="text">
              </label>
              <button class="btn primary hero-btn" id="frz-start">Start Frozen</button>
            </div>
            <div class="hero-end" id="frz-end" style="display:none">
              <button class="btn danger" id="frz-endbtn">End early</button>
            </div>
          </div>

          <div class="card hero pomo-hero">
            <h3>Pomodoro</h3>
            <div class="hero-top">
              <div>
                <div class="hero-big num" id="pm-big"><span class="faint">--:--</span></div>
                <div class="pm-phase faint" id="pm-phase" data-phase="off">Off</div>
              </div>
            </div>
            <div class="chip-row" id="pm-chips">
              ${PRESETS.map(p => `<button class="chip" data-p="${p.id}">${p.label}<span class="chip-hint">${p.hint}</span></button>`).join('')}
            </div>
            <div class="btn-row">
              <button class="btn violet" id="pm-start">Start</button>
              <button class="btn" id="pm-skip">Skip</button>
              <button class="btn" id="pm-pause">Pause</button>
              <button class="btn" id="pm-resume" style="display:none">Resume</button>
              <button class="btn ghost" id="pm-stop">Stop</button>
            </div>
          </div>
        </div>

        <div class="card bound-card">
          <h3>Phase-bound lists <span class="faint" id="bound-count" style="float:right;letter-spacing:0;text-transform:none;font-size:12px"></span></h3>
          <table class="tbl">
            <thead><tr><th>List</th><th>Bound phase</th><th>State</th><th>Unlock</th></tr></thead>
            <tbody id="bound-rows"></tbody>
          </table>
        </div>`;

      q('#frz-lock').addEventListener('change', e => {
        const k = e.target.value;
        const wrap = q('#frz-cred-wrap');
        const lbl = q('#frz-cred-lbl');
        const inp = q('#frz-cred');
        if (k === 'none') { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        if (k === 'password') {
          lbl.textContent = 'Lock password';
          inp.type = 'password';
          inp.placeholder = 'Needed to end Frozen early';
        } else {
          lbl.textContent = 'Phrase length';
          inp.type = 'number';
          inp.min = 4; inp.max = 64;
          if (!inp.value || isNaN(parseInt(inp.value, 10))) inp.value = 24;
          inp.placeholder = 'chars';
        }
      });
      q('#frz-start').addEventListener('click', startFrozen);
      q('#frz-endbtn').addEventListener('click', endFrozen);

      q('#pm-chips').addEventListener('click', e => {
        const c = e.target.closest('.chip');
        if (c && !c.disabled) { preset = c.dataset.p; if (lastState) updatePomo(lastState.flags || {}); }
      });
      q('#pm-start').addEventListener('click', () => pomo('start'));
      q('#pm-skip').addEventListener('click', () => pomo('skip'));
      q('#pm-pause').addEventListener('click', () => pomo('pause'));
      q('#pm-resume').addEventListener('click', () => pomo('resume'));
      q('#pm-stop').addEventListener('click', () => pomo('stop'));

      if (!ticker) ticker = setInterval(() => {
        if (!root || !root.isConnected) return;
        renderPomoClock();
        const f = lastState && lastState.flags;
        if (f && f.frozen_until > now()) {
          const big = q('#frz-big');
          if (big) big.textContent = H.fmtCountdown(f.frozen_until);
        }
      }, 500);
    },

    update(a, b) {
      // shell calls update(state) or update(el, state) depending on version
      const state = b === undefined ? a : b;
      if (!state) return;
      lastState = state;
      const flags = state.flags || {};
      updateFrozen(flags);
      updatePomo(flags);
      updateBound(state.blocks);
    },
  });
})();
