/* Stats page — usage stats: top apps, top domains, blocked attempts. */
(() => {
  let root = null;
  let data = { apps: [], domains: [], blocked: [] };
  let loading = false;

  const q = sel => root.querySelector(sel);

  function fmtDay(d) {
    // d: 'YYYY-MM-DD'
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d + 'T00:00:00');
    const diff = Math.round((today - dd) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return dd.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  }

  function barCell(val, max, fmt) {
    const pct = max > 0 ? Math.max(2, (val / max) * 100) : 0;
    return `<td class="bar-cell"><span class="bar-fill" style="width:${pct}%"></span><span class="bar-val num">${fmt(val)}</span></td>`;
  }

  const emptyRow = cols => `<tr><td colspan="${cols}" class="empty-cell"><span class="glyph">◆</span>No data yet</td></tr>`;

  function renderApps() {
    const rows = (data.apps || []).slice().sort((a, b) => b.seconds - a.seconds).slice(0, 14);
    const max = Math.max(0, ...rows.map(r => r.seconds));
    const total = (data.apps || []).reduce((s, r) => s + r.seconds, 0);
    q('#apps-body').innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td class="bname">${H.esc(r.process)}</td>
          <td class="mut">${H.esc(fmtDay(r.day))}</td>
          ${barCell(r.seconds, max, H.fmtDur)}
        </tr>`).join('') +
        `<tr class="total-row"><td>Total</td><td></td><td class="bar-cell"><span class="bar-val num">${H.fmtDur(total)}</span></td></tr>`
      : emptyRow(3);
    q('#apps-sub').textContent = rows.length ? `${data.apps.length} rows · ${H.fmtDur(total)} tracked` : '';
  }

  function renderDomains() {
    const rows = (data.domains || []).slice().sort((a, b) => b.seconds - a.seconds).slice(0, 14);
    const max = Math.max(0, ...rows.map(r => r.seconds));
    const tSec = (data.domains || []).reduce((s, r) => s + r.seconds, 0);
    const tVis = (data.domains || []).reduce((s, r) => s + (r.visits || 0), 0);
    const tBlk = (data.domains || []).reduce((s, r) => s + (r.blocked || 0), 0);
    q('#dom-body').innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td class="bname">${H.esc(r.domain)}</td>
          <td class="mut">${H.esc(fmtDay(r.day))}</td>
          <td class="num mut">${r.visits || 0}</td>
          <td class="num">${r.blocked ? `<span class="pill warn plain">${r.blocked}</span>` : '<span class="faint">0</span>'}</td>
          ${barCell(r.seconds, max, H.fmtDur)}
        </tr>`).join('') +
        `<tr class="total-row"><td>Total</td><td></td><td class="num">${tVis}</td><td class="num">${tBlk}</td><td class="bar-cell"><span class="bar-val num">${H.fmtDur(tSec)}</span></td></tr>`
      : emptyRow(5);
    q('#dom-sub').textContent = rows.length ? `${tVis} visits · ${tBlk} blocks` : '';
  }

  function renderBlocked() {
    const rows = (data.blocked || []).slice().sort((a, b) => b.attempts - a.attempts).slice(0, 14);
    const max = Math.max(0, ...rows.map(r => r.attempts));
    const total = (data.blocked || []).reduce((s, r) => s + r.attempts, 0);
    q('#blk-body').innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td class="bname">${H.esc(r.target)}</td>
          <td><span class="pill ${r.kind === 'app' ? 'violet' : 'plain'}">${H.esc(r.kind)}</span></td>
          <td class="mut">${H.esc(fmtDay(r.day))}</td>
          ${barCell(r.attempts, max, v => v + '×')}
        </tr>`).join('') +
        `<tr class="total-row"><td>Total</td><td></td><td></td><td class="bar-cell"><span class="bar-val num">${total}×</span></td></tr>`
      : emptyRow(4);
    q('#blk-sub').textContent = rows.length ? `${total} attempts blocked` : '';
  }

  function render() { renderApps(); renderDomains(); renderBlocked(); }

  function fetchStats() {
    if (loading) return;
    loading = true;
    const btn = q('#st-refresh');
    if (btn) btn.disabled = true;
    Frozen.invoke('stats', { days: 7 })
      .then(r => { data = r || {}; render(); })
      .catch(e => H.toast(e && e.message ? e.message : String(e), 'err'))
      .finally(() => { loading = false; if (btn) btn.disabled = false; });
  }

  function clearStats() {
    const m = H.modal(`
      <h2>Clear statistics</h2>
      <p class="mut" style="font-size:13.5px">Delete all recorded app usage, domain stats and blocked-attempt
      history? This cannot be undone.</p>
      <div class="row">
        <button class="btn ghost" data-x="cancel">Cancel</button>
        <button class="btn danger" data-x="clear">Clear stats</button>
      </div>`);
    m.root.querySelector('[data-x=cancel]').onclick = () => m.close();
    m.root.querySelector('[data-x=clear]').onclick = () => {
      H.call('delete-stats', {})
        .then(() => { m.close(); H.toast('Statistics cleared', 'ok'); data = { apps: [], domains: [], blocked: [] }; render(); })
        .catch(() => {});
    };
  }

  Pages.register('stats', {
    title: 'Stats',
    sub: 'Where your time actually goes — last 7 days',

    mount(el) {
      root = el;
      el.innerHTML = `
        <div class="stats-toolbar">
          <div class="mut" style="font-size:13px">Tracked while blocking is on</div>
          <div style="display:flex;gap:10px">
            <button class="btn sm" id="st-refresh">↻ Refresh</button>
            <button class="btn sm danger" id="st-clear">Clear stats</button>
          </div>
        </div>
        <div class="card">
          <h3>Top apps <span class="card-sub" id="apps-sub"></span></h3>
          <table class="tbl">
            <thead><tr><th>Process</th><th>Day</th><th style="width:52%">Time</th></tr></thead>
            <tbody id="apps-body">${emptyRow(3)}</tbody>
          </table>
        </div>
        <div class="card">
          <h3>Top domains <span class="card-sub" id="dom-sub"></span></h3>
          <table class="tbl">
            <thead><tr><th>Domain</th><th>Day</th><th>Visits</th><th>Blocks</th><th style="width:42%">Time</th></tr></thead>
            <tbody id="dom-body">${emptyRow(5)}</tbody>
          </table>
        </div>
        <div class="card">
          <h3>Blocked attempts <span class="card-sub" id="blk-sub"></span></h3>
          <table class="tbl">
            <thead><tr><th>Target</th><th>Kind</th><th>Day</th><th style="width:52%">Attempts</th></tr></thead>
            <tbody id="blk-body">${emptyRow(4)}</tbody>
          </table>
        </div>`;
      q('#st-refresh').addEventListener('click', fetchStats);
      q('#st-clear').addEventListener('click', clearStats);
      fetchStats();
    },

    update() { /* stats are fetched, not pushed */ },
  });
})();
