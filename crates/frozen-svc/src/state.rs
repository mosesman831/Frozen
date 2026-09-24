//! In-memory runtime state: blocks, flags, connected clients, rev counter,
//! plus the M5 engines' mutable state (pomodoro, breaks, unlock tokens,
//! allowance, pause budget, restart-lock boot detection).

use frozen_common::proto::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub id: u64,
    /// "helper" | "nmh" | "gui" | "cli"
    pub kind: String,
    pub browser: Option<String>,
    pub pid: u32,
    /// last heartbeat (mono ms)
    pub last_beat: u64,
    /// sender for pushes (state/notify) — none for one-shot cli rpc calls
    pub push: Option<tokio::sync::mpsc::UnboundedSender<Envelope>>,
}

/// Pomodoro state machine (spec §15). `ends_at` is wall-clock so phase
/// length survives svc restarts and clock jitter.
#[derive(Debug, Clone)]
pub struct Pomodoro {
    /// "off" | "work" | "short_break" | "long_break"
    pub phase: String,
    /// unix time the current phase ends
    pub ends_at: i64,
    /// completed work cycles in this session
    pub cycle: u32,
    pub work_s: u64,
    pub short_s: u64,
    pub long_s: u64,
    /// every Nth work completion takes the long break
    pub cycles_per_long: u32,
}

impl Default for Pomodoro {
    fn default() -> Self {
        Pomodoro {
            phase: "off".into(),
            ends_at: 0,
            cycle: 0,
            work_s: 1500,
            short_s: 300,
            long_s: 900,
            cycles_per_long: 4,
        }
    }
}

impl Pomodoro {
    pub fn remaining(&self, now: i64) -> u64 {
        if self.phase == "off" {
            0
        } else if self.ends_at < 0 {
            (-self.ends_at) as u64 // paused: negative stash
        } else {
            (self.ends_at - now).max(0) as u64
        }
    }

    pub fn in_break(&self) -> bool {
        self.phase == "short_break" || self.phase == "long_break"
    }
}

/// A live or pending break on a block (spec §17).
#[derive(Debug, Clone)]
pub struct BreakInfo {
    /// "delay" | "random" | "cause"
    pub kind: String,
    /// unix time the break becomes effective — only meaningful while pending
    pub activate_at: i64,
    /// unix time the break ends
    pub until: i64,
    /// delay breaks stay pending until activate_at is reached
    pub pending: bool,
}

