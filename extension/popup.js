/* Frozen popup — status + quick actions via background rpc relay. */
"use strict";

const $ = (id) => document.getElementById(id);
const errEl = $("err");

function rpc(method, params) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "rpc", method, params: params || {} }, (r) => {
      if (!r) { resolve({ err: "no response" }); return; }
      if (r.err) { errEl.textContent = r.err; resolve({ err: r.err }); }
      else resolve(r.ok);
    });
  });
}

function fmtLeft(ms) {
  if (ms <= 0) return "";
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : `${m}m`;
}

async function refresh() {
  errEl.textContent = "";
  const now = Date.now() / 1000;
  const st = await rpc("status");
  const sw = await chrome.runtime.sendMessage({ type: "get-state" }).catch(() => null);
  const flags = (sw && sw.state && sw.state.flags) || {};

  $("svc").textContent = st && st.service_running
    ? `rev ${st.rev} · ${st.ext_clients} ext` : "—";

  let stTxt = "idle", cls = "off";
  if (flags.paused) { stTxt = "paused"; cls = "bad"; }
  else if (st && st.blocks_active) { stTxt = `${st.blocks_active} active`; cls = "active"; }
  const el = $("st"); el.textContent = stTxt; el.className = "val " + cls;

  const fu = flags.frozen_until || 0;
  if (fu > now) {
    $("frozenrow").style.display = "";
    $("fzr").textContent = `frozen ${fmtLeft((fu - now) * 1000)}`;
  } else $("frozenrow").style.display = "none";

  if (flags.pomodoro_phase && flags.pomodoro_phase !== "off") {
    $("pomorow").style.display = "";
    $("pomo").textContent = `${flags.pomodoro_phase} ${fmtLeft((flags.pomodoro_remaining_s || 0) * 1000)}`;
  } else $("pomorow").style.display = "none";

  const lb = await rpc("list-blocks");
  const blocks = (lb && lb.blocks) || (sw && sw.state && sw.state.blocks) || [];
  window._blocks = blocks;
  const host = $("blocks");
  host.textContent = "";
  for (const b of blocks) {
    const div = document.createElement("div");
    div.className = "block";
    const lockName = (b.lock && (b.lock.type || b.lock)) || "none";
    const dotCls = b.active ? "dot on" : (lockName && lockName.toLowerCase() !== "none" ? "dot lock" : "dot");
    const left = document.createElement("span");
    const dot = document.createElement("span");
    dot.className = dotCls;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = `${b.name} (${b.rules})`;
    left.appendChild(dot); left.appendChild(nm);
    div.appendChild(left);
    const btn = document.createElement("button");
    btn.textContent = b.enabled ? "stop" : "start";
    btn.onclick = async () => {
      errEl.textContent = "";
      await rpc(b.enabled ? "stop" : "start", { name: b.name });
      setTimeout(refresh, 400);
    };
    div.appendChild(btn);
    host.appendChild(div);
  }
  if (!blocks.length) host.innerHTML = '<div class="lbl">no blocks — open options</div>';
}

function firstActive() {
  const bs = window._blocks || [];
  const act = bs.find((b) => b.active) || bs[0];
  return act ? act.name : null;
}

$("bd").onclick = async () => {
  const name = firstActive();
  if (!name) { errEl.textContent = "no block"; return; }
  const r = await rpc("start-delay-break", { name, wait_s: 60, duration_m: 10 });
  if (r && r.activates_in) errEl.style.color = "#7ee787", errEl.textContent = `break in ${r.activates_in}s`;
  setTimeout(refresh, 400);
};
$("br").onclick = async () => {
  const name = firstActive();
  if (!name) { errEl.textContent = "no block"; return; }
  const r = await rpc("start-random-break", { name, duration_m: 10, len: 30 });
  if (r && r.text) {
    const typed = prompt("retype this text exactly:\n\n" + r.text);
    if (typed) await rpc("complete-break", { challenge: r.challenge, text: typed });
  }
  setTimeout(refresh, 400);
};
$("bc").onclick = async () => {
  const name = firstActive();
  if (!name) { errEl.textContent = "no block"; return; }
  const why = prompt("what do you actually need?");
  if (why !== null) await rpc("start-cause-break", { name, reason: why });
  setTimeout(refresh, 400);
};
$("be").onclick = async () => {
  const name = firstActive();
  if (name) await rpc("end-break", { name });
  setTimeout(refresh, 400);
};
$("pause").onclick = async () => { await rpc("pause", { for_s: 300 }); setTimeout(refresh, 400); };
$("resume").onclick = async () => { await rpc("resume", {}); setTimeout(refresh, 400); };
$("opts").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

refresh();
setInterval(refresh, 5000);
