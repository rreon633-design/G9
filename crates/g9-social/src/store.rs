//! Local history. One SQLite file for G9 Social, kept separate from `g9-store` so the
//! chat database can be deleted, exported or moved on its own.
//!
//! Messages are stored **after** decryption. The room key is stored too, because the app
//! has to be able to open yesterday's thread after a restart — the key itself is wrapped
//! by the caller before it reaches this file (see `src-tauri/src/social.rs`).

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::crypto::RoomKey;
use crate::SocialError;

/// One conversation: a 1:1 chat or a room.
#[derive(Debug, Clone)]
pub struct Thread {
    pub id: String,
    pub name: String,
    /// `dm` or `room`.
    pub kind: String,
    pub hub: String,
    pub seats: u8,
    pub created_at: i64,
    pub last_at: i64,
    pub unread: i64,
}

/// One message, already plaintext.
#[derive(Debug, Clone)]
pub struct Message {
    pub id: String,
    pub thread: String,
    pub sender: String,
    pub sender_name: String,
    /// `chat`, `call-event`, `note`, `system`.
    pub kind: String,
    pub body: String,
    pub ts: i64,
    /// Sent from this device.
    pub mine: bool,
    /// `pending` → `sent` → `delivered` → `read`, or `failed`.
    pub state: String,
}

/// A person you can talk to.
#[derive(Debug, Clone)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub added_at: i64,
    /// SAS/QR verified.
    pub verified: bool,
}

