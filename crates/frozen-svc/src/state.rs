//! In-memory runtime state: blocks, flags, connected clients, rev counter.

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

pub struct Core {
    pub store: crate::db::Store,
    pub blocks: Vec<BlockInfo>,
    pub flags: Flags,
    pub rev: u64,
    pub paused: bool,
    /// pomodoro phase off|work|break + remaining seconds
    pub pomodoro_phase: String,
    pub pomodoro_remaining_s: u64,
    pub clients: HashMap<u64, ClientInfo>,
    pub next_client_id: u64,
}

pub type Shared = Arc<RwLock<Core>>;

impl Core {
    pub fn new(store: crate::db::Store) -> Core {
        let blocks = store.load_blocks().unwrap_or_default();
        Core {
            store,
            blocks,
            flags: Flags::default(),
            rev: 1,
            paused: false,
            pomodoro_phase: "off".into(),
            pomodoro_remaining_s: 0,
            clients: HashMap::new(),
            next_client_id: 1,
        }
    }

    pub fn block_list_info(&self) -> BlockListInfo {
        let mut flags = self.flags.clone();
        flags.paused = self.paused;
        flags.pomodoro_phase = self.pomodoro_phase.clone();
        flags.pomodoro_remaining_s = self.pomodoro_remaining_s;
        BlockListInfo { rev: self.rev, blocks: self.blocks.clone(), flags }
    }

    pub fn bump_rev(&mut self) {
        self.rev += 1;
    }

    /// Recompute `active` on every block from schedule + enabled + paused.
    pub fn resolve_active(&mut self) {
        let now = chrono::Local::now();
        let paused = self.paused;
        for b in &mut self.blocks {
            b.active = b.enabled
                && !paused
                && frozen_common::schedule_active(b, now)
                && match b.pomodoro_phase.as_deref() {
                    None => true,
                    Some("work") => self.pomodoro_phase == "work",
                    Some("break") => self.pomodoro_phase == "break",
                    _ => true,
                };
        }
    }

    /// Find block by name (case-insensitive) or id.
    pub fn find_block(&self, name_or_id: &str) -> Option<&BlockInfo> {
        self.blocks
            .iter()
            .find(|b| b.id == name_or_id || b.name.eq_ignore_ascii_case(name_or_id))
    }
}
