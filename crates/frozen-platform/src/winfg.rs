//! Foreground-window capture (used by the helper's stats sensor).

use crate::procs::process_path;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};

/// Snapshot of the current foreground window: (pid, exe basename, full path, title).
pub fn foreground() -> Option<(u32, String, String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let path = process_path(pid).unwrap_or_default();
        let name = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_lowercase();
        let len = GetWindowTextLengthW(hwnd);
        let title = if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let n = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..n as usize])
        } else {
            String::new()
        };
        Some((pid, name, path, title))
    }
}
