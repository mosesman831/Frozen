//! Process enumeration, window-title capture, and termination (Windows).

use anyhow::Result;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, BOOL};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};
use windows::core::PWSTR;

#[derive(Debug, Clone)]
pub struct ProcInfo {
    pub pid: u32,
    /// exe basename, e.g. "chrome.exe" (lowercase)
    pub name: String,
    /// full image path if accessible
    pub path: String,
}

/// Snapshot of all running processes.
pub fn list_processes() -> Result<Vec<ProcInfo>> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        let mut out = Vec::with_capacity(256);
        let mut pe = PROCESSENTRY32W::default();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                let name = pwstr_to_string(&pe.szExeFile);
                let path = process_path(pe.th32ProcessID).unwrap_or_default();
                out.push(ProcInfo {
                    pid: pe.th32ProcessID,
                    name: name.to_lowercase(),
                    path,
                });
                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        Ok(out)
    }
}

/// Which browser spawned this process — walks up to 4 parents looking for a
/// known browser image name. Used by frozen-nmh since a native-messaging
/// manifest `path` cannot carry arguments.
pub fn detect_browser() -> Option<String> {
    let mut pid = std::process::id();
    for _ in 0..4 {
        let (ppid, name) = parent_of(pid)?;
        if ppid == 0 || ppid == pid {
            return None;
        }
        let n = name.to_lowercase();
        let known = match n.as_str() {
            "chrome.exe" => Some("chrome"),
            "msedge.exe" => Some("edge"),
            "firefox.exe" => Some("firefox"),
            "brave.exe" => Some("brave"),
            _ => None,
        };
        if let Some(b) = known {
            return Some(b.to_string());
        }
        pid = ppid;
    }
    None
}

/// (ppid, image name) of the parent of `pid`.
fn parent_of(pid: u32) -> Option<(u32, String)> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut pe = PROCESSENTRY32W::default();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ppid = 0u32;
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                if pe.th32ProcessID == pid {
                    ppid = pe.th32ParentProcessID;
                    break;
                }
                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        if ppid == 0 {
            let _ = CloseHandle(snap);
            return None;
        }
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut name = String::new();
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                if pe.th32ProcessID == ppid {
                    name = pwstr_to_string(&pe.szExeFile);
                    break;
                }
                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        Some((ppid, name))
    }
}

/// Full image path of a process (empty string if access denied / exited).
pub fn process_path(pid: u32) -> Result<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r?;
        Ok(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Terminate a process tree entry (the process itself).
pub fn kill_process(pid: u32) -> Result<()> {
    unsafe {
        let h = OpenProcess(PROCESS_TERMINATE, false, pid)?;
        let r = TerminateProcess(h, 1);
        let _ = CloseHandle(h);
        r?;
        Ok(())
    }
}

/// All visible top-level window titles for a pid.
pub fn window_titles(pid: u32) -> Vec<String> {
    struct Ctx {
        pid: u32,
        out: Vec<String>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let ctx = &mut *(lp.0 as *mut Ctx);
        let mut wpid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut wpid));
        if wpid == ctx.pid && IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
            let mut buf = vec![0u16; (GetWindowTextLengthW(hwnd) + 1) as usize];
            let n = GetWindowTextW(hwnd, &mut buf);
            if n > 0 {
                ctx.out.push(String::from_utf16_lossy(&buf[..n as usize]));
            }
        }
        BOOL(1)
    }
    let mut ctx = Ctx { pid, out: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.out
}

fn pwstr_to_string(s: &[u16; 260]) -> String {
    let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
    String::from_utf16_lossy(&s[..end])
}
