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
        "audit" => audit(shared, params).await,
        "set-setting" | "set_setting" => set_setting(shared, params).await,
        "get-setting" | "get_setting" => get_setting(shared, params).await,
        _ => Err(anyhow::anyhow!("unknown rpc: {method}")),
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
    let b = c
        .find_block(name)
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?;
    if !frozen_common::lock_allows_edit(&b.lock, chrono::Local::now()) {
        return Err(anyhow::anyhow!("LOCKED: block is locked"));
    }
    let id = b.id.clone();
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
    let idx = c
        .blocks
        .iter()
        .position(|b| b.id == name || b.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?;
    if !frozen_common::lock_allows_edit(&c.blocks[idx].lock, chrono::Local::now()) {
        return Err(anyhow::anyhow!("LOCKED: block is locked"));
    }
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
    let idx = c
        .blocks
        .iter()
        .position(|b| b.id == name || b.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?;
    if !frozen_common::lock_allows_edit(&c.blocks[idx].lock, chrono::Local::now()) {
        return Err(anyhow::anyhow!("LOCKED: block is locked"));
    }
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
    let idx = c
        .blocks
        .iter()
        .position(|b| b.id == name || b.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?;
    if !on && !frozen_common::lock_allows_edit(&c.blocks[idx].lock, chrono::Local::now()) {
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
    set_enabled(shared, &json!({"name": name}), !cur).await
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
    let mut c = shared.write().await;
    c.paused = !p["off"].as_bool().unwrap_or(false);
    c.bump_rev();
    c.store.audit("rpc", if c.paused { "pause" } else { "resume" }, "");
    Ok(json!({ "paused": c.paused }))
}

async fn set_lock(shared: &Shared, p: &Value) -> Result<Value> {
    let name = p["block"].as_str().ok_or_else(|| anyhow::anyhow!("block required"))?;
    let lock: LockKind = serde_json::from_value(p["lock"].clone())?;
    let mut c = shared.write().await;
    let c = &mut *c;
    let idx = c
        .blocks
        .iter()
        .position(|b| b.id == name || b.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("no such block: {name}"))?;
    if !frozen_common::lock_allows_edit(&c.blocks[idx].lock, chrono::Local::now()) {
        return Err(anyhow::anyhow!("LOCKED: cannot change lock on a locked block"));
    }
    c.blocks[idx].lock = lock;
    let b = c.blocks[idx].clone();
    c.store.save_block(&b)?;
    c.bump_rev();
    c.store.audit("rpc", "lock.change", name);
    Ok(json!({ "ok": true }))
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
    let mut c = shared.write().await;
    match action {
        "start" => {
            let work = p["work_s"].as_u64().unwrap_or(1500);
            c.pomodoro_phase = "work".into();
            c.pomodoro_remaining_s = work;
        }
        "stop" => {
            c.pomodoro_phase = "off".into();
            c.pomodoro_remaining_s = 0;
        }
        _ => {}
    }
    c.bump_rev();
    Ok(json!({ "phase": c.pomodoro_phase, "remaining": c.pomodoro_remaining_s }))
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
