//! RPC dispatch — gui/cli calls into the service (spec §11.4).

use crate::state::Shared;
use anyhow::Result;
use frozen_common::proto::*;
use serde_json::{json, Value};

pub async fn dispatch(shared: &Shared, method: &str, params: &Value) -> Result<Value> {
    match method {
        "status" => status(shared).await,
        "list-blocks" | "list_blocks" => list_blocks(shared).await,
        "add-block" | "add_block" => add_block(shared, params).await,
        "remove-block" | "remove_block" => remove_block(shared, params).await,
        "add-rule" | "add_rule" => add_rule(shared, params).await,
        "remove-rule" | "remove_rule" => remove_rule(shared, params).await,
        "start" => set_enabled(shared, params, true).await,
        "stop" => set_enabled(shared, params, false).await,
        "toggle" => toggle(shared, params).await,
        "add-exception" | "add_exception" => add_exception(shared, params).await,
        "pause" => pause(shared, params).await,
        "resume" => pause(shared, &json!({"off": true})).await,
        "lock" => set_lock(shared, params).await,
        "reload-settings" | "reload_settings" => reload(shared).await,
        "delete-stats" | "delete_stats" => delete_stats(shared).await,
        "pomodoro" => pomodoro(shared, params).await,
        "unlock" => unlock(shared, params).await,
        "start-delay-break" => start_delay_break(shared, params).await,
        "start-random-break" => start_random_break(shared, params).await,
        "complete-break" | "complete_break" => complete_break(shared, params).await,
        "start-cause-break" => start_cause_break(shared, params).await,
        "end-break" | "end_break" => end_break(shared, params).await,
        "audit" => audit(shared, params).await,
        "stats" => stats(shared, params).await,
        "set-setting" | "set_setting" => set_setting(shared, params).await,
        "get-setting" | "get_setting" => get_setting(shared, params).await,
        _ => Err(anyhow::anyhow!("unknown rpc: {method}")),
    }
}

/// hash a secret with argon2id (spec: m=64MiB t=3 p=4 — default params are
/// sane; argon2 crate defaults to those for Argon2::default()).
fn hash_secret(s: &str) -> Result<String> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    Ok(argon2::Argon2::default()
        .hash_password(s.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2: {e}"))?
        .to_string())
}

fn verify_secret(hash: &str, s: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    match PasswordHash::new(hash) {
        Ok(h) => argon2::Argon2::default().verify_password(s.as_bytes(), &h).is_ok(),
        Err(_) => false,
    }
}

/// Cryptographically random text (no real words), grouped 5-char chunks.
fn gen_random_text(len: u32) -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    let raw: String = (0..len).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect();
    raw.chars()
        .collect::<Vec<_>>()
        .chunks(5)
        .map(|c| c.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// locate a block index by name or id
fn block_idx(c: &crate::state::Core, name: &str) -> Result<usize> {
    c.blocks
        .iter()
        .position(|b| b.id == name || b.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))
}

/// Gate a mutation: natural lock window OR a valid unlock token.
fn gate_edit(c: &crate::state::Core, block_id: &str, p: &Value) -> Result<()> {
    if c.edit_allowed(block_id, p["unlock_token"].as_str()) {
        Ok(())
    } else {
        Err(anyhow::anyhow!("LOCKED: block is locked"))
    }
}

async fn status(shared: &Shared) -> Result<Value> {
    let c = shared.read().await;
    let st = StatusInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        service_running: true,
        helper_connected: c.clients.values().any(|x| x.kind == "helper"),
        ext_clients: c.clients.values().filter(|x| x.kind == "nmh").count() as u32,
        rev: c.rev,
        blocks_total: c.blocks.len(),
        blocks_active: c.blocks.iter().filter(|b| b.active).count(),
    };
    Ok(serde_json::to_value(st)?)
}

async fn list_blocks(shared: &Shared) -> Result<Value> {
    let c = shared.read().await;
    let blocks: Vec<Value> = c
        .blocks
        .iter()
        .map(|b| {
            json!({
                "id": b.id, "name": b.name, "enabled": b.enabled,
                "active": b.active, "rules": b.rules.len(),
                "lock": b.lock, "schedule": b.schedule_kind,
            })
        })
        .collect();
    Ok(json!({ "blocks": blocks }))
}

