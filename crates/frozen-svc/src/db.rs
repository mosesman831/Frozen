//! SQLite persistence — schema per spec §12.
//!
//! Layout (all under %ProgramData%\Frozen, overridable via FROZEN_DATA_DIR):
//!   data-app.db     settings, audit, install_secret
//!   data-service.db blocks, rules, app catalog, fingerprints
//!   data-helper.db  app/title usage stats
//!   data-browser.db domain stats
//!   data-frozen.db  frozen-mode sessions

use anyhow::Result;
use frozen_common::proto::*;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub struct Store {
    pub dir: PathBuf,
    pub app: Connection,
    pub service: Connection,
    pub helper: Connection,
    pub browser: Connection,
    pub frozen: Connection,
    secret: Vec<u8>,
}

const SCHEMA_APP: &str = r#"
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  mono INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS install_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret BLOB NOT NULL
);
"#;

const SCHEMA_SERVICE: &str = r#"
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'block',
  block_all_internet INTEGER NOT NULL DEFAULT 0,
  schedule_kind TEXT NOT NULL DEFAULT 'always',
  schedule_grid BLOB,
  schedule_start INTEGER,
  schedule_end INTEGER,
  lock_kind TEXT NOT NULL DEFAULT 'none',
  lock_param TEXT,
  lock_since INTEGER,
  allowance_seconds INTEGER,
  allowance_scope TEXT DEFAULT 'per_rule',
  pomodoro_phase TEXT,
  force_close INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  sig BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_enabled ON blocks(enabled);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  negated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(block_id, kind, value, negated)
);
CREATE INDEX IF NOT EXISTS idx_rules_block ON rules(block_id);
CREATE TABLE IF NOT EXISTS app_catalog (
  path TEXT PRIMARY KEY,
  name TEXT, version TEXT, icon BLOB,
  first_seen INTEGER, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS app_fingerprints (
  app_path TEXT PRIMARY KEY,
  sha256_prefix BLOB NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL
);
"#;

const SCHEMA_HELPER: &str = r#"
CREATE TABLE IF NOT EXISTS usage_app (
  day TEXT NOT NULL, process TEXT NOT NULL, path TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, process, path)
);
CREATE TABLE IF NOT EXISTS usage_title (
  day TEXT NOT NULL, process TEXT NOT NULL, title TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, process, title)
);
CREATE TABLE IF NOT EXISTS stats_blocked (
  day TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, target)
);
"#;

const SCHEMA_BROWSER: &str = r#"
CREATE TABLE IF NOT EXISTS usage_domain (
  day TEXT NOT NULL, domain TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, domain)
);
"#;

const SCHEMA_FROZEN: &str = r#"
CREATE TABLE IF NOT EXISTS frozen_sessions (
  id TEXT PRIMARY KEY,
  started INTEGER NOT NULL,
  ends INTEGER NOT NULL,
  mono_start INTEGER NOT NULL,
  active INTEGER NOT NULL
);
"#;

impl Store {
    pub fn open() -> Result<Store> {
        let dir = frozen_platform::data_dir();
        std::fs::create_dir_all(&dir)?;
        Self::open_at(dir)
    }

    pub fn open_at(dir: PathBuf) -> Result<Store> {
        let open = |name: &str, schema: &str| -> Result<Connection> {
            let c = Connection::open(dir.join(name))?;
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.execute_batch(schema)?;
            Ok(c)
        };
        let app = open("data-app.db", SCHEMA_APP)?;
        let service = open("data-service.db", SCHEMA_SERVICE)?;
        let helper = open("data-helper.db", SCHEMA_HELPER)?;
        let browser = open("data-browser.db", SCHEMA_BROWSER)?;
        let frozen = open("data-frozen.db", SCHEMA_FROZEN)?;

        // install secret: 32 random bytes, created once
        let secret: Vec<u8> = {
            let existing: Option<Vec<u8>> = app
                .query_row("SELECT secret FROM install_secret WHERE id = 1", [], |r| r.get(0))
                .ok();
            match existing {
                Some(s) if s.len() == 32 => s,
                _ => {
                    use rand::RngCore;
                    let mut s = vec![0u8; 32];
                    rand::thread_rng().fill_bytes(&mut s);
                    app.execute(
                        "INSERT OR REPLACE INTO install_secret (id, secret) VALUES (1, ?1)",
                        params![s],
                    )?;
                    s
                }
            }
        };

        Ok(Store { dir, app, service, helper, browser, frozen, secret })
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }

    // ── settings ──────────────────────────────────────────────────────────

