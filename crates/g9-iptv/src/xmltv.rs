//! XMLTV programme guide: enough of the format to show now / next per channel.
//!
//! Parsed with a small tag scanner rather than a DOM so a 100 MB guide can be
//! streamed line by line without holding the document in memory.

use serde::Serialize;

/// Seconds since the Unix epoch.
pub type Stamp = i64;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Programme {
    pub channel: String,
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub start: Stamp,
    pub stop: Stamp,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NowNext {
    pub now: Option<Programme>,
    pub next: Option<Programme>,
    /// 0.0–1.0 through the current programme.
    pub progress: f32,
}

impl Default for NowNext {
    fn default() -> Self {
        Self {
            now: None,
            next: None,
            progress: 0.0,
        }
    }
}

/// `2026-10-25 20:00:00 +0530` (XMLTV) to Unix seconds.
pub fn parse_time(raw: &str) -> Option<Stamp> {
    let text = raw.trim();
    let b = text.as_bytes();
    if b.len() < 14 {
        return None;
    }
    let num = |from: usize, len: usize| -> Option<i64> { text.get(from..from + len)?.parse().ok() };
    let y = num(0, 4)?;
    let mo = num(4, 2)?;
    let d = num(6, 2)?;
    let h = num(8, 2)?;
    let mi = num(10, 2)?;
    let s = if b.len() >= 14 { num(12, 2)? } else { 0 };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 60 {
        return None;
    }
    let mut days = days_from_civil(y, mo, d);
    days = days * 86_400 + h * 3_600 + mi * 60 + s;

    // Optional " +0530" / " -0400" offset after the time.
    let tail = text.get(14..).unwrap_or("").trim();
    let mut offset = 0i64;
    if tail.len() >= 5 {
        let sign = match tail.as_bytes()[0] {
            b'+' => 1,
            b'-' => -1,
            _ => 0,
        };
        if sign != 0 {
            if let (Some(hh), Some(mm)) = (tail.get(1..3), tail.get(3..5)) {
                if let (Ok(hh), Ok(mm)) = (hh.parse::<i64>(), mm.parse::<i64>()) {
                    offset = sign * (hh * 3_600 + mm * 60);
                }
            }
        }
    }
    Some(days - offset)
}

/// Howard Hinnant's days_from_civil.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn attr<'a>(tag: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("{key}=\"");
    let at = tag.find(&needle)?;
    let rest = &tag[at + needle.len()..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn inner_text(line: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let at = line.find(&open)?;
    let gt = line[at..].find('>')? + at;
    let close = format!("</{name}>");
    let end = line[gt..].find(&close)? + gt;
    let text = decode_entities(line.get(gt + 1..end)?.trim());
    (!text.is_empty()).then_some(text)
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let semi = tail.find(';').filter(|n| *n <= 8);
        let Some(semi) = semi else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let ent = &tail[1..semi];
        let decoded = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=semi]),
        }
        rest = &tail[semi + 1..];
    }
    out.push_str(rest);
    out
}

/// Parse XMLTV text. Programmes without a valid start/stop are dropped.
pub fn parse(text: &str) -> Vec<Programme> {
    const MAX_PROGRAMMES: usize = 500_000;
    let mut out = Vec::new();
    let mut current: Option<Programme> = None;

    for raw in text.lines() {
        if out.len() >= MAX_PROGRAMMES {
            break;
        }
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("<programme") {
            let channel = attr(line, "channel").unwrap_or_default().to_string();
            let start = attr(line, "start").and_then(parse_time);
            let stop = attr(line, "stop").and_then(parse_time);
            match (start, stop) {
                (Some(start), Some(stop)) if stop > start && !channel.is_empty() => {
                    current = Some(Programme {
                        channel,
                        title: String::new(),
                        description: None,
                        category: None,
                        start,
                        stop,
                    });
                }
                _ => current = None,
            }
            // Self-closing, or the whole entry on one line — common in exported
            // guides, and it must not be lost when the next line starts anew.
            if let Some(p) = current.as_mut() {
                if let Some(t) = inner_text(line, "title") {
                    p.title = t;
                }
                if let Some(d) = inner_text(line, "desc") {
                    p.description = Some(d);
                }
                let closes = line.contains("</programme>");
                if closes && !p.title.is_empty() {
                    out.push(p.clone());
                    current = None;
                } else if closes {
                    current = None;
                }
            }
            continue;
        }
        let Some(p) = current.as_mut() else { continue };
        if p.title.is_empty() {
            if let Some(t) = inner_text(line, "title") {
                p.title = t;
                continue;
            }
        }
        if p.description.is_none() {
            if let Some(d) = inner_text(line, "desc") {
                p.description = Some(d);
                continue;
            }
        }
        if p.category.is_none() {
            if let Some(c) = inner_text(line, "category") {
                p.category = Some(c);
                continue;
            }
        }
        if line.starts_with("</programme>") {
            if !p.title.is_empty() {
                out.push(p.clone());
            }
            current = None;
        }
    }
    if let Some(p) = current {
        if !p.title.is_empty() {
            out.push(p);
        }
    }
    out.sort_by_key(|p| (p.channel.clone(), p.start));
    out
}