async fn add_block(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let b = BlockInfo {
        id: id.clone(),
        name: name.to_string(),
        enabled: p["enabled"].as_bool().unwrap_or(false),
        allow_mode: p["allow"].as_bool().unwrap_or(false),
        block_all_internet: p["all_internet"].as_bool().unwrap_or(false),
        rules: vec![],
        schedule_kind: ScheduleKind::Always,
        schedule_grid: vec![],
        schedule_start: None,
        schedule_end: None,
        lock: LockKind::None,
        allowance_seconds: p["allowance"].as_u64(),
        allowance_remaining: None,
        pomodoro_phase: p["pomodoro"].as_str().map(String::from),
        force_close: p["force_close"].as_bool().unwrap_or(false),
        active: false,
        break_until: None,
    };
    let mut c = shared.write().await;
    c.store.save_block(&b)?;
    c.blocks.push(b);
    c.bump_rev();
    c.store.audit("rpc", "block.create", name);
    Ok(json!({ "id": id }))
}

async fn remove_block(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let mut c = shared.write().await;
    let idx = block_idx(&c, name)?;
    gate_edit(&c, &c.blocks[idx].id.clone(), p)?;
    let id = c.blocks[idx].id.clone();
    c.store.delete_block(&id)?;
    c.blocks.retain(|x| x.id != id);
    c.bump_rev();
    c.store.audit("rpc", "block.delete", name);
    Ok(json!({ "ok": true }))
}

async fn add_rule(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["block"].as_str().ok_or_else(|| anyhow::anyhow!("block required"))?;
    let kind = p["kind"].as_str().unwrap_or("domain");
    let value = p["value"].as_str().ok_or_else(|| anyhow::anyhow!("value required"))?;
    let norm = frozen_common::rules::normalize_rule(kind, value)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let rk = frozen_common::rules::kind_from_name(kind)
        .ok_or_else(|| anyhow::anyhow!("unknown kind {kind}"))?;
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    gate_edit(c, &c.blocks[idx].id.clone(), p)?;
    c.blocks[idx].rules.push(Rule { kind: rk, value: norm.clone(), negated: p["negated"].as_bool().unwrap_or(false) });
    let b = c.blocks[idx].clone();
    c.store.save_block(&b)?;
    c.bump_rev();
    Ok(json!({ "ok": true, "normalized": norm }))
}

async fn remove_rule(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["block"].as_str().ok_or_else(|| anyhow::anyhow!("block required"))?;
    let value = p["value"].as_str().ok_or_else(|| anyhow::anyhow!("value required"))?;
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    gate_edit(c, &c.blocks[idx].id.clone(), p)?;
    c.blocks[idx].rules.retain(|r| !r.value.eq_ignore_ascii_case(value));
    let b = c.blocks[idx].clone();
    c.store.save_block(&b)?;
    c.bump_rev();
    Ok(json!({ "ok": true }))
}

async fn set_enabled(shared: &Shared, p: &Value, on: bool) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    if !on && !c.edit_allowed(&c.blocks[idx].id, p["unlock_token"].as_str()) {
        return Err(anyhow::anyhow!("LOCKED: cannot stop a locked block"));
    }
    c.blocks[idx].enabled = on;
    let b = c.blocks[idx].clone();
    c.store.save_block(&b)?;
    c.bump_rev();
    c.store.audit("rpc", if on { "block.start" } else { "block.stop" }, name);
    Ok(json!({ "ok": true }))
}

async fn toggle(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let cur = {
        let c = shared.read().await;
        c.find_block(name)
            .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?
            .enabled
    };
    let token = p["unlock_token"].clone();
    set_enabled(shared, &json!({"name": name, "unlock_token": token}), !cur).await
}

async fn add_exception(shared: &Shared, p: &Value) -> Result<Value> {
    let mut p = p.clone();
    if p["kind"].is_null() {
        p["kind"] = json!("domain");
    }
    p["negated"] = json!(true);
    add_rule(shared, &p).await
}

