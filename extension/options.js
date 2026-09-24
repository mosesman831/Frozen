/* Frozen options — block/rule/lock management + frozen + stats + audit. */
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
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- nav ----------
function showTab(id) {
  document.querySelectorAll("nav a").forEach((x) => x.classList.toggle("on", x.hash === "#" + id));
  document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("on", s.id === id));
  if (id === "stats") loadStats();
  if (id === "audit") loadAudit();
  if (id === "frozen") loadFrozen();
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1) || "blocks"));
document.querySelectorAll("nav a").forEach((a) => {
  a.onclick = () => { location.hash = a.hash; };  // hashchange does the work
});
if (location.hash) showTab(location.hash.slice(1));

// ---------- blocks ----------
async function loadBlocks() {
  errEl.textContent = "";
  const lb = await rpc("list-blocks");
  const blocks = (lb && lb.blocks) || [];
  const sw = await chrome.runtime.sendMessage({ type: "get-state" }).catch(() => null);
  const full = (sw && sw.state && sw.state.blocks) || [];
  const host = $("blocklist");
  host.textContent = "";
  for (const b of blocks) {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "row";
    const lockName = (b.lock && (b.lock.type || b.lock)) || "none";
    const schedName = (b.schedule && (b.schedule.type || b.schedule)) || "always";
    const tags = [];
    if (b.active) tags.push('<span class="tag active">active</span>');
    if (b.enabled && !b.active) tags.push('<span class="tag">enabled</span>');
    if (lockName && lockName.toLowerCase() !== "none") tags.push(`<span class="tag locked">${esc(lockName)}</span>`);
    if (schedName && schedName.toLowerCase() !== "always") tags.push(`<span class="tag">${esc(schedName)}</span>`);
    head.innerHTML = `<strong>${esc(b.name)}</strong> ${tags.join(" ")} <span class="muted">${b.rules} rules</span><span class="spacer"></span>`;
    const mk = (label, cls, fn) => {
      const btn = document.createElement("button");
      btn.className = "small " + cls; btn.textContent = label; btn.onclick = fn;
      head.appendChild(btn); return btn;
    };
    mk(b.enabled ? "stop" : "start", b.enabled ? "warn" : "primary", async () => {
      await rpc(b.enabled ? "stop" : "start", { name: b.name }); loadBlocks();
    });
    mk("delete", "", async () => {
      if (confirm(`delete block "${b.name}"?`)) { await rpc("remove-block", { name: b.name }); loadBlocks(); }
    });
    card.appendChild(head);

    // rules
    const fb = full.find((x) => x.id === b.id || x.name === b.name);
    const rulesDiv = document.createElement("div");
    rulesDiv.className = "rules";
    if (fb && fb.rules) {
      for (const r of fb.rules) {
        const rd = document.createElement("div");
        rd.className = "rule";
        rd.innerHTML = `<span class="tag">${esc(r.kind)}${r.negated ? " (except)" : ""}</span><code></code>`;
        rd.querySelector("code").textContent = r.value;
        const x = document.createElement("button");
        x.className = "small"; x.textContent = "×";
        x.onclick = async () => {
          await rpc("remove-rule", { block: b.name, value: r.value }); loadBlocks();
        };
        rd.appendChild(x);
        rulesDiv.appendChild(rd);
      }
    }
    const addrow = document.createElement("div");
    addrow.className = "row";
    addrow.style.marginTop = "8px";
    addrow.innerHTML = `
      <select>
        <option value="domain">domain</option><option value="url">url</option>
        <option value="keyword">keyword</option><option value="app">app</option>
        <option value="title">title</option><option value="exception">exception</option>
      </select>
      <input placeholder="e.g. reddit.com  or  notepad.exe" style="flex:1">
      <button class="small">+ add rule</button>`;
    addrow.querySelector("button").onclick = async () => {
      const kind = addrow.querySelector("select").value;
      const value = addrow.querySelector("input").value.trim();
      if (!value) return;
      if (kind === "exception") await rpc("add-exception", { block: b.name, value });
      else await rpc("add-rule", { block: b.name, kind, value });
      loadBlocks();
    };
    rulesDiv.appendChild(addrow);
    card.appendChild(rulesDiv);

    // lock + misc row
    const lockrow = document.createElement("div");
    lockrow.className = "row";
    lockrow.innerHTML = `
      <span class="muted">lock:</span>
      <select>
        <option value="none">none</option><option value="password">password</option>
        <option value="random">random text</option><option value="timer">timer</option>
        <option value="range">time range</option><option value="restart">restart</option>
        <option value="enforced">ENFORCED</option>
      </select>
      <input placeholder="arg (password / len / +minutes / HH:MM-HH:MM)" style="width:280px">
      <button class="small">set lock</button>
      <span class="spacer"></span>
      <button class="small">unlock…</button>`;
    const [sel, arg] = lockrow.querySelectorAll("select,input");
    lockrow.querySelectorAll("button")[0].onclick = async () => {
      const t = sel.value, a = arg.value.trim();
      const lock = { type: t };
      if (t === "password") lock.password = a;
      else if (t === "random") lock.len = parseInt(a) || 50;
      else if (t === "timer") lock.until = Math.floor(Date.now() / 1000) + (parseInt(a) || 60) * 60;
      else if (t === "range") {
        const m = a.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (!m) { errEl.textContent = "range needs HH:MM-HH:MM"; return; }
        lock.start_hm = m[1]; lock.end_hm = m[2];
      } else if (t === "enforced" && !confirm("ENFORCED has no escape — the block cannot be stopped until the schedule ends. Sure?")) return;
      const r = await rpc("lock", { block: b.name, lock });
      if (r && r.generated) alert("random-text lock set — write this down, it is never stored:\n\n" + r.generated);
      loadBlocks();
    };
    lockrow.querySelectorAll("button")[1].onclick = async () => {
      const cred = prompt("credential for " + b.name + ":");
      if (cred === null) return;
      const r = await rpc("unlock", { name: b.name, credential: cred });
      if (r && r.unlock_token) alert("unlocked — token valid ~5min:\n" + r.unlock_token);
      loadBlocks();
    };
    card.appendChild(lockrow);
    host.appendChild(card);
  }
  if (!blocks.length) host.innerHTML = '<div class="muted">no blocks yet — create one above</div>';
}