/// Now / next for one channel at `at` (Unix seconds).
pub fn now_next(programmes: &[Programme], channel: &str, at: Stamp) -> NowNext {
    let mut out = NowNext::default();
    for p in programmes.iter().filter(|p| p.channel == channel) {
        if p.start <= at && at < p.stop {
            out.now = Some(p.clone());
        } else if p.start > at && out.next.is_none() {
            out.next = Some(p.clone());
        }
    }
    if let Some(now) = &out.now {
        let span = (now.stop - now.start) as f32;
        if span > 0.0 {
            out.progress = (((at - now.start) as f32) / span).clamp(0.0, 1.0);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc1"><display-name>BBC One</display-name></channel>
  <programme start="20261025200000 +0000" stop="20261025210000 +0000" channel="bbc1">
    <title lang="en">Evening News &amp; Weather</title>
    <desc>Headlines.</desc>
    <category>News</category>
  </programme>
  <programme start="20261025210000 +0000" stop="20261025223000 +0000" channel="bbc1">
    <title>Drama</title>
  </programme>
  <programme start="bad" stop="20261025210000 +0000" channel="bbc1">
    <title>Broken</title>
  </programme>
  <programme start="20261025200000 +0000" stop="20261025210000 +0000" channel="itv1">
    <title>Other channel</title>
  </programme>
</tv>"#;

    #[test]
    fn parses_programmes_and_entities() {
        let list = parse(SAMPLE);
        assert_eq!(list.len(), 3);
        let first = &list[0];
        assert_eq!(first.title, "Evening News & Weather");
        assert_eq!(first.description.as_deref(), Some("Headlines."));
        assert_eq!(first.category.as_deref(), Some("News"));
        assert_eq!(first.channel, "bbc1");
        assert_eq!(first.stop - first.start, 3600);
    }

    #[test]
    fn time_offsets_are_applied() {
        let utc = parse_time("20261025200000 +0000").unwrap();
        let ist = parse_time("20261026013000 +0530").unwrap();
        assert_eq!(utc, ist);
        assert!(parse_time("nonsense").is_none());
        assert!(parse_time("20261325200000 +0000").is_none());
    }

    #[test]
    fn now_next_picks_the_right_slot() {
        let list = parse(SAMPLE);
        let at = parse_time("20261025203000 +0000").unwrap();
        let nn = now_next(&list, "bbc1", at);
        assert_eq!(
            nn.now.as_ref().map(|p| p.title.as_str()),
            Some("Evening News & Weather")
        );
        assert_eq!(nn.next.as_ref().map(|p| p.title.as_str()), Some("Drama"));
        assert!((nn.progress - 0.5).abs() < 0.01);

        let later = parse_time("20261025220000 +0000").unwrap();
        let nn = now_next(&list, "bbc1", later);
        assert_eq!(nn.now.as_ref().map(|p| p.title.as_str()), Some("Drama"));
        assert!(nn.next.is_none());

        let none = now_next(&list, "missing", at);
        assert!(none.now.is_none() && none.next.is_none());
    }

    #[test]
    fn decodes_numeric_entities() {
        assert_eq!(decode_entities("a&#233;b"), "aéb");
        assert_eq!(decode_entities("x&#x1F600;y"), "x😀y");
        assert_eq!(decode_entities("plain"), "plain");
    }
}