async fn pause(shared: &Shared, p: &Value) -> Result<Value> {
    let off = p["off"].as_bool().unwrap_or(false);
    let mut c = shared.write().await;
    // refuse a pause while any locked+active block forbids it — a global
    // pause is the cheapest bypass, so locks veto it
    if !off && c.blocks.iter().any(|b| {
        b.enabled && matches!(b.lock, LockKind::Enforced | LockKind::Frozen)
    }) {
        return Err(anyhow::anyhow!(
            "LOCKED: cannot pause while an enforced/frozen block is enabled"
        ));
    }
    if off {
        c.paused = false;
        c.paused_until = None;
    } else {
        let for_s = p["for_s"].as_u64().unwrap_or(600).min(3600);
        c.paused = true;
        c.paused_until = Some(chrono::Local::now().timestamp() + for_s as i64);
    }
    c.bump_rev();
    c.store.audit("rpc", if c.paused { "pause" } else { "resume" }, "");
    Ok(json!({ "paused": c.paused, "until": c.paused_until }))
}

async fn set_lock(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["block"].as_str().ok_or_else(|| anyhow::anyhow!("block required"))?;
    let lt = p["lock"]["type"].as_str().unwrap_or("none");
    let mut generated = None;
    let lock = match lt {
        "none" => LockKind::None,
        "timer" => LockKind::Timer {
            until: p["lock"]["until"].as_i64()
                .ok_or_else(|| anyhow::anyhow!("timer lock needs until"))?,
        },
        "range" => LockKind::Range {
            start_hm: p["lock"]["start_hm"].as_str()
                .or_else(|| p["lock"]["start"].as_str()).unwrap_or("00:00").into(),
            end_hm: p["lock"]["end_hm"].as_str()
                .or_else(|| p["lock"]["end"].as_str()).unwrap_or("00:00").into(),
        },
        "password" => {
            let pw = p["lock"]["password"].as_str()
                .or_else(|| p["lock"]["hash"].as_str()) // legacy cli field
                .ok_or_else(|| anyhow::anyhow!("password lock needs password"))?;
            LockKind::Password { hash: hash_secret(pw)? }
        }
        "random" | "random_text" => {
            let len = p["lock"]["len"].as_u64().unwrap_or(50).clamp(10, 500) as u32;
            let perfect = p["lock"]["perfect"].as_bool().unwrap_or(false);
            let text = gen_random_text(len);
            generated = Some(text.clone());
            LockKind::RandomText { len, perfect, hash: Some(hash_secret(&text)?) }
        }
        "restart" => LockKind::Restart,
        "allowance" => LockKind::Allowance {
            seconds: p["lock"]["seconds"].as_u64()
                .ok_or_else(|| anyhow::anyhow!("allowance lock needs seconds"))?,
        },
        "enforced" => LockKind::Enforced,
        "frozen" => LockKind::Frozen,
        other => return Err(anyhow::anyhow!("unknown lock type {other}")),
    };
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    gate_edit(c, &c.blocks[idx].id.clone(), p)?;
    c.blocks[idx].lock = lock;
    let b = c.blocks[idx].clone();
    c.store.save_block(&b)?;
    c.bump_rev();
    c.store.audit("rpc", "lock.change", name);
    // random text is returned ONCE and never stored in plaintext — write it
    // down or the block stays locked (restart/safe-mode wipe aside)
    Ok(json!({ "ok": true, "generated": generated }))
}

async fn reload(shared: &Shared) -> Result<Value> {
    let mut c = shared.write().await;
    c.blocks = c.store.load_blocks()?;
    c.bump_rev();
    Ok(json!({ "blocks": c.blocks.len() }))
}

async fn delete_stats(shared: &Shared) -> Result<Value> {
    let c = shared.read().await;
    // refuse while any lock is active (B-level gating: can't erase evidence mid-lock)
    if c.blocks.iter().any(|b| !matches!(b.lock, LockKind::None) && b.enabled) {
        return Err(anyhow::anyhow!("LOCKED: stats cannot be cleared during a locked block"));
    }
    drop(c);
    let c = shared.read().await;
    for conn in [&c.store.helper, &c.store.browser] {
        for t in ["usage_app", "usage_title", "usage_domain", "stats_blocked"] {
            let _ = conn.execute(&format!("DELETE FROM {t}"), []);
        }
    }
    c.store.audit("rpc", "stats.delete", "");
    Ok(json!({ "ok": true }))
}

