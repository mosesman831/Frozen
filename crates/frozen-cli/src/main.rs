//! frozen — CLI control surface (spec §24).

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use frozen_common::pipe::{read_env, win, write_env};
use frozen_common::proto::*;
use serde_json::{json, Value};
use std::process;
use uuid::Uuid;

#[derive(Parser)]
#[command(name = "frozen", version, about = "Frozen blocker control")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Service + engine status
    Status,
    /// List blocks
    ListBlocks,
    /// Create a block list
    AddBlock {
        name: String,
        /// whitelist mode: only listed sites are reachable
        #[arg(long)]
        allow: bool,
        /// block the whole internet except exceptions
        #[arg(long)]
        all_internet: bool,
    },
    /// Delete a block list
    RemoveBlock { name: String },
    /// Add a rule to a block
    AddRule {
        block: String,
        /// domain|wildcard|url|keyword|regex|path|title|app|folder
        kind: String,
        value: String,
        /// exception (allow) rule
        #[arg(long)]
        negated: bool,
    },
    /// Remove a rule from a block
    RemoveRule { block: String, value: String },
    /// Add a site exception to a block
    AddException { block: String, site: String },
    /// Enable a block now
    Start { name: String },
    /// Disable a block (subject to locks)
    Stop { name: String },
    /// Toggle a block
    Toggle { name: String },
    /// Pause all blocking
    Pause,
    /// Resume blocking
    Resume,
    /// Lock a block: none|timer|range|password|random|restart|allowance|enforced|frozen
    Lock {
        block: String,
        kind: String,
        /// timer: minutes | range: HH:MM-HH:MM | password: secret | random: length[,perfect] | allowance: minutes
        #[arg(long)]
        arg: Option<String>,
    },
    /// Unlock a password/random-locked block (prints a 5-min token)
    Unlock { name: String, credential: String },
    /// Start a break: <block> delay|random|cause
    Break {
        name: String,
        kind: String,
        /// delay-break wait seconds (default 120)
        #[arg(long, default_value_t = 120)]
        wait_s: u64,
        /// break length in minutes (default 30)
        #[arg(long, default_value_t = 30)]
        duration_m: u64,
        /// random-break text length (default 50)
        #[arg(long, default_value_t = 50)]
        len: u64,
        /// random-break perfect mode
        #[arg(long)]
        perfect: bool,
    },
    /// Complete a random break: <challenge-id> <typed text>
    BreakComplete { challenge: String, text: String },
    /// End the active/pending break on a block
    BreakEnd { name: String },
    /// Pomodoro: status|start|skip|pause|resume|stop  (+ --preset classic|long|sprint|custom)
    Pomodoro {
        action: String,
        #[arg(long)]
        preset: Option<String>,
        /// work seconds (custom preset)
        #[arg(long)]
        work_s: Option<u64>,
        #[arg(long)]
        short_s: Option<u64>,
        #[arg(long)]
        long_s: Option<u64>,
        #[arg(long)]
        cycles_per_long: Option<u64>,
    },
    /// Audit log tail
    Audit {
        #[arg(long, default_value_t = 50)]
        last: i64,
    },
    /// Frozen mode — whole-computer lockout
    Frozen {
        #[command(subcommand)]
        action: FrozenCmd,
    },
    /// Usage + blocked-attempt stats
    Stats {
        #[arg(long, default_value_t = 7)]
        days: u64,
    },
    /// Windows service management
    Service {
        #[command(subcommand)]
        action: SvcCmd,
    },
    /// Raw RPC escape hatch
    Rpc {
        method: String,
        #[arg(long, default_value = "{}")]
        params: String,
    },
}

#[derive(Subcommand)]
enum FrozenCmd {
    /// Lock the whole computer until the timer ends
    Start {
        /// duration e.g. 45s, 30m, 2h (alternative to --until)
        #[arg(long)]
        r#for: Option<String>,
        /// unix timestamp the lockout ends (alternative to --for)
        #[arg(long)]
        until: Option<i64>,
        /// early-exit ceremony: none|password|random
        #[arg(long, default_value = "none")]
        lock: String,
        /// ceremony arg: password text or random-text length
        #[arg(long)]
        arg: Option<String>,
    },
    /// End the lockout early (credential if one was set)
    Stop {
        credential: Option<String>,
    },
    Status,
}

