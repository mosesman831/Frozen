//! frozen-helper — per-user agent: foreground sensor, watchdog heartbeat,
//! notification sink. Tray UI is a later milestone; this runs headless.

mod overlay;

use anyhow::Result;
use frozen_common::pipe::{read_env, win, write_env};
use frozen_common::proto::*;
use serde_json::json;
use std::process;
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    loop {
        match run().await {
            Ok(_) => info!("service closed connection; reconnecting"),
            Err(e) => warn!(err = %e, "connection lost; reconnecting"),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn run() -> Result<()> {
    let stream = win::connect(PIPE_HELPER).await?;
    let (mut rd, mut wr) = tokio::io::split(stream);
    info!("connected to service");

    let hello = Hello {
        client: "helper".into(),
        browser: None,
        pid: process::id(),
        nonce: Some(Uuid::new_v4().to_string()),
    };
    write_env(&mut wr, &Envelope::new(op::HELLO, serde_json::to_value(hello)?)).await?;

    let (evt_tx, mut evt_rx) = tokio::sync::mpsc::unbounded_channel::<Envelope>();

    // frozen-mode credential channel: overlay -> frozen_stop event
    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    {
        let tx = evt_tx.clone();
        tokio::spawn(async move {
            while let Some(cred) = stop_rx.recv().await {
                let env = Envelope::new(
                    op::EVENT,
                    json!({"type": "frozen_stop", "credential": cred}),
                );
                if tx.send(env).is_err() {
                    return;
                }
            }
        });
    }

    // foreground sensor — blocking Win32 on a dedicated thread
    {
        let tx = evt_tx.clone();
        std::thread::spawn(move || {
            let mut last: Option<String> = None;
            loop {
                std::thread::sleep(Duration::from_secs(1));
                if let Some((pid, name, path, title)) = frozen_platform::foreground() {
                    let key = format!("{pid}|{title}");
                    if last.as_deref() != Some(key.as_str()) {
                        last = Some(key);
                        let ev = FgEvent {
                            ts: chrono::Utc::now().timestamp_millis(),
                            process: name,
                            path,
                            title,
                            pid,
                        };
                        let env = Envelope::new(op::FG_EVENT, serde_json::to_value(ev).unwrap());
                        if tx.send(env).is_err() {
                            return;
                        }
                    }
                }
            }
        });
    }

    // watchdog beat — prove the helper is alive to the service every 5s
    let beat_tx = evt_tx.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if beat_tx
                .send(Envelope::new(op::BEAT, json!({"ts": chrono::Utc::now().timestamp_millis(), "tabs": 0})))
                .is_err()
            {
                return;
            }
        }
    });

    loop {
        tokio::select! {
            read = read_env(&mut rd) => {
                let env = match read {
                    Ok(e) => e,
                    Err(e) => return Err(e),
                };
                match env.op.as_str() {
                    op::STATE => {
                        let info: BlockListInfo = serde_json::from_value(env.payload)?;
                        info!(rev = info.rev, blocks = info.blocks.len(), "state");
                        let fu = info.flags.frozen_until;
                        if fu > chrono::Local::now().timestamp() {
                            overlay::set_active(fu, info.flags.frozen_locked, stop_tx.clone());
                        } else {
                            overlay::clear();
                        }
                    }
                    op::NOTIFY => {
                        let n: Notify = serde_json::from_value(env.payload)?;
                        info!(kind = %n.kind, title = %n.title, text = %n.text, "notify");
                        // tray balloon / toast lands here in M6
                    }
                    op::CMD => {
                        info!(payload = %env.payload, "cmd");
                    }
                    _ => {}
                }
            }
            Some(env) = evt_rx.recv() => {
                write_env(&mut wr, &env).await?;
            }
        }
    }
}