async fn pomodoro(shared: &Shared, p: &Value) -> Result<Value> {
    let action = p["action"].as_str().unwrap_or("status");
    let now = chrono::Local::now().timestamp();
    let mut c = shared.write().await;
    // stop/skip are lock-gated: refuse if a locked block is bound to a
    // pomodoro phase (otherwise stop is a free escape hatch)
    let locked_bound = c.blocks.iter().any(|b| {
        b.enabled
            && b.pomodoro_phase.is_some()
            && !frozen_common::lock_allows_edit(&b.lock, chrono::Local::now())
    });
    match action {
        "start" => {
            // presets: classic 25/5/15@4, long 50/10/30@4, sprint 15/3/12@4
            let (w, s, l, n) = match p["preset"].as_str().unwrap_or("classic") {
                "long" => (3000, 600, 1800, 4),
                "sprint" => (900, 180, 720, 4),
                "custom" => (
                    p["work_s"].as_u64().unwrap_or(1500),
                    p["short_s"].as_u64().unwrap_or(300),
                    p["long_s"].as_u64().unwrap_or(900),
                    p["cycles_per_long"].as_u64().unwrap_or(4) as u32,
                ),
                _ => (1500, 300, 900, 4),
            };
            c.pomodoro.work_s = w;
            c.pomodoro.short_s = s;
            c.pomodoro.long_s = l;
            c.pomodoro.cycles_per_long = n;
            c.pomodoro.cycle = 0;
            c.pomodoro.phase = "work".into();
            c.pomodoro.ends_at = now + w as i64;
            c.persist_pomodoro();
            c.store.audit("rpc", "pomodoro.start", &format!("{w}/{s}/{l}@{n}"));
        }
        "skip" => {
            if locked_bound {
                return Err(anyhow::anyhow!("LOCKED: cannot skip while a locked pomodoro block is enabled"));
            }
            c.pomodoro.ends_at = now; // tick promotes the phase immediately
        }
        "pause" => {
            if locked_bound {
                return Err(anyhow::anyhow!("LOCKED: cannot pause while a locked pomodoro block is enabled"));
            }
            // pause = freeze remaining into work_s field trick is ugly; store
            // remaining in ends_at=now+remaining? Just freeze: phase stays,
            // ends_at pushed forward on resume. Track via paused_until reuse?
            // Simplest: dedicated 'paused' phase marker.
            if c.pomodoro.phase != "off" && c.pomodoro.phase != "paused" {
                c.pomodoro.ends_at = -(c.pomodoro.ends_at - now); // stash remaining (negative)
                c.persist_pomodoro();
            }
        }
        "resume" => {
            if c.pomodoro.ends_at < 0 && c.pomodoro.phase != "off" {
                c.pomodoro.ends_at = now + (-c.pomodoro.ends_at); // restore remaining
                c.persist_pomodoro();
            }
        }
        "stop" => {
            if locked_bound {
                return Err(anyhow::anyhow!("LOCKED: cannot stop while a locked pomodoro block is enabled"));
            }
            c.pomodoro.phase = "off".into();
            c.pomodoro.ends_at = 0;
            c.persist_pomodoro();
            c.store.audit("rpc", "pomodoro.stop", "");
        }
        _ => {}
    }
    c.bump_rev();
    let phase = c.pomodoro.phase.clone();
    let remaining = c.pomodoro.remaining(now);
    Ok(json!({ "phase": phase, "remaining": remaining, "cycle": c.pomodoro.cycle }))
}

/// Ceremony: verify a credential for a locked block, return a 5-minute
/// single-block unlock token. Rate-limited (5 tries -> 60s -> doubles).
async fn unlock(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let cred = p["credential"].as_str().ok_or_else(|| anyhow::anyhow!("credential required"))?;
    let now = chrono::Local::now().timestamp();
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    let bid = c.blocks[idx].id.clone();

    // rate limit
    if let Some((tries, lockout)) = c.unlock_fails.get(&bid) {
        if now < *lockout {
            return Err(anyhow::anyhow!("LOCKED: too many attempts, retry in {}s", lockout - now));
        }
        if *tries >= 5 && now >= *lockout {
            c.unlock_fails.insert(bid.clone(), (0, 0));
        }
    }

    let ok = match &c.blocks[idx].lock {
        LockKind::Password { hash } => verify_secret(hash, cred),
        LockKind::RandomText { hash: Some(hash), .. } => verify_secret(hash, cred),
        LockKind::RandomText { hash: None, .. } => false,
        _ => return Err(anyhow::anyhow!("ENFORCED: this lock has no credential ceremony")),
    };
    if !ok {
        let (tries, _) = c.unlock_fails.get(&bid).copied().unwrap_or((0, 0));
        let tries = tries + 1;
        let lockout = if tries >= 5 { now + 60 * (1 << (tries - 5).min(6)) } else { 0 };
        c.unlock_fails.insert(bid.clone(), (tries, lockout));
        c.store.audit("svc", "unlock.fail", name);
        return Err(anyhow::anyhow!("INVALID: wrong credential"));
    }
    c.unlock_fails.remove(&bid);
    let token = uuid::Uuid::new_v4().to_string();
    c.unlock_tokens.insert(token.clone(), (bid, now + 300));
    c.store.audit("svc", "unlock.success", name);
    Ok(json!({ "token": token, "expires_in": 300 }))
}

