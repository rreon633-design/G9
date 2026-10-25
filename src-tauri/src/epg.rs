//! Guide cache: fetch an XMLTV file, keep the now/next slice in memory.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::sync::OnceLock;

use g9_iptv::xmltv::{self, NowNext, Programme};
use serde::Serialize;

#[derive(Default)]
struct Cache {
    programmes: Vec<Programme>,
    channels: HashMap<String, Vec<usize>>,
    /// Guide display name (normalised) -> channel id, so playlists that only
    /// carry a name still match.
    names: HashMap<String, String>,
    source: Option<String>,
    fetched: Option<String>,
}

/// `BBC One HD` -> `bbcone`, so ids, names and file names can meet in the middle.
fn norm(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Pull `<channel id="…"><display-name>…</display-name></channel>` pairs.
fn channel_names(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut open: Option<String> = None;
    for line in text.lines() {
        if let Some(at) = line.find("<channel") {
            let tag = &line[at..];
            open = xmltv_attr(tag, "id");
        }
        if let Some(id) = open.clone() {
            if let Some(name) = element_text(line, "display-name") {
                let key = norm(&name);
                if !key.is_empty() {
                    out.insert(key, id);
                }
            }
        }
        if line.contains("</channel>") {
            open = None;
        }
    }
    out
}

fn xmltv_attr(tag: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let at = tag.find(&needle)?;
    let rest = &tag[at + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn element_text(line: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let at = line.find(&open)?;
    let rest = &line[at..];
    let start = rest.find('>')? + 1;
    let body = &rest[start..];
    let end = body.find(&format!("</{name}>"))?;
    let text = body[..end].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}

#[derive(Debug, Clone, Serialize)]
pub struct Guide {
    pub channel: String,
    pub now_title: Option<String>,
    pub now_desc: Option<String>,
    pub next_title: Option<String>,
    pub start: Option<i64>,
    pub stop: Option<i64>,
    pub progress: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuideStatus {
    pub loaded: bool,
    pub programmes: usize,
    pub channels: usize,
    pub source: Option<String>,
    pub fetched: Option<String>,
}

pub fn status() -> GuideStatus {
    let c = cache().lock().unwrap();
    GuideStatus {
        loaded: !c.programmes.is_empty(),
        programmes: c.programmes.len(),
        channels: c.channels.len(),
        source: c.source.clone(),
        fetched: c.fetched.clone(),
    }
}

/// Keep the guide on disk (gzipped) so it is there next launch.
pub fn store(dir: &Path, text: &str) -> Option<()> {
    let src = cache().lock().unwrap().source.clone().unwrap_or_default();
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    enc.write_all(text.as_bytes()).ok()?;
    let gz = enc.finish().ok()?;
    std::fs::create_dir_all(dir).ok()?;
    std::fs::write(dir.join(GUIDE_FILE), gz).ok()?;
    std::fs::write(dir.join(GUIDE_SRC), src).ok()?;
    Some(())
}

/// Load the guide saved by the last run, if any.
pub fn restore(dir: &Path) -> bool {
    use std::io::Read;
    let Ok(bytes) = std::fs::read(dir.join(GUIDE_FILE)) else {
        return false;
    };
    let mut text = String::new();
    let mut dec = flate2::read::GzDecoder::new(&bytes[..]);
    if dec.read_to_string(&mut text).is_err() {
        return false;
    }
    let source = std::fs::read_to_string(dir.join(GUIDE_SRC)).unwrap_or_default();
    let st = load(
        &text,
        if source.is_empty() {
            "saved guide"
        } else {
            &source
        },
    );
    st.loaded
}

const GUIDE_FILE: &str = "guide.xml.gz";
const GUIDE_SRC: &str = "guide.src";

/// Replace the cache with a freshly parsed guide.
pub fn load(text: &str, source: &str) -> GuideStatus {
    let programmes = xmltv::parse(text);
    let mut channels: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in programmes.iter().enumerate() {
        channels.entry(p.channel.clone()).or_default().push(i);
    }
    let names = channel_names(text);
    let mut c = cache().lock().unwrap();
    c.programmes = programmes;
    c.channels = channels;
    c.names = names;
    c.source = Some(source.to_string());
    c.fetched = Some(now_iso());
    drop(c);
    status()
}

pub fn clear() {
    *cache().lock().unwrap() = Cache::default();
}

/// Now / next for the given tvg ids at `at` (defaults to the current time).
pub fn now_next(ids: &[String], at: Option<i64>) -> Vec<Guide> {
    let at = at.unwrap_or_else(unix_now);
    let c = cache().lock().unwrap();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        // Accept a tvg-id or a plain channel name; whichever the playlist has.
        let resolved = if c.channels.contains_key(id) {
            Some(id.as_str())
        } else {
            c.names.get(&norm(id)).map(|s| s.as_str())
        };
        let nn: NowNext = match resolved.and_then(|k| c.channels.get(k).map(|i| (k, i))) {
            Some((key, indexes)) => {
                let slice: Vec<Programme> =
                    indexes.iter().map(|i| c.programmes[*i].clone()).collect();
                xmltv::now_next(&slice, key, at)
            }
            None => NowNext::default(),
        };
        out.push(Guide {
            channel: id.clone(),
            now_title: nn.now.as_ref().map(|p| p.title.clone()),
            now_desc: nn.now.as_ref().and_then(|p| p.description.clone()),
            next_title: nn.next.as_ref().map(|p| p.title.clone()),
            start: nn.now.as_ref().map(|p| p.start),
            stop: nn.now.as_ref().map(|p| p.stop),
            progress: nn.progress,
        });
    }
    out
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    // Compact UTC stamp, good enough for "updated 5 min ago" in the UI.
    let secs = unix_now();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60
    )
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The guide cache is process-wide, so these tests must not interleave.
    fn guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    const GUIDE: &str = r#"<tv>
  <programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="a">
    <title>Noon Show</title>
  </programme>
  <programme start="20261025130000 +0000" stop="20261025140000 +0000" channel="a">
    <title>Afternoon Show</title>
  </programme>
</tv>"#;

    #[test]
    fn loads_and_answers_now_next() {
        let _g = guard();
        let st = load(GUIDE, "https://guide.example/epg.xml");
        assert!(st.loaded);
        assert_eq!(st.programmes, 2);
        assert_eq!(st.channels, 1);

        let at = xmltv::parse_time("20261025123000 +0000").unwrap();
        let got = now_next(&[String::from("a"), String::from("missing")], Some(at));
        assert_eq!(got[0].now_title.as_deref(), Some("Noon Show"));
        assert_eq!(got[0].next_title.as_deref(), Some("Afternoon Show"));
        assert!(got[1].now_title.is_none());
        clear();
        assert!(!status().loaded);
    }

    #[test]
    fn matches_a_channel_by_its_display_name() {
        let _g = guard();
        let guide = r#"<tv>
  <channel id="bbcone.uk"><display-name>BBC One HD</display-name></channel>
  <programme start="20261025120000 +0000" stop="20261025130000 +0000" channel="bbcone.uk">
    <title>News</title>
  </programme>
</tv>"#;
        load(guide, "local");
        let at = xmltv::parse_time("20261025121500 +0000").unwrap();
        let got = now_next(
            &[String::from("bbc one hd"), String::from("BBC One")],
            Some(at),
        );
        assert_eq!(got[0].now_title.as_deref(), Some("News"));
        assert!(got[1].now_title.is_none());
        assert_eq!(norm("Sky Sports 1 HD!"), "skysports1hd");
        clear();
    }

    #[test]
    fn civil_dates_round_trip() {
        let _g = guard();
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_725), (2026, 9, 29));
    }
}
