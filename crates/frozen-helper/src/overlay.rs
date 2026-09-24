//! Frozen-mode lockout overlay (spec §21 v1).
//!
//! One full-screen always-on-top window spanning the whole virtual screen,
//! painted by hand on raw Win32 (no GUI framework): black background, big
//! countdown, an "END EARLY" button and an inline credential box.
//!
//! Low-level WH_KEYBOARD_LL / WH_MOUSE_LL hooks swallow all user input
//! except clicks on the overlay's own controls. Ctrl+Alt+Del is a Secure
//! Attention Sequence — it cannot be hooked and still reaches Winlogon,
//! which is intentional (documented escape hatches live in spec §21).
//!
//! The overlay runs on its own thread with a real message pump; the tokio
//! runtime just calls `set_active` / `clear`. Stopping takes effect within
//! ~1s (next WM_TIMER tick) or immediately via a wake message.

use std::sync::{Mutex, OnceLock};
use tokio::sync::mpsc::UnboundedSender;
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DrawTextW, EndPaint, FillRect, InvalidateRect, Rectangle,
    SetBkMode, SetTextColor, DT_CENTER, DT_SINGLELINE, DT_VCENTER, PAINTSTRUCT,
    TRANSPARENT, DRAW_TEXT_FORMAT, HBRUSH,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_BACK, VK_ESCAPE, VK_RETURN, VK_SHIFT, VK_SPACE,
};
use windows::Win32::UI::WindowsAndMessaging::*;

const WM_WAKE: u32 = WM_APP + 1;

struct State {
    until: i64,
    locked: bool,
    done: bool,
    typing: bool,
    typed: String,
    fail_flash_until: i64,
    hwnd: isize,
    stop_tx: Option<UnboundedSender<String>>,
    // screen coords of the interactive controls (set on first paint)
    button: RECT,
    input: RECT,
    screen: RECT,
}

fn state() -> &'static Mutex<Option<State>> {
    static S: OnceLock<Mutex<Option<State>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn now() -> i64 {
    chrono::Local::now().timestamp()
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Engage the overlay (idempotent: re-calling updates until/locked only).
/// `stop_tx` carries a submitted credential back to the service as a
/// `frozen_stop` event.
pub fn set_active(until: i64, locked: bool, stop_tx: UnboundedSender<String>) {
    {
        let mut g = state().lock().unwrap();
        if let Some(s) = g.as_mut() {
            s.until = until;
            s.locked = locked;
            return;
        }
        *g = Some(State {
            until,
            locked,
            done: false,
            typing: false,
            typed: String::new(),
            fail_flash_until: 0,
            hwnd: 0,
            stop_tx: Some(stop_tx),
            button: RECT::default(),
            input: RECT::default(),
            screen: RECT::default(),
        });
    }
    std::thread::spawn(overlay_thread);
}

/// Disengage (idempotent). The window dies within ~1s.
pub fn clear() {
    let mut g = state().lock().unwrap();
    if let Some(s) = g.as_mut() {
        s.done = true;
        if s.hwnd != 0 {
            unsafe {
                let _ = PostMessageW(HWND(s.hwnd as _), WM_WAKE, WPARAM(0), LPARAM(0));
            }
        }
    }
}

pub fn active() -> bool {
    state()
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| !s.done)
        .unwrap_or(false)
}

