//! frozen-platform — OS abstraction (Windows implementation).
//!
//! Everything OS-specific lives here so the core crates stay portable.

#[cfg(windows)]
pub mod procs;
#[cfg(windows)]
pub mod winfg;
#[cfg(windows)]
pub mod svcname;

#[cfg(windows)]
pub use procs::*;
#[cfg(windows)]
pub use winfg::*;
#[cfg(windows)]
pub use svcname::*;
