/* Frozen background service worker.
   - Keeps a native-messaging port to frozen-nmh → frozen-svc.
   - Caches the pushed BlockListInfo and answers verdict queries.
   - Blocks top-level navigations via webNavigation → blocked page redirect.
   - Reports visits/blocks/ticks back to the service for stats. */
"use strict";

importScripts("rules.js");

const NMH = "com.frozen.frozen";
let port = null;
let state = { rev: 0, blocks: [], flags: {} };
let connected = false;

// ---- native messaging bridge ----
const rpcPending = new Map();
let rpcSeq = 1;

function connect() {
  try {
    port = chrome.runtime.connectNative(NMH);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  port.onMessage.addListener((env) => {
    if (!env || !env.op) return;
    if (env.op === "state") {
      state = env.payload || state;
    } else if (env.op === "ok" || env.op === "err") {
      const r = rpcPending.get(env.id);
      if (r) {
        rpcPending.delete(env.id);
        r(env);
      }
    } else if (env.op === "cmd") {
      // future: overlay/close-tab commands
    }
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    state = { rev: 0, blocks: [], flags: {} };
    scheduleReconnect();
  });
  connected = true;
  // initial hello over the pipe envelope
  send({ op: "hello", payload: { client: "ext", pid: 0 } });
}

function scheduleReconnect() {
  chrome.alarms.create("reconnect", { delayInMinutes: 0.083 }); // ~5s
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "reconnect" && !connected) connect();
  if (a.name === "beat" && connected) {
    send({ op: "beat", payload: { ts: Date.now(), tabs: 0 } });
  }
});

function send(env) {
  try { port && port.postMessage(env); } catch (e) { /* port dead */ }
}

connect();
chrome.alarms.create("beat", { periodInMinutes: 0.083 });

// ---- navigation interception ----
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.url.startsWith("chrome-extension://")) return;
  const v = FrozenRules.verdict(d.url, state.blocks);
  if (v.block && d.frameId === 0) {
    const target = chrome.runtime.getURL("blocked.html") +
      "?u=" + encodeURIComponent(d.url) +
      "&b=" + encodeURIComponent(v.block_name || "") +
      "&r=" + encodeURIComponent(v.rule || "");
    chrome.tabs.update(d.tabId, { url: target }).catch(() => {});
    send({ op: "event", payload: { type: "blocked", domain: FrozenRules.canonicalHost(d.url), block: v.block_name } });
  }
});

// SPA navigations inside the same document
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  const v = FrozenRules.verdict(d.url, state.blocks);
  if (v.block) {
    chrome.tabs.sendMessage(d.tabId, { type: "frozen-block", v }).catch(() => {});
  }
});

// ---- content-script verdict service + stats ----
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || !msg.type) return;
  if (msg.type === "rpc") {
    // options/popup → svc call relayed over the single native port
    if (!connected || !port) { respond({ err: "disconnected" }); return true; }
    const id = rpcSeq++;
    rpcPending.set(id, (env) => {
      if (env.op === "ok") respond({ ok: env.payload });
      else respond({ err: (env.payload && env.payload.msg) || "rpc error", code: env.payload && env.payload.code });
    });
    send({ op: "rpc", id, payload: { method: msg.method, params: msg.params || {} } });
    return true;
  }
  if (msg.type === "get-state") {
    respond({ state });
    return true;
  }
  if (msg.type === "verdict") {
    respond({ v: FrozenRules.verdict(msg.url, state.blocks, msg.title) });
    return true;
  }
  if (msg.type === "visit" && sender.tab) {
    send({ op: "event", payload: { type: "visit", domain: msg.domain } });
  }
  if (msg.type === "tick" && sender.tab) {
    send({ op: "event", payload: { type: "tick", domain: msg.domain, seconds: msg.seconds } });
  }
});
