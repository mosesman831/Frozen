//! frozen-svc — SYSTEM service / enforcement authority.
//!
//! Dev mode: run as a console app (`frozen-svc`). Service registration is
//! handled by `frozen-cli service install` (M4+).

mod db;
mod rpc;
mod state;

use anyhow::Result;
use frozen_common::pipe::{read_env, win, write_env};
use frozen_common::proto::*;
use state::{ClientInfo, Core, Shared};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::windows::named_pipe::NamedPipeServer;
use tokio::sync::RwLock;
use tokio::task::LocalSet;
use tracing::{info, warn};

fn main() -> Result<()> {
    // real SCM service mode (installer / `sc start`): when spawned by the
    // Service Control Manager we must enter the dispatcher immediately.
    if std::env::args().any(|a| a == "--service") {
        return service_mode();
    }
    init_logging();
    // current_thread + LocalSet: rusqlite connections are !Sync, and this
    // event loop doesn't need multi-threaded throughput
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async_main())
}

// ---- Windows service entry ----

windows_service::define_windows_service!(ffi_service_main, service_main_wrapper);

fn service_mode() -> Result<()> {
    use windows_service::service_dispatcher;
    service_dispatcher::start("FrozenSvc", ffi_service_main)
        .map_err(|e| anyhow::anyhow!("service dispatcher: {e}"))
}

fn service_main_wrapper(_args: Vec<std::ffi::OsString>) {
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState,
        ServiceStatus, ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};

    init_logging();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let handle = match service_control_handler::register("FrozenSvc", move |event| {
        match event {
            ServiceControl::Stop => {
                let _ = stop_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    }) {
        Ok(h) => h,
        Err(e) => {
            warn!(err = %e, "scm handler register failed");
            return;
        }
    };

    let report = |state: ServiceState| {
        let _ = handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: if state == ServiceState::Running {
                ServiceControlAccept::STOP
            } else {
                ServiceControlAccept::empty()
            },
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: std::time::Duration::from_secs(10),
            process_id: None,
        });
    };
    report(ServiceState::Running);

    // run the app on a worker thread; main thread waits for SCM Stop.
    // On stop: exit the process — all state is persisted continuously, so
    // pipes closing is the only effect (clients reconnect).
    let _worker = std::thread::spawn(|| {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        rt.block_on(async_main())
    });
    let _ = stop_rx.recv();
    report(ServiceState::Stopped);
    std::process::exit(0);
}

async fn async_main() -> Result<()> {
    let store = db::Store::open()?;
    let dir = store.dir.clone();
    let shared: Shared = Arc::new(RwLock::new(Core::new(store)));
    {
        let mut c = shared.write().await;
        c.flags = load_flags(&c.store);
        c.resolve_active();
    }
    info!(dir = %dir.display(), "frozen-svc starting");

    let local = LocalSet::new();
    local
        .run_until(async move {
            // accept loops for each pipe endpoint
            tokio::task::spawn_local(accept_loop(PIPE_APP.to_string(), shared.clone()));
            tokio::task::spawn_local(accept_loop(PIPE_HELPER.to_string(), shared.clone()));
            for b in ["chrome", "edge", "firefox", "brave"] {
                tokio::task::spawn_local(accept_loop(
                    format!("{PIPE_NMH_PREFIX}{b}"),
                    shared.clone(),
                ));
            }

            // 1s engine tick
            tick_loop(shared).await
        })
        .await
}

fn init_logging() {
    let dir = frozen_platform::data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("svc.log"))
        .unwrap();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::sync::Mutex::new(file))
        .with_ansi(false)
        .init();
}

fn load_flags(store: &db::Store) -> Flags {
    Flags {
        stats_enabled: store.setting_bool("stats.enabled", true),
        stats_enabled_incognito: store.setting_bool("stats.incognito", false),
        ignore_incognito: store.setting_bool("ext.ignore_incognito", false),
        force_allow_file: store.setting_bool("ext.force_allow_file", true),
        block_inactive: store.setting_bool("enforce.block_inactive", true),
        block_split: store.setting_bool("enforce.block_split", true),
        block_embedded: store.setting_bool("enforce.block_embedded", true),
        stats_strict: store.setting_bool("stats.strict", false),
        paused: false,
        pomodoro_phase: "off".into(),
        pomodoro_remaining_s: 0,
        frozen_until: 0,
        frozen_locked: false,
    }
}

