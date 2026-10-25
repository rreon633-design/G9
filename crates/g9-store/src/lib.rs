//! Local SQLite store for G9. No passwords are persisted here.

mod schema;

use g9_core::{ParseReport, ParsedChannel, SourceKind};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Msg(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRow {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub status: String,
    pub channel_count: i64,
}

/// Filters for [`Store::list_channels`]; every field is optional.
#[derive(Debug, Clone, Default)]
pub struct ChannelQuery<'a> {
    pub group: Option<&'a str>,
    pub query: Option<&'a str>,
    pub favourites_only: bool,
    pub country: Option<&'a str>,
    pub language: Option<&'a str>,
    pub quality: Option<&'a str>,
    /// `number` (default), `name`, `country`, `quality`, `group`.
    pub sort: &'a str,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Facet {
    pub value: String,
    pub count: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Facets {
    pub countries: Vec<Facet>,
    pub languages: Vec<Facet>,
    pub qualities: Vec<Facet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRow {
    pub id: i64,
    pub source_id: i64,
    pub number: i64,
    pub name: String,
    pub group_name: Option<String>,
    pub logo_url: Option<String>,
    pub stream_url: String,
    pub tvg_id: Option<String>,
    pub country: Option<String>,
    pub language: Option<String>,
    pub quality: Option<String>,
    pub is_favourite: bool,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRow {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRow {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub kind: String,
    pub position: f64,
    pub duration: f64,
    pub played_at: String,
}

pub struct Store {
    conn: Connection,
    path: PathBuf,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| StoreError::Msg(e.to_string()))?;
        }
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        schema::migrate(&conn)?;
        Ok(Self { conn, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn add_source(
        &mut self,
        kind: SourceKind,
        name: &str,
        url: &str,
        channels: &[ParsedChannel],
    ) -> Result<(i64, ParseReport)> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO sources (kind, name, url, status, last_refresh) VALUES (?1, ?2, ?3, 'ok', datetime('now'))",
            params![kind_str(kind), name, url],
        )?;
        let source_id = tx.last_insert_rowid();
        insert_channels(&tx, source_id, channels)?;
        tx.commit()?;
        let mut groups = std::collections::BTreeSet::new();
        for c in channels {
            if let Some(g) = &c.group {
                groups.insert(g.clone());
            }
        }
        Ok((
            source_id,
            ParseReport {
                channel_count: channels.len(),
                group_count: groups.len(),
                ..ParseReport::default()
            },
        ))
    }

    pub fn replace_source_channels(
        &mut self,
        source_id: i64,
        channels: &[ParsedChannel],
    ) -> Result<usize> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM channels WHERE source_id = ?1",
            params![source_id],
        )?;
        insert_channels(&tx, source_id, channels)?;
        tx.execute(
            "UPDATE sources SET last_refresh = datetime('now'), status = 'ok' WHERE id = ?1",
            params![source_id],
        )?;
        tx.commit()?;
        Ok(channels.len())
    }

    pub fn list_sources(&self) -> Result<Vec<SourceRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.kind, s.name, s.url, s.status,
                    (SELECT COUNT(*) FROM channels c WHERE c.source_id = s.id)
             FROM sources s ORDER BY s.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SourceRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                name: row.get(2)?,
                url: row.get(3)?,
                status: row.get(4)?,
                channel_count: row.get(5)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn delete_source(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM sources WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_groups(&self) -> Result<Vec<GroupRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(group_name, 'Ungrouped') AS g, COUNT(*)
             FROM channels WHERE is_hidden = 0
             GROUP BY g ORDER BY g",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(GroupRow {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    /// Everything TV mode can ask the channel table for.
    pub fn list_channels(&self, q: &ChannelQuery<'_>) -> Result<Vec<ChannelRow>> {
        let limit = q.limit.clamp(1, 5000);
        let offset = q.offset.max(0);
        let mut sql = String::from(
            "SELECT id, source_id, number, name, group_name, logo_url, stream_url, tvg_id,
                    country, language, quality, is_favourite, is_hidden
             FROM channels WHERE is_hidden = 0",
        );
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if q.favourites_only {
            sql.push_str(" AND is_favourite = 1");
        }
        for (col, value) in [
            ("COALESCE(group_name, 'Ungrouped')", q.group),
            ("COALESCE(country, '')", q.country),
            ("COALESCE(language, '')", q.language),
            ("COALESCE(quality, '')", q.quality),
        ] {
            if let Some(v) = value {
                sql.push_str(&format!(" AND {col} = ?"));
                args.push(v.to_string().into());
            }
        }
        if let Some(query) = q.query {
            sql.push_str(
                " AND (name LIKE ? OR IFNULL(group_name,'') LIKE ? OR IFNULL(tvg_id,'') LIKE ?
                   OR IFNULL(country,'') LIKE ? OR IFNULL(language,'') LIKE ?)",
            );
            let like = format!("%{}%", query.replace(['%', '_'], ""));
            for _ in 0..5 {
                args.push(like.clone().into());
            }
        }
        // Sorting: quality high-to-low, then the number the playlist gave.
        let order = match q.sort {
            "name" => "name COLLATE NOCASE",
            "country" => "COALESCE(country,'') , name COLLATE NOCASE",
            "quality" => {
                "CASE COALESCE(quality,'') WHEN '4K' THEN 0 WHEN 'FHD' THEN 1 WHEN 'HD' THEN 2 \
                 WHEN 'SD' THEN 3 ELSE 4 END, name COLLATE NOCASE"
            }
            "group" => "COALESCE(group_name,''), number",
            _ => "number, name COLLATE NOCASE",
        };
        sql.push_str(&format!(" ORDER BY {order} LIMIT ? OFFSET ?"));
        args.push(limit.into());
        args.push(offset.into());

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args), |row| {
                Ok(ChannelRow {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    number: row.get(2)?,
                    name: row.get(3)?,
                    group_name: row.get(4)?,
                    logo_url: row.get(5)?,
                    stream_url: row.get(6)?,
                    tvg_id: row.get(7)?,
                    country: row.get(8)?,
                    language: row.get(9)?,
                    quality: row.get(10)?,
                    is_favourite: row.get::<_, i64>(11)? != 0,
                    is_hidden: row.get::<_, i64>(12)? != 0,
                })
            })?
            .flatten()
            .collect();
        Ok(rows)
    }

    /// Distinct values (with counts) that the TV filter chips offer.
    pub fn channel_facets(&self) -> Result<Facets> {
        let mut facets = Facets::default();
        for (sql, bucket) in [
            (
                "SELECT COALESCE(country,''), COUNT(*) FROM channels WHERE is_hidden = 0
                 AND IFNULL(country,'') <> '' GROUP BY 1 ORDER BY 2 DESC, 1",
                &mut facets.countries,
            ),
            (
                "SELECT COALESCE(language,''), COUNT(*) FROM channels WHERE is_hidden = 0
                 AND IFNULL(language,'') <> '' GROUP BY 1 ORDER BY 2 DESC, 1",
                &mut facets.languages,
            ),
            (
                "SELECT COALESCE(quality,''), COUNT(*) FROM channels WHERE is_hidden = 0
                 AND IFNULL(quality,'') <> '' GROUP BY 1
                 ORDER BY CASE quality WHEN '4K' THEN 0 WHEN 'FHD' THEN 1 WHEN 'HD' THEN 2
                 WHEN 'SD' THEN 3 ELSE 4 END",
                &mut facets.qualities,
            ),
        ] {
            let mut stmt = self.conn.prepare(sql)?;
            *bucket = stmt
                .query_map([], |r| {
                    Ok(Facet {
                        value: r.get(0)?,
                        count: r.get::<_, i64>(1)?,
                    })
                })?
                .flatten()
                .collect();
        }
        Ok(facets)
    }

    pub fn get_channel(&self, id: i64) -> Result<Option<ChannelRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, number, name, group_name, logo_url, stream_url, tvg_id,
                    country, language, quality, is_favourite, is_hidden
             FROM channels WHERE id = ?1",
        )?;
        let row = stmt
            .query_row(params![id], |row| {
                Ok(ChannelRow {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    number: row.get(2)?,
                    name: row.get(3)?,
                    group_name: row.get(4)?,
                    logo_url: row.get(5)?,
                    stream_url: row.get(6)?,
                    tvg_id: row.get(7)?,
                    country: row.get(8)?,
                    language: row.get(9)?,
                    quality: row.get(10)?,
                    is_favourite: row.get::<_, i64>(11)? != 0,
                    is_hidden: row.get::<_, i64>(12)? != 0,
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn neighbour_ids(&self, id: i64) -> Result<(Option<i64>, Option<i64>)> {
        let number: i64 = self
            .conn
            .query_row(
                "SELECT number FROM channels WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        let prev = self
            .conn
            .query_row(
                "SELECT id FROM channels WHERE is_hidden = 0 AND (number < ?1 OR (number = ?1 AND id < ?2))
                 ORDER BY number DESC, id DESC LIMIT 1",
                params![number, id],
                |r| r.get(0),
            )
            .optional()?;
        let next = self
            .conn
            .query_row(
                "SELECT id FROM channels WHERE is_hidden = 0 AND (number > ?1 OR (number = ?1 AND id > ?2))
                 ORDER BY number ASC, id ASC LIMIT 1",
                params![number, id],
                |r| r.get(0),
            )
            .optional()?;
        Ok((prev, next))
    }

    pub fn toggle_favourite(&self, id: i64) -> Result<bool> {
        self.conn.execute(
            "UPDATE channels SET is_favourite = CASE is_favourite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?1",
            params![id],
        )?;
        let fav: i64 = self.conn.query_row(
            "SELECT is_favourite FROM channels WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(fav != 0)
    }

    pub fn add_history(
        &self,
        title: &str,
        url: &str,
        kind: &str,
        position: f64,
        duration: f64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO history (title, url, kind, position, duration, played_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            params![title, url, kind, position, duration],
        )?;
        self.conn.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 200)",
            [],
        )?;
        Ok(())
    }

    pub fn list_history(&self, limit: i64) -> Result<Vec<HistoryRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, url, kind, position, duration, played_at
             FROM history ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.clamp(1, 200)], |row| {
            Ok(HistoryRow {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                kind: row.get(3)?,
                position: row.get(4)?,
                duration: row.get(5)?,
                played_at: row.get(6)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        let v = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn stats(&self) -> Result<StoreStats> {
        let sources: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))?;
        let channels: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM channels", [], |r| r.get(0))?;
        let favs: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM channels WHERE is_favourite = 1",
            [],
            |r| r.get(0),
        )?;
        Ok(StoreStats {
            sources,
            channels,
            favourites: favs,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreStats {
    pub sources: i64,
    pub channels: i64,
    pub favourites: i64,
}

fn kind_str(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::File => "file",
        SourceKind::Url => "url",
        SourceKind::Xtream => "xtream",
    }
}

fn insert_channels(
    tx: &rusqlite::Transaction<'_>,
    source_id: i64,
    channels: &[ParsedChannel],
) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO channels (source_id, number, name, group_name, logo_url, stream_url, tvg_id, tvg_name, country, language, quality)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;
    for (i, ch) in channels.iter().enumerate() {
        stmt.execute(params![
            source_id,
            (i as i64) + 1,
            ch.name,
            ch.group,
            ch.tvg_logo,
            ch.url,
            ch.tvg_id,
            ch.tvg_name,
            ch.country,
            ch.language,
            ch.quality,
        ])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use g9_core::StreamType;
    use tempfile::tempdir;

    fn sample() -> Vec<ParsedChannel> {
        vec![
            ParsedChannel {
                name: "One".into(),
                url: "https://e/1".into(),
                group: Some("A".into()),
                tvg_id: Some("one".into()),
                tvg_name: None,
                tvg_logo: None,
                country: Some("UK".into()),
                language: Some("English".into()),
                quality: Some("HD".into()),
                duration: None,
                stream_type: StreamType::Live,
            },
            ParsedChannel {
                name: "Two".into(),
                url: "https://e/2".into(),
                group: Some("B".into()),
                tvg_id: None,
                tvg_name: None,
                tvg_logo: None,
                country: Some("US".into()),
                language: None,
                quality: Some("4K".into()),
                duration: None,
                stream_type: StreamType::Live,
            },
        ]
    }

    #[test]
    fn import_search_favourite() {
        let dir = tempdir().unwrap();
        let mut store = Store::open(dir.path().join("g9.db")).unwrap();
        store
            .add_source(
                SourceKind::Url,
                "Demo",
                "https://example/list.m3u",
                &sample(),
            )
            .unwrap();
        let groups = store.list_groups().unwrap();
        assert_eq!(groups.len(), 2);
        let found = store
            .list_channels(&ChannelQuery {
                query: Some("two"),
                limit: 50,
                ..ChannelQuery::default()
            })
            .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Two");
        let fav = store.toggle_favourite(found[0].id).unwrap();
        assert!(fav);
        let favs = store
            .list_channels(&ChannelQuery {
                favourites_only: true,
                limit: 50,
                ..ChannelQuery::default()
            })
            .unwrap();
        assert_eq!(favs.len(), 1);

        // country / quality filters and the facet counts behind the TV chips
        let uk = store
            .list_channels(&ChannelQuery {
                country: Some("UK"),
                limit: 50,
                ..ChannelQuery::default()
            })
            .unwrap();
        assert_eq!(uk.len(), 1);
        assert_eq!(uk[0].name, "One");
        let best = store
            .list_channels(&ChannelQuery {
                sort: "quality",
                limit: 50,
                ..ChannelQuery::default()
            })
            .unwrap();
        assert_eq!(best[0].quality.as_deref(), Some("4K"));

        let facets = store.channel_facets().unwrap();
        assert_eq!(facets.countries.len(), 2);
        assert_eq!(facets.qualities.len(), 2);
        assert_eq!(facets.languages.len(), 1);
        assert!(facets.countries.iter().all(|f| f.count == 1));
    }
}