    pub fn setting(&self, key: &str) -> Option<String> {
        self.app
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
            .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.app.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn setting_bool(&self, key: &str, default: bool) -> bool {
        self.setting(key).map(|v| v == "1" || v == "true").unwrap_or(default)
    }

    // ── audit ────────────────────────────────────────────────────────────

    pub fn audit(&self, actor: &str, action: &str, detail: &str) {
        let _ = self.app.execute(
            "INSERT INTO audit (ts, mono, actor, action, detail) VALUES (?1,?2,?3,?4,?5)",
            params![
                chrono::Local::now().timestamp(),
                uptime_ms() as i64,
                actor,
                action,
                detail
            ],
        );
    }

    // ── blocks ───────────────────────────────────────────────────────────

    fn block_sig(&self, b: &BlockInfo) -> Vec<u8> {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.secret).unwrap();
        mac.update(b.id.as_bytes());
        mac.update(b.name.as_bytes());
        mac.update(&[b.enabled as u8, b.allow_mode as u8, b.block_all_internet as u8]);
        mac.update(serde_json::to_string(&b.lock).unwrap_or_default().as_bytes());
        for r in &b.rules {
            mac.update(frozen_common::rules::kind_name(&r.kind).as_bytes());
            mac.update(r.value.as_bytes());
            mac.update(&[r.negated as u8]);
        }
        mac.finalize().into_bytes().to_vec()
    }