#[derive(Subcommand)]
enum SvcCmd {
    Install,
    Uninstall,
    Start,
    Stop,
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Service { action } => return service_cmd(action),
        _ => {}
    }

    let (method, params) = match &cli.cmd {
        Cmd::Status => ("status", json!({})),
        Cmd::ListBlocks => ("list-blocks", json!({})),
        Cmd::AddBlock { name, allow, all_internet } => (
            "add-block",
            json!({"name": name, "allow": allow, "all_internet": all_internet}),
        ),
        Cmd::RemoveBlock { name } => ("remove-block", json!({"name": name})),
        Cmd::AddRule { block, kind, value, negated } => (
            "add-rule",
            json!({"block": block, "kind": kind, "value": value, "negated": negated}),
        ),
        Cmd::RemoveRule { block, value } => {
            ("remove-rule", json!({"block": block, "value": value}))
        }
        Cmd::AddException { block, site } => {
            // domain for bare hosts; url once there's a path/query
            let kind = if site.contains('/') { "url" } else { "domain" };
            ("add-exception", json!({"block": block, "value": site, "kind": kind}))
        }
        Cmd::Start { name } => ("start", json!({"name": name})),
        Cmd::Stop { name } => ("stop", json!({"name": name})),
        Cmd::Toggle { name } => ("toggle", json!({"name": name})),
        Cmd::Pause => ("pause", json!({})),
        Cmd::Resume => ("resume", json!({})),
        Cmd::Lock { block, kind, arg } => ("lock", lock_params(block, kind, arg.as_deref())?),
        Cmd::Unlock { name, credential } => {
            ("unlock", json!({"name": name, "credential": credential}))
        }
        Cmd::Break { name, kind, wait_s, duration_m, len, perfect } => {
            let m = match kind.as_str() {
                "delay" => "start-delay-break",
                "random" => "start-random-break",
                "cause" => "start-cause-break",
                _ => anyhow::bail!("break kind: delay|random|cause"),
            };
            (
                m,
                json!({"name": name, "wait_s": wait_s, "duration_m": duration_m,
                       "len": len, "perfect": perfect}),
            )
        }
        Cmd::BreakComplete { challenge, text } => {
            ("complete-break", json!({"challenge": challenge, "text": text}))
        }
        Cmd::BreakEnd { name } => ("end-break", json!({"name": name})),
        Cmd::Pomodoro { action, preset, work_s, short_s, long_s, cycles_per_long } => {
            let mut pj = json!({"action": action});
            if let Some(pr) = preset { pj["preset"] = json!(pr); }
            if let Some(w) = work_s { pj["work_s"] = json!(w); }
            if let Some(s) = short_s { pj["short_s"] = json!(s); }
            if let Some(l) = long_s { pj["long_s"] = json!(l); }
            if let Some(n) = cycles_per_long { pj["cycles_per_long"] = json!(n); }
            ("pomodoro", pj)
        }
        Cmd::Audit { last } => ("audit", json!({"last": last})),
        Cmd::Stats { days } => ("stats", json!({"days": days})),
        Cmd::Frozen { action } => match action {
            FrozenCmd::Status => ("frozen-status", json!({})),
            FrozenCmd::Stop { credential } => (
                "frozen-stop",
                json!({"credential": credential.clone().unwrap_or_default()}),
            ),
            FrozenCmd::Start { r#for, until, lock, arg } => {
                let mut p = json!({});
                if let Some(u) = until {
                    p["until"] = json!(u);
                } else {
                    let secs = parse_duration(r#for.as_deref().unwrap_or("1h"))?;
                    p["for_s"] = json!(secs);
                }
                let mut lk = json!({"type": lock});
                if let Some(a) = arg {
                    if lock == "password" {
                        lk["password"] = json!(a);
                    } else if lock == "random" {
                        lk["len"] = json!(a.parse::<u64>().unwrap_or(50));
                    }
                }
                p["lock"] = lk;
                ("frozen-start", p)
            }
        },
        Cmd::Rpc { method, params } => {
            let m = method.as_str();
            let p: Value = serde_json::from_str(params).context("params must be JSON")?;
            (m, p)
        }
        _ => unreachable!(),
    };

    let out = rpc(method, params).await;
    match out {
        Ok(v) => {
            print_human(method, &v);
            Ok(())
        }
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1)
        }
    }
}