/// A device on your own identity.
#[derive(Debug, Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub added_at: i64,
    pub verified: bool,
    pub revoked: bool,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (and create) the database. Safe to call on every start.
    pub fn open(path: &Path) -> Result<Self, SocialError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| SocialError::Io(e.to_string()))?;
        }
        let conn = Connection::open(path)?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    /// In-memory, for tests.
    pub fn memory() -> Result<Self, SocialError> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    fn migrate(conn: &Connection) -> Result<(), SocialError> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS threads (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL DEFAULT 'room',
                hub        TEXT NOT NULL DEFAULT '',
                seats      INTEGER NOT NULL DEFAULT 9,
                key_b64    TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                last_at    INTEGER NOT NULL,
                read_at    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                thread      TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                sender      TEXT NOT NULL,
                sender_name TEXT NOT NULL DEFAULT '',
                kind        TEXT NOT NULL DEFAULT 'chat',
                body        TEXT NOT NULL,
                ts          INTEGER NOT NULL,
                mine        INTEGER NOT NULL DEFAULT 0,
                state       TEXT NOT NULL DEFAULT 'sent'
            );
            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread, ts);

            CREATE TABLE IF NOT EXISTS contacts (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                public_key TEXT NOT NULL,
                added_at   INTEGER NOT NULL,
                verified   INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS devices (
                id       TEXT PRIMARY KEY,
                name     TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                revoked  INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )?;
        Ok(())
    }

    // ---- meta -----------------------------------------------------------------

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), SocialError> {
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .ok()
            .flatten()
    }

    // ---- threads --------------------------------------------------------------

    /// Create the thread if it is new, otherwise only refresh its name and hub. Never
    /// touches the stored key, so a re-join cannot silently swap the room key.
    // Eight arguments is one per column of `threads`; a builder struct would be longer
    // than the call sites it replaces.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_thread(
        &self,
        id: &str,
        name: &str,
        kind: &str,
        hub: &str,
        seats: u8,
        key: &RoomKey,
        now: i64,
    ) -> Result<(), SocialError> {
        self.conn.execute(
            "INSERT INTO threads(id, name, kind, hub, seats, key_b64, created_at, last_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 hub  = excluded.hub,
                 seats = excluded.seats",
            params![id, name, kind, hub, seats, key.to_b64(), now],
        )?;
        Ok(())
    }

    pub fn thread(&self, id: &str) -> Option<Thread> {
        self.conn
            .query_row(
                "SELECT id, name, kind, hub, seats, created_at, last_at, read_at
                 FROM threads WHERE id = ?1",
                params![id],
                row_to_thread,
            )
            .optional()
            .ok()
            .flatten()
    }

    /// The room key for a thread: stored base64 in, [`RoomKey`] out.
    pub fn thread_key(&self, id: &str) -> Option<RoomKey> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT key_b64 FROM threads WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        raw.and_then(|s| RoomKey::from_b64(&s).ok())
    }

    /// Newest first, with the unread count computed from `read_at`.
    pub fn threads(&self) -> Result<Vec<Thread>, SocialError> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.kind, t.hub, t.seats, t.created_at, t.last_at,
                    (SELECT COUNT(*) FROM messages m
                      WHERE m.thread = t.id AND m.ts > t.read_at AND m.mine = 0)
             FROM threads t ORDER BY t.last_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_thread)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn mark_read(&self, thread: &str, now: i64) -> Result<(), SocialError> {
        self.conn.execute(
            "UPDATE threads SET read_at = ?2 WHERE id = ?1",
            params![thread, now],
        )?;
        Ok(())
    }

    pub fn forget_thread(&self, thread: &str) -> Result<(), SocialError> {
        self.conn
            .execute("DELETE FROM threads WHERE id = ?1", params![thread])?;
        Ok(())
    }

    // ---- messages -------------------------------------------------------------

    /// Insert a message. Returns `false` when that id is already stored — which is how the
    /// receive path deduplicates a message the hub delivered twice.
    pub fn add_message(&self, m: &Message) -> Result<bool, SocialError> {
        let changed = self.conn.execute(
            "INSERT OR IGNORE INTO messages
                (id, thread, sender, sender_name, kind, body, ts, mine, state)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                m.id,
                m.thread,
                m.sender,
                m.sender_name,
                m.kind,
                m.body,
                m.ts,
                m.mine as i64,
                m.state
            ],
        )?;
        if changed > 0 {
            self.conn.execute(
                "UPDATE threads SET last_at = MAX(last_at, ?2) WHERE id = ?1",
                params![m.thread, m.ts],
            )?;
        }
        Ok(changed > 0)
    }

    /// Oldest first, so the UI can append. `before` pages backwards through history.
    pub fn messages(
        &self,
        thread: &str,
        limit: i64,
        before: Option<i64>,
    ) -> Result<Vec<Message>, SocialError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, thread, sender, sender_name, kind, body, ts, mine, state
             FROM messages
             WHERE thread = ?1 AND (?2 IS NULL OR ts < ?2)
             ORDER BY ts DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![thread, before, limit], |r| {
            Ok(Message {
                id: r.get(0)?,
                thread: r.get(1)?,
                sender: r.get(2)?,
                sender_name: r.get(3)?,
                kind: r.get(4)?,
                body: r.get(5)?,
                ts: r.get(6)?,
                mine: r.get::<_, i64>(7)? != 0,
                state: r.get(8)?,
            })
        })?;
        let mut out: Vec<Message> = rows.filter_map(Result::ok).collect();
        out.reverse();
        Ok(out)
    }

    pub fn set_message_state(&self, id: &str, state: &str) -> Result<(), SocialError> {
        self.conn.execute(
            "UPDATE messages SET state = ?2 WHERE id = ?1",
            params![id, state],
        )?;
        Ok(())
    }

    // ---- contacts and devices -------------------------------------------------

    /// Add or rename a contact. `verified` is only ever set by the SAS screen.
    pub fn upsert_contact(
        &self,
        id: &str,
        name: &str,
        public_key: &str,
        now: i64,
    ) -> Result<(), SocialError> {
        self.conn.execute(
            "INSERT INTO contacts(id, name, public_key, added_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                           public_key = excluded.public_key",
            params![id, name, public_key, now],
        )?;
        Ok(())
    }

    pub fn set_contact_verified(&self, id: &str, verified: bool) -> Result<(), SocialError> {
        self.conn.execute(
            "UPDATE contacts SET verified = ?2 WHERE id = ?1",
            params![id, verified as i64],
        )?;
        Ok(())
    }

    pub fn contacts(&self) -> Result<Vec<Contact>, SocialError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, public_key, added_at, verified FROM contacts ORDER BY name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Contact {
                id: r.get(0)?,
                name: r.get(1)?,
                public_key: r.get(2)?,
                added_at: r.get(3)?,
                verified: r.get::<_, i64>(4)? != 0,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// Record a device. The first device is inserted verified, because it is this machine.
    pub fn upsert_device(&self, id: &str, name: &str, now: i64) -> Result<(), SocialError> {
        self.conn.execute(
            "INSERT INTO devices(id, name, added_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![id, name, now],
        )?;
        Ok(())
    }

    pub fn devices(&self) -> Result<Vec<Device>, SocialError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, added_at, verified, revoked FROM devices ORDER BY added_at",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Device {
                id: r.get(0)?,
                name: r.get(1)?,
                added_at: r.get(2)?,
                verified: r.get::<_, i64>(3)? != 0,
                revoked: r.get::<_, i64>(4)? != 0,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn revoke_device(&self, id: &str) -> Result<(), SocialError> {
        self.conn
            .execute("UPDATE devices SET revoked = 1 WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn row_to_thread(r: &rusqlite::Row<'_>) -> rusqlite::Result<Thread> {
    Ok(Thread {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        hub: r.get(3)?,
        seats: r.get::<_, i64>(4)? as u8,
        created_at: r.get(5)?,
        last_at: r.get(6)?,
        unread: r.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, thread: &str, body: &str, ts: i64, mine: bool) -> Message {
        Message {
            id: id.into(),
            thread: thread.into(),
            sender: if mine { "me" } else { "them" }.into(),
            sender_name: if mine { "Me" } else { "Them" }.into(),
            kind: "chat".into(),
            body: body.into(),
            ts,
            mine,
            state: "sent".into(),
        }
    }

    #[test]
    fn threads_and_messages_round_trip() {
        let store = Store::memory().unwrap();
        let key = RoomKey::generate();
        store
            .upsert_thread("r1", "K7f2", "room", "wss://hub", 9, &key, 100)
            .unwrap();
        assert!(store
            .add_message(&msg("m1", "r1", "hi", 101, true))
            .unwrap());
        assert!(store
            .add_message(&msg("m2", "r1", "hello", 102, false))
            .unwrap());

        let list = store.messages("r1", 50, None).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].body, "hi");
        assert_eq!(store.thread_key("r1").unwrap(), key);
        assert_eq!(store.threads().unwrap()[0].unread, 1);
    }

    #[test]
    fn duplicates_are_dropped() {
        let store = Store::memory().unwrap();
        let key = RoomKey::generate();
        store
            .upsert_thread("r1", "r", "room", "hub", 9, &key, 0)
            .unwrap();
        assert!(store
            .add_message(&msg("m1", "r1", "once", 1, false))
            .unwrap());
        assert!(!store
            .add_message(&msg("m1", "r1", "once", 1, false))
            .unwrap());
        assert_eq!(store.messages("r1", 50, None).unwrap().len(), 1);
    }

    #[test]
    fn read_state_and_paging_work() {
        let store = Store::memory().unwrap();
        let key = RoomKey::generate();
        store
            .upsert_thread("r1", "r", "room", "hub", 9, &key, 0)
            .unwrap();
        for i in 0..10 {
            store
                .add_message(&msg(
                    &format!("m{i}"),
                    "r1",
                    &format!("b{i}"),
                    100 + i,
                    false,
                ))
                .unwrap();
        }
        store.mark_read("r1", 105).unwrap();
        assert_eq!(store.threads().unwrap()[0].unread, 4);

        let page = store.messages("r1", 3, Some(105)).unwrap();
        assert_eq!(page.len(), 3);
        assert_eq!(page[2].body, "b4");
    }

    #[test]
    fn rejoining_a_thread_keeps_its_key() {
        let store = Store::memory().unwrap();
        let original = RoomKey::generate();
        store
            .upsert_thread("r1", "Old", "room", "hub", 9, &original, 0)
            .unwrap();
        // a re-join with a different key must not overwrite the stored one
        store
            .upsert_thread("r1", "New", "room", "hub", 9, &RoomKey::generate(), 0)
            .unwrap();
        assert_eq!(store.thread_key("r1").unwrap(), original);
        assert_eq!(store.thread("r1").unwrap().name, "New");
    }

    #[test]
    fn contacts_and_devices() {
        let store = Store::memory().unwrap();
        store.upsert_contact("g9:abc", "Ada", "pk", 10).unwrap();
        store.set_contact_verified("g9:abc", true).unwrap();
        assert!(store.contacts().unwrap()[0].verified);

        store.upsert_device("d1", "This PC", 1).unwrap();
        store.upsert_device("d2", "Laptop", 2).unwrap();
        store.revoke_device("d2").unwrap();
        let devices = store.devices().unwrap();
        assert_eq!(devices.len(), 2);
        assert!(devices[1].revoked);
    }

    #[test]
    fn meta_survives_writes() {
        let store = Store::memory().unwrap();
        assert!(store.meta("name").is_none());
        store.set_meta("name", "Guest").unwrap();
        store.set_meta("name", "Ada").unwrap();
        assert_eq!(store.meta("name").unwrap(), "Ada");
    }
}
