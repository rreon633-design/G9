//! Shared types for the G9 player.
//!
//! G9 is a local-first media player. It ships no channels, playlists,
//! or provider credentials. Users supply their own legal sources.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const APP_NAME: &str = "G9";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const USER_AGENT: &str = concat!("G9/", env!("CARGO_PKG_VERSION"));

/// Legal notice shown on first playlist add and in docs.
pub const CONTENT_POLICY: &str =
    "G9 is a media player. It does not provide channels or playlists. Only add sources you are allowed to use.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    File,
    Url,
    Xtream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamType {
    Live,
    Vod,
    Series,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedChannel {
    pub name: String,
    pub url: String,
    pub group: Option<String>,
    pub tvg_id: Option<String>,
    pub tvg_name: Option<String>,
    pub tvg_logo: Option<String>,
    pub duration: Option<i64>,
    pub stream_type: StreamType,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParseReport {
    pub channel_count: usize,
    pub group_count: usize,
    pub stripped_extvlcopt: usize,
    pub skipped_dangerous: usize,
    pub skipped_blank: usize,
    /// `url-tvg` / `x-tvg-url` from the playlist header, when present.
    #[serde(default)]
    pub epg_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum G9Error {
    #[error("{0}")]
    Message(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("not found")]
    NotFound,
}

impl G9Error {
    pub fn code(&self) -> &'static str {
        match self {
            G9Error::Message(_) => "ERR",
            G9Error::Parse(_) => "PARSE",
            G9Error::Storage(_) => "STORE",
            G9Error::Network(_) => "NET",
            G9Error::NotFound => "NOT_FOUND",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorDto {
    pub code: String,
    pub message: String,
}

impl From<G9Error> for ErrorDto {
    fn from(value: G9Error) -> Self {
        Self {
            code: value.code().to_string(),
            message: value.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_includes_version() {
        assert!(USER_AGENT.starts_with("G9/"));
        assert!(USER_AGENT.contains(APP_VERSION));
    }

    #[test]
    fn content_policy_is_byo() {
        assert!(CONTENT_POLICY.contains("does not provide channels"));
    }
}

pub mod download;
