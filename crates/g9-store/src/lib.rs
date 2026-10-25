//! Local SQLite store for G9. No passwords are persisted here.

mod schema;

use g9_core::{ParseReport, ParsedChannel, SourceKind};
use rusqlite::types::Value;
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

/// One Fun Mode source the user added (`fun_sources`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunSourceRow {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub manifest: Option<String>,
    pub added_at: String,
    pub checked_at: Option<String>,
    /// JSON object of extra request headers (`{"Accept-Language":"hi"}`).
    pub headers: Option<String>,
    /// How long the source took to answer last time, in milliseconds.
    pub last_ms: Option<i64>,
    /// Why it failed last time, trimmed to a sentence.
    pub last_error: Option<String>,
}

/// One title the user has started. Doubles as the recents row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunProgressRow {
    pub source_id: i64,
    pub item_id: String,
    pub kind: String,
    pub title: String,
    pub poster: Option<String>,
    pub episode_id: Option<String>,
    pub episode_title: Option<String>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub position: f64,
    pub duration: f64,
    pub page: Option<i32>,
    pub updated_at: String,
}

/// A row in the Fun Mode library: My List, Following, Watched or Hidden.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunLibRow {
    /// `list` | `follow` | `watched` | `hidden`.
    pub kind: String,
    pub item_id: String,
    pub source_id: i64,
    pub title: String,
    pub item_kind: Option<String>,
    pub poster: Option<String>,
    /// Free-form JSON (progress at watch time, badge, season…) — keeps new
    /// viewer flags out of the schema.
    pub meta: Option<String>,
    pub added_at: String,
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

    /// WHERE clause shared by the list and the count, so paging agrees with filters.
    fn channel_filter(q: &ChannelQuery<'_>, sql: &mut String, args: &mut Vec<Value>) {
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
        let mut args: Vec<Value> = Vec::new();
        Self::channel_filter(q, &mut sql, &mut args);
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

    /// How many channels the same filters would return; TV mode pages with it.
    pub fn count_channels(&self, q: &ChannelQuery<'_>) -> Result<i64> {
        let mut sql = String::from("SELECT COUNT(*) FROM channels WHERE is_hidden = 0");
        let mut args: Vec<Value> = Vec::new();
        Self::channel_filter(q, &mut sql, &mut args);
        let n = self
            .conn
            .query_row(&sql, rusqlite::params_from_iter(args), |r| r.get(0))?;
        Ok(n)
    }

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

    // ---------- Fun Mode ----------

    pub fn fun_sources(&self) -> Result<Vec<FunSourceRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, name, url, enabled, manifest, added_at, checked_at,
                    headers, last_ms, last_error
             FROM fun_sources ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(FunSourceRow {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    url: r.get(3)?,
                    enabled: r.get::<_, i64>(4)? != 0,
                    manifest: r.get(5)?,
                    added_at: r.get(6)?,
                    checked_at: r.get(7)?,
                    headers: r.get(8)?,
                    last_ms: r.get(9)?,
                    last_error: r.get(10)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn fun_source_add(
        &self,
        kind: &str,
        name: &str,
        url: &str,
        manifest: Option<&str>,
    ) -> Result<i64> {
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM fun_sources WHERE url = ?1",
                params![url],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            self.conn.execute(
                "UPDATE fun_sources SET kind = ?1, name = ?2, manifest = ?3, enabled = 1,
                 checked_at = datetime('now') WHERE id = ?4",
                params![kind, name, manifest, id],
            )?;
            return Ok(id);
        }
        self.conn.execute(
            "INSERT INTO fun_sources (kind, name, url, manifest, added_at, checked_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))",
            params![kind, name, url, manifest],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Replace a source's extra request headers. `None` clears them.
    pub fn fun_source_headers(&self, id: i64, headers: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE fun_sources SET headers = ?1 WHERE id = ?2",
            params![headers, id],
        )?;
        Ok(())
    }

    /// Record how a source answered: timing on success, message on failure.
    pub fn fun_source_health(&self, id: i64, ms: Option<i64>, error: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE fun_sources SET checked_at = datetime('now'), last_ms = ?1, last_error = ?2
             WHERE id = ?3",
            params![ms, error, id],
        )?;
        Ok(())
    }

    pub fn fun_source_set_enabled(&self, id: i64, enabled: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE fun_sources SET enabled = ?1 WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(())
    }

    pub fn fun_source_remove(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM fun_sources WHERE id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM fun_progress WHERE source_id = ?1", params![id])?;
        Ok(())
    }

    /// Upsert one progress row. A finished title (`position/duration > .95`) is
    /// kept so it still shows in recents, just without a resume point.
    #[allow(clippy::too_many_arguments)]
    /// One library flag (My List, Following, Watched, Hidden) for a title.
    pub fn fun_lib_set(&self, row: &FunLibRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO fun_lib (kind, item_id, source_id, title, item_kind, poster, meta, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
             ON CONFLICT(kind, item_id) DO UPDATE SET
               source_id = excluded.source_id,
               title = excluded.title,
               item_kind = excluded.item_kind,
               poster = excluded.poster,
               meta = excluded.meta",
            params![
                row.kind,
                row.item_id,
                row.source_id,
                row.title,
                row.item_kind,
                row.poster,
                row.meta
            ],
        )?;
        Ok(())
    }

    pub fn fun_lib_remove(&self, kind: &str, item_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM fun_lib WHERE kind = ?1 AND item_id = ?2",
            params![kind, item_id],
        )?;
        Ok(())
    }

    /// Every row of one flag, newest first.
    pub fn fun_lib_list(&self, kind: &str) -> Result<Vec<FunLibRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT kind, item_id, source_id, title, item_kind, poster, meta, added_at
             FROM fun_lib WHERE kind = ?1 ORDER BY added_at DESC, item_id LIMIT 2000",
        )?;
        let rows = stmt
            .query_map(params![kind], |r| {
                Ok(FunLibRow {
                    kind: r.get(0)?,
                    item_id: r.get(1)?,
                    source_id: r.get(2)?,
                    title: r.get(3)?,
                    item_kind: r.get(4)?,
                    poster: r.get(5)?,
                    meta: r.get(6)?,
                    added_at: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Every flag on one title, so the sheet can render its buttons in one call.
    pub fn fun_lib_flags(&self, item_id: &str) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT kind FROM fun_lib WHERE item_id = ?1")?;
        let rows = stmt
            .query_map(params![item_id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn fun_progress_save(&self, row: &FunProgressRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO fun_progress (source_id, item_id, kind, title, poster, episode_id,
                episode_title, season, episode, position, duration, page, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
                     CASE WHEN ?13 = '' THEN datetime('now') ELSE ?13 END)
             ON CONFLICT(source_id, item_id) DO UPDATE SET
                kind = excluded.kind, title = excluded.title, poster = excluded.poster,
                episode_id = excluded.episode_id, episode_title = excluded.episode_title,
                season = excluded.season, episode = excluded.episode,
                position = excluded.position, duration = excluded.duration,
                page = COALESCE(excluded.page, fun_progress.page),
                updated_at = CASE WHEN excluded.updated_at = '' THEN datetime('now')
                                  ELSE excluded.updated_at END",
            params![
                row.source_id,
                row.item_id,
                row.kind,
                row.title,
                row.poster,
                row.episode_id,
                row.episode_title,
                row.season,
                row.episode,
                row.position,
                row.duration,
                row.page,
                row.updated_at.clone(),
            ],
        )?;
        Ok(())
    }

    pub fn fun_progress_list(&self, limit: i64) -> Result<Vec<FunProgressRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_id, item_id, kind, title, poster, episode_id, episode_title,
                    season, episode, position, duration, page, updated_at
             FROM fun_progress ORDER BY updated_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(FunProgressRow {
                    source_id: r.get(0)?,
                    item_id: r.get(1)?,
                    kind: r.get(2)?,
                    title: r.get(3)?,
                    poster: r.get(4)?,
                    episode_id: r.get(5)?,
                    episode_title: r.get(6)?,
                    season: r.get(7)?,
                    episode: r.get(8)?,
                    position: r.get(9)?,
                    duration: r.get(10)?,
                    page: r.get(11)?,
                    updated_at: r.get(12)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn fun_progress_for(
        &self,
        source_id: i64,
        item_id: &str,
    ) -> Result<Option<FunProgressRow>> {
        let row = self
            .conn
            .query_row(
                "SELECT source_id, item_id, kind, title, poster, episode_id, episode_title,
                        season, episode, position, duration, page, updated_at
                 FROM fun_progress WHERE source_id = ?1 AND item_id = ?2",
                params![source_id, item_id],
                |r| {
                    Ok(FunProgressRow {
                        source_id: r.get(0)?,
                        item_id: r.get(1)?,
                        kind: r.get(2)?,
                        title: r.get(3)?,
                        poster: r.get(4)?,
                        episode_id: r.get(5)?,
                        episode_title: r.get(6)?,
                        season: r.get(7)?,
                        episode: r.get(8)?,
                        position: r.get(9)?,
                        duration: r.get(10)?,
                        page: r.get(11)?,
                        updated_at: r.get(12)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn fun_progress_remove(&self, source_id: i64, item_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM fun_progress WHERE source_id = ?1 AND item_id = ?2",
            params![source_id, item_id],
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

    #[test]
    fn fun_sources_and_progress_round_trip() {
        let dir = tempdir().unwrap();
        let store = Store::open(dir.path().join("g9.db")).unwrap();

        let a = store
            .fun_source_add(
                "stremio",
                "Demo Addon",
                "https://addon.example/manifest.json",
                Some("{}"),
            )
            .unwrap();
        let b = store
            .fun_source_add("rss", "Anime feed", "https://nyaa.si/?page=rss&q=x", None)
            .unwrap();
        assert_ne!(a, b);
        // Re-adding the same URL updates instead of duplicating.
        let again = store
            .fun_source_add(
                "stremio",
                "Demo Addon 2",
                "https://addon.example/manifest.json",
                None,
            )
            .unwrap();
        assert_eq!(again, a);
        let list = store.fun_sources().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Demo Addon 2");
        assert!(list[0].enabled);

        store.fun_source_set_enabled(b, false).unwrap();
        let list = store.fun_sources().unwrap();
        assert!(!list.iter().find(|s| s.id == b).unwrap().enabled);

        let mut row = FunProgressRow {
            source_id: a,
            item_id: "tt1".into(),
            kind: "movie".into(),
            title: "A Film".into(),
            poster: None,
            episode_id: None,
            episode_title: None,
            season: None,
            episode: None,
            position: 120.0,
            duration: 600.0,
            page: None,
            updated_at: String::new(),
        };
        store.fun_progress_save(&row).unwrap();
        row.position = 300.0;
        store.fun_progress_save(&row).unwrap();
        let got = store.fun_progress_for(a, "tt1").unwrap().unwrap();
        assert!((got.position - 300.0).abs() < 0.01);
        assert!(!got.updated_at.is_empty());
        assert_eq!(store.fun_progress_list(10).unwrap().len(), 1);

        store.fun_source_remove(a).unwrap();
        assert!(store.fun_progress_for(a, "tt1").unwrap().is_none());
        assert_eq!(store.fun_sources().unwrap().len(), 1);
    }

    #[test]
    fn fun_lib_flags_round_trip() {
        let dir = tempdir().unwrap();
        let store = Store::open(dir.path().join("g9.db")).unwrap();

        let row = FunLibRow {
            kind: "list".into(),
            item_id: "1:tt7".into(),
            source_id: 1,
            title: "A Film".into(),
            item_kind: Some("movie".into()),
            poster: Some("https://img/p.jpg".into()),
            meta: Some("{\"year\":2024}".into()),
            added_at: String::new(),
        };
        store.fun_lib_set(&row).unwrap();
        // Setting the same flag twice updates instead of duplicating.
        store.fun_lib_set(&row).unwrap();
        let list = store.fun_lib_list("list").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "A Film");
        assert_eq!(list[0].meta.as_deref(), Some("{\"year\":2024}"));
        assert!(!list[0].added_at.is_empty());

        // A second flag on the same title is a separate row.
        let mut follow = row.clone();
        follow.kind = "follow".into();
        store.fun_lib_set(&follow).unwrap();
        assert_eq!(store.fun_lib_list("follow").unwrap().len(), 1);
        let mut flags = store.fun_lib_flags("1:tt7").unwrap();
        flags.sort();
        assert_eq!(flags, vec!["follow".to_string(), "list".to_string()]);

        // Watched and hidden are independent of each other.
        let mut watched = row.clone();
        watched.kind = "watched".into();
        store.fun_lib_set(&watched).unwrap();
        let mut hidden = row.clone();
        hidden.kind = "hidden".into();
        store.fun_lib_set(&hidden).unwrap();
        assert_eq!(store.fun_lib_list("hidden").unwrap().len(), 1);

        store.fun_lib_remove("list", "1:tt7").unwrap();
        assert!(store.fun_lib_list("list").unwrap().is_empty());
        assert_eq!(store.fun_lib_list("follow").unwrap().len(), 1);
        assert_eq!(store.fun_lib_flags("1:tt7").unwrap().len(), 3);
    }
}
