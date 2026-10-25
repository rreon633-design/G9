//! Shared Fun Mode types. The UI receives these as JSON, so the field names are
//! part of the contract (`ui/fun.js`).

use serde::{Deserialize, Serialize};

/// What a card is. `movie` and `series` come from addons; `anime`, `drama` and
/// `serial` are the same shape with a different shelf label; `manga` opens the
/// reader instead of the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Movie,
    Series,
    Anime,
    Drama,
    Serial,
    Manga,
}

impl Kind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "movie" | "film" => Some(Self::Movie),
            "series" | "show" | "tv" => Some(Self::Series),
            "anime" => Some(Self::Anime),
            "drama" => Some(Self::Drama),
            "serial" | "soap" => Some(Self::Serial),
            "manga" | "manhwa" | "manhua" => Some(Self::Manga),
            _ => None,
        }
    }

    /// Stremio names its own types; map them onto G9 shelves.
    pub fn from_stremio(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "movie" => Some(Self::Movie),
            "series" => Some(Self::Series),
            "anime" => Some(Self::Anime),
            "manga" | "comic" => Some(Self::Manga),
            "channel" | "tv" => Some(Self::Serial),
            _ => None,
        }
    }

    pub fn is_reading(self) -> bool {
        matches!(self, Self::Manga)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Uhd,
    Fhd,
    Hd,
    Sd,
    #[default]
    Unknown,
}

impl Quality {
    pub fn label(self) -> &'static str {
        match self {
            Self::Uhd => "4K",
            Self::Fhd => "1080p",
            Self::Hd => "720p",
            Self::Sd => "SD",
            Self::Unknown => "—",
        }
    }

    /// Rough ordering used to pick the best stream: 4K > 1080p > 720p > SD.
    pub fn rank(self) -> u8 {
        match self {
            Self::Uhd => 4,
            Self::Fhd => 3,
            Self::Hd => 2,
            Self::Sd => 1,
            Self::Unknown => 0,
        }
    }

    /// Read a resolution from a free-form label ("1080p", "4K", "2160p", "HD").
    pub fn from_label(raw: &str) -> Self {
        let s = raw.to_ascii_lowercase();
        if s.contains("2160") || s.contains("4k") || s.contains("uhd") {
            Self::Uhd
        } else if s.contains("1080") || s.contains("fhd") {
            Self::Fhd
        } else if s.contains("720") || s.contains("hd") {
            Self::Hd
        } else if s.contains("480") || s.contains("360") || s.contains("sd") {
            Self::Sd
        } else {
            Self::Unknown
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subtitle {
    pub label: String,
    pub url: String,
    pub lang: String,
}

/// A card on a shelf.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    /// Provider-scoped id, e.g. `tt1234` or a feed GUID.
    pub id: String,
    pub title: String,
    pub kind: Kind,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub score: Option<f32>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub backdrop: Option<String>,
    #[serde(default)]
    pub synopsis: Option<String>,
    /// `214 ch` for a manga, `S3 E6` for a series — the small line under a card.
    #[serde(default)]
    pub subtitle: Option<String>,
    /// Highest quality any stream offered last time this was resolved.
    #[serde(default)]
    pub quality: Quality,
    /// Rows this belongs to (`Continue watching`, `New episodes`, …).
    #[serde(default)]
    pub badge: Option<String>,
    /// Top-billed people, when the source lists them. Powers the cast row.
    #[serde(default)]
    pub cast: Vec<String>,
}

impl Item {
    pub fn new(id: impl Into<String>, title: impl Into<String>, kind: Kind) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            kind,
            year: None,
            score: None,
            genres: Vec::new(),
            poster: None,
            backdrop: None,
            synopsis: None,
            subtitle: None,
            quality: Quality::Unknown,
            badge: None,
            cast: Vec::new(),
        }
    }
}

/// One playable thing. `url` may be an `http(s)` media URL or a `magnet:` URI;
/// the UI hands magnets to the torrent engine (v0.10) and everything else to the
/// player.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stream {
    pub url: String,
    pub label: String,
    pub provider: String,
    #[serde(default)]
    pub quality: Quality,
    /// Bytes, when the source says.
    #[serde(default)]
    pub size: Option<u64>,
    /// Seeds for a magnet; `None` for plain HTTP.
    #[serde(default)]
    pub seeds: Option<u32>,
    #[serde(default)]
    pub magnet: bool,
    /// Extra request headers the CDN needs (`Referer`, `User-Agent`, …).
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub subtitles: Vec<Subtitle>,
}

