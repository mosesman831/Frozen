//! frozen-gui — desktop control surface for the Frozen blocker.
//! Talks to frozen-svc over \\.\pipe\Frozen.App (same protocol as the
//! extension/native-messaging path): state pushes drive the UI, RPC calls
//! mutate it.

slint::include_modules!();

use anyhow::Result;
use frozen_common::pipe::{read_env, win, write_env};
use frozen_common::proto::*;
use serde_json::{json, Value};
use slint::{ComponentHandle, ModelRc, VecModel, Weak};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::mpsc;

/// requests from UI thread → io thread
struct Req {
    id: u64,
    method: String,
    params: Value,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(|| std::fs::OpenOptions::new()
            .create(true).append(true)
            .open(r"C:\ProgramData\Frozen\logs\gui.log")
            .unwrap_or_else(|_| std::fs::File::create("gui.log").unwrap()))
        .with_ansi(false)
        .init();

    let ui = AppWindow::new()?;
    let weak = ui.as_weak();

    let (tx, rx) = mpsc::unbounded_channel::<Req>();
    // io thread owns the pipe; replies routed by id
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(io_loop(rx, weak));
    });

    // pre-load stats + audit is sent inside connect_and_run after HELLO,
    // so it replays on every (re)connect rather than being lost with the
    // first connection's queue.

    let g = ui.global::<G>();

    // ---- callbacks → rpc queue ----
    // `q` builds a Req and pushes it to the io thread.
    let q = |tx: &mpsc::UnboundedSender<Req>, method: &str, params: Value| {
        let _ = tx.send(Req {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            method: method.into(),
            params,
        });
    };
    g.on_start_block({
        let tx = tx.clone();
        move |n| q(&tx, "start", json!({"name": n.to_string()}))
    });
    g.on_stop_block({
        let tx = tx.clone();
        move |n| q(&tx, "stop", json!({"name": n.to_string()}))
    });
    g.on_add_block({
        let tx = tx.clone();
        move |n| q(&tx, "add-block", json!({
            "name": n.to_string(), "enabled": false, "allow": false,
            "all_internet": false, "allowance": null, "pomodoro": null,
            "force_close": false
        }))
    });
    g.on_remove_block({
        let tx = tx.clone();
        move |n| q(&tx, "remove-block", json!({"name": n.to_string()}))
    });
    g.on_add_rule({
        let tx = tx.clone();
        move |b, k, v| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "add-rule".into(),
                params: json!({"block": b.to_string(), "kind": k.to_string(),
                               "value": v.to_string(), "negated": false}),
            });
        }
    });
    g.on_remove_rule({
        let tx = tx.clone();
        move |b, v| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "remove-rule".into(),
                params: json!({"block": b.to_string(), "value": v.to_string()}),
            });
        }
    });
    g.on_add_exception({
        let tx = tx.clone();
        move |b, v| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "add-exception".into(),
                params: json!({"block": b.to_string(), "value": v.to_string()}),
            });
        }
    });
    g.on_set_lock({
        let tx = tx.clone();
        move |b, kind, arg| {
            let arg = arg.to_string();
            let lock = match kind.as_str() {
                "timer" => json!({"type": "timer", "until": parse_i64(&arg)}),
                "range" => {
                    let mut it = arg.splitn(2, '-');
                    json!({"type": "range",
                           "start_hm": it.next().unwrap_or("00:00"),
                           "end_hm": it.next().unwrap_or("23:59")})
                }
                "password" => json!({"type": "password", "password": arg}),
                "random" => json!({"type": "random", "len": parse_u64(&arg).max(10).min(500)}),
                "allowance" => json!({"type": "allowance", "seconds": parse_u64(&arg)}),
                "restart" => json!({"type": "restart"}),
                "enforced" => json!({"type": "enforced"}),
                "frozen" => json!({"type": "frozen"}),
                _ => json!({"type": "none"}),
            };
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "lock".into(),
                params: json!({"block": b.to_string(), "lock": lock}),
            });
        }
    });
    g.on_unlock({
        let tx = tx.clone();
        move |n, c| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "unlock".into(),
                params: json!({"name": n.to_string(), "credential": c.to_string()}),
            });
        }
    });
    g.on_delay_break({
        let tx = tx.clone();
        move |n| q(&tx, "start-delay-break",
            json!({"name": n.to_string(), "wait_s": 10, "duration_m": 5}))
    });
    g.on_random_break({
        let tx = tx.clone();
        move |n| q(&tx, "start-random-break",
            json!({"name": n.to_string(), "duration_m": 5, "len": 60, "perfect": false}))
    });
    g.on_cause_break({
        let tx = tx.clone();
        move |n| q(&tx, "start-cause-break",
            json!({"name": n.to_string(), "reason": "gui"}))
    });
    g.on_end_break({
        let tx = tx.clone();
        move |n| q(&tx, "end-break", json!({"name": n.to_string()}))
    });
    {
        let tx0 = tx.clone();
        g.on_resume_global(move || q(&tx0, "resume", json!({})));
    }
    g.on_complete_break({
        let tx = tx.clone();
        move |ch, t| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "complete-break".into(),
                params: json!({"challenge": ch.to_string(), "text": t.to_string()}),
            });
        }
    });
    g.on_pause_global({
        let tx = tx.clone();
        move |secs| {
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "pause".into(),
                params: json!({"for_s": secs}),
            });
        }
    });
    g.on_pomo({
        let tx = tx.clone();
        move |action, preset| {
            let mut p = json!({"action": action.to_string()});
            if !preset.is_empty() {
                p["preset"] = json!(preset.to_string());
            }
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "pomodoro".into(),
                params: p,
            });
        }
    });
    g.on_frozen_start({
        let tx = tx.clone();
        move |mins, lock, arg| {
            let arg = arg.to_string();
            let lock = match lock.as_str() {
                "password" => json!({"type": "password", "password": arg}),
                "random" => json!({"type": "random",
                                   "len": if arg.is_empty() { 50 } else { parse_u64(&arg) }}),
                _ => json!({"type": "none"}),
            };
            let _ = tx.send(Req {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                method: "frozen-start".into(),
                params: json!({"for_s": (mins as u64) * 60, "lock": lock}),
            });
        }
    });
    g.on_frozen_stop({
        let tx = tx.clone();
        move |c| q(&tx, "frozen-stop", json!({"credential": c.to_string()}))
    });
    {
        let tx1 = tx.clone();
        g.on_refresh_stats(move || q(&tx1, "stats", json!({"days": 7})));
        let tx2 = tx.clone();
        g.on_refresh_audit(move || q(&tx2, "audit", json!({"last": 300})));
    }

    // 1s clock for countdown display
    {
        let weak = ui.as_weak();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let weak = weak.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(ui) = weak.upgrade() {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i32)
                        .unwrap_or(0);
                    ui.global::<G>().set_now(now);
                }
            });
        });
    }

    ui.run()?;
    Ok(())
}