fn lock_params(block: &str, kind: &str, arg: Option<&str>) -> Result<Value> {
    let lock = match kind {
        "none" => json!({"type": "none"}),
        "timer" => {
            let mins: i64 = arg.unwrap_or("60").parse().context("timer minutes")?;
            let until = chrono::Local::now() + chrono::Duration::minutes(mins);
            json!({"type": "timer", "until": until.timestamp()})
        }
        "range" => {
            let a = arg.context("range needs HH:MM-HH:MM")?;
            let (s, e) = a.split_once('-').context("range needs HH:MM-HH:MM")?;
            json!({"type": "range", "start_hm": s, "end_hm": e})
        }
        // plaintext password — the service hashes it (argon2id)
        "password" => json!({"type": "password", "password": arg.context("password needs --arg <secret>")?}),
        "random" => {
            let a = arg.unwrap_or("32");
            let (len, perfect) = match a.split_once(',') {
                Some((l, p)) => (l.parse().unwrap_or(32), p == "perfect"),
                None => (a.parse().unwrap_or(32), false),
            };
            json!({"type": "random_text", "len": len, "perfect": perfect})
        }
        "restart" => json!({"type": "restart"}),
        "allowance" => {
            let mins: u64 = arg.unwrap_or("60").parse().context("allowance minutes")?;
            json!({"type": "allowance", "seconds": mins * 60})
        }
        "enforced" => json!({"type": "enforced"}),
        "frozen" => json!({"type": "frozen"}),
        _ => anyhow::bail!("unknown lock kind: {kind}"),
    };
    Ok(json!({"block": block, "lock": lock}))
}

/// Connect to the service, handshake, send one RPC, print the response.
async fn rpc(method: &str, params: Value) -> Result<Value> {
    let stream = win::connect(PIPE_APP)
        .await
        .context("cannot reach frozen service — is frozen-svc running?")?;
    let (mut rd, mut wr) = tokio::io::split(stream);

    let hello = Hello {
        client: "cli".into(),
        browser: None,
        pid: process::id(),
        nonce: Some(Uuid::new_v4().to_string()),
    };
    write_env(&mut wr, &Envelope::new(op::HELLO, serde_json::to_value(hello)?)).await?;

    let req = Envelope::req(op::RPC, 1, json!({"method": method, "params": params}));
    write_env(&mut wr, &req).await?;

    // replies may interleave with state pushes — wait for our id
    loop {
        let env = read_env(&mut rd).await?;
        if env.id == 1 {
            if env.op == op::ERR {
                anyhow::bail!("{}: {}",
                    env.payload["code"].as_str().unwrap_or("ERR"),
                    env.payload["message"].as_str().unwrap_or("unknown"));
            }
            return Ok(env.payload);
        }
    }
}

fn parse_duration(s: &str) -> Result<u64> {
    let (n, mult) = if let Some(v) = s.strip_suffix('h') {
        (v, 3600)
    } else if let Some(v) = s.strip_suffix('m') {
        (v, 60)
    } else if let Some(v) = s.strip_suffix('d') {
        (v, 86400)
    } else {
        (s.trim_end_matches('s'), 1)
    };
    Ok(n.trim().parse::<u64>().context("bad duration, e.g. 30m/2h")? * mult)
}

fn fmt_dur(s: i64) -> String {
    if s >= 3600 {
        format!("{}h{:02}m", s / 3600, (s % 3600) / 60)
    } else if s >= 60 {
        format!("{}m{:02}s", s / 60, s % 60)
    } else {
        format!("{s}s")
    }
}