impl Stream {
    pub fn http(
        url: impl Into<String>,
        label: impl Into<String>,
        provider: impl Into<String>,
    ) -> Self {
        let url = url.into();
        let label = label.into();
        Self {
            quality: Quality::from_label(&label),
            url,
            label,
            provider: provider.into(),
            size: None,
            seeds: None,
            magnet: false,
            headers: Vec::new(),
            subtitles: Vec::new(),
        }
    }

    pub fn magnet(
        url: impl Into<String>,
        label: impl Into<String>,
        provider: impl Into<String>,
    ) -> Self {
        let mut s = Self::http(url, label, provider);
        s.magnet = true;
        s
    }
}

/// Best-first: quality, then seeds, then known size. The player falls back down
/// this list when a URL 403s or stalls.
pub fn rank_streams(list: &mut [Stream]) {
    list.sort_by(|a, b| {
        b.quality
            .rank()
            .cmp(&a.quality.rank())
            .then(b.seeds.unwrap_or(0).cmp(&a.seeds.unwrap_or(0)))
            .then(b.size.unwrap_or(0).cmp(&a.size.unwrap_or(0)))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_from_label_reads_resolutions() {
        assert_eq!(Quality::from_label("2160p HDR"), Quality::Uhd);
        assert_eq!(Quality::from_label("4K · HEVC"), Quality::Uhd);
        assert_eq!(Quality::from_label("1080p BluRay"), Quality::Fhd);
        assert_eq!(Quality::from_label("720p"), Quality::Hd);
        assert_eq!(Quality::from_label("480p"), Quality::Sd);
        assert_eq!(Quality::from_label("cam"), Quality::Unknown);
    }

    #[test]
    fn streams_rank_best_first() {
        let mut v = vec![
            Stream::http("http://a/720", "720p", "p"),
            Stream::http("http://a/2160", "2160p", "p"),
            Stream::http("http://a/1080", "1080p", "p"),
        ];
        rank_streams(&mut v);
        assert_eq!(v[0].url, "http://a/2160");
        assert_eq!(v[1].url, "http://a/1080");
        assert_eq!(v[2].url, "http://a/720");
    }

    #[test]
    fn magnet_beats_http_of_same_quality_when_it_has_seeds() {
        let mut v = vec![
            Stream::http("http://a/x", "1080p", "p"),
            Stream::magnet("magnet:?xt=urn:btih:abc", "1080p", "p"),
        ];
        v[1].seeds = Some(42);
        rank_streams(&mut v);
        assert!(v[0].magnet);
    }

    #[test]
    fn kind_parsing_covers_shelves() {
        assert_eq!(Kind::parse("Manhwa"), Some(Kind::Manga));
        assert_eq!(Kind::parse("web series"), None);
        assert_eq!(Kind::from_stremio("series"), Some(Kind::Series));
        assert!(Kind::Manga.is_reading());
    }

    #[test]
    fn item_serialises_with_lowercase_kind() {
        let it = Item::new("tt1", "Title", Kind::Movie);
        let js = serde_json::to_string(&it).unwrap();
        assert!(js.contains("\"kind\":\"movie\""), "{js}");
    }
}

/// One episode (or chapter). `id` is what the source needs to resolve a stream:
/// Stremio wants `tt123:1:2`, MangaDex wants the chapter UUID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub number: i32,
    #[serde(default)]
    pub season: Option<i32>,
    pub title: String,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub thumb: Option<String>,
    #[serde(default)]
    pub runtime: Option<i32>,
    #[serde(default)]
    pub released: Option<String>,
}

/// A shelf on the wall. One catalog is one row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shelf {
    pub id: String,
    pub title: String,
    pub source_id: i64,
    pub kind: Kind,
    pub items: Vec<Item>,
}

/// Everything the details sheet needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Details {
    pub item: Item,
    #[serde(default)]
    pub episodes: Vec<Episode>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub seasons: Vec<i32>,
}
