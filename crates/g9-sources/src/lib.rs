//! Fun Mode source layer.
//!
//! G9 ships no catalogue. This crate only knows how to *talk* to sources the
//! user adds — it contains no titles, no links and no credentials:
//!
//! * [`stremio`] — the open Stremio addon protocol (`manifest.json`, `catalog`,
//!   `meta`, `stream`).
//! * [`rss`] — any RSS feed of magnet links (Nyaa-compatible namespaces).
//! * [`ytdlp`] — the `-J` JSON that the yt-dlp engine G9 already installs prints.
//! * [`mangadex`] — the official MangaDex API for manga / manhwa / manhua.
//!
//! Everything here is a pure function over text or `serde_json::Value`, so the
//! whole layer is tested offline against fixtures. Network calls live in the
//! app crate (`src-tauri/src/fun.rs`).

pub mod html;
pub mod mangadex;
pub mod model;
pub mod rss;
pub mod stremio;
pub mod ytdlp;

pub use model::{Item, Kind, Quality, Stream, Subtitle};

/// `https://host/path` with no trailing slash.
pub fn trim_slash(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/// A source kind, as stored in `fun_sources.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Stremio,
    Rss,
    YouTube,
    MangaDex,
    Local,
}

impl SourceKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "stremio" | "addon" => Some(Self::Stremio),
            "rss" | "nyaa" | "feed" => Some(Self::Rss),
            "ytdlp" | "youtube" => Some(Self::YouTube),
            "mangadex" | "manga" => Some(Self::MangaDex),
            "local" => Some(Self::Local),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stremio => "stremio",
            Self::Rss => "rss",
            Self::YouTube => "ytdlp",
            Self::MangaDex => "mangadex",
            Self::Local => "local",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_kind_round_trip() {
        for k in [
            SourceKind::Stremio,
            SourceKind::Rss,
            SourceKind::YouTube,
            SourceKind::MangaDex,
            SourceKind::Local,
        ] {
            assert_eq!(SourceKind::parse(k.as_str()), Some(k));
        }
        assert_eq!(SourceKind::parse("nonsense"), None);
    }

    #[test]
    fn trim_slash_strips_whitespace_and_trailing() {
        assert_eq!(trim_slash("  https://a.b/c/  "), "https://a.b/c");
    }
}
