//! Pipe plumbing — length-prefixed JSON envelopes over byte streams.
//!
//! We use 4-byte little-endian length + UTF-8 JSON framing on top of named
//! pipes (and, for nmh, the browser's own stdio framing which we adapt in
//! the nmh crate). Cap: 1 MiB per message.

use crate::proto::Envelope;
use anyhow::{anyhow, Result};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const MAX_FRAME: usize = 1024 * 1024;

pub async fn write_env<W: AsyncWrite + Unpin>(w: &mut W, env: &Envelope) -> Result<()> {
    let bytes = serde_json::to_vec(env)?;
    if bytes.len() > MAX_FRAME {
        return Err(anyhow!("frame too large: {}", bytes.len()));
    }
    w.write_all(&(bytes.len() as u32).to_le_bytes()).await?;
    w.write_all(&bytes).await?;
    w.flush().await?;
    Ok(())
}

pub async fn read_env<R: AsyncRead + Unpin>(r: &mut R) -> Result<Envelope> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > MAX_FRAME {
        return Err(anyhow!("bad frame len {len}"));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(serde_json::from_slice(&buf)?)
}

#[cfg(windows)]
pub mod win {
    use anyhow::Result;
    use std::time::Duration;
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, PipeMode, ServerOptions};

    /// Create a named-pipe server instance (first instance).
    /// Byte mode: our own u32-LE+JSON framing supplies the boundaries, and
    /// byte mode avoids message-truncation edge cases entirely.
    pub fn server(name: &str) -> Result<NamedPipeServer> {
        Ok(ServerOptions::new()
            .first_pipe_instance(true)
            .pipe_mode(PipeMode::Byte)
            .max_instances(32)
            .create(name)?)
    }

    /// Create the NEXT server instance for accept-loop.
    pub fn next_server(name: &str) -> Result<NamedPipeServer> {
        Ok(ServerOptions::new().pipe_mode(PipeMode::Byte).create(name)?)
    }

    /// Connect a client, retrying while the pipe is busy or not yet created
    /// (ERROR_PIPE_BUSY 231, ERROR_FILE_NOT_FOUND 2 while svc is starting).
    pub async fn connect(name: &str) -> Result<NamedPipeClient> {
        loop {
            match ClientOptions::new().pipe_mode(PipeMode::Byte).open(name) {
                Ok(c) => return Ok(c),
                Err(e) => {
                    if matches!(e.raw_os_error(), Some(231) | Some(2)) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    return Err(e.into());
                }
            }
        }
    }
}