$("addblk").onclick = async () => {
  const name = $("newname").value.trim();
  if (!name) return;
  await rpc("add-block", { name });
  $("newname").value = "";
  loadBlocks();
};

// ---------- frozen ----------
async function loadFrozen() {
  const r = await rpc("frozen-status");
  $("fstatus").textContent = r && r.active
    ? `status: FROZEN until ${new Date(r.until * 1000).toLocaleTimeString()} (${r.remaining}s left)`
    : "status: inactive";
}
$("fstart").onclick = async () => {
  const d = $("fhours").value.trim();
  const m = d.match(/^(\d+(?:\.\d+)?)\s*(h|m|s)?$/i);
  if (!m) { errEl.textContent = "duration like 2h / 45m / 90s"; return; }
  const mult = { s: 1, m: 60, h: 3600 }[(m[2] || "h").toLowerCase()];
  const lockType = $("flock").value;
  const lock = { type: lockType };
  const a = $("farg").value.trim();
  if (lockType === "password") { if (!a) { errEl.textContent = "password required"; return; } lock.password = a; }
  if (lockType === "random") lock.len = parseInt(a) || 50;
  if (!confirm(`freeze the whole computer for ${d}?`)) return;
  const r = await rpc("frozen-start", { for_s: Math.round(parseFloat(m[1]) * mult), lock });
  if (r && r.generated) alert("random-text exit credential — write it down:\n\n" + r.generated);
  loadFrozen();
};

// ---------- stats / audit ----------
async function loadStats() {
  const r = await rpc("stats", { days: 7 });
  const g = $("statgrid");
  g.textContent = "";
  const list = $("blockedlist");
  list.textContent = "";
  if (!r) return;
  for (const [k, v] of Object.entries(r)) {
    if (!Array.isArray(v)) {
      const d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = `<div class="n"></div><div class="muted">${esc(k)}</div>`;
      d.querySelector(".n").textContent = typeof v === "object" ? JSON.stringify(v) : v;
      g.appendChild(d);
      continue;
    }
    const h = document.createElement("h3");
    h.textContent = k; h.style.margin = "12px 0 6px"; h.style.color = "#7aa2ff";
    list.appendChild(h);
    const t = document.createElement("table");
    const cols = [...new Set(v.flatMap((x) => typeof x === "object" && x ? Object.keys(x) : []))];
    if (cols.length) {
      t.innerHTML = "<thead><tr>" + cols.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr></thead>";
      const tb = document.createElement("tbody");
      for (const row of v.slice(0, 40)) {
        const tr = document.createElement("tr");
        tr.innerHTML = cols.map((c) => `<td>${esc(row[c] ?? "")}</td>`).join("");
        tb.appendChild(tr);
      }
      t.appendChild(tb);
    } else {
      t.innerHTML = "<tbody>" + v.slice(0, 40).map((x) => `<tr><td>${esc(x)}</td></tr>`).join("") + "</tbody>";
    }
    list.appendChild(t);
  }
}
async function loadAudit() {
  const r = await rpc("audit", { last: 100 });
  const tb = $("audittb");
  tb.textContent = "";
  for (const row of (r && r.audit) || []) {
    const tr = document.createElement("tr");
    const ts = row.ts ? new Date(row.ts * 1000).toLocaleTimeString() : "";
    tr.innerHTML = [ts, row.actor, row.action, row.detail]
      .map((c) => `<td>${esc(c ?? "")}</td>`).join("");
    tb.appendChild(tr);
  }
}

loadBlocks();
setInterval(loadBlocks, 10000);