/// Result of the per-second engine tick, for the caller to act on (notify).
#[derive(Debug)]
pub enum EngineEvent {
    Notify { kind: &'static str, title: String, text: String },
    Audit { action: &'static str, detail: String },
}

pub struct Core {
    pub store: crate::db::Store,
    pub blocks: Vec<BlockInfo>,
    pub flags: Flags,
    pub rev: u64,
    pub paused: bool,
    /// unix time pause auto-expires (pause is always capped)
    pub paused_until: Option<i64>,
    pub pomodoro: Pomodoro,
    /// block_id -> live/pending break
    pub breaks: HashMap<String, BreakInfo>,
    /// token -> (block_id, expiry unix); one-shot ceremony passes
    pub unlock_tokens: HashMap<String, (String, i64)>,
    /// block_id -> (failed tries, lockout_until unix)
    pub unlock_fails: HashMap<String, (u32, i64)>,
    /// block_id -> (YYYY-MM-DD, seconds remaining) — daily site/app allowance
    pub allowance: HashMap<String, (String, u64)>,
    /// block_id -> (YYYY-MM-DD, seconds used) — allowance *lock* break budget
    pub lock_allow_used: HashMap<String, (String, u64)>,
    /// YYYY-MM-DD -> pause seconds used today (global pause budget)
    pub pause_used: (String, u64),
    /// unix epoch the system booted (detect restarts for Restart locks)
    pub boot_epoch: i64,
    /// last seen foreground window (exe path, title) — for app allowances
    pub last_fg: Option<(String, String)>,
    /// unix time the whole-computer lockout ends (0 = inactive; spec §21)
    pub frozen_until: i64,
    /// argon2id hash gating early exit (None = no ceremony)
    pub frozen_lock_hash: Option<String>,
    pub clients: HashMap<u64, ClientInfo>,
    pub next_client_id: u64,
}

pub type Shared = Arc<RwLock<Core>>;

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn boot_epoch() -> i64 {
    chrono::Local::now().timestamp() - (crate::db::uptime_ms() / 1000) as i64
}

impl Core {
    pub fn new(store: crate::db::Store) -> Core {
        let blocks = store.load_blocks().unwrap_or_default();
        let mut pomodoro = Pomodoro::default();
        // resume a persisted pomodoro session (phase still in the future)
        if let Some(s) = store.setting("pomodoro.session") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                let ends = v["ends_at"].as_i64().unwrap_or(0);
                let phase = v["phase"].as_str().unwrap_or("off");
                if phase != "off" && ends > chrono::Local::now().timestamp() {
                    pomodoro.phase = phase.into();
                    pomodoro.ends_at = ends;
                    pomodoro.cycle = v["cycle"].as_u64().unwrap_or(0) as u32;
                    pomodoro.work_s = v["work_s"].as_u64().unwrap_or(1500);
                    pomodoro.short_s = v["short_s"].as_u64().unwrap_or(300);
                    pomodoro.long_s = v["long_s"].as_u64().unwrap_or(900);
                    pomodoro.cycles_per_long = v["cpl"].as_u64().unwrap_or(4) as u32;
                }
            }
        }
        let mut c = Core {
            paused_until: None,
            pomodoro,
            breaks: HashMap::new(),
            unlock_tokens: HashMap::new(),
            unlock_fails: HashMap::new(),
            allowance: HashMap::new(),
            lock_allow_used: HashMap::new(),
            pause_used: (today(), 0),
            boot_epoch: boot_epoch(),
            last_fg: None,
            frozen_until: 0,
            frozen_lock_hash: None,
            store,
            blocks,
            flags: Flags::default(),
            rev: 1,
            paused: false,
            clients: HashMap::new(),
            next_client_id: 1,
        };
        // restore persisted daily allowances (`allowance.<id>` = "YYYY-MM-DD|remaining")
        let today = today();
        for b in &c.blocks {
            if b.allowance_seconds.is_none() {
                continue;
            }
            if let Some(v) = c.store.setting(&format!("allowance.{}", b.id)) {
                let mut it = v.splitn(2, '|');
                if let (Some(d), Some(r)) = (it.next(), it.next()) {
                    let remaining = r.parse().unwrap_or_else(|_| b.allowance_seconds.unwrap());
                    if d == today {
                        c.allowance.insert(b.id.clone(), (today.clone(), remaining));
                    }
                }
            }
        }
        // restore a frozen session that survives the service restart
        if let Some(s) = c.store.setting("frozen.session") {
            let mut it = s.splitn(2, '|');
            if let Some(u) = it.next().and_then(|v| v.parse::<i64>().ok()) {
                if u > chrono::Local::now().timestamp() {
                    c.frozen_until = u;
                    c.frozen_lock_hash = it
                        .next()
                        .map(String::from)
                        .filter(|h| !h.is_empty());
                }
            }
        }
        c.resolve_active();
        c
    }

    pub fn frozen_active(&self) -> bool {
        self.frozen_until > chrono::Local::now().timestamp()
    }

    /// Attempt to end the frozen session early. `credential` is required when
    /// the session was started with a ceremony lock. Rate-limits failures.
    /// Returns Err(reason) on refusal.
    pub fn try_frozen_stop(&mut self, credential: Option<&str>) -> Result<(), String> {
        if !self.frozen_active() {
            return Ok(());
        }
        let now = chrono::Local::now().timestamp();
        let (tries, lockout) = self.unlock_fails.get("frozen").copied().unwrap_or((0, 0));
        if tries >= 5 && now < lockout {
            return Err(format!("LOCKED: too many failed attempts ({}s)", lockout - now));
        }
        if let Some(hash) = self.frozen_lock_hash.clone() {
            let cred = credential.ok_or_else(|| "credential required".to_string())?;
            let ok = {
                use argon2::password_hash::{PasswordHash, PasswordVerifier};
                match PasswordHash::new(&hash) {
                    Ok(h) => argon2::Argon2::default()
                        .verify_password(cred.as_bytes(), &h)
                        .is_ok(),
                    Err(_) => false,
                }
            };
            if !ok {
                let tries = tries + 1;
                let lockout = if tries >= 5 {
                    now + 60 * (1i64 << (tries - 5).min(6))
                } else {
                    0
                };
                self.unlock_fails.insert("frozen".into(), (tries, lockout));
                let _ = self.store.audit("svc", "frozen.stop.fail", "");
                return Err("INVALID: wrong credential".into());
            }
        }
        self.frozen_until = 0;
        self.frozen_lock_hash = None;
        self.persist_frozen();
        self.bump_rev();
        let _ = self.store.audit("svc", "frozen.stop", "");
        Ok(())
    }