fn overlay_thread() {
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let class = w!("FrozenOverlayWindow");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: class,
            hbrBackground: HBRUSH(
                windows::Win32::Graphics::Gdi::GetStockObject(
                    windows::Win32::Graphics::Gdi::BLACK_BRUSH,
                )
                .0,
            ),
            ..Default::default()
        };
        let _ = RegisterClassExW(&wc);

        let (x, y, w, h) = (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        );
        {
            let mut g = state().lock().unwrap();
            if let Some(s) = g.as_mut() {
                s.screen = RECT {
                    left: x,
                    top: y,
                    right: x + w,
                    bottom: y + h,
                };
            }
        }
        let hwnd = match CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class,
            w!("Frozen"),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            w,
            h,
            None,
            None,
            hinst,
            None,
        ) {
            Ok(h) => h,
            Err(_) => {
                state().lock().unwrap().take();
                return;
            }
        };
        {
            let mut g = state().lock().unwrap();
            if let Some(s) = g.as_mut() {
                s.hwnd = hwnd.0 as isize;
            }
        }
        let _ = SetTimer(hwnd, 1, 1000, None);
        let _ = SetWindowsHookExW(WH_KEYBOARD_LL, Some(kbd_proc), hinst, 0);
        let _ = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hinst, 0);

        let mut msg = MSG::default();
        loop {
            let done = state()
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.done)
                .unwrap_or(true);
            if done {
                break;
            }
            while PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    break;
                }
                TranslateMessage(&msg);
                let _ = DispatchMessageW(&msg);
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        let _ = DestroyWindow(hwnd);
        state().lock().unwrap().take();
    }
}

/// Click targets the overlay allows the mouse to reach: its own controls.
/// Everything else is swallowed, which keeps clicks off the desktop shell.
fn in_rect(p: &POINT, r: &RECT) -> bool {
    p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
}

unsafe extern "system" fn kbd_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
        let mut typing = false;
        {
            let g = state().lock().unwrap();
            if let Some(s) = g.as_ref() {
                typing = s.typing && !s.done;
            }
        }
        let down = matches!(
            w.0 as u32,
            x if x == WM_KEYDOWN || x == WM_SYSKEYDOWN
        );
        if !typing {
            return LRESULT(1); // swallow everything
        }
        if down {
            let kb = &*(l.0 as *const KBDLLHOOKSTRUCT);
            let mut submit = false;
            {
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    match VIRTUAL_KEY(kb.vkCode as u16) {
                        VK_ESCAPE => {
                            s.typing = false;
                            s.typed.clear();
                        }
                        VK_BACK => {
                            s.typed.pop();
                        }
                        VK_RETURN => {
                            submit = !s.typed.is_empty();
                        }
                        _ => {
                            if let Some(ch) = vk_to_char(kb.vkCode) {
                                s.typed.push(ch);
                            }
                        }
                    }
                    if s.hwnd != 0 {
                        let _ = InvalidateRect(HWND(s.hwnd as *mut _), None, true);
                    }
                }
            }
            if submit {
                let cred = {
                    let mut g = state().lock().unwrap();
                    if let Some(s) = g.as_mut() {
                        // stay in typing mode: if the credential is wrong the
                        // service keeps the session and the flash shows; if it
                        // is right the overlay dies with the session either way
                        s.fail_flash_until = now() + 4;
                        std::mem::take(&mut s.typed)
                    } else {
                        String::new()
                    }
                };
                let g = state().lock().unwrap();
                if let Some(s) = g.as_ref() {
                    if let Some(tx) = &s.stop_tx {
                        let _ = tx.send(cred);
                    }
                }
            }
        }
    }
    CallNextHookEx(None, code, w, l)
}

