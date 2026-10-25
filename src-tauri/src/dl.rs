//! Downloading web video with a managed `yt-dlp` binary.
//!
//! G9 does not bundle a downloader or scrape sites itself: it runs `yt-dlp`,
//! which the user installs with one click (Settings → Downloads), the same way
//! FFmpeg is handled. Only download material you have the rights to.
//!
//! Jobs run as child processes so they survive the UI closing, and `yt-dlp -c`
//! resumes from the `.part` files it leaves behind. "Pause" stops the process
//! (the partial file stays), "Resume" starts it again from where it stopped.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[cfg_attr(not(windows), allow(dead_code))]
pub const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
pub const PROGRESS_EVENT: &str = "dl-progress";
pub const STATE_FILE: &str = "downloads.json";
const MAX_JOBS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Running,
    Paused,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub title: String,
    /// Requested ladder height: 2160 / 1440 / 1080 / 720 / 480 / 360 / 0 (audio only).
    pub height: u32,
    pub status: Status,
    pub percent: f32,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
    pub eta: i64,
    pub path: Option<String>,
    /// Destination yt-dlp will write to; known before the merge, so a deleted
    /// download can take its `.part` files with it.
    #[serde(default)]
    pub target: Option<String>,
    pub error: Option<String>,
    pub site: String,
}

#[derive(Default)]
struct Runtime {
    jobs: Vec<Job>,
    children: HashMap<String, Child>,
    /// Last non-empty stderr line per job: the child exits before the reader
    /// thread is drained, so the reason has to be kept here.
    tails: HashMap<String, String>,
    seq: u64,
}

fn state() -> &'static Mutex<Runtime> {
    static RT: OnceLock<Mutex<Runtime>> = OnceLock::new();
    RT.get_or_init(|| Mutex::new(Runtime::default()))
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn bin_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("downloader"))
}

fn managed_path(app: &AppHandle) -> Option<PathBuf> {
    let p = bin_dir(app)?.join(exe("yt-dlp"));
    p.is_file().then_some(p)
}

/// The binary G9 will run: managed copy, else `yt-dlp` on PATH.
pub fn binary(app: &AppHandle) -> PathBuf {
    managed_path(app).unwrap_or_else(|| PathBuf::from(exe("yt-dlp")))
}

/// Remove `Title [id].mp4.part` and friends left behind by a stopped download.
fn purge_partials(target: &str) {
    let path = std::path::Path::new(target);
    for suffix in ["", ".part", ".ytdl", ".temp"] {
        let _ = std::fs::remove_file(format!("{target}{suffix}"));
    }
    let (Some(dir), Some(stem)) = (path.parent(), path.file_stem().and_then(|s| s.to_str())) else {
        return;
    };
    // Fragment files are named `<stem>.f137.mp4.part`; the `[id]` in the stem
    // keeps this specific to one video.
    if stem.len() < 12 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(stem) && (name.contains(".part") || name.ends_with(".ytdl")) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .video_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("G9");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ---------------------------------------------------------------- yt-dlp setup

#[derive(Debug, Clone, Serialize)]
pub struct ToolStatus {
    pub available: bool,
    pub managed: bool,
    pub version: Option<String>,
    pub dir: Option<String>,
    pub download_dir: Option<String>,
}

pub fn tool_status(app: &AppHandle) -> ToolStatus {
    let mut cmd = Command::new(binary(app));
    cmd.arg("--version");
    let version = crate::tools::run_hidden(&mut cmd)
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    ToolStatus {
        available: version.is_some(),
        managed: managed_path(app).is_some(),
        version,
        dir: bin_dir(app).map(|p| p.display().to_string()),
        download_dir: download_dir(app).ok().map(|p| p.display().to_string()),
    }
}

#[cfg(not(windows))]
pub fn install(app: &AppHandle) -> Result<ToolStatus, String> {
    let _ = app;
    Err(
        "One-click install is Windows-only. Install yt-dlp with your package manager, \
         or place it on PATH."
            .into(),
    )
}

/// Fetch yt-dlp.exe into app data.
#[cfg(windows)]
pub fn install(app: &AppHandle) -> Result<ToolStatus, String> {
    // The traits are only needed on this path, so they stay out of the Linux build.
    use std::io::{Read, Write};

    let dir = bin_dir(app).ok_or("app data unavailable")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(exe("yt-dlp"));
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .user_agent(g9_core::USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(YTDLP_URL).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 128 * 1024];
    let mut got: u64 = 0;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        let _ = app.emit(PROGRESS_EVENT, format!("setup:{got}"));
    }
    if got < 1024 * 1024 {
        let _ = std::fs::remove_file(&dest);
        return Err("download was too small to be yt-dlp".into());
    }
    let st = tool_status(app);
    if !st.available {
        return Err("yt-dlp was saved but does not run".into());
    }
    Ok(st)
}