fn breaks_forbidden(lock: &LockKind) -> bool {
    matches!(lock, LockKind::Enforced | LockKind::Frozen)
}

/// Reserve allowance-lock budget for a break: returns Ok(duration seconds)
/// possibly shortened to fit today's remaining budget.
fn consume_lock_allowance(c: &mut crate::state::Core, block_id: &str, want_s: u64) -> Result<u64> {
    let budget = match c.blocks.iter().find(|b| b.id == block_id).map(|b| &b.lock) {
        Some(LockKind::Allowance { seconds }) => *seconds,
        _ => return Ok(want_s),
    };
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let entry = c.lock_allow_used.entry(block_id.into()).or_insert((today.clone(), 0));
    if entry.0 != today {
        entry.0 = today;
        entry.1 = 0;
    }
    let left = budget.saturating_sub(entry.1);
    if left == 0 {
        return Err(anyhow::anyhow!("LOCKED: daily break allowance exhausted until tomorrow"));
    }
    let granted = want_s.min(left);
    entry.1 += granted;
    Ok(granted)
}

async fn start_delay_break(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let wait_s = p["wait_s"].as_u64().unwrap_or(120).clamp(10, 3600);
    let dur_m = p["duration_m"].as_u64().unwrap_or(30).clamp(1, 720);
    let now = chrono::Local::now().timestamp();
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    if breaks_forbidden(&c.blocks[idx].lock) {
        return Err(anyhow::anyhow!("LOCKED: breaks are not allowed on this lock"));
    }
    let bid = c.blocks[idx].id.clone();
    let granted = consume_lock_allowance(c, &bid, dur_m * 60)?;
    c.breaks.insert(bid.clone(), crate::state::BreakInfo {
        kind: "delay".into(),
        activate_at: now + wait_s as i64,
        until: now + wait_s as i64 + granted as i64,
        pending: true,
    });
    c.store.audit("rpc", "break.delay.request", &format!("{name} wait={wait_s}s dur={granted}s"));
    Ok(json!({ "ok": true, "activates_in": wait_s, "duration_s": granted }))
}

async fn start_random_break(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let dur_m = p["duration_m"].as_u64().unwrap_or(30).clamp(1, 720);
    let len = p["len"].as_u64().unwrap_or(50).clamp(10, 500) as u32;
    let perfect = p["perfect"].as_bool().unwrap_or(false);
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    if breaks_forbidden(&c.blocks[idx].lock) {
        return Err(anyhow::anyhow!("LOCKED: breaks are not allowed on this lock"));
    }
    let bid = c.blocks[idx].id.clone();
    let granted = consume_lock_allowance(c, &bid, dur_m * 60)?;
    let text = gen_random_text(len);
    let challenge = uuid::Uuid::new_v4().to_string();
    c.store.set_setting(
        &format!("break.challenge.{challenge}"),
        &serde_json::json!({"block": bid, "hash": hash_secret(&text)?, "perfect": perfect, "dur_s": granted}).to_string(),
    )?;
    c.store.audit("rpc", "break.random.request", name);
    Ok(json!({ "challenge": challenge, "text": text, "duration_s": granted }))
}