fn parse_i64(s: &str) -> i64 {
    s.trim().parse().unwrap_or(0)
}
fn parse_u64(s: &str) -> u64 {
    s.trim().parse().unwrap_or(0)
}

// ---------- io thread ----------

async fn io_loop(mut rx: mpsc::UnboundedReceiver<Req>, weak: Weak<AppWindow>) {
    loop {
        match connect_and_run(&mut rx, &weak).await {
            Ok(()) => return, // clean shutdown
            Err(e) => {
                set_status(&weak, &format!("service offline: {e}"));
                set_connected(&weak, false);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
}

async fn connect_and_run(
    rx: &mut mpsc::UnboundedReceiver<Req>,
    weak: &Weak<AppWindow>,
) -> Result<()> {
    let stream = win::connect(PIPE_APP).await?;
    let (mut rd, mut wr) = tokio::io::split(stream);

    let hello = Hello {
        client: "gui".into(),
        browser: None,
        pid: std::process::id(),
        nonce: Some(uuid::Uuid::new_v4().to_string()),
    };
    write_env(&mut wr, &Envelope::new(op::HELLO, serde_json::to_value(&hello)?)).await?;
    set_connected(weak, true);
    set_status(weak, "service connected");

    // pending requests map id -> method (for reply routing)
    let pending_methods: Mutex<HashMap<u64, String>> = Mutex::new(HashMap::new());

    // preload stats + audit on this connection — writing them here (after
    // HELLO) means a dropped/replaced connection replays them instead of
    // silently losing the queue.
    for (method, params) in [
        ("stats", json!({"days": 7})),
        ("audit", json!({"last": 300})),
    ] {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        pending_methods.lock().unwrap().insert(id, method.into());
        let env = Envelope::req(op::RPC, id, json!({"method": method, "params": params}));
        if write_env(&mut wr, &env).await.is_err() {
            anyhow::bail!("pipe write failed");
        }
    }

    loop {
        tokio::select! {
            req = rx.recv() => {
                match req {
                    None => return Ok(()),
                    Some(r) => {
                        pending_methods.lock().unwrap().insert(r.id, r.method.clone());
                        let env = Envelope::req(op::RPC, r.id,
                            json!({"method": r.method, "params": r.params}));
                        if write_env(&mut wr, &env).await.is_err() {
                            anyhow::bail!("pipe write failed");
                        }
                    }
                }
            }
            env = read_env(&mut rd) => {
                let env = match env {
                    Ok(e) => e,
                    Err(e) => anyhow::bail!("pipe read: {e}"),
                };
                match env.op.as_str() {
                    op::STATE => {
                        if let Ok(info) = serde_json::from_value::<BlockListInfo>(env.payload.clone()) {
                            push_state(weak, &info);
                        }
                    }
                    op::OK => {
                        let m = pending_methods.lock().unwrap().remove(&env.id).unwrap_or_default();
                        handle_reply(weak, &m, &env.payload);
                    }
                    op::ERR => {
                        let msg = env.payload["message"].as_str()
                            .or_else(|| env.payload["msg"].as_str())
                            .unwrap_or("error").to_string();
                        set_err(weak, &msg);
                    }
                    _ => {}
                }
            }
        }
    }
}

fn upgrade<F: FnOnce(AppWindow) + Send + 'static>(weak: &Weak<AppWindow>, f: F) {
    let weak = weak.clone();
    let _ = slint::invoke_from_event_loop(move || {
        if let Some(ui) = weak.upgrade() {
            f(ui);
        }
    });
}

fn set_status(weak: &Weak<AppWindow>, s: &str) {
    let s = s.to_string();
    upgrade(weak, move |ui| ui.global::<G>().set_status_line(s.into()));
}
fn set_connected(weak: &Weak<AppWindow>, v: bool) {
    upgrade(weak, move |ui| ui.global::<G>().set_connected(v));
}
fn set_err(weak: &Weak<AppWindow>, s: &str) {
    let s = s.to_string();
    upgrade(weak, move |ui| ui.global::<G>().set_last_error(s.into()));
}

/// plain-Send snapshot of a block — the UI builds BlockRow/VecModel on the
/// event-loop thread (Slint models are Rc and can't cross threads)
struct BlockSnap {
    name: String,
    enabled: bool,
    active: bool,
    lock: String,
    allow_mode: bool,
    all_internet: bool,
    rules: Vec<(String, String, bool)>,
    allowance: i32,
    allowance_left: i32,
    break_until: i32,
}

fn push_state(weak: &Weak<AppWindow>, info: &BlockListInfo) {
    let snaps: Vec<BlockSnap> = info.blocks.iter().map(|b| BlockSnap {
        name: b.name.clone(),
        enabled: b.enabled,
        active: b.active,
        lock: serde_json::to_value(&b.lock)
            .ok()
            .and_then(|v| v["type"].as_str().map(String::from))
            .unwrap_or_else(|| "none".into()),
        allow_mode: b.allow_mode,
        all_internet: b.block_all_internet,
        rules: b.rules.iter().map(|r| (
            serde_json::to_value(r.kind)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| format!("{:?}", r.kind).to_lowercase()),
            r.value.clone(),
            r.negated,
        )).collect(),
        allowance: b.allowance_seconds.unwrap_or(0) as i32,
        allowance_left: b.allowance_remaining.unwrap_or(0) as i32,
        break_until: b.break_until.unwrap_or(0) as i32,
    }).collect();
    let rev = info.rev as i32;
    let paused = info.flags.paused;
    let pomo = if info.flags.pomodoro_phase.is_empty() || info.flags.pomodoro_phase == "off" {
        String::new()
    } else {
        format!("{} {}s", info.flags.pomodoro_phase, info.flags.pomodoro_remaining_s)
    };
    let frozen_until = info.flags.frozen_until as i32;
    let frozen_locked = info.flags.frozen_locked;
    upgrade(weak, move |ui| {
        let rows: Vec<BlockRow> = snaps.into_iter().map(|s| BlockRow {
            name: s.name.into(),
            enabled: s.enabled,
            active: s.active,
            lock: s.lock.into(),
            allow_mode: s.allow_mode,
            all_internet: s.all_internet,
            rules: ModelRc::new(VecModel::from(s.rules.into_iter().map(|(k, v, n)| RuleRow {
                kind: k.into(), value: v.into(), negated: n,
            }).collect::<Vec<_>>())),
            allowance: s.allowance,
            allowance_left: s.allowance_left,
            break_until: s.break_until,
        }).collect();
        let g = ui.global::<G>();
        g.set_blocks(ModelRc::new(VecModel::from(rows)));
        g.set_rev(rev);
        g.set_paused(paused);
        g.set_pomodoro(pomo.into());
        g.set_frozen_until(frozen_until);
        g.set_frozen_locked(frozen_locked);
    });
}

fn handle_reply(weak: &Weak<AppWindow>, method: &str, payload: &Value) {
    match method {
        "start-random-break" => {
            // challenge = opaque token; text = the string the user must type
            let tok = payload["challenge"].as_str().unwrap_or("").to_string();
            let text = payload["text"].as_str().unwrap_or("").to_string();
            upgrade(weak, move |ui| {
                let g = ui.global::<G>();
                g.set_challenge_token(tok.into());
                g.set_challenge_text(text.into());
            });
        }
        "frozen-start" => {
            if let Some(gen) = payload.get("generated").and_then(|v| v.as_str()) {
                let gen = gen.to_string();
                upgrade(weak, move |ui| ui.global::<G>().set_generated(gen.into()));
            }
        }
        "lock" => {
            if let Some(gen) = payload.get("generated").and_then(|v| v.as_str()) {
                let gen = gen.to_string();
                upgrade(weak, move |ui| ui.global::<G>().set_generated(gen.into()));
            }
        }
        "stats" => {
            let rows = flatten_stats(payload);
            upgrade(weak, move |ui| ui.global::<G>().set_stats(ModelRc::new(VecModel::from(rows))));
        }
        "audit" => {
            let mut rows: Vec<AuditRow> = payload["audit"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|r| {
                    let ts = r["ts"].as_i64().unwrap_or(0);
                    let time = chrono_lite(ts);
                    AuditRow {
                        time: time.into(),
                        actor: r["actor"].as_str().unwrap_or("").into(),
                        action: r["action"].as_str().unwrap_or("").into(),
                        detail: r["detail"].as_str().unwrap_or("").into(),
                    }
                })
                .collect();
            rows.reverse(); // newest first
            upgrade(weak, move |ui| ui.global::<G>().set_audits(ModelRc::new(VecModel::from(rows))));
        }
        _ => {
            let msg = payload["ok"].as_bool().unwrap_or(false);
            if msg {
                set_status(weak, "ok");
            }
        }
    }
}

fn chrono_lite(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|t| {
            let local: chrono::DateTime<chrono::Local> = t.into();
            local.format("%H:%M:%S").to_string()
        })
        .unwrap_or_default()
}

