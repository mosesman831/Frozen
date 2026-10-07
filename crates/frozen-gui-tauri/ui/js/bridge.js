/* Bridge — single seam between the UI and the backend.
   Real app: Tauri `rpc` command + `state`/`status` events.
   Browser preview: FrozenMock (mock.js). Pages only ever call window.Frozen. */
(function () {
  const listeners = { state: [], status: [] };
  let invoke;

  const isTauri = typeof window.__TAURI__ !== 'undefined' && !!window.__TAURI__.core;
  if (isTauri) {
    const core = window.__TAURI__.core;
    invoke = (method, params) => core.invoke('rpc', { method, params: params || {} });
    window.__TAURI__.event.listen('state', e => emit('state', e.payload));
    window.__TAURI__.event.listen('status', e => emit('status', e.payload));
  } else if (window.FrozenMock) {
    invoke = (m, p) => window.FrozenMock.invoke(m, p);
    window.FrozenMock.onState(d => emit('state', d));
    window.FrozenMock.onStatus(d => emit('status', d));
  } else {
    invoke = () => Promise.reject(new Error('no backend'));
  }

  function emit(kind, data) {
    for (const f of listeners[kind]) {
      try { f(data); } catch (e) { console.error(e); }
    }
  }

  window.Frozen = {
    invoke,
    onState: f => listeners.state.push(f),
    onStatus: f => listeners.status.push(f),
    isMock: !isTauri,
  };
})();
