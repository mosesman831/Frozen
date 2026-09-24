//! Wire protocol — envelopes, ops, and payload types shared by every process.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTO_VERSION: u32 = 1;

/// Pipe names — the service listens on both.
pub const PIPE_APP: &str = r"\\.\pipe\Frozen.App";
pub const PIPE_HELPER: &str = r"\\.\pipe\Frozen.Helper";
/// Native messaging hosts each get their own pipe endpoint per browser.
pub const PIPE_NMH_PREFIX: &str = r"\\.\pipe\Frozen.Nmh.";

/// Native messaging host name registered with browsers.
pub const NMH_NAME: &str = "com.frozen.frozen";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub op: String,
    #[serde(default)]
    pub id: u64,
    #[serde(default)]
    pub payload: Value,
}

impl Envelope {
    pub fn new(op: &str, payload: Value) -> Self {
        Envelope { v: PROTO_VERSION, op: op.to_string(), id: 0, payload }
    }

    pub fn req(op: &str, id: u64, payload: Value) -> Self {
        Envelope { v: PROTO_VERSION, op: op.to_string(), id, payload }
    }

    pub fn ok(id: u64, payload: Value) -> Self {
        Envelope::req("ok", id, payload)
    }

    pub fn err(id: u64, code: &str, msg: &str) -> Self {
        Envelope::req(
            "err",
            id,
            serde_json::json!({ "code": code, "message": msg }),
        )
    }
}

/// Ops used on all pipes.
pub mod op {
    pub const HELLO: &str = "hello";
    pub const OK: &str = "ok";
    pub const ERR: &str = "err";
    pub const BYE: &str = "bye";
    // svc -> host/helper pushes
    pub const STATE: &str = "state";
    pub const NOTIFY: &str = "notify";
    pub const OVERLAY: &str = "overlay";
    pub const CMD: &str = "cmd";
    // host/helper -> svc
    pub const BEAT: &str = "beat";
    pub const EVENT: &str = "event";
    pub const FG_EVENT: &str = "fg-event";
    pub const WATCHDOG: &str = "watchdog";
    // gui/cli -> svc rpc
    pub const RPC: &str = "rpc";
}

/// hello payload from a client connecting to the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    /// "helper" | "nmh" | "gui" | "cli"
    pub client: String,
    /// browser name for nmh clients
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub pid: u32,
    /// helper auth nonce
    #[serde(default)]
    pub nonce: Option<String>,
}

/// beat payload — extension liveness signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Beat {
    pub ts: i64,
    #[serde(default)]
    pub tabs: u32,
}

/// A single block rule (see spec §13.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub kind: RuleKind,
    pub value: String,
    #[serde(default)]
    pub negated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleKind {
    Domain,
    Wildcard,
    Url,
    Keyword,
    Regex,
    Path,
    Title,
    App,
    Folder,
    YtChannel,
}

/// Lock config on a block (spec §14).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LockKind {
    None,
    Timer { until: i64 },
    Range { start_hm: String, end_hm: String },
    Password { hash: String },
    RandomText { len: u32, perfect: bool },
    Restart,
    Allowance { seconds: u64 },
    Enforced,
    Frozen,
}

impl Default for LockKind {
    fn default() -> Self {
        LockKind::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    Always,
    Weekly,
    Range,
}

impl Default for ScheduleKind {
    fn default() -> Self {
        ScheduleKind::Always
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockInfo {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// true = whitelist mode ("block everything except")
    pub allow_mode: bool,
    pub block_all_internet: bool,
    pub rules: Vec<Rule>,
    pub schedule_kind: ScheduleKind,
    /// 168 half-hour slots for weekly schedules
    #[serde(default)]
    pub schedule_grid: Vec<bool>,
    #[serde(default)]
    pub schedule_start: Option<i64>,
    #[serde(default)]
    pub schedule_end: Option<i64>,
    #[serde(default)]
    pub lock: LockKind,
    #[serde(default)]
    pub allowance_seconds: Option<u64>,
    #[serde(default)]
    pub allowance_remaining: Option<u64>,
    /// "work" | "break" | null
    #[serde(default)]
    pub pomodoro_phase: Option<String>,
    #[serde(default)]
    pub force_close: bool,
    /// runtime-computed: whether this block is actively enforcing right now
    #[serde(default)]
    pub active: bool,
}

/// The state blob pushed to extensions/helpers (spec §11.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockListInfo {
    pub rev: u64,
    pub blocks: Vec<BlockInfo>,
    pub flags: Flags,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Flags {
    pub stats_enabled: bool,
    pub stats_enabled_incognito: bool,
    pub ignore_incognito: bool,
    pub force_allow_file: bool,
    pub block_inactive: bool,
    pub block_split: bool,
    pub block_embedded: bool,
    pub stats_strict: bool,
    pub paused: bool,
    pub pomodoro_phase: String,
    pub pomodoro_remaining_s: u64,
}

impl Default for Flags {
    fn default() -> Self {
        Flags {
            stats_enabled: true,
            stats_enabled_incognito: false,
            ignore_incognito: false,
            force_allow_file: true,
            block_inactive: true,
            block_split: true,
            block_embedded: true,
            stats_strict: false,
            paused: false,
            pomodoro_phase: "off".into(),
            pomodoro_remaining_s: 0,
        }
    }
}

/// notify payload sent svc -> helper for toasts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notify {
    /// "info" | "warn" | "block" | "grace"
    pub kind: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub urgent: bool,
}

/// Foreground-window sample helper -> svc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FgEvent {
    pub ts: i64,
    pub process: String,
    pub path: String,
    pub title: String,
    pub pid: u32,
}

/// Status rpc result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusInfo {
    pub version: String,
    pub service_running: bool,
    pub helper_connected: bool,
    pub ext_clients: u32,
    pub rev: u64,
    pub blocks_total: usize,
    pub blocks_active: usize,
}