    pub fn persist_frozen(&self) {
        let _ = self.store.set_setting(
            "frozen.session",
            &format!(
                "{}|{}",
                self.frozen_until,
                self.frozen_lock_hash.clone().unwrap_or_default()
            ),
        );
    }

    pub fn persist_pomodoro(&self) {
        let v = serde_json::json!({
            "phase": self.pomodoro.phase, "ends_at": self.pomodoro.ends_at,
            "cycle": self.pomodoro.cycle, "work_s": self.pomodoro.work_s,
            "short_s": self.pomodoro.short_s, "long_s": self.pomodoro.long_s,
            "cpl": self.pomodoro.cycles_per_long,
        });
        let _ = self.store.set_setting("pomodoro.session", &v.to_string());
    }

    pub fn block_list_info(&self) -> BlockListInfo {
        let mut flags = self.flags.clone();
        flags.paused = self.paused;
        flags.pomodoro_phase = self.pomodoro.phase.clone();
        flags.pomodoro_remaining_s = self.pomodoro.remaining(chrono::Local::now().timestamp());
        flags.frozen_until = if self.frozen_active() { self.frozen_until } else { 0 };
        flags.frozen_locked = self.frozen_lock_hash.is_some();
        BlockListInfo { rev: self.rev, blocks: self.blocks.clone(), flags }
    }

    pub fn bump_rev(&mut self) {
        self.rev += 1;
    }

    /// A break currently suppressing this block's enforcement.
    fn break_active(&self, block_id: &str) -> Option<i64> {
        let now = chrono::Local::now().timestamp();
        self.breaks.get(block_id).and_then(|b| {
            if !b.pending && now < b.until {
                Some(b.until)
            } else {
                None
            }
        })
    }

    /// Recompute `active` on every block from schedule + enabled + paused +
    /// pomodoro phase + live breaks + exhausted allowances.
    pub fn resolve_active(&mut self) {
        let now = chrono::Local::now();
        let now_ts = now.timestamp();
        let paused = self.paused;
        // normalize + snapshot daily allowances first (avoids borrow conflict)
        let today = today();
        let mut remaining_map: HashMap<String, u64> = HashMap::new();
        for b in self.blocks.iter() {
            if let Some(quota) = b.allowance_seconds {
                let entry = self
                    .allowance
                    .entry(b.id.clone())
                    .or_insert_with(|| (today.clone(), quota));
                if entry.0 != today {
                    entry.0 = today.clone();
                    entry.1 = quota;
                }
                remaining_map.insert(b.id.clone(), entry.1);
            }
        }
        for b in self.blocks.iter_mut() {
            let pomodoro_ok = match b.pomodoro_phase.as_deref() {
                None => true,
                Some("work") => self.pomodoro.phase == "work",
                Some("break") => self.pomodoro.in_break(),
                _ => true,
            };
            // allowance quota: while budget remains the target is ALLOWED;
            // at 0 the block enforces for the rest of the day (spec §16)
            let allowance_ok = match (b.allowance_seconds, remaining_map.get(&b.id)) {
                (None, _) => true,
                (Some(_), Some(&0)) => true,
                (Some(_), _) => false,
            };
            b.break_until = self.breaks.get(&b.id).and_then(|br| {
                if br.activate_at <= now_ts && now_ts < br.until {
                    Some(br.until)
                } else {
                    None
                }
            });
            b.allowance_remaining = b
                .allowance_seconds
                .map(|_| remaining_map.get(&b.id).copied().unwrap_or(0));
            b.active = b.enabled
                && !paused
                && frozen_common::schedule_active(b, now)
                && pomodoro_ok
                && b.break_until.is_none()
                && allowance_ok;
        }
    }

