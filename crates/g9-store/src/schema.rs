use rusqlite::Connection;

use super::Result;

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            etag TEXT,
            status TEXT NOT NULL DEFAULT 'ok',
            last_refresh TEXT
        );

        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
            number INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL,
            group_name TEXT,
            logo_url TEXT,
            stream_url TEXT NOT NULL,
            tvg_id TEXT,
            tvg_name TEXT,
            is_favourite INTEGER NOT NULL DEFAULT 0,
            is_hidden INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_channels_source ON channels(source_id);
        CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_name);
        CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name);
        CREATE INDEX IF NOT EXISTS idx_channels_tvg ON channels(tvg_id);

        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            kind TEXT NOT NULL,
            position REAL NOT NULL DEFAULT 0,
            duration REAL NOT NULL DEFAULT 0,
            played_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)",
        [],
    )?;

    // v2: country / language / quality, so TV mode can filter and sort.
    let have: Vec<String> = conn
        .prepare("PRAGMA table_info(channels)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .flatten()
        .collect();
    for (name, ddl) in [
        ("country", "ALTER TABLE channels ADD COLUMN country TEXT"),
        ("language", "ALTER TABLE channels ADD COLUMN language TEXT"),
        ("quality", "ALTER TABLE channels ADD COLUMN quality TEXT"),
    ] {
        if !have.iter().any(|c| c == name) {
            conn.execute(ddl, [])?;
        }
    }
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)",
        [],
    )?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_channels_country ON channels(country);
         CREATE INDEX IF NOT EXISTS idx_channels_language ON channels(language);
         CREATE INDEX IF NOT EXISTS idx_channels_quality ON channels(quality);",
    )?;

    // v3: Fun Mode. Sources the user added, plus one row per title they have
    // started — that is both "Continue watching" and the recents list.
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS fun_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            manifest TEXT,
            added_at TEXT NOT NULL,
            checked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS fun_progress (
            source_id INTEGER NOT NULL,
            item_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            poster TEXT,
            episode_id TEXT,
            episode_title TEXT,
            season INTEGER,
            episode INTEGER,
            position REAL NOT NULL DEFAULT 0,
            duration REAL NOT NULL DEFAULT 0,
            page INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (source_id, item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_fun_progress_updated ON fun_progress(updated_at DESC);
        "#,
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)",
        [],
    )?;
    Ok(())
}