// ---------------------------------------------------------------- probing

pub use g9_core::download::{is_supported_url, summarise, MediaInfo};

fn site_name(url: &str) -> String {
    g9_core::download::site_name(url)
}

fn format_selector(height: u32) -> String {
    g9_core::download::format_selector(height)
}

pub fn probe(app: &AppHandle, url: &str) -> Result<MediaInfo, String> {
    if !is_supported_url(url) {
        return Err("Paste a link to a video page".into());
    }
    let mut cmd = Command::new(binary(app));
    cmd.args([
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout",
        "20",
    ]);
    cmd.arg(url);
    let out = crate::tools::run_hidden(&mut cmd)?;
    if !out.status.success() {
        return Err("Could not read that link".into());
    }
    summarise(&String::from_utf8_lossy(&out.stdout))
}

// ---------------------------------------------------------------- jobs

fn persist(app: &AppHandle) {
    let rt = state().lock().unwrap();
    let jobs: Vec<Job> = rt.jobs.iter().take(MAX_JOBS).cloned().collect();
    drop(rt);
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(text) = serde_json::to_string_pretty(&jobs) {
            let _ = std::fs::write(dir.join(STATE_FILE), text);
        }
    }
}

/// Load jobs from the previous session; anything that was running is paused.
pub fn restore(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(dir.join(STATE_FILE)) else {
        return;
    };
    let Ok(mut jobs) = serde_json::from_str::<Vec<Job>>(&text) else {
        return;
    };
    for job in jobs.iter_mut() {
        if matches!(job.status, Status::Running | Status::Queued) {
            job.status = Status::Paused;
            job.speed = 0;
            job.eta = 0;
        }
    }
    let mut rt = state().lock().unwrap();
    rt.seq = jobs.len() as u64;
    rt.jobs = jobs;
}

pub fn list() -> Vec<Job> {
    let rt = state().lock().unwrap();
    let mut jobs = rt.jobs.clone();
    jobs.sort_by(|a, b| b.id.cmp(&a.id));
    jobs
}

#[derive(Debug, Clone, Serialize)]
struct Progress {
    id: String,
    job: Job,
}

fn emit(app: &AppHandle, id: &str) {
    let job = {
        let rt = state().lock().unwrap();
        rt.jobs.iter().find(|j| j.id == id).cloned()
    };
    if let Some(job) = job {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                id: id.to_string(),
                job,
            },
        );
    }
}

/// Both binaries the download needs, installing the engine on first use.
fn ensure_tools(app: &AppHandle) -> Result<(), String> {
    if !tool_status(app).available {
        return Err("Downloader not installed".into());
    }
    if !crate::ffmpeg::status().available {
        let _ = app.emit(PROGRESS_EVENT, "start:engine".to_string());
        crate::ffmpeg::install(app).map_err(|e| {
            format!("G9 needs FFmpeg to join video and audio, and it could not be installed: {e}")
        })?;
    }
    Ok(())
}

