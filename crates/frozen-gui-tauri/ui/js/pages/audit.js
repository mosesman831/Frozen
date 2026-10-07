/* Audit page — service event log with live filter. */
(() => {
  let root = null;
  let entries = [];
  let loading = false;

  const q = sel => root.querySelector(sel);
  const ACTOR_CLASS = { svc: 'violet', gui: 'pink', ext: 'blue' };

  function daySuffix(ts) {
    const d = new Date(ts * 1000), t = new Date();
    const sameDay = d.toDateString() === t.toDateString();
    if (sameDay) return '';
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return ' · yday';
    return ' · ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function render() {
    const filter = (q('#au-filter').value || '').trim().toLowerCase();
    const rows = entries.filter(e => !filter ||
      (e.actor + ' ' + e.action + ' ' + e.detail).toLowerCase().includes(filter));

    q('#au-body').innerHTML = rows.length
      ? rows.slice(0, 300).map(e => `<tr>
          <td class="num mut" style="white-space:nowrap">${H.fmtClock(e.ts)}<span class="faint">${H.esc(daySuffix(e.ts))}</span></td>
          <td><span class="pill actor ${ACTOR_CLASS[e.actor] || ''}">${H.esc(e.actor)}</span></td>
          <td class="mono" style="font-size:12.5px">${H.esc(e.action)}</td>
          <td class="mut">${H.esc(e.detail)}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="empty-cell"><span class="glyph">◆</span>${entries.length ? 'No matching entries' : 'No audit entries yet'}</td></tr>`;

    q('#au-count').textContent = filter
      ? `${rows.length} of ${entries.length}`
      : `${entries.length} entries`;
  }

  function fetchAudit() {
    if (loading) return;
    loading = true;
    const btn = q('#au-refresh');
    if (btn) btn.disabled = true;
    Frozen.invoke('audit', { last: 300 })
      .then(r => {
        entries = (r && r.audit ? r.audit : []).slice().sort((a, b) => b.ts - a.ts);
        render();
      })
      .catch(e => H.toast(e && e.message ? e.message : String(e), 'err'))
      .finally(() => { loading = false; if (btn) btn.disabled = false; });
  }

  Pages.register('audit', {
    title: 'Audit',
    sub: 'Everything the service did, newest first',

    mount(el) {
      root = el;
      el.innerHTML = `
        <div class="card">
          <div class="audit-bar">
            <h3 style="margin:0">Event log <span class="card-sub" id="au-count"></span></h3>
            <div style="display:flex;gap:10px;align-items:center">
              <input class="field" id="au-filter" type="search" placeholder="Filter — actor, action, detail…" style="width:300px">
              <button class="btn sm" id="au-refresh">↻ Refresh</button>
            </div>
          </div>
          <table class="tbl">
            <thead><tr><th style="width:110px">Time</th><th style="width:80px">Actor</th><th style="width:220px">Action</th><th>Detail</th></tr></thead>
            <tbody id="au-body"><tr><td colspan="4" class="empty-cell"><span class="glyph">◆</span>No audit entries yet</td></tr></tbody>
          </table>
        </div>`;
      q('#au-refresh').addEventListener('click', fetchAudit);
      q('#au-filter').addEventListener('input', render);
      fetchAudit();
    },

    update() { /* fetched, not pushed */ },
  });
})();