async fn complete_break(shared: &Shared, p: &Value) -> Result<Value> {
    let cid = p["challenge"].as_str().ok_or_else(|| anyhow::anyhow!("challenge required"))?;
    let text = p["text"].as_str().ok_or_else(|| anyhow::anyhow!("text required"))?;
    let key = format!("break.challenge.{cid}");
    let mut c = shared.write().await;
    let c = &mut *c;
    let v = c.store.setting(&key)
        .ok_or_else(|| anyhow::anyhow!("INVALID: unknown challenge"))?;
    let v: Value = serde_json::from_str(&v)?;
    let bid = v["block"].as_str().unwrap_or("").to_string();
    let hash = v["hash"].as_str().unwrap_or("").to_string();
    let perfect = v["perfect"].as_bool().unwrap_or(false);
    let dur_s = v["dur_s"].as_u64().unwrap_or(300) as i64;
    if !verify_secret(&hash, text) {
        c.store.audit("svc", "break.random.fail", &bid);
        if perfect {
            // Perfect mode: a typo burns the challenge — the next request
            // generates a fresh text
            c.store.set_setting(&key, "")?;
        }
        return Err(anyhow::anyhow!("INVALID: wrong text{}", if perfect { " (challenge reset)" } else { "" }));
    }
    c.store.set_setting(&key, "")?;
    let now = chrono::Local::now().timestamp();
    c.breaks.insert(bid.clone(), crate::state::BreakInfo {
        kind: "random".into(), activate_at: now, until: now + dur_s, pending: false,
    });
    c.store.audit("svc", "break.start", &bid);
    c.bump_rev();
    Ok(json!({ "ok": true, "until": now + dur_s }))
}

async fn start_cause_break(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let dur_m = p["duration_m"].as_u64().unwrap_or(30).clamp(1, 60);
    let now = chrono::Local::now().timestamp();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    if breaks_forbidden(&c.blocks[idx].lock) {
        return Err(anyhow::anyhow!("LOCKED: breaks are not allowed on this lock"));
    }
    let bid = c.blocks[idx].id.clone();
    // pause-for-a-cause: hard cap 2/day
    let key = format!("cause.{today}");
    let used: u64 = c.store.setting(&key).and_then(|v| v.parse().ok()).unwrap_or(0);
    if used >= 2 {
        return Err(anyhow::anyhow!("INVALID: daily cause-break cap reached (2/day)"));
    }
    c.store.set_setting(&key, &(used + 1).to_string())?;
    let granted = consume_lock_allowance(c, &bid, dur_m * 60)?;
    c.breaks.insert(bid.clone(), crate::state::BreakInfo {
        kind: "cause".into(), activate_at: now, until: now + granted as i64, pending: false,
    });
    c.store.audit("rpc", "break.cause", &format!("{name} {granted}s"));
    c.bump_rev();
    Ok(json!({ "ok": true, "until": now + granted as i64, "used_today": used + 1 }))
}

async fn end_break(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["name"].as_str().ok_or_else(|| anyhow::anyhow!("name required"))?;
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = block_idx(c, name)?;
    let bid = c.blocks[idx].id.clone();
    if c.breaks.remove(&bid).is_some() {
        c.store.audit("rpc", "break.end", name);
        c.bump_rev();
    }
    Ok(json!({ "ok": true }))
}

async fn stats(shared: &Shared, p: &Value) -> Result<Value> {
    let days = p["days"].as_u64().unwrap_or(7).clamp(1, 90) as u32;
    let c = shared.read().await;
    c.store.stats_summary(days)
}

async fn audit(shared: &Shared, p: &Value) -> Result<Value> {
    let n = p["last"].as_i64().unwrap_or(50);
    let c = shared.read().await;
    let mut stmt = c.store.app.prepare(
        "SELECT ts, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?1",
    )?;
    let rows: Vec<Value> = stmt
        .query_map([n], |r| {
            Ok(json!({
                "ts": r.get::<_, i64>(0)?, "actor": r.get::<_, String>(1)?,
                "action": r.get::<_, String>(2)?,
                "detail": r.get::<_, Option<String>>(3)?,
            }))
        })?
        .filter_map(|x| x.ok())
        .collect();
    Ok(json!({ "audit": rows }))
}

async fn set_setting(shared: &Shared, p: &Value) -> Result<Value> {
    let k = p["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?;
    let v = p["value"].as_str().unwrap_or("");
    let c = shared.read().await;
    c.store.set_setting(k, v)?;
    c.store.audit("rpc", "setting.set", &format!("{k}={v}"));
    Ok(json!({ "ok": true }))
}

async fn get_setting(shared: &Shared, p: &Value) -> Result<Value> {
    let k = p["key"].as_str().ok_or_else(|| anyhow::anyhow!("key required"))?;
    let c = shared.read().await;
    Ok(json!({ "key": k, "value": c.store.setting(k) }))
}