pub fn start(app: &AppHandle, url: &str, height: u32, title: Option<&str>) -> Result<Job, String> {
    if !is_supported_url(url) {
        return Err("Paste a link to a video page".into());
    }
    ensure_tools(app)?;
    let dir = download_dir(app)?;
    let id = {
        let mut rt = state().lock().unwrap();
        rt.seq += 1;
        format!("dl-{}", rt.seq)
    };
    let job = Job {
        id: id.clone(),
        url: url.trim().to_string(),
        title: title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| url.trim().to_string()),
        height,
        status: Status::Queued,
        percent: 0.0,
        downloaded: 0,
        total: 0,
        speed: 0,
        eta: -1,
        path: None,
        target: None,
        error: None,
        site: site_name(url),
    };
    {
        let mut rt = state().lock().unwrap();
        rt.jobs.insert(0, job.clone());
        if rt.jobs.len() > MAX_JOBS {
            rt.jobs.truncate(MAX_JOBS);
        }
    }
    persist(app);
    spawn(app, &id, &dir)?;
    Ok(job)
}

fn spawn(app: &AppHandle, id: &str, dir: &std::path::Path) -> Result<(), String> {
    let (url, height) = {
        let rt = state().lock().unwrap();
        let job = rt.jobs.iter().find(|j| j.id == id).ok_or("unknown job")?;
        (job.url.clone(), job.height)
    };
    // Modern YouTube (and most sites) only publish separate video and audio
    // streams, so FFmpeg is required to merge them. `start` installs it first.
    let fmt = format_selector(height);

    let mut cmd = Command::new(binary(app));
    cmd.args([
        "-c", // continue a partial download
        "--no-warnings",
        "--newline",
        "--no-playlist",
        // `--print` implies `--simulate`; without this nothing is downloaded.
        "--no-simulate",
        "--progress",
        "--socket-timeout",
        "20",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
        "--progress-template",
        // `total_bytes` is empty for streams; the alternate keeps the estimate.
        "g9|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
        // One print per hook, and the path only exists once post-processing
        // has run; `before_dl` would print NA.
        "--print",
        "post_process:g9target:%(filepath)s",
        "--print",
        "after_move:g9file:%(filepath)s",
        // Fragmented DASH downloads are far faster with a few connections.
        "-N",
        "4",
        "-f",
        &fmt,
    ]);
    if height > 0 {
        cmd.args(["--merge-output-format", "mp4"]);
    }
    if let Some(ff) = crate::ffmpeg::dir() {
        if crate::ffmpeg::status().managed {
            cmd.arg("--ffmpeg-location").arg(&ff);
        }
    }
    cmd.arg("-o")
        .arg(dir.join("%(title).120B [%(id)s].%(ext)s").as_os_str());
    cmd.arg(&url);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start the downloader: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let handle = app.clone();
        let job_id = id.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                handle_line(&handle, &job_id, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let job_id = id.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let mut rt = state().lock().unwrap();
                rt.tails
                    .insert(job_id.clone(), line.chars().take(200).collect::<String>());
            }
            let reason = state().lock().unwrap().tails.get(&job_id).cloned();
            if let Some(reason) = reason {
                let mut rt = state().lock().unwrap();
                if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == job_id) {
                    if job.status != Status::Paused && job.status != Status::Done {
                        job.error = Some(reason);
                    }
                }
            }
        });
    }

    {
        let mut rt = state().lock().unwrap();
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            job.status = Status::Running;
            job.error = None;
        }
        rt.children.insert(id.to_string(), child);
    }
    emit(app, id);
    Ok(())
}

