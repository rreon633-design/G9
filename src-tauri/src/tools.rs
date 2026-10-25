//! Optional ffmpeg helpers (if on PATH) and caption translation.

use serde::Serialize;
use std::process::Command;
use std::time::Duration;

fn run_hidden(cmd: &mut Command) -> Result<std::process::Output, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ToolResult {
    pub ok: bool,
    pub output: String,
}

pub fn ffmpeg_available() -> bool {
    run_hidden(Command::new("ffmpeg").args(["-version"]))
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn extract_audio(path: &str, dest: &str) -> Result<ToolResult, String> {
    let out = run_hidden(Command::new("ffmpeg").args([
        "-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-q:a", "2", dest,
    ]))?;
    if out.status.success() {
        Ok(ToolResult {
            ok: true,
            output: dest.into(),
        })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

pub fn remux_repair(path: &str, dest: &str) -> Result<ToolResult, String> {
    let out = run_hidden(Command::new("ffmpeg").args([
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-err_detect",
        "ignore_err",
        "-i",
        path,
        "-c",
        "copy",
        dest,
    ]))?;
    if out.status.success() {
        Ok(ToolResult {
            ok: true,
            output: dest.into(),
        })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

pub fn translate(text: &str, from: &str, to: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }
    let pair = format!("{from}|{to}");
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}",
        urlencoding_q(text),
        urlencoding_q(&pair)
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("G9/0.1.2")
        .build()
        .map_err(|e| e.to_string())?;
    let v: serde_json::Value = client
        .get(&url)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    v.pointer("/responseData/translatedText")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "translate failed".into())
}

fn urlencoding_q(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            b' ' => o.push('+'),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}