unsafe extern "system" fn mouse_proc(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 && (w.0 as u32) == WM_LBUTTONDOWN {
        let p = (*(l.0 as *const MSLLHOOKSTRUCT)).pt;
        let g = state().lock().unwrap();
        if let Some(s) = g.as_ref() {
            // let clicks on the overlay's own controls through; eat the rest
            if in_rect(&p, &s.button) || (s.typing && in_rect(&p, &s.input)) {
                drop(g);
                return CallNextHookEx(None, code, w, l);
            }
        }
        return LRESULT(1);
    }
    if code >= 0 && (w.0 as u32) != WM_MOUSEMOVE {
        // swallow clicks/scrolls everywhere except inside overlay controls;
        // pointer motion is harmless — clicks on the desktop still die here
        let g = state().lock().unwrap();
        if g.is_some() {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, w, l)
}

/// Basic US-layout vkCode → char. Random-text unlock only needs
/// [a-zA-Z0-9-]; passwords realistically use the same plus punctuation.
fn vk_to_char(vk: u32) -> Option<char> {
    let shift = unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } < 0;
    let c = match vk {
        0x30..=0x39 => {
            let d = (vk - 0x30) as u8;
            if shift {
                ")!@#$%^&*(".as_bytes()[d as usize] as char
            } else {
                (b'0' + d) as char
            }
        }
        0x41..=0x5A => {
            let base = (vk - 0x41) as u8;
            if shift {
                (b'A' + base) as char
            } else {
                (b'a' + base) as char
            }
        }
        0x60..=0x69 => (b'0' + (vk - 0x60) as u8) as char, // numpad
        x if x == VK_SPACE.0 as u32 => ' ',
        0xBD => {
            if shift { '_' } else { '-' }
        }
        0xBB => {
            if shift { '+' } else { '=' }
        }
        0xBA => {
            if shift { ':' } else { ';' }
        }
        0xBC => {
            if shift { '<' } else { ',' }
        }
        0xBE => {
            if shift { '>' } else { '.' }
        }
        0xBF => {
            if shift { '?' } else { '/' }
        }
        0xC0 => {
            if shift { '~' } else { '`' }
        }
        0xDB => {
            if shift { '{' } else { '[' }
        }
        0xDC => {
            if shift { '|' } else { '\\' }
        }
        0xDD => {
            if shift { '}' } else { ']' }
        }
        0xDE => {
            if shift { '"' } else { '\'' }
        }
        _ => return None,
    };
    Some(c)
}

