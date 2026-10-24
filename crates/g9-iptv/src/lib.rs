//! IPTV playlist parsing for G9.
//!
//! Security rules:
//! - `#EXTVLCOPT` / ffmpeg option injection is stripped, never applied.
//! - Remote playlists cannot open `file:`, `unix:`, `data:`, or similar URLs.
//! - Line length and playlist size are capped.

mod m3u;
mod sanitize;

pub use m3u::{parse_m3u, ParseOptions};
pub use sanitize::{is_dangerous_media_url, sanitize_logo_url};

pub use g9_core::{ParseReport, ParsedChannel, SourceKind, StreamType};
