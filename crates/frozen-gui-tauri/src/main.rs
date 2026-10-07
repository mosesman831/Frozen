#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! frozen-gui-tauri — WebView2 shell for the Frozen blocker UI.
//! The frontend is plain HTML/CSS/JS in ./ui; this backend bridges it to
//! frozen-svc over \\.\pipe\Frozen.App (identical protocol to frozen-gui):
//! `rpc` Tauri command → Envelope::req → ok/err reply by id; `state` pushes
//! → Tauri "state" events; connect/disconnect → "status" events.

use anyhow::Result;
use frozen_common::pipe::{read_env, win, write_env};
use frozen_common::proto::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, WS_CAPTION,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
};

fn strip_caption(hwnd_isize: isize) {
    unsafe {
        let hwnd = HWND(hwnd_isize as *mut std::ffi::c_void);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style & (WS_CAPTION.0 as isize) != 0 {
            SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_CAPTION.0 as isize));
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct Bridge {
    writer: Mutex<Option<mpsc::UnboundedSender<Envelope>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    last_state: Mutex<Option<Value>>,
    last_status: Mutex<Value>,
}

#[tauri::command]
async fn snapshot(bridge: tauri::State<'_, Arc<Bridge>>) -> Result<Value, String> {
    Ok(json!({
        "status": bridge.last_status.lock().unwrap().clone(),
        "state": bridge.last_state.lock().unwrap().clone(),
    }))
}

#[tauri::command]
async fn rpc(
    bridge: tauri::State<'_, Arc<Bridge>>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let writer = bridge
        .writer
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "service offline".to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id, tx);
    let env = Envelope::req(
        op::RPC,
        id,
        json!({"method": method, "params": params.unwrap_or(json!({}))}),
    );
    writer.send(env).map_err(|_| "service offline".to_string())?;
    match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
        Ok(Ok(res)) => res,
        Ok(Err(_)) => Err("reply channel dropped".into()),
        Err(_) => {
            bridge.pending.lock().unwrap().remove(&id);
            Err("rpc timeout".into())
        }
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_writer(|| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(r"C:\ProgramData\Frozen\logs\gui-tauri.log")
                .unwrap_or_else(|_| std::fs::File::create("gui-tauri.log").unwrap())
        })
        .with_ansi(false)
        .init();

    let bridge = Arc::new(Bridge {
        writer: Mutex::new(None),
        pending: Mutex::new(HashMap::new()),
        last_state: Mutex::new(None),
        last_status: Mutex::new(json!({"connected": false, "detail": "connecting..."})),
    });

    let bridge2 = bridge.clone();
    tauri::Builder::default()
        .manage(bridge)
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
                if let Ok(hwnd) = w.hwnd() {
                    let h = hwnd.0 as isize;
                    strip_caption(h);
                    tauri::async_runtime::spawn(async move {
                        for ms in [300u64, 800, 1600, 3000] {
                            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                            strip_caption(h);
                        }
                    });
                }
            }
            tauri::async_runtime::spawn(io_loop(handle, bridge2));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc, snapshot])
        .run(tauri::generate_context!())
        .expect("error while running frozen-gui-tauri");
}

async fn io_loop(app: AppHandle, bridge: Arc<Bridge>) {
    loop {
        if let Err(e) = run(&app, &bridge).await {
            *bridge.writer.lock().unwrap() = None;
            let senders: Vec<_> = {
                let mut guard = bridge.pending.lock().unwrap();
                guard.drain().map(|(_, tx)| tx).collect()
            };
            for tx in senders {
                let _ = tx.send(Err("service offline".into()));
            }
            let st = json!({"connected": false, "detail": format!("{e}")});
            *bridge.last_status.lock().unwrap() = st.clone();
            let _ = app.emit("status", st);
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        } else {
            return;
        }
    }
}

async fn run(app: &AppHandle, bridge: &Arc<Bridge>) -> Result<()> {
    let stream = win::connect(PIPE_APP).await?;
    let (mut rd, mut wr) = tokio::io::split(stream);

    let hello = Hello {
        client: "gui".into(),
        browser: None,
        pid: std::process::id(),
        nonce: Some(uuid::Uuid::new_v4().to_string()),
    };
    write_env(&mut wr, &Envelope::new(op::HELLO, serde_json::to_value(&hello)?)).await?;

    let (tx_w, mut rx_w) = mpsc::unbounded_channel::<Envelope>();
    let writer_task = tokio::spawn(async move {
        while let Some(env) = rx_w.recv().await {
            if write_env(&mut wr, &env).await.is_err() {
                return;
            }
        }
    });
    *bridge.writer.lock().unwrap() = Some(tx_w);
    let st = json!({"connected": true, "detail": "service connected"});
    *bridge.last_status.lock().unwrap() = st.clone();
    let _ = app.emit("status", st);

    let res = async {
        loop {
            let env = read_env(&mut rd).await?;
            match env.op.as_str() {
                op::STATE => {
                    *bridge.last_state.lock().unwrap() = Some(env.payload.clone());
                    let _ = app.emit("state", env.payload);
                }
                op::OK => {
                    if let Some(tx) = bridge.pending.lock().unwrap().remove(&env.id) {
                        let _ = tx.send(Ok(env.payload));
                    }
                }
                op::ERR => {
                    let msg = env
                        .payload
                        .get("message")
                        .or_else(|| env.payload.get("msg"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("error")
                        .to_string();
                    if let Some(tx) = bridge.pending.lock().unwrap().remove(&env.id) {
                        let _ = tx.send(Err(msg));
                    }
                }
                _ => {}
            }
        }
        #[allow(unreachable_code)]
        Ok::<(), anyhow::Error>(())
    }
    .await;
    writer_task.abort();
    res
}