fn draw_text(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    text: &mut [u16],
    r: &mut RECT,
    flags: DRAW_TEXT_FORMAT,
) {
    unsafe {
        DrawTextW(hdc, text, r, flags);
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        x if x == WM_PAINT => {
                let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            let (screen, until, locked, typing, typed_len, fail_until) = {
                let g = state().lock().unwrap();
                match g.as_ref() {
                    Some(s) => (
                        s.screen,
                        s.until,
                        s.locked,
                        s.typing,
                        s.typed.len(),
                        s.fail_flash_until,
                    ),
                    None => return LRESULT(0),
                }
            };
            let mut rc = screen;
            // paint area coords are window-local (window starts at screen.left/top)
            rc.left = 0;
            rc.top = 0;
            rc.right = screen.right - screen.left;
            rc.bottom = screen.bottom - screen.top;
            FillRect(hdc, &rc, CreateSolidBrush(COLORREF(0x00000000)));
            SetBkMode(hdc, TRANSPARENT);
            SetTextColor(hdc, COLORREF(0x00FFFFFF));

            let cx = (rc.right - rc.left) / 2;
            let cy = (rc.bottom - rc.top) / 2;

            let mut r = RECT {
                left: rc.left,
                top: cy - 220,
                right: rc.right,
                bottom: cy - 160,
            };
            draw_text(hdc, &mut wide("F R O Z E N"), &mut r, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

            let remain = (until - now()).max(0);
            let cd = format!(
                "{:02}:{:02}:{:02}",
                remain / 3600,
                (remain % 3600) / 60,
                remain % 60
            );
            let mut r2 = RECT {
                left: rc.left,
                top: cy - 120,
                right: rc.right,
                bottom: cy - 20,
            };
            draw_text(hdc, &mut wide(&cd), &mut r2, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

            let hint = if locked {
                "type the unlock text, then press Enter — or wait"
            } else {
                "the computer is locked until the timer ends"
            };
            let mut r3 = RECT {
                left: rc.left,
                top: cy + 46,
                right: rc.right,
                bottom: cy + 76,
            };
            draw_text(hdc, &mut wide(hint), &mut r3, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

            if typing {
                let mut ri = RECT {
                    left: cx - 160,
                    top: cy + 60,
                    right: cx + 160,
                    bottom: cy + 108,
                };
                let _ = Rectangle(hdc, ri.left, ri.top, ri.right, ri.bottom);
                if now() < fail_until {
                    let mut rf = RECT {
                        left: ri.left,
                        top: ri.bottom + 8,
                        right: ri.right,
                        bottom: ri.bottom + 34,
                    };
                    draw_text(
                        hdc,
                        &mut wide("wrong — try again"),
                        &mut rf,
                        DT_CENTER | DT_SINGLELINE,
                    );
                }
                let stars: String = "*".repeat(typed_len);
                let mut rt = ri;
                rt.left += 10;
                draw_text(
                    hdc,
                    &mut wide(&stars),
                    &mut rt,
                    DT_SINGLELINE | DT_VCENTER,
                );
                // remember screen-space rect for the mouse hook
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    s.input = RECT {
                        left: ri.left + s.screen.left,
                        top: ri.top + s.screen.top,
                        right: ri.right + s.screen.left,
                        bottom: ri.bottom + s.screen.top,
                    };
                }
            }

            // END EARLY button
            let mut rb = RECT {
                left: 0,
                top: cy + 180,
                right: rc.right,
                bottom: rc.bottom,
            };
            let _ = Rectangle(hdc, rb.left, rb.top, rb.right, rb.bottom);
            draw_text(
                hdc,
                &mut wide(if typing { "SUBMIT (Enter)" } else { "END EARLY" }),
                &mut rb,
                DT_CENTER | DT_SINGLELINE | DT_VCENTER,
            );
            {
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    s.button = RECT {
                        left: rb.left + s.screen.left,
                        top: rb.top + s.screen.top,
                        right: rb.right + s.screen.left,
                        bottom: rb.bottom + s.screen.top,
                    };
                }
            }
            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }
        x if x == WM_TIMER => {
            let (done, until, hwnd_raw) = {
                let g = state().lock().unwrap();
                match g.as_ref() {
                    Some(s) => (s.done, s.until, s.hwnd),
                    None => (true, 0, 0),
                }
            };
            if done || now() >= until {
                PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
            } else {
                // re-assert topmost: the shell taskbar wins z-order ties
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                let _ = InvalidateRect(HWND(hwnd_raw as _), None, true);
            }
            LRESULT(0)
        }
        x if x == WM_LBUTTONDOWN => {
            let p = POINT {
                x: (l.0 & 0xFFFF) as i16 as i32,
                y: ((l.0 >> 16) & 0xFFFF) as i16 as i32,
            };
            // convert to screen space
            let sp = {
                let g = state().lock().unwrap();
                g.as_ref()
                    .map(|s| POINT {
                        x: p.x + s.screen.left,
                        y: p.y + s.screen.top,
                    })
                    .unwrap_or(p)
            };
            let (on_btn, on_input, locked, tx) = {
                let g = state().lock().unwrap();
                match g.as_ref() {
                    Some(s) => (
                        in_rect(&sp, &s.button),
                        in_rect(&sp, &s.input),
                        s.locked,
                        s.stop_tx.clone(),
                    ),
                    None => return LRESULT(0),
                }
            };
            if on_btn {
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    if !locked {
                        // no ceremony: request stop immediately
                        if let Some(tx) = tx {
                            let _ = tx.send(String::new());
                        }
                    } else if s.typing && !s.typed.is_empty() {
                        if let Some(tx) = tx {
                            let _ = tx.send(std::mem::take(&mut s.typed));
                            s.fail_flash_until = now() + 4;
                        }
                    } else {
                        s.typing = true;
                        s.typed.clear();
                    }
                    let _ = InvalidateRect(hwnd, None, true);
                }
            } else if on_input {
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    if locked {
                        s.typing = true;
                    }
                    let _ = InvalidateRect(hwnd, None, true);
                }
            }
            LRESULT(0)
        }
        x if x == WM_WAKE => {
            let done = state()
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.done)
                .unwrap_or(true);
            if done {
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        x if x == WM_CLOSE || x == WM_DESTROY => {
            {
                let mut g = state().lock().unwrap();
                if let Some(s) = g.as_mut() {
                    s.done = true;
                }
            }
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}