/// Accept loop for one pipe name: create instance, wait connect, spawn session.
async fn accept_loop(name: String, shared: Shared) -> Result<()> {
    let mut first = true;
    loop {
        let server = match if first {
            win::server(&name)
        } else {
            win::next_server(&name)
        } {
            Ok(s) => s,
            Err(e) => {
                warn!(pipe = %name, err = %e, "pipe create failed");
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        first = false;
        if let Err(e) = server.connect().await {
            warn!(pipe = %name, err = %e, "pipe connect failed");
            continue;
        }
        info!(pipe = %name, "client connected");
        tokio::task::spawn_local(session(server, shared.clone(), name.clone()));
    }
}

/// One connected client session: hello handshake then message pump.
async fn session(mut srv: NamedPipeServer, shared: Shared, pipe: String) -> Result<()> {
    let (mut rd, mut wr) = tokio::io::split(&mut srv);
    let mut client_id = 0u64;
    let (push_tx, mut push_rx) = tokio::sync::mpsc::unbounded_channel::<Envelope>();

    loop {
        tokio::select! {
            read = read_env(&mut rd) => {
                let env = match read {
                    Ok(e) => e,
                    Err(_) => break,
                };
                match env.op.as_str() {
                    op::HELLO => {
                        let h: Hello = serde_json::from_value(env.payload)?;
                        client_id = register(&shared, &h, push_tx.clone(), &pipe).await;
                        let rev = shared.read().await.rev;
                        let _ = write_env(&mut wr, &Envelope::ok(env.id, serde_json::json!({
                            "client_id": client_id, "rev": rev
                        }))).await;
                        // push current state immediately so clients converge
                        let info = shared.read().await.block_list_info();
                        let _ = write_env(&mut wr, &Envelope::new(op::STATE, serde_json::to_value(info)?)).await;
                    }
                    op::RPC => {
                        let method = env.payload["method"].as_str().unwrap_or("").to_string();
                        let params = env.payload["params"].clone();
                        match rpc::dispatch(&shared, &method, &params).await {
                            Ok(v) => { let _ = write_env(&mut wr, &Envelope::ok(env.id, v)).await; }
                            Err(e) => {
                                let msg = e.to_string();
                                let code = if msg.starts_with("LOCKED") { "LOCKED" }
                                    else if msg.starts_with("ENFORCED") { "ENFORCED" }
                                    else { "INVALID" };
                                let _ = write_env(&mut wr, &Envelope::err(env.id, code, &msg)).await;
                            }
                        }
                    }
                    op::BEAT => {
                        if client_id != 0 {
                            let mut c = shared.write().await;
                            if let Some(ci) = c.clients.get_mut(&client_id) {
                                ci.last_beat = db::uptime_ms();
                            }
                        }
                    }
                    op::FG_EVENT => {
                        let ev: FgEvent = serde_json::from_value(env.payload)?;
                        let mut c = shared.write().await;
                        c.store.record_fg(&ev);
                        c.last_fg = Some((ev.path.clone(), ev.title.clone()));
                    }
                    op::EVENT => {
                        handle_event(&shared, &env.payload).await;
                    }
                    op::WATCHDOG => {
                        let _ = write_env(&mut wr, &Envelope::ok(env.id, serde_json::json!({"alive": true}))).await;
                    }
                    op::BYE => break,
                    other => warn!(op = other, "unknown op"),
                }
            }
            Some(env) = push_rx.recv() => {
                if write_env(&mut wr, &env).await.is_err() {
                    break;
                }
            }
        }
    }

    if client_id != 0 {
        let mut c = shared.write().await;
        if let Some(ci) = c.clients.remove(&client_id) {
            info!(client = %ci.kind, pid = ci.pid, "client disconnected");
        }
    }
    Ok(())
}

async fn register(
    shared: &Shared,
    h: &Hello,
    push: tokio::sync::mpsc::UnboundedSender<Envelope>,
    _pipe: &str,
) -> u64 {
    let mut c = shared.write().await;
    let id = c.next_client_id;
    c.next_client_id += 1;
    c.clients.insert(
        id,
        ClientInfo {
            id,
            kind: h.client.clone(),
            browser: h.browser.clone(),
            pid: h.pid,
            last_beat: db::uptime_ms(),
            push: Some(push),
        },
    );
    info!(client = %h.client, browser = ?h.browser, pid = h.pid, "registered");
    id
}

async fn handle_event(shared: &Shared, p: &serde_json::Value) {
    let kind = p["type"].as_str().unwrap_or("");
    let c = shared.read().await;
    match kind {
        "blocked" => {
            let target = p["domain"].as_str().unwrap_or("?");
            c.store.record_blocked("domain", target);
            c.store.record_domain(target, 0, true);
        }
        "visit" => {
            if let Some(d) = p["domain"].as_str() {
                c.store.record_domain(d, 0, false);
            }
        }
        "frozen_stop" => {
            drop(c);
            let mut cw = shared.write().await;
            let cred = p["credential"].as_str();
            if let Err(e) = cw.try_frozen_stop(cred) {
                warn!(err = %e, "frozen-stop refused");
            }
        }
        "tick" => {
            if let Some(d) = p["domain"].as_str() {
                let secs = p["seconds"].as_i64().unwrap_or(5);
                c.store.record_domain(d, secs, false);
                drop(c);
                // allowance engine: focused-domain seconds draw down quotas
                let url = format!("https://{d}/");
                let mut cw = shared.write().await;
                let hit = cw.spend_allowance(secs as u64, |b| {
                    let rules: Vec<(String, String, bool)> = b
                        .rules
                        .iter()
                        .filter(|r| !r.negated)
                        .filter(|r| !matches!(r.kind, RuleKind::App | RuleKind::Folder | RuleKind::Title))
                        .map(|r| (frozen_common::rules::kind_name(&r.kind), r.value.clone(), false))
                        .collect();
                    !rules.is_empty() && frozen_common::rules::match_url(&url, &rules).is_some()
                });
                if let Some(ids) = hit {
                    let names: Vec<String> = cw.blocks.iter()
                        .filter(|b| ids.split(',').any(|i| i == b.id))
                        .map(|b| b.name.clone()).collect();
                    cw.store.audit("svc", "allowance.exhausted", &names.join(","));
                    drop(cw);
                    notify(shared, "block", "Allowance exhausted",
                        &format!("{} — blocked for the rest of the day", names.join(", "))).await;
                }
            }
        }
        _ => {}
    }
}

/// Push current state to every push-enabled client.
async fn broadcast_state(shared: &Shared) {
    let (env, targets): (Envelope, Vec<tokio::sync::mpsc::UnboundedSender<Envelope>>) = {
        let c = shared.read().await;
        let env = Envelope::new(op::STATE, serde_json::to_value(c.block_list_info()).unwrap());
        let targets = c
            .clients
            .values()
            .filter_map(|ci| ci.push.clone())
            .collect();
        (env, targets)
    };
    for t in targets {
        let _ = t.send(env.clone());
    }
}

async fn notify(shared: &Shared, kind: &str, title: &str, text: &str) {
    let env = Envelope::new(
        op::NOTIFY,
        serde_json::to_value(Notify {
            kind: kind.into(),
            title: title.into(),
            text: text.into(),
            urgent: kind == "grace" || kind == "block",
        })
        .unwrap(),
    );
    let targets: Vec<_> = {
        let c = shared.read().await;
        c.clients
            .values()
            .filter(|ci| ci.kind == "helper")
            .filter_map(|ci| ci.push.clone())
            .collect()
    };
    for t in targets {
        let _ = t.send(env.clone());
    }
}

/// The 1-second engine tick: resolve actives, enforce processes, push state.
async fn tick_loop(shared: Shared) -> ! {
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    let mut last_rev = 0u64;
    let mut last_proc_scan = Instant::now() - Duration::from_secs(10);
    // browser → seconds it has been running without its extension connected
    let mut ext_grace: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    loop {
        interval.tick().await;
        let evs = {
            let mut c = shared.write().await;
            // foreground-app allowance: spend 1s into app/folder/title blocks
            // whose rules match the current foreground process
            if let Some((path, title)) = c.last_fg.clone() {
                let titles = vec![title];
                c.spend_allowance(1, |b| {
                    let rules: Vec<(String, String, bool)> = b
                        .rules
                        .iter()
                        .filter(|r| !r.negated)
                        .filter(|r| matches!(r.kind, RuleKind::App | RuleKind::Folder | RuleKind::Title))
                        .map(|r| (frozen_common::rules::kind_name(&r.kind), r.value.clone(), false))
                        .collect();
                    !rules.is_empty()
                        && frozen_common::rules::match_process(&path, &titles, &rules).is_some()
                });
            }
            c.resolve_active();
            c.tick_engines()
        };
        for ev in evs {
            match ev {
                state::EngineEvent::Notify { kind, title, text } => {
                    notify(&shared, kind, &title, &text).await
                }
                state::EngineEvent::Audit { action, detail } => {
                    shared.read().await.store.audit("svc", action, &detail)
                }
            }
        }
        let rev = shared.read().await.rev;
        if rev != last_rev {
            last_rev = rev;
            broadcast_state(&shared).await;
        }

        // process enforcement — every 2s
        if last_proc_scan.elapsed() >= Duration::from_secs(2) {
            last_proc_scan = Instant::now();
            enforce_processes(&shared).await;
            enforce_extension_health(&shared, &mut ext_grace).await;
            enforce_frozen(&shared).await;
        }
    }
}

/// Application blocking: kill processes matching app/folder/title rules on
/// active blocks.
async fn enforce_processes(shared: &Shared) {
    let (blocks, force_close) = {
        let c = shared.read().await;
        let blocks: Vec<BlockInfo> = c.blocks.iter().filter(|b| b.active).cloned().collect();
        (blocks, true)
    };
    if blocks.is_empty() {
        return;
    }
    let _ = force_close;

    let procs = match frozen_platform::list_processes() {
        Ok(p) => p,
        Err(_) => return,
    };
    for p in procs {
        for b in &blocks {
            let rules: Vec<(String, String, bool)> = b
                .rules
                .iter()
                .filter(|r| matches!(r.kind, RuleKind::App | RuleKind::Folder | RuleKind::Title))
                .map(|r| (frozen_common::rules::kind_name(&r.kind), r.value.clone(), r.negated))
                .collect();
            if rules.is_empty() {
                continue;
            }
            let titles = if rules.iter().any(|(k, _, _)| k == "title") {
                frozen_platform::window_titles(p.pid)
            } else {
                vec![]
            };
            if let Some((rule, negated)) =
                frozen_common::rules::match_process(&p.path, &titles, &rules)
            {
                if negated {
                    continue;
                }
                if b.force_close {
                    let _ = frozen_platform::kill_process(p.pid);
                } else {
                    // ask-close-then-kill: for M1 just kill; WM_CLOSE comes in M3
                    let _ = frozen_platform::kill_process(p.pid);
                }
                let c = shared.read().await;
                c.store.record_blocked("app", &p.name);
                c.store.audit("svc", "app.kill", &format!("{} ({}) via {}", p.name, p.pid, rule));
                drop(c);
                notify(
                    shared,
                    "block",
                    "Application blocked",
                    &format!("{} was blocked by \"{}\"", p.name, b.name),
                )
                .await;
                break;
            }
        }
    }
}

/// Frozen mode (spec §21): while the session is active every process not on
/// the allowlist is killed on sight — browsers, task tools, everything.
/// The overlay + explorer survive; the user can stare at a countdown or
/// complete the exit ceremony, nothing else.
async fn enforce_frozen(shared: &Shared) {
    let (active, allow_apps) = {
        let c = shared.read().await;
        let extra = c
            .store
            .setting("frozen.allow_apps")
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_lowercase())
                    .filter(|x| !x.is_empty())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        (c.frozen_active(), extra)
    };
    if !active {
        return;
    }
    // OS processes the session can't live without, plus the pieces Frozen
    // itself depends on (explorer renders the desktop under the overlay,
    // our own binaries keep enforcing, user-explicit allow apps).
    const SAFE: &[&str] = &[
        "system", "registry", "smss.exe", "csrss.exe", "wininit.exe",
        "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe",
        "svchost.exe", "dwm.exe", "explorer.exe", "sihost.exe",
        "taskhostw.exe", "fontdrvhost.exe", "ctfmon.exe", "conhost.exe",
        "dllhost.exe", "runtimebroker.exe", "shellexperiencehost.exe",
        "searchhost.exe", "startmenuexperiencehost.exe", "textinputhost.exe",
        "inputhost.exe", "securityhealthservice.exe", "securityhealthsystray.exe",
        "frozen.exe", "frozen-svc.exe", "frozen-helper.exe", "frozen-nmh.exe",
        "frozen-gui.exe", "wmiprvse.exe", "memory compression",
        "msdtc.exe", "spoolsv.exe", "audiodg.exe", "wlanext.exe",
    ];
    let procs = match frozen_platform::list_processes() {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut killed = Vec::new();
    for p in procs {
        let name = p.name.to_lowercase();
        if SAFE.contains(&name.as_str()) || allow_apps.contains(&name) {
            continue;
        }
        if frozen_platform::kill_process(p.pid).is_ok() {
            killed.push(p.name.clone());
        }
    }
    if !killed.is_empty() {
        let c = shared.read().await;
        for name in &killed {
            c.store.record_blocked("frozen", name);
        }
        c.store
            .audit("svc", "frozen.kill", &killed.join(","));
    }
}

/// Extension-health enforcement (CT's model): while ANY active block is
/// locked, a running browser whose extension isn't connected gets a grace
/// countdown, then is force-closed. Protected processes (Task Manager etc.)
/// die immediately under the same gate.
const EXT_GRACE_S: u64 = 60;

async fn enforce_extension_health(
    shared: &Shared,
    grace: &mut std::collections::HashMap<String, u64>,
) {
    let locked = {
        let c = shared.read().await;
        c.blocks
            .iter()
            .any(|b| b.active && !matches!(b.lock, LockKind::None))
    };
    if !locked {
        grace.clear();
        return;
    }

    let procs = match frozen_platform::list_processes() {
        Ok(p) => p,
        Err(_) => return,
    };

    // protected tooling: kill outright during locked blocks
    const PROTECTED: &[&str] = &[
        "taskmgr.exe",
        "procexp.exe",
        "procexp64.exe",
        "processhacker.exe",
        "perfmon.exe",
        "resmon.exe",
    ];
    for p in &procs {
        if PROTECTED.contains(&p.name.as_str()) {
            let _ = frozen_platform::kill_process(p.pid);
            let c = shared.read().await;
            c.store.audit("svc", "protect.kill", &format!("{} ({})", p.name, p.pid));
            drop(c);
            notify(
                shared,
                "block",
                "Protected application",
                &format!("{} is not available during a locked block", p.name),
            )
            .await;
        }
    }

    // browser extension health
    const BROWSERS: &[(&str, &str)] = &[
        ("chrome", "chrome.exe"),
        ("edge", "msedge.exe"),
        ("firefox", "firefox.exe"),
        ("brave", "brave.exe"),
    ];
    for (bname, exe) in BROWSERS {
        let running_pids: Vec<u32> = procs
            .iter()
            .filter(|p| p.name == *exe)
            .map(|p| p.pid)
            .collect();
        if running_pids.is_empty() {
            grace.remove(*bname);
            continue;
        }
        let connected = {
            let c = shared.read().await;
            c.clients
                .values()
                .any(|ci| ci.kind == "nmh" && ci.browser.as_deref() == Some(*bname))
        };
        if connected {
            grace.remove(*bname);
            continue;
        }
        let elapsed = grace.entry((*bname).to_string()).or_insert(0);
        *elapsed += 2;
        if *elapsed == 10 || (*elapsed > 10 && *elapsed % 10 == 0 && *elapsed < EXT_GRACE_S) {
            let remaining = EXT_GRACE_S - *elapsed;
            notify(
                shared,
                "grace",
                "Frozen extension required",
                &format!(
                    "The {bname} browser will close in {remaining}s — the Frozen extension must be re-enabled during a locked block"
                ),
            )
            .await;
        }
        if *elapsed >= EXT_GRACE_S {
            for pid in &running_pids {
                let _ = frozen_platform::kill_process(*pid);
            }
            let c = shared.read().await;
            c.store
                .audit("svc", "ext.enforce", &format!("{bname} killed: extension absent"));
            drop(c);
            grace.remove(*bname);
        }
    }
}