fn handle_line(app: &AppHandle, id: &str, line: &str) {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("g9|") {
        let mut parts = rest.split('|');
        let num = |v: Option<&str>| -> u64 {
            v.and_then(|x| x.parse::<f64>().ok())
                .filter(|x| x.is_finite() && *x >= 0.0)
                .unwrap_or(0.0) as u64
        };
        let downloaded = num(parts.next());
        let total = num(parts.next());
        let speed = num(parts.next());
        let eta = rest
            .split('|')
            .nth(3)
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(-1);
        let mut rt = state().lock().unwrap();
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            job.downloaded = downloaded;
            if total > 0 {
                job.total = total;
                job.percent = ((downloaded as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32;
            }
            job.speed = speed;
            job.eta = eta;
        }
        drop(rt);
        emit(app, id);
        return;
    }
    if let Some(target) = line.strip_prefix("g9target:") {
        let mut rt = state().lock().unwrap();
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            job.target = Some(target.trim().to_string());
        }
        drop(rt);
        emit(app, id);
        return;
    }
    if let Some(path) = line.strip_prefix("g9file:") {
        let mut rt = state().lock().unwrap();
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            job.path = Some(path.trim().to_string());
            if job.title == job.url {
                if let Some(name) = std::path::Path::new(path.trim()).file_name() {
                    job.title = name.to_string_lossy().into_owned();
                }
            }
        }
        drop(rt);
        emit(app, id);
    }
}

/// Called when the child exits: decide whether this was a finish or a failure.
fn finish(app: &AppHandle, id: &str, code: Option<i32>) {
    let job = {
        let mut rt = state().lock().unwrap();
        rt.children.remove(id);
        let tail = rt.tails.remove(id);
        let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) else {
            return;
        };
        if job.status == Status::Running {
            if code == Some(0) {
                job.status = Status::Done;
                job.percent = 100.0;
                job.speed = 0;
                job.eta = 0;
            } else {
                job.status = Status::Failed;
                job.error =
                    Some(tail.unwrap_or_else(|| "the download stopped before it finished".into()));
            }
        }
        job.clone()
    };
    persist(app);
    emit(app, id);
    if job.status == Status::Done {
        notify_done(app, &job);
    }
}

fn notify_done(app: &AppHandle, job: &Job) {
    use tauri_plugin_notification::NotificationExt;
    let name = job
        .path
        .as_ref()
        .and_then(|p| p.rsplit(['/', '\\']).next().map(|s| s.to_string()))
        .unwrap_or_else(|| job.title.clone());
    let _ = app
        .notification()
        .builder()
        .title("Download finished")
        .body(format!("{name} is ready in G9"))
        .show();
}

/// Run a failed or stopped job again from its partial files.
pub fn retry(app: &AppHandle, id: &str) -> Result<Job, String> {
    ensure_tools(app)?;
    let job = {
        let mut rt = state().lock().unwrap();
        let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) else {
            return Err("unknown download".into());
        };
        if !matches!(
            job.status,
            Status::Failed | Status::Cancelled | Status::Paused
        ) {
            return Err("that download is still running".into());
        }
        job.status = Status::Queued;
        job.percent = 0.0;
        job.downloaded = 0;
        job.speed = 0;
        job.eta = -1;
        job.error = None;
        job.clone()
    };
    let dir = download_dir(app)?;
    spawn(app, id, &dir)?;
    persist(app);
    Ok(job)
}

pub fn toggle(app: &AppHandle, id: &str) -> Result<Job, String> {
    let status = {
        let rt = state().lock().unwrap();
        rt.jobs
            .iter()
            .find(|j| j.id == id)
            .map(|j| j.status.clone())
            .ok_or("unknown download")?
    };
    match status {
        Status::Running | Status::Queued => pause(app, id),
        Status::Paused | Status::Failed | Status::Cancelled => resume(app, id),
        Status::Done => Err("already finished".into()),
    }
}

pub fn pause(app: &AppHandle, id: &str) -> Result<Job, String> {
    {
        let mut rt = state().lock().unwrap();
        if let Some(child) = rt.children.get_mut(id) {
            let _ = child.kill();
        }
        rt.children.remove(id);
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            if job.status == Status::Running || job.status == Status::Queued {
                job.status = Status::Paused;
                job.speed = 0;
                job.eta = -1;
            }
        }
    }
    persist(app);
    emit(app, id);
    job(app, id)
}