fn print_human(method: &str, v: &Value) {
    match method {
        "status" => {
            println!("frozen {}", v["version"].as_str().unwrap_or("?"));
            println!("  service:      running");
            println!("  helper:       {}", v["helper_connected"]);
            println!("  ext clients:  {}", v["ext_clients"]);
            println!("  blocks:       {} total / {} active", v["blocks_total"], v["blocks_active"]);
            println!("  state rev:    {}", v["rev"]);
        }
        "list-blocks" | "list_blocks" => {
            let blocks = v["blocks"].as_array();
            if let Some(bl) = blocks {
                if bl.is_empty() {
                    println!("no blocks defined");
                }
                for b in bl {
                    let state = if b["active"].as_bool() == Some(true) { "ACTIVE" }
                        else if b["enabled"].as_bool() == Some(true) { "enabled" }
                        else { "off" };
                    println!("{:<30} {:<8} {:>3} rules  lock={}",
                        b["name"].as_str().unwrap_or("?"),
                        state,
                        b["rules"].as_u64().unwrap_or(0),
                        b["lock"]["type"].as_str().unwrap_or("none"));
                }
            }
        }
        "unlock" => {
            if let Some(t) = v["token"].as_str() {
                println!("unlock token: {t}  (valid {}s)", v["expires_in"].as_u64().unwrap_or(300));
                println!("pass it with: --params '{{\"unlock_token\":\"{t}\"}}' via `frozen rpc`");
            } else {
                println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
            }
        }
        "lock" => {
            if let Some(g) = v["generated"].as_str() {
                println!("block locked. Type this text to unlock (shown once):");
                println!("\n  {g}\n");
            } else {
                println!("lock set");
            }
        }
        "pomodoro" => {
            println!("pomodoro: {}  remaining {}s  cycle {}",
                v["phase"].as_str().unwrap_or("off"),
                v["remaining"].as_u64().unwrap_or(0),
                v["cycle"].as_u64().unwrap_or(0));
        }
        "audit" => {
            if let Some(rows) = v["audit"].as_array() {
                for r in rows {
                    let ts = r["ts"].as_i64().unwrap_or(0);
                    let t = chrono::DateTime::from_timestamp(ts, 0)
                        .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default();
                    println!("{t}  {:<8} {:<16} {}",
                        r["actor"].as_str().unwrap_or(""),
                        r["action"].as_str().unwrap_or(""),
                        r["detail"].as_str().unwrap_or(""));
                }
            }
        }
        "frozen-status" | "frozen_status" => {
            if v["active"].as_bool() == Some(true) {
                println!("FROZEN  remaining {}  locked={}",
                    fmt_dur(v["remaining"].as_i64().unwrap_or(0)),
                    v["locked"].as_bool().unwrap_or(false));
            } else {
                println!("not frozen");
            }
        }
        "frozen-start" | "frozen_start" => {
            if let Some(g) = v["generated"].as_str() {
                println!("computer frozen. Type this text to end early (shown once):\n\n  {g}\n");
            } else {
                println!("computer frozen until {}", v["until"].as_i64().unwrap_or(0));
            }
        }
        "stats" => {
            let domains = v["domains"].as_array();
            let apps = v["apps"].as_array();
            let blocked = v["blocked"].as_array();
            if let Some(rows) = domains {
                println!("top domains");
                for r in rows.iter().take(15) {
                    println!("  {}  {:<30} {}  visits={}  blocked={}",
                        r["day"].as_str().unwrap_or(""),
                        r["domain"].as_str().unwrap_or(""),
                        fmt_dur(r["seconds"].as_i64().unwrap_or(0)),
                        r["visits"].as_u64().unwrap_or(0),
                        r["blocked"].as_u64().unwrap_or(0));
                }
            }
            if let Some(rows) = apps {
                println!("top apps");
                for r in rows.iter().take(15) {
                    println!("  {}  {:<30} {}",
                        r["day"].as_str().unwrap_or(""),
                        r["process"].as_str().unwrap_or(""),
                        fmt_dur(r["seconds"].as_i64().unwrap_or(0)));
                }
            }
            if let Some(rows) = blocked {
                println!("blocked attempts");
                for r in rows.iter().take(15) {
                    println!("  {}  {:<8} {:<30} x{}",
                        r["day"].as_str().unwrap_or(""),
                        r["kind"].as_str().unwrap_or(""),
                        r["target"].as_str().unwrap_or(""),
                        r["attempts"].as_u64().unwrap_or(0));
                }
            }
        }
        _ => println!("{}", serde_json::to_string_pretty(v).unwrap_or_default()),
    }
}

// ---- service management (sc.exe; SCM API comes with the installer in M6) ----

fn service_cmd(action: SvcCmd) -> Result<()> {
    let svc = frozen_platform::svc_name();
    match action {
        SvcCmd::Install => {
            let exe = std::env::current_exe()?
                .parent()
                .unwrap()
                .join("frozen-svc.exe");
            let out = process::Command::new("sc")
                .args(["create", &svc, "binpath="])
                .arg(exe)
                .args(["start=", "auto"])
                .output()?;
            println!("{}", String::from_utf8_lossy(&out.stdout));
            if !out.status.success() {
                eprintln!("{}", String::from_utf8_lossy(&out.stderr));
                anyhow::bail!("sc create failed");
            }
        }
        SvcCmd::Uninstall => {
            let _ = process::Command::new("sc").args(["stop", &svc]).output();
            let out = process::Command::new("sc").args(["delete", &svc]).output()?;
            println!("{}", String::from_utf8_lossy(&out.stdout));
        }
        SvcCmd::Start => {
            let out = process::Command::new("sc").args(["start", &svc]).output()?;
            println!("{}", String::from_utf8_lossy(&out.stdout));
        }
        SvcCmd::Stop => {
            let out = process::Command::new("sc").args(["stop", &svc]).output()?;
            println!("{}", String::from_utf8_lossy(&out.stdout));
        }
        SvcCmd::Status => {
            let out = process::Command::new("sc").args(["query", &svc]).output()?;
            println!("{}", String::from_utf8_lossy(&out.stdout));
        }
    }
    Ok(())
}
