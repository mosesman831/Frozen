//! frozen-common — shared types, protocol envelope, pipe helpers.
//!
//! All Frozen processes speak the same envelope over packet-mode named pipes
//! (and, for browser extensions, stdio native-messaging frames):
//!
//! ```json
//! { "v": 1, "op": "<op>", "id": 42, "payload": { } }
//! ```

pub mod proto;
pub mod rules;
pub mod schedule;
pub mod pipe;

pub use proto::*;
pub use rules::*;
pub use schedule::*;