pub fn resume(app: &AppHandle, id: &str) -> Result<Job, String> {
    let existing = {
        let rt = state().lock().unwrap();
        rt.children.contains_key(id)
    };
    if existing {
        return job(app, id);
    }
    let dir = download_dir(app)?;
    {
        let mut rt = state().lock().unwrap();
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            job.status = Status::Queued;
            job.error = None;
        }
    }
    spawn(app, id, &dir)?;
    job(app, id)
}

pub fn cancel(app: &AppHandle, id: &str) -> Result<Job, String> {
    let path = {
        let mut rt = state().lock().unwrap();
        if let Some(child) = rt.children.get_mut(id) {
            let _ = child.kill();
        }
        rt.children.remove(id);
        let mut path = None;
        if let Some(job) = rt.jobs.iter_mut().find(|j| j.id == id) {
            if job.status != Status::Done {
                job.status = Status::Cancelled;
                job.speed = 0;
                job.eta = -1;
            }
            path = job.path.clone();
        }
        path
    };
    persist(app);
    emit(app, id);
    if let Some(p) = path {
        let _ = std::fs::remove_file(&p);
    }
    job(app, id)
}

/// Remove the record and, when asked, the file on disk.
pub fn remove(app: &AppHandle, id: &str, delete_file: bool) -> Result<(), String> {
    let (path, target) = {
        let mut rt = state().lock().unwrap();
        if let Some(child) = rt.children.get_mut(id) {
            let _ = child.kill();
        }
        rt.children.remove(id);
        let job = rt.jobs.iter().find(|j| j.id == id);
        let path = job.and_then(|j| j.path.clone());
        let target = job.and_then(|j| j.target.clone());
        rt.jobs.retain(|j| j.id != id);
        (path, target)
    };
    if delete_file {
        if let Some(p) = path {
            let _ = std::fs::remove_file(&p);
        }
        if let Some(t) = target {
            purge_partials(&t);
        }
    }
    persist(app);
    let _ = app.emit(PROGRESS_EVENT, "reload");
    Ok(())
}

fn job(_app: &AppHandle, id: &str) -> Result<Job, String> {
    let rt = state().lock().unwrap();
    rt.jobs
        .iter()
        .find(|j| j.id == id)
        .cloned()
        .ok_or_else(|| "unknown download".to_string())
}

/// Watch children so a finished job flips to Done even if `--print` said nothing.
pub fn spawn_reaper(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let exited: Vec<(String, Option<i32>)> = {
            let mut rt = state().lock().unwrap();
            let ids: Vec<String> = rt.children.keys().cloned().collect();
            let mut done = Vec::new();
            for id in ids {
                if let Some(child) = rt.children.get_mut(&id) {
                    match child.try_wait() {
                        Ok(Some(status)) => done.push((id, status.code())),
                        Ok(None) => {}
                        Err(_) => done.push((id, None)),
                    }
                }
            }
            done
        };
        for (id, code) in exited {
            finish(&app, &id, code);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_links_are_accepted() {
        assert!(is_supported_url("https://www.youtube.com/watch?v=abc"));
        assert!(!is_supported_url("file:///c:/x.mp4"));
        assert!(!is_supported_url("javascript:alert(1)"));
        assert!(!is_supported_url("https://127.0.0.1:18765/x"));
    }

    #[test]
    fn selector_matches_height() {
        assert_eq!(format_selector(0), "bestaudio/best");
        assert!(format_selector(1080).contains("height<=1080"));
    }

    #[test]
    fn site_is_read_from_the_host() {
        assert_eq!(site_name("https://www.youtube.com/watch?v=1"), "youtube");
        assert_eq!(site_name("https://fb.watch/x"), "fb");
    }
}
