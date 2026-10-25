//! G9 Social — the parts a chat client cannot afford to get wrong.
//!
//! Four things live here, and nothing else does:
//!
//! * **identity** — an Ed25519 key pair per person, one device key per install, and a
//!   `g9:` id derived from the public key so nobody has to register anywhere;
//! * **invites** — one signed link that carries the hub, the room, the seat count and the
//!   room key, so joining is "open the link" and not "ask them for twelve characters";
//! * **crypto** — a room key and an AEAD seal for everything that goes through a hub,
//!   which is why the hub can route messages it cannot read;
//! * **store** — SQLite history, because a chat that forgets is not a chat.
//!
//! The network client deliberately lives in the webview (`ui/social.js`): it is one
//! `WebSocket` and it is behind `G9Social.transport`, so a Rust transport can replace it
//! later without the UI noticing. Everything secret stays on this side.

pub mod crypto;
pub mod id;
pub mod identity;
pub mod invite;
pub mod store;

pub use crypto::RoomKey;
pub use id::{g9_id, short_id};
pub use identity::{hello_canonical, verify_b64, Identity};
pub use invite::{Invite, InviteKind};
pub use store::{Message, Store, Thread};

use thiserror::Error;

/// Everything that can go wrong in this crate, in words a UI can show.
#[derive(Debug, Error)]
pub enum SocialError {
    #[error("that is not a valid link")]
    Link,
    #[error("the link has expired")]
    Expired,
    #[error("the link was changed in transit — ask for a new one")]
    Tampered,
    #[error("the link belongs to a different person")]
    WrongIssuer,
    #[error("malformed key material")]
    Key,
    #[error("could not decrypt this message — the room key does not match")]
    Decrypt,
    #[error("{0}")]
    Io(String),
    #[error(transparent)]
    Store(#[from] rusqlite::Error),
}

impl From<serde_json::Error> for SocialError {
    fn from(e: serde_json::Error) -> Self {
        SocialError::Io(e.to_string())
    }
}

/// Seconds since the Unix epoch. Invites are the only clock-sensitive thing here.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A fresh 10-character room id. Short enough to read out, long enough to collide
/// once per universe.
pub fn new_room_id() -> String {
    id::random_b64(8)
}
