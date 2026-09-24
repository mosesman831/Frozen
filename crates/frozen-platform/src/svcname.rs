//! Service naming, registry helpers, and install-time identity.

use anyhow::Result;
use windows::core::PCWSTR;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegGetValueW, RegOpenKeyExW, RegSetValueExW,
    HKEY_LOCAL_MACHINE, KEY_ALL_ACCESS, KEY_READ, REG_SZ, REG_OPTION_NON_VOLATILE,
    RRF_RT_REG_SZ, REG_VALUE_TYPE,
};

pub const REG_ROOT: &str = r"SOFTWARE\Frozen";

/// The randomized service-name suffix (e.g. "9q3k2a"). Read from registry;
/// during dev, falls back to "dev".
pub fn svc_suffix() -> String {
    reg_read_sz(REG_ROOT, "SvcSuffix").unwrap_or_else(|_| "dev".into())
}

/// Full service name like `FrozenSvc_9q3k2a`.
pub fn svc_name() -> String {
    format!("FrozenSvc_{}", svc_suffix())
}

/// Scheduled task name — same suffix, mirrors CT's convention.
pub fn task_name() -> String {
    format!("FrozenSvc_{}", svc_suffix())
}

pub fn data_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("FROZEN_DATA_DIR") {
        return dir.into();
    }
    std::path::PathBuf::from(r"C:\ProgramData\Frozen")
}

pub fn install_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Program Files\Frozen"))
}

fn reg_read_sz(subkey: &str, name: &str) -> Result<String> {
    unsafe {
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        let sub: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(sub.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .ok()?;
        let name_w: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut ty = REG_VALUE_TYPE(0);
        let mut sz = 0u32;
        RegGetValueW(
            hkey,
            PCWSTR::null(),
            PCWSTR(name_w.as_ptr()),
            RRF_RT_REG_SZ,
            Some(&mut ty),
            None,
            Some(&mut sz),
        )
        .ok()?;
        let mut buf = vec![0u8; sz as usize];
        RegGetValueW(
            hkey,
            PCWSTR::null(),
            PCWSTR(name_w.as_ptr()),
            RRF_RT_REG_SZ,
            Some(&mut ty),
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut sz),
        )
        .ok()?;
        let _ = RegCloseKey(hkey);
        let wide: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        Ok(String::from_utf16_lossy(&wide[..end]))
    }
}

/// Write a REG_SZ under HKLM\SOFTWARE\Frozen (admin required).
pub fn reg_write_sz(name: &str, value: &str) -> Result<()> {
    unsafe {
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        let sub: Vec<u16> = REG_ROOT.encode_utf16().chain(std::iter::once(0)).collect();
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(sub.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_ALL_ACCESS,
            None,
            &mut hkey,
            None,
        )
        .ok()?;
        let name_w: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut val: Vec<u16> = value.encode_utf16().collect();
        val.push(0);
        RegSetValueExW(
            hkey,
            PCWSTR(name_w.as_ptr()),
            0,
            REG_SZ,
            Some(std::slice::from_raw_parts(
                val.as_ptr() as *const u8,
                val.len() * 2,
            )),
        )
        .ok()?;
        let _ = RegCloseKey(hkey);
        Ok(())
    }
}

/// Generate a fresh random suffix (install-time only).
pub fn gen_suffix() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| {
            let n = rng.gen_range(0..36u8);
            (if n < 10 { b'0' + n } else { b'a' + n - 10 }) as char
        })
        .collect()
}