    /// One engine tick (called every second). Returns events for the caller
    /// to fan out as notifications once the write guard is released.
    pub fn tick_engines(&mut self) -> Vec<EngineEvent> {
        let now = chrono::Local::now().timestamp();
        let mut ev = Vec::new();

        // ── pause auto-resume + daily budget ──────────────────────────
        if self.paused {
            if self.pause_used.0 != today() {
                self.pause_used = (today(), 0);
            }
            self.pause_used.1 += 1;
            let expired = self.paused_until.map(|u| now >= u).unwrap_or(false);
            let budget_gone = self.pause_used.1 >= 3600; // hard cap: 1h/day
            if expired || budget_gone {
                self.paused = false;
                self.paused_until = None;
                self.bump_rev();
                ev.push(EngineEvent::Audit { action: "pause.auto_resume", detail: String::new() });
                ev.push(EngineEvent::Notify {
                    kind: "info",
                    title: "Pause over".into(),
                    text: "Blocking has resumed".into(),
                });
            }
        }

        // ── pomodoro phase transitions ────────────────────────────────
        // ends_at < 0 marks a paused session (magnitude = remaining secs)
        if self.pomodoro.phase != "off" && self.pomodoro.ends_at > 0 && now >= self.pomodoro.ends_at {
            let (next, len) = match self.pomodoro.phase.as_str() {
                "work" => {
                    self.pomodoro.cycle += 1;
                    ev.push(EngineEvent::Audit {
                        action: "pomodoro.cycle",
                        detail: format!("cycle {} complete", self.pomodoro.cycle),
                    });
                    if self.pomodoro.cycles_per_long > 0
                        && self.pomodoro.cycle % self.pomodoro.cycles_per_long == 0
                    {
                        ("long_break", self.pomodoro.long_s)
                    } else {
                        ("short_break", self.pomodoro.short_s)
                    }
                }
                _ => ("work", self.pomodoro.work_s),
            };
            let done = self.pomodoro.phase.clone();
            self.pomodoro.phase = next.to_string();
            self.pomodoro.ends_at = now + len as i64;
            self.persist_pomodoro();
            self.bump_rev();
            ev.push(EngineEvent::Notify {
                kind: "info",
                title: format!("Pomodoro: {} done", done.replace('_', " ")),
                text: format!("{} phase started ({} min)", next.replace('_', " "), len / 60),
            });
            ev.push(EngineEvent::Audit { action: "pomodoro.phase", detail: next.into() });
        }
        // 5s warning before a phase ends
        if self.pomodoro.phase != "off" && self.pomodoro.ends_at > 0 && self.pomodoro.ends_at - now == 5 {
            ev.push(EngineEvent::Notify {
                kind: "info",
                title: "Pomodoro".into(),
                text: format!("{} ends in 5s", self.pomodoro.phase.replace('_', " ")),
            });
        }

        // ── breaks: pending -> live, live -> expired ──────────────────
        let mut gone = Vec::new();
        let mut need_bump = false;
        for (bid, br) in self.breaks.iter_mut() {
            if br.pending && now >= br.activate_at {
                br.pending = false;
                ev.push(EngineEvent::Notify {
                    kind: "info",
                    title: "Break started".into(),
                    text: format!("Break active for {}s", (br.until - now).max(0)),
                });
                ev.push(EngineEvent::Audit { action: "break.start", detail: bid.clone() });
                need_bump = true;
            } else if !br.pending && now >= br.until {
                gone.push(bid.clone());
            }
        }
        if need_bump {
            self.bump_rev();
        }
        for bid in gone {
            self.breaks.remove(&bid);
            ev.push(EngineEvent::Notify {
                kind: "info",
                title: "Break over".into(),
                text: "Blocking has resumed".into(),
            });
            ev.push(EngineEvent::Audit { action: "break.end", detail: bid });
            self.bump_rev();
        }

        // ── timer locks: clear when their wall-clock deadline passes ──
        {
            let mut cleared = false;
            for b in &mut self.blocks {
                if let LockKind::Timer { until } = b.lock {
                    if now >= until {
                        b.lock = LockKind::None;
                        let _ = self.store.save_block(b);
                        ev.push(EngineEvent::Audit {
                            action: "lock.timer_expired",
                            detail: b.name.clone(),
                        });
                        ev.push(EngineEvent::Notify {
                            kind: "info",
                            title: "Lock expired".into(),
                            text: format!("Timer lock on {} has expired", b.name),
                        });
                        cleared = true;
                    }
                }
            }
            if cleared {
                self.bump_rev();
            }
        }

        // ── frozen session expiry ────────────────────────────────────
        if self.frozen_until > 0 && now >= self.frozen_until {
            self.frozen_until = 0;
            self.frozen_lock_hash = None;
            self.persist_frozen();
            ev.push(EngineEvent::Audit { action: "frozen.end", detail: String::new() });
            ev.push(EngineEvent::Notify {
                kind: "info",
                title: "Frozen over".into(),
                text: "The computer is usable again".into(),
            });
            self.bump_rev();
        }

        // ── restart locks: clear on detected reboot ───────────────────
        let cur_boot = boot_epoch();
        if (cur_boot - self.boot_epoch).abs() > 60 {
            self.boot_epoch = cur_boot;
            let mut cleared = 0;
            for b in &mut self.blocks {
                if matches!(b.lock, LockKind::Restart) {
                    b.lock = LockKind::None;
                    let _ = self.store.save_block(b);
                    cleared += 1;
                }
            }
            if cleared > 0 {
                ev.push(EngineEvent::Audit {
                    action: "lock.restart_clear",
                    detail: format!("{cleared} blocks unlocked by reboot"),
                });
                self.bump_rev();
            }
        }

        // ── unlock token GC ───────────────────────────────────────────
        self.unlock_tokens.retain(|_, (_, exp)| *exp > now);

        ev
    }