fn flatten_stats(v: &Value) -> Vec<StatRow> {
    let mut out = Vec::new();
    let row = |group: &str, name: String, value: String| StatRow {
        group: group.into(),
        name: name.into(),
        value: value.into(),
    };
    if let Some(arr) = v.get("apps").and_then(|a| a.as_array()) {
        for r in arr {
            out.push(row(
                "apps",
                r["process"].as_str().unwrap_or("").to_string(),
                format!("{}  ({})", fmt_dur(r["seconds"].as_i64().unwrap_or(0)), r["day"].as_str().unwrap_or("")),
            ));
        }
    }
    if let Some(arr) = v.get("domains").and_then(|a| a.as_array()) {
        for r in arr {
            let blocked = r["blocked"].as_i64().unwrap_or(0);
            out.push(row(
                "domains",
                r["domain"].as_str().unwrap_or("").to_string(),
                format!(
                    "{} · {} visits{}  ({})",
                    fmt_dur(r["seconds"].as_i64().unwrap_or(0)),
                    r["visits"].as_i64().unwrap_or(0),
                    if blocked > 0 { format!(" · {blocked} blocked") } else { String::new() },
                    r["day"].as_str().unwrap_or(""),
                ),
            ));
        }
    }
    if let Some(arr) = v.get("blocked").and_then(|a| a.as_array()) {
        for r in arr {
            out.push(row(
                "blocked",
                r["target"].as_str().unwrap_or("").to_string(),
                format!(
                    "{} · {} attempts  ({})",
                    r["kind"].as_str().unwrap_or(""),
                    r["attempts"].as_i64().unwrap_or(0),
                    r["day"].as_str().unwrap_or(""),
                ),
            ));
        }
    }
    out
}

fn fmt_dur(s: i64) -> String {
    if s >= 3600 {
        format!("{}h{}m", s / 3600, (s % 3600) / 60)
    } else if s >= 60 {
        format!("{}m", s / 60)
    } else {
        format!("{s}s")
    }
}
