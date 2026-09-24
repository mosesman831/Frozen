//! Schedule evaluation (spec: always / weekly grid / date range).

use crate::proto::{BlockInfo, ScheduleKind};
use chrono::{Datelike, Local, Timelike};

/// Half-hour slots per week: 7 days * 48 slots = 336 bits stored as bools.
/// Slot index = weekday(Mon=0..Sun=6) * 48 + hour*2 + (minute>=30).
pub fn weekly_slot_active(grid: &[bool], when: chrono::DateTime<Local>) -> bool {
    if grid.is_empty() {
        return false;
    }
    let weekday = when.weekday().num_days_from_monday() as usize;
    let slot = weekday * 48 + when.hour() as usize * 2 + (when.minute() >= 30) as usize;
    grid.get(slot).copied().unwrap_or(false)
}

/// Is this block active right now, given schedule only (ignores locks/breaks).
pub fn schedule_active(b: &BlockInfo, now: chrono::DateTime<Local>) -> bool {
    match b.schedule_kind {
        ScheduleKind::Always => true,
        ScheduleKind::Weekly => weekly_slot_active(&b.schedule_grid, now),
        ScheduleKind::Range => {
            let t = now.timestamp();
            match (b.schedule_start, b.schedule_end) {
                (Some(s), Some(e)) => t >= s && t <= e,
                (Some(s), None) => t >= s,
                (None, Some(e)) => t <= e,
                _ => false,
            }
        }
    }
}

/// Is the lock's *edit window* currently open — i.e. can the user modify
/// the block right now? (Distinct from whether the block is enforcing.)
/// For `range` locks the user can edit only inside the range.
pub fn lock_allows_edit(lock: &crate::proto::LockKind, now: chrono::DateTime<Local>) -> bool {
    use crate::proto::LockKind::*;
    match lock {
        None => true,
        Enforced | Frozen => false,
        Timer { until } => now.timestamp() >= *until,
        Restart => false, // only cleared by detected restart
        Range { start_hm, end_hm } => {
            let cur = now.format("%H:%M").to_string();
            cur >= *start_hm && cur <= *end_hm
        }
        Password { .. } | RandomText { .. } => false, // gated by ceremony
        Allowance { .. } => false,
    }
}