    /// Consume a daily site allowance for a domain (browser tick) or an app
    /// (foreground second). Returns Some(block_name) when a quota just hit 0.
    pub fn spend_allowance<F>(&mut self, seconds: u64, matches: F) -> Option<String>
    where
        F: Fn(&BlockInfo) -> bool,
    {
        let today = today();
        let mut exhausted = Vec::new();
        let ids: Vec<String> = self
            .blocks
            .iter()
            .filter(|b| b.allowance_seconds.is_some() && b.enabled && matches(b))
            .map(|b| b.id.clone())
            .collect();
        for id in ids {
            let quota = self
                .blocks
                .iter()
                .find(|b| b.id == id)
                .and_then(|b| b.allowance_seconds)
                .unwrap_or(0);
            let entry = self
                .allowance
                .entry(id.clone())
                .or_insert_with(|| (today.clone(), quota));
            if entry.0 != today {
                entry.0 = today.clone();
                entry.1 = quota;
            }
            if entry.1 > 0 {
                entry.1 = entry.1.saturating_sub(seconds);
                let _ = self.store.set_setting(
                    &format!("allowance.{id}"),
                    &format!("{}|{}", entry.0, entry.1),
                );
                if entry.1 == 0 {
                    exhausted.push(id);
                }
            }
        }
        if exhausted.is_empty() {
            None
        } else {
            self.bump_rev();
            Some(exhausted.join(","))
        }
    }

    /// Find block by name (case-insensitive) or id.
    pub fn find_block(&self, name_or_id: &str) -> Option<&BlockInfo> {
        self.blocks
            .iter()
            .find(|b| b.id == name_or_id || b.name.eq_ignore_ascii_case(name_or_id))
    }

    /// Is this unlock token valid for this block right now?
    pub fn token_allows(&self, block_id: &str, token: Option<&str>) -> bool {
        let now = chrono::Local::now().timestamp();
        token
            .and_then(|t| self.unlock_tokens.get(t))
            .map(|(bid, exp)| bid == block_id && *exp > now)
            .unwrap_or(false)
    }

    /// Can this block be edited right now — via its lock's natural window or
    /// a ceremony token? `token` is the optional `unlock_token` rpc param.
    pub fn edit_allowed(&self, block_id: &str, token: Option<&str>) -> bool {
        let now = chrono::Local::now();
        let b = match self.find_block(block_id) {
            Some(b) => b,
            None => return false,
        };
        frozen_common::lock_allows_edit(&b.lock, now) || self.token_allows(&b.id, token)
    }
}