    /// Load all blocks (verifies sig — tampered rows are dropped + audited).
    pub fn load_blocks(&self) -> Result<Vec<BlockInfo>> {
        let mut stmt = self.service.prepare(
            "SELECT id,name,enabled,kind,block_all_internet,schedule_kind,schedule_grid,
                    schedule_start,schedule_end,lock_kind,lock_param,allowance_seconds,
                    pomodoro_phase,force_close,sig
             FROM blocks",
        )?;
        let mut rules_stmt = self.service.prepare(
            "SELECT kind, value, negated FROM rules WHERE block_id = ?1 ORDER BY id",
        )?;

        #[allow(clippy::type_complexity)]
        let rows: Vec<(String, String, i64, String, i64, String, Option<Vec<u8>>, Option<i64>, Option<i64>, String, Option<String>, Option<i64>, Option<String>, i64, Vec<u8>)> =
            stmt.query_map([], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                    r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?,
                ))
            })?
            .collect::<Result<_, _>>()?;

        let mut out = Vec::new();
        for (id, name, enabled, kind, bai, sk, grid, ss, se, lk, lp, allow, pp, fc, sig) in rows {
            let rules: Vec<Rule> = rules_stmt
                .query_map(params![id], |r| {
                    let k: String = r.get(0)?;
                    let v: String = r.get(1)?;
                    let n: i64 = r.get(2)?;
                    Ok((k, v, n))
                })?
                .filter_map(|x| x.ok())
                .filter_map(|(k, v, n)| {
                    frozen_common::rules::kind_from_name(&k).map(|kind| Rule {
                        kind,
                        value: v,
                        negated: n != 0,
                    })
                })
                .collect();

            let lock: LockKind = decode_lock(&lk, lp.as_deref());

            let b = BlockInfo {
                id: id.clone(),
                name,
                enabled: enabled != 0,
                allow_mode: kind == "allow",
                block_all_internet: bai != 0,
                rules,
                schedule_kind: match sk.as_str() {
                    "weekly" => ScheduleKind::Weekly,
                    "range" => ScheduleKind::Range,
                    _ => ScheduleKind::Always,
                },
                schedule_grid: grid
                    .map(|g| g.iter().map(|&b| b != 0).collect())
                    .unwrap_or_default(),
                schedule_start: ss,
                schedule_end: se,
                lock,
                allowance_seconds: allow.map(|x| x as u64),
                allowance_remaining: None,
                pomodoro_phase: pp,
                force_close: fc != 0,
                active: false,
                break_until: None,
            };
            if self.block_sig(&b) == sig {
                out.push(b);
            } else {
                self.audit("svc", "state.tamper", &format!("block {} dropped (bad sig)", id));
            }
        }
        Ok(out)
    }

    /// Persist a block (insert or full update) + its rules, with sig.
    pub fn save_block(&self, b: &BlockInfo) -> Result<()> {
        let now = chrono::Local::now().timestamp();
        let sig = self.block_sig(b);
        let (lk, lp) = encode_lock(&b.lock);
        self.service.execute(
            "INSERT INTO blocks (id,name,enabled,kind,block_all_internet,schedule_kind,
                schedule_grid,schedule_start,schedule_end,lock_kind,lock_param,
                allowance_seconds,pomodoro_phase,force_close,created,updated,sig)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, enabled=excluded.enabled, kind=excluded.kind,
                block_all_internet=excluded.block_all_internet,
                schedule_kind=excluded.schedule_kind, schedule_grid=excluded.schedule_grid,
                schedule_start=excluded.schedule_start, schedule_end=excluded.schedule_end,
                lock_kind=excluded.lock_kind, lock_param=excluded.lock_param,
                allowance_seconds=excluded.allowance_seconds,
                pomodoro_phase=excluded.pomodoro_phase, force_close=excluded.force_close,
                updated=excluded.updated, sig=excluded.sig",
            params![
                b.id, b.name, b.enabled as i64,
                if b.allow_mode { "allow" } else { "block" },
                b.block_all_internet as i64,
                match b.schedule_kind {
                    ScheduleKind::Always => "always",
                    ScheduleKind::Weekly => "weekly",
                    ScheduleKind::Range => "range",
                },
                b.schedule_grid.iter().map(|&x| x as u8).collect::<Vec<u8>>(),
                b.schedule_start, b.schedule_end,
                lk, lp, b.allowance_seconds.map(|x| x as i64),
                b.pomodoro_phase, b.force_close as i64, now, sig,
            ],
        )?;
        self.service.execute("DELETE FROM rules WHERE block_id = ?1", params![b.id])?;
        for r in &b.rules {
            self.service.execute(
                "INSERT INTO rules (block_id, kind, value, negated) VALUES (?1,?2,?3,?4)",
                params![b.id, frozen_common::rules::kind_name(&r.kind), r.value, r.negated as i64],
            )?;
        }
        Ok(())
    }

    pub fn delete_block(&self, id: &str) -> Result<()> {
        self.service.execute("DELETE FROM blocks WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── stats ─────────────────────────────────────────────────────────────

    pub fn record_fg(&self, ev: &FgEvent) {
        let day = chrono::DateTime::from_timestamp(ev.ts, 0)
            .map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        let _ = self.helper.execute(
            "INSERT INTO usage_app (day, process, path, seconds) VALUES (?1,?2,?3,1)
             ON CONFLICT(day,process,path) DO UPDATE SET seconds = seconds + 1",
            params![day, ev.process, ev.path],
        );
        if self.setting_bool("stats.strict", false) && !ev.title.is_empty() {
            let _ = self.helper.execute(
                "INSERT INTO usage_title (day, process, title, seconds) VALUES (?1,?2,?3,1)
                 ON CONFLICT(day,process,title) DO UPDATE SET seconds = seconds + 1",
                params![day, ev.process, ev.title],
            );
        }
    }

    pub fn record_blocked(&self, kind: &str, target: &str) {
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = self.helper.execute(
            "INSERT INTO stats_blocked (day, kind, target, attempts) VALUES (?1,?2,?3,1)
             ON CONFLICT(day,kind,target) DO UPDATE SET attempts = attempts + 1",
            params![day, kind, target],
        );
    }

    pub fn record_domain(&self, domain: &str, seconds: i64, blocked: bool) {
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = self.browser.execute(
            "INSERT INTO usage_domain (day, domain, seconds, visits, blocked)
             VALUES (?1,?2,?3,1,?4)
             ON CONFLICT(day,domain) DO UPDATE SET
               seconds = seconds + excluded.seconds,
               visits = visits + 1,
               blocked = blocked + excluded.blocked",
            params![day, domain, seconds, blocked as i64],
        );
    }
}

// ── lock encode/decode ─────────────────────────────────────────────────────

fn encode_lock(l: &LockKind) -> (&'static str, Option<String>) {
    match l {
        LockKind::None => ("none", None),
        LockKind::Timer { until } => ("timer", Some(until.to_string())),
        LockKind::Range { start_hm, end_hm } => {
            ("range", Some(format!("{}|{}", start_hm, end_hm)))
        }
        LockKind::Password { hash } => ("password", Some(hash.clone())),
        LockKind::RandomText { len, perfect, hash } => (
            "random_text",
            Some(format!("{}|{}|{}", len, perfect, hash.clone().unwrap_or_default())),
        ),
        LockKind::Restart => ("restart", None),
        LockKind::Allowance { seconds } => ("allowance", Some(seconds.to_string())),
        LockKind::Enforced => ("enforced", None),
        LockKind::Frozen => ("frozen", None),
    }
}

fn decode_lock(kind: &str, param: Option<&str>) -> LockKind {
    match kind {
        "timer" => LockKind::Timer {
            until: param.and_then(|p| p.parse().ok()).unwrap_or(0),
        },
        "range" => {
            let mut it = param.unwrap_or("00:00|00:00").splitn(2, '|');
            LockKind::Range {
                start_hm: it.next().unwrap_or("00:00").into(),
                end_hm: it.next().unwrap_or("00:00").into(),
            }
        }
        "password" => LockKind::Password {
            hash: param.unwrap_or_default().into(),
        },
        "random_text" => {
            let mut it = param.unwrap_or("100|false").splitn(3, '|');
            LockKind::RandomText {
                len: it.next().and_then(|s| s.parse().ok()).unwrap_or(100),
                perfect: it.next().map(|s| s == "true").unwrap_or(false),
                hash: it.next().and_then(|s| {
                    if s.is_empty() { None } else { Some(s.to_string()) }
                }),
            }
        }
        "restart" => LockKind::Restart,
        "allowance" => LockKind::Allowance {
            seconds: param.and_then(|p| p.parse().ok()).unwrap_or(0),
        },
        "enforced" => LockKind::Enforced,
        "frozen" => LockKind::Frozen,
        _ => LockKind::None,
    }
}

/// Milliseconds since boot (monotonic — immune to wall-clock tampering).
pub fn uptime_ms() -> u64 {
    #[cfg(windows)]
    {
        // GetTickCount64 via windows crate
        unsafe { windows::Win32::System::SystemInformation::GetTickCount64() }
    }
    #[cfg(not(windows))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

pub fn db_dir_path(dir: &Path) -> PathBuf {
    dir.to_path_buf()
}
