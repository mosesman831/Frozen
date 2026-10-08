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
    use std::ffi::c_void;
    use std::time::Duration;
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, PipeMode, ServerOptions};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, BOOL, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

    /// DACL applied to every server pipe instance. The default named-pipe
    /// security descriptor grants non-admin users *read* access only, so the
    /// unelevated clients (GUI, helper, NMH) get ERROR_ACCESS_DENIED opening a
    /// duplex connection even though the service is running. SYSTEM+admins get
    /// full access; authenticated users get generic read+write.
    const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)";

    /// Frees the LocalAlloc'd SECURITY_DESCRIPTOR on drop.
    struct PipeSd(PSECURITY_DESCRIPTOR);

    impl Drop for PipeSd {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe {
                    let _ = LocalFree(HLOCAL(self.0 .0));
                }
            }
        }
    }

    /// SECURITY_ATTRIBUTES carrying PIPE_SDDL. CreateNamedPipe copies the
    /// descriptor synchronously, so the guard only has to outlive the call.
    fn client_accessible_sa() -> Result<(SECURITY_ATTRIBUTES, PipeSd)> {
        let wide: Vec<u16> = PIPE_SDDL.encode_utf16().chain(std::iter::once(0)).collect();
        let mut sd = PSECURITY_DESCRIPTOR(std::ptr::null_mut());
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(wide.as_ptr()),
                SDDL_REVISION_1,
                &mut sd,
                None,
            )?;
        }
        Ok((
            SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd.0,
                bInheritHandle: BOOL(0),
            },
            PipeSd(sd),
        ))
    }

    /// Create a named-pipe server instance (first instance).
    /// Byte mode: our own u32-LE+JSON framing supplies the boundaries, and
    /// byte mode avoids message-truncation edge cases entirely.
    pub fn server(name: &str) -> Result<NamedPipeServer> {
        let (mut sa, _sd) = client_accessible_sa()?;
        Ok(unsafe {
            ServerOptions::new()
                .first_pipe_instance(true)
                .pipe_mode(PipeMode::Byte)
                .max_instances(32)
                .create_with_security_attributes_raw(name, &mut sa as *mut _ as *mut c_void)?
        })
    }

    /// Create the NEXT server instance for accept-loop.
    pub fn next_server(name: &str) -> Result<NamedPipeServer> {
        let (mut sa, _sd) = client_accessible_sa()?;
        Ok(unsafe {
            ServerOptions::new()
                .pipe_mode(PipeMode::Byte)
                .create_with_security_attributes_raw(name, &mut sa as *mut _ as *mut c_void)?
        })
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
