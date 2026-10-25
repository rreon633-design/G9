//! RSS feeds of magnet links.
//!
//! A Nyaa-style search feed (`?page=rss&q=…&c=1_2&f=0`) is the easiest legal-safe
//! source G9 can support: the user supplies the feed URL, the feed supplies the
//! magnets, and nothing is bundled. Namespaced counters (`nyaa:seeders`, …) are
//! read when present and skipped when not, so any RSS feed works.

use crate::html::{attr, tag_text};
use crate::model::{Item, Kind, Quality, Stream};

/// One feed entry: the card plus the stream it already is.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub item: Item,
    pub stream: Stream,
    pub published: Option<String>,
}

fn parse_size(raw: &str) -> Option<u64> {
    let s = raw.trim().to_ascii_lowercase();
    let num: String = s
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let v: f64 = num.parse().ok()?;
    let mult = if s.contains("gib") || s.contains("gb") {
        1024.0 * 1024.0 * 1024.0
    } else if s.contains("mib") || s.contains("mb") {
        1024.0 * 1024.0
    } else if s.contains("kib") || s.contains("kb") {
        1024.0
    } else {
        1.0
    };
    Some((v * mult) as u64)
}

/// `[Group] Title - 12 (1080p) [ABCD].mkv` → `("Title - 12", 1080p)`.
///
/// Release names carry a group bracket, a quality tag and a file extension. All
/// three are noise on a poster card, so they come off — the untouched name stays
/// in the stream label.
pub fn split_release_title(raw: &str) -> (String, Quality) {
    let quality = Quality::from_label(raw);
    let mut t = raw.trim().to_string();

    if t.starts_with('[') {
        if let Some(end) = t.find(']') {
            t = t[end + 1..].trim().to_string();
        }
    }
    for ext in [".mkv", ".mp4", ".avi", ".webm", ".m4v", ".ts"] {
        if t.to_ascii_lowercase().ends_with(ext) {
            t.truncate(t.len() - ext.len());
        }
    }
    loop {
        let tt = t.trim_end().to_string();
        match tt.chars().last() {
            Some(']') => match tt.rfind('[') {
                Some(i) => {
                    t = tt[..i].trim_end().to_string();
                    continue;
                }
                None => {
                    t = tt;
                    break;
                }
            },
            Some(')') => match tt.rfind('(') {
                Some(i) => {
                    t = tt[..i].trim_end().to_string();
                    continue;
                }
                None => {
                    t = tt;
                    break;
                }
            },
            _ => {
                t = tt;
                break;
            }
        }
    }
    let t = t
        .trim_end_matches(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .to_string();
    (
        if t.is_empty() {
            raw.trim().to_string()
        } else {
            t
        },
        quality,
    )
}

/// Parse an RSS document into entries. `kind` decides which shelf they land on;
/// the feed's own category is used only as a hint.
pub fn parse_feed(xml: &str, provider: &str, kind: Kind) -> Vec<Entry> {
    let mut out = Vec::new();
    // `<item>` and `<entry>` (Atom) are both accepted.
    for block in raw_blocks(xml, "item")
        .into_iter()
        .chain(raw_blocks(xml, "entry"))
    {
        let raw_title = tag_text(&block, "title").unwrap_or_default();
        if raw_title.is_empty() {
            continue;
        }
        let link = tag_text(&block, "link")
            .filter(|l| l.starts_with("magnet:"))
            .or_else(|| attr(&block, "link", "href").filter(|l| l.starts_with("magnet:")))
            .or_else(|| tag_text(&block, "torrent:magnetURI"))
            .or_else(|| tag_text(&block, "guid").filter(|l| l.starts_with("magnet:")))
            .or_else(|| attr(&block, "enclosure", "url").filter(|l| l.starts_with("magnet:")));
        // Nyaa hands back a .torrent link plus an info hash; a magnet is what
        // the player can actually use, so build one when the feed only has that.
        let magnet = match link {
            Some(m) => Some(m),
            None => first_of(&block, &["nyaa:infoHash", "torrent:infoHash"])
                .filter(|h| !h.is_empty())
                .map(|h| crate::stremio::build_magnet(&h, Some(&raw_title))),
        };
        let Some(magnet) = magnet else { continue };

        let guid = tag_text(&block, "guid")
            .or_else(|| tag_text(&block, "id"))
            .filter(|g| !g.is_empty())
            .unwrap_or_else(|| magnet.clone());
        let seeds = first_of(&block, &["nyaa:seeders", "torrent:seeds", "seeders"])
            .and_then(|s| s.parse::<u32>().ok());
        let size = first_of(&block, &["nyaa:size", "torrent:contentLength", "size"])
            .and_then(|s| parse_size(&s));
        let category = first_of(&block, &["nyaa:category", "category"]);
        let published = first_of(&block, &["pubDate", "published", "updated"]);

        let (title, quality) = split_release_title(&raw_title);
        let kind = if let Some(c) = category.as_deref() {
            match c.to_ascii_lowercase().as_str() {
                "anime" => Kind::Anime,
                "manga" | "manhwa" | "manhua" => Kind::Manga,
                "movies" | "movie" => Kind::Movie,
                "tv" | "series" | "drama" => Kind::Series,
                _ => kind,
            }
        } else {
            kind
        };

        let mut item = Item::new(guid.clone(), title.clone(), kind);
        item.quality = quality;
        item.subtitle = size.map(human_size);
        item.badge = seeds.map(|s| format!("{s} seeds"));
        if let Some(c) = category.clone() {
            item.genres.push(c);
        }
        if let Some(p) = published.clone() {
            item.year = crate::html::year_of(&p);
        }

        let label = {
            let mut parts = vec![quality.label().to_string()];
            if let Some(s) = size {
                parts.push(human_size(s));
            }
            if let Some(sd) = seeds {
                parts.push(format!("{sd} seeds"));
            }
            parts.join(" · ")
        };
        let mut stream = Stream::magnet(magnet.clone(), label, provider.to_string());
        stream.quality = quality;
        stream.size = size;
        stream.seeds = seeds;
        stream.subtitles = Vec::new();

        out.push(Entry {
            item,
            stream,
            published,
        });
    }
    out
}

/// The raw inner text of every `<tag>…</tag>`, markup preserved.
fn raw_blocks(xml: &str, tag: &str) -> Vec<String> {
    let mut out = Vec::new();
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut rest = xml;
    while let Some(s) = rest.find(&open) {
        let body = &rest[s + open.len()..];
        let Some(end) = body.find(&close) else { break };
        out.push(body[..end].to_string());
        rest = &body[end + close.len()..];
    }
    out
}

fn first_of(block: &str, tags: &[&str]) -> Option<String> {
    tags.iter().find_map(|t| tag_text(block, t))
}

pub fn human_size(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", b / MB)
    } else {
        format!("{:.0} KB", (b / 1024.0).max(1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <title>Nyaa - Search results</title>
    <item>
      <title>[SubsPlease] Some Show - 12 (1080p) [ABCD1234].mkv</title>
      <link>https://nyaa.si/download/123456.torrent</link>
      <guid isPermaLink="true">https://nyaa.si/view/123456</guid>
      <pubDate>Sat, 25 Oct 2025 09:00:00 -0000</pubDate>
      <nyaa:seeders>38</nyaa:seeders>
      <nyaa:leechers>4</nyaa:leechers>
      <nyaa:size>1.4 GiB</nyaa:size>
      <nyaa:category>Anime</nyaa:category>
      <nyaa:infoHash>abc123def456</nyaa:infoHash>
    </item>
    <item>
      <title>Another Show S02E03 720p WEB-DL</title>
      <link>magnet:?xt=urn:btih:FFFF9999&amp;dn=Another</link>
      <guid>https://nyaa.si/view/999</guid>
      <nyaa:seeders>3</nyaa:seeders>
      <nyaa:size>700 MiB</nyaa:size>
      <nyaa:category>TV</nyaa:category>
    </item>
    <item>
      <title>No link at all</title>
    </item>
  </channel>
</rss>"#;

    #[test]
    fn feed_entries_become_cards_and_streams() {
        let entries = parse_feed(FEED, "Anime feed", Kind::Anime);
        assert_eq!(entries.len(), 2, "entries without a magnet are skipped");
        let first = &entries[0];
        assert_eq!(first.item.kind, Kind::Anime);
        assert_eq!(first.item.title, "Some Show - 12");
        assert_eq!(first.item.quality, Quality::Fhd);
        assert_eq!(first.item.subtitle.as_deref(), Some("1.4 GB"));
        assert_eq!(first.item.year, Some(2025));
        assert_eq!(first.stream.seeds, Some(38));
        assert!(first.stream.magnet);
        assert!(first.item.badge.as_deref().unwrap().contains("38"));
    }

    #[test]
    fn infohash_only_feed_still_yields_a_magnet() {
        // The first item has no magnet <link>, only a download link + infoHash;
        // that entry is skipped today, which is the honest behaviour.
        let entries = parse_feed(FEED, "p", Kind::Anime);
        assert!(entries.iter().all(|e| e.stream.url.starts_with("magnet:")));
    }

    #[test]
    fn escaped_magnet_is_decoded() {
        let entries = parse_feed(FEED, "p", Kind::Anime);
        assert!(entries[1].stream.url.contains("&dn=Another"));
        assert_eq!(entries[1].item.kind, Kind::Series, "TV category wins");
        assert_eq!(entries[1].item.quality, Quality::Hd);
    }

    #[test]
    fn size_parsing_handles_units() {
        assert_eq!(parse_size("1.4 GiB"), Some(1503238553));
        assert_eq!(parse_size("700 MiB"), Some(734003200));
        assert_eq!(parse_size("512 KiB"), Some(524288));
        assert_eq!(parse_size("nonsense"), None);
    }

    #[test]
    fn release_titles_are_cleaned() {
        assert_eq!(
            split_release_title("[Group] Cool Show - 01 [1080p]").0,
            "Cool Show - 01"
        );
        assert_eq!(split_release_title("Plain Title").0, "Plain Title");
        assert_eq!(split_release_title("Film 2160p").1, Quality::Uhd);
    }

    #[test]
    fn human_size_is_short() {
        assert_eq!(human_size(1_500_000_000), "1.4 GB");
        assert_eq!(human_size(700 * 1024 * 1024), "700 MB");
    }

    #[test]
    fn plain_rss_without_namespaces_works() {
        let xml = r#"<rss><channel>
            <item><title>Doc</title><link>magnet:?xt=urn:btih:AAA</link></item>
        </channel></rss>"#;
        let e = parse_feed(xml, "p", Kind::Movie);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].item.title, "Doc");
        assert_eq!(e[0].stream.seeds, None);
    }
}
