/* Bridge — single seam between the UI and the backend.
   Real app: Tauri `rpc` command + `state`/`status` events.
   Browser preview: FrozenMock (mock.js). Pages only ever call window.Frozen. */
(function () {
  const listeners = { state: [], status: [] };
  const last = {};        // replay-subject: late subscribers get the last value
  let invoke;

  const isTauri = typeof window.__TAURI__ !== 'undefined' && !!window.__TAURI__.core;
  if (isTauri) {
    const core = window.__TAURI__.core;
    invoke = (method, params) => core.invoke('rpc', { method, params: params || {} });
    // primary channel: poll the bridge's snapshot — event.listen proved
    // unreliable on this WebView2 runtime, and snapshot rides the same
    // proven invoke path. dedupe by rev/conn so unchanged pushes are cheap.
    let lastRev = -1, lastConn = null, lastDetail = null;
    const poll = () => core.invoke('snapshot').then(s => {
      if (!s) return;
      const st = s.status || {};
      const conn = st.connected, det = st.detail;
      if (conn !== lastConn || det !== lastDetail) {
        lastConn = conn; lastDetail = det; emit('status', st);
      }
      const rev = s.state && s.state.rev;
      if (rev !== undefined && rev !== lastRev) { lastRev = rev; emit('state', s.state); }
    }).catch(() => {
      if (lastConn !== false) {
        lastConn = false; lastDetail = 'bridge lost';
        emit('status', { connected: false, detail: 'bridge lost' });
      }
    });
    poll();
    setInterval(poll, 800);
    // opportunistic fast path — if Tauri events do arrive, UI updates instantly
    try {
      window.__TAURI__.event.listen('state', e => emit('state', e.payload));
      window.__TAURI__.event.listen('status', e => emit('status', e.payload));
    } catch (e) {}
  } else if (window.FrozenMock) {
    invoke = (m, p) => window.FrozenMock.invoke(m, p);
    window.FrozenMock.onState(d => emit('state', d));
    window.FrozenMock.onStatus(d => emit('status', d));
  } else {
    invoke = () => Promise.reject(new Error('no backend'));
  }

  function emit(kind, data) {
    last[kind] = data;
    for (const f of listeners[kind]) {
      try { f(data); } catch (e) { console.error(e); }
    }
  }

  window.Frozen = {
    invoke,
    onState: f => {
      listeners.state.push(f);
      if (last.state !== undefined) { try { f(last.state); } catch (e) { console.error(e); } }
    },
    onStatus: f => {
      listeners.status.push(f);
      if (last.status !== undefined) { try { f(last.status); } catch (e) { console.error(e); } }
    },
    isMock: !isTauri,
  };
})();
