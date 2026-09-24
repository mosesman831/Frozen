//! frozen-nmh — native messaging host. Chrome/Edge/Firefox launch one per
//! browser and speak u32-LE-length-prefixed JSON on stdio. We bridge that to
//! the service's per-browser pipe (spec §11.2): raw extension JSON passes
//! through untouched; service→extension pushes arrive as native messages.
//!
//! Usage: launched by the browser via the native-messaging manifest.
//!   --browser <chrome|edge|firefox|brave>   selects the service pipe
//!   (default: chrome)

use anyhow::Result;
use frozen_common::pipe::{read_env, win, write_env, MAX_FRAME};
use frozen_common::proto::*;
use std::io::{Read, Write};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn log_init() {
    let dir = frozen_platform::data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("nmh.log"))
    {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "info".into()),
            )
            .with_writer(std::sync::Mutex::new(f))
            .with_ansi(false)
            .try_init();
    }
}

fn main() -> Result<()> {
    log_init();
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(run())
}

/// Read one native-messaging frame from stdin (u32 LE len + JSON).
fn read_nm(r: &mut impl Read) -> Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_FRAME {
        anyhow::bail!("frame too large: {len}");
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

fn write_nm(w: &mut impl Write, json: &[u8]) -> Result<()> {
    w.write_all(&(json.len() as u32).to_le_bytes())?;
    w.write_all(json)?;
    w.flush()?;
    Ok(())
}

async fn run() -> Result<()> {
    let browser = std::env::args()
        .skip_while(|a| a != "--browser")
        .nth(1)
        .or_else(|| frozen_platform::detect_browser())
        .unwrap_or_else(|| "chrome".into());
    info!(browser = %browser, pid = process::id(), "nmh starting");

    // connect to service, retrying — svc may still be booting
    let pipe_name = format!("{PIPE_NMH_PREFIX}{browser}");
    let mut stream = None;
    for i in 0..30 {
        match win::connect(&pipe_name).await {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => {
                warn!(attempt = i, err = %e, "svc pipe connect retry");
                tokio::time::sleep(Duration::from_millis(1000)).await;
            }
        }
    }
    let stream = stream.ok_or_else(|| anyhow::anyhow!("service unreachable"))?;
    let (rd, mut wr) = tokio::io::split(stream);
    info!("connected to service");

    // hello handshake
    let hello = Hello {
        client: "nmh".into(),
        browser: Some(browser.clone()),
        pid: process::id(),
        nonce: Some(Uuid::new_v4().to_string()),
    };
    write_env(&mut wr, &Envelope::new(op::HELLO, serde_json::to_value(hello)?)).await?;

    // channel: stdin reader thread → main loop (to be forwarded to svc)
    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        loop {
            match read_nm(&mut stdin) {
                Ok(f) => {
                    if stdin_tx.send(f).is_err() {
                        return;
                    }
                }
                Err(_) => return, // browser closed the pipe
            }
        }
    });

    // channel: outbound native messages → stdout writer thread
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut stdout = std::io::stdout();
        while let Some(msg) = out_rx.blocking_recv() {
            if write_nm(&mut stdout, &msg).is_err() {
                return;
            }
        }
    });

    let mut rd = rd;
    loop {
        tokio::select! {
            // extension → service
            frame = stdin_rx.recv() => {
                let Some(raw) = frame else { break }; // browser exited
                let v: serde_json::Value = match serde_json::from_slice(&raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let op = v["op"].as_str().unwrap_or("").to_string();
                if op.is_empty() {
                    continue;
                }
                let id = v["id"]
                    .as_u64()
                    .unwrap_or_else(|| NEXT_ID.fetch_add(1, Ordering::Relaxed));
                let env = Envelope::req(&op, id, v["payload"].clone());
                if write_env(&mut wr, &env).await.is_err() {
                    break;
                }
            }
            // service → extension
            read = read_env(&mut rd) => {
                let env = match read {
                    Ok(e) => e,
                    Err(_) => break,
                };
                // forward envelope as a native message verbatim
                if let Ok(raw) = serde_json::to_vec(&env) {
                    if out_tx.send(raw).is_err() {
                        break;
                    }
                }
            }
        }
    }

    info!("nmh exiting");
    Ok(())
}
