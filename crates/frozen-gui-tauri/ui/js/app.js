/* app.js — router, store, shared helpers.
   Page contract: each js/pages/*.js calls
     Pages.register('name', { title, sub, mount(el), update(state) })
   `mount` runs once; `update` runs on every BlockListInfo push. */
(function () {
  const registry = {};
  // adopt registrations made before app.js ran (page scripts self-ensure a
  // fallback Pages when they load first — merge their defs, don't wipe them)
  if (window.Pages && window.Pages.defs) Object.assign(registry, window.Pages.defs);
  window.Pages = {
    defs: registry,
    register(name, def) { registry[name] = def; },
  };

  window.App = {
    state: null,
    status: { connected: false, detail: '' },
    activePage: 'dashboard',
  };

  /* ---------- helpers ---------- */
  const H = window.H = {
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtDur(s) {
      s = Math.max(0, Math.floor(s || 0));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      if (h) return `${h}h ${m}m`;
      if (m) return `${m}m ${sec}s`;
      return `${sec}s`;
    },
    fmtClock(unix) {
      if (!unix) return '—';
      return new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    fmtCountdown(until) {
      const d = until - Math.floor(Date.now() / 1000);
      return d <= 0 ? 'ended' : H.fmtDur(d);
    },
    lockLabel(lock) {
      if (!lock || lock.type === 'none') return null;
      return lock.type.replace('_', ' ');
    },
    el(html) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      return t.content.firstElementChild;
    },
    toast(msg, kind) {
      const t = H.el(`<div class="toast ${kind || ''}">${H.esc(msg)}</div>`);
      document.getElementById('toast-root').appendChild(t);
      setTimeout(() => t.remove(), 4500);
    },
    call(method, params) {
      return window.Frozen.invoke(method, params || {})
        .then(r => { H.toast('ok', 'ok'); return r; })
        .catch(e => { H.toast(String(e.message || e), 'err'); throw e; });
    },
    modal(innerHtml) {
      const root = document.getElementById('modal-root');
      root.innerHTML = `<div class="modal">${innerHtml}</div>`;
      const close = () => { root.innerHTML = ''; };
      root.addEventListener('mousedown', e => { if (e.target === root) close(); });
      return { root: root.firstElementChild, close };
    },
  };

  /* ---------- router ---------- */
  function switchPage(name) {
    App.activePage = name;
    document.querySelectorAll('.nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.page === name));
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('active', p.id === 'page-' + name));
    const def = registry[name];
    document.getElementById('page-title').textContent = def && def.title || name;
    document.getElementById('page-sub').textContent = def && def.sub || '';
  }

  function boot() {
    document.querySelectorAll('.nav-item').forEach(b =>
      b.addEventListener('click', () => switchPage(b.dataset.page)));
    for (const [name, def] of Object.entries(registry)) {
      const el = document.getElementById('page-' + name);
      if (el && def.mount) def.mount(el);
    }
    switchPage(App.activePage);

    window.Frozen.onState(s => {
      App.state = s;
      for (const [name, def] of Object.entries(registry)) {
        if (def.update) {
          const el = document.getElementById('page-' + name);
          if (el) try { def.update(el, s); } catch (e) { console.error(name, e); }
        }
      }
    });
    window.Frozen.onStatus(st => {
      App.status = st;
      const dot = document.getElementById('conn-dot');
      dot.className = 'conn-dot ' + (st.connected ? 'on' : 'off');
      document.getElementById('conn-text').textContent =
        st.connected ? 'service connected' : (st.detail || 'offline');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
