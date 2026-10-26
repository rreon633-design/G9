//! Social commands: identity, signed invites, the QR code, and local history.
//!
//! The network lives in the webview (`ui/social.js`) because it is one WebSocket and
//! because WebRTC has to be there anyway. This module owns the things that must not: the
//! private key, the signature that proves who you are to a hub, the invite link (which the
//! key is baked into), and the SQLite history.
//!
//! **Key storage, v1.** The Ed25519 secret is written to `social/identity.key` with
//! owner-only permissions. Wrapping it with DPAPI is a one-function change and is tracked
//! for the call release; until then the file never leaves the app data directory and is
//! never copied anywhere by G9.

use std::path::PathBuf;
use std::sync::Mutex;

use g9_social::{Invite, InviteKind, Message, RoomKey, Store};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Everything social, held once per process.
pub struct SocialState {
    store: Mutex<Store>,
    identity: g9_social::Identity,
    dir: PathBuf,
}

impl SocialState {
    pub fn init(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?.join("social");
        std::fs::create_dir_all(&dir)?;

        let key_path = dir.join("identity.key");
        let identity = match std::fs::read(&key_path) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut secret = [0u8; 32];
                secret.copy_from_slice(&bytes);
                g9_social::Identity::from_secret_bytes(&secret)
            }
            _ => {
                let fresh = g9_social::Identity::generate();
                write_secret(&key_path, &fresh.secret_bytes())?;
                fresh
            }
        };

        let store = Store::open(&dir.join("social.db"))?;
        store.upsert_device(&identity.id(), "This PC", g9_social::now())?;
        Ok(Self {
            store: Mutex::new(store),
            identity,
            dir,
        })
    }

    fn store(&self) -> std::sync::MutexGuard<'_, Store> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// 0600 on Unix; on Windows the file lives inside the per-user app data directory, which
/// is already ACL'd to that user.
fn write_secret(path: &std::path::Path, secret: &[u8; 32]) -> std::io::Result<()> {
    std::fs::write(path, secret)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct IdentityInfo {
    pub id: String,
    pub public: String,
    pub name: String,
    pub device: String,
}

#[derive(Serialize)]
pub struct Handshake {
    pub device: String,
    pub public: String,
    pub sig: String,
}

#[derive(Serialize)]
pub struct MadeInvite {
    pub link: String,
    pub qr_svg: String,
    pub fingerprint: String,
    pub exp: i64,
    pub key_b64: String,
    pub key: String,
}

#[derive(Serialize)]
pub struct ParsedInvite {
    pub ok: bool,
    pub error: String,
    pub hub: String,
    pub room: String,
    pub token: String,
    pub seats: u8,
    pub kind: String,
    pub issuer: String,
    pub fingerprint: String,
    pub exp: i64,
    pub key_b64: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct ThreadJson {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub hub: String,
    pub seats: u8,
    pub created_at: i64,
    pub last_at: i64,
    pub unread: i64,
}

#[derive(Serialize)]
pub struct MessageJson {
    pub id: String,
    pub thread: String,
    pub sender: String,
    pub sender_name: String,
    pub kind: String,
    pub body: String,
    pub ts: i64,
    pub mine: bool,
    pub state: String,
}

#[derive(Deserialize)]
pub struct MessageIn {
    pub id: String,
    pub thread: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub sender_name: String,
    #[serde(default = "chat_kind")]
    pub kind: String,
    pub body: String,
    pub ts: i64,
    #[serde(default)]
    pub mine: bool,
    #[serde(default = "sent")]
    pub state: String,
}

fn chat_kind() -> String {
    "chat".to_string()
}

fn sent() -> String {
    "sent".to_string()
}

#[derive(Deserialize)]
pub struct ThreadIn {
    pub id: String,
    pub name: String,
    #[serde(default = "room_kind")]
    pub kind: String,
    #[serde(default)]
    pub hub: String,
    #[serde(default = "nine")]
    pub seats: u8,
}

fn room_kind() -> String {
    "room".to_string()
}

fn nine() -> u8 {
    9
}

#[derive(Serialize)]
pub struct ContactJson {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub verified: bool,
}

#[derive(Serialize)]
pub struct DeviceJson {
    pub id: String,
    pub name: String,
    pub verified: bool,
    pub revoked: bool,
}

/// `g9:…`, the public key and the display name. Called once when the workspace opens.
/// What the UI needs to talk to a hub that is running on this machine.
#[derive(serde::Serialize)]
pub struct HubJson {
    /// Loopback address, what this app itself uses.
    pub url: String,
    /// Address other devices on the same network can use. Falls back to `url`.
    pub share_url: String,
    pub port: u16,
    /// false when a hub was already listening — nothing was started twice.
    pub started: bool,
}

/// Best-effort LAN address: the source address the OS would use to reach the internet.
/// No traffic is sent (a connected UDP socket only picks a route).
fn lan_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip)
    }
}

fn hub_json(port: u16, started: bool) -> HubJson {
    let url = format!("http://127.0.0.1:{port}");
    let share_url = lan_ip()
        .map(|ip| format!("http://{ip}:{port}"))
        .unwrap_or_else(|| url.clone());
    HubJson {
        url,
        share_url,
        port,
        started,
    }
}

async fn hub_answers(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/health");
    match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(700))
        .build()
    {
        Ok(client) => client
            .get(url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Make sure there is a hub to talk to, starting one in this process if there is not.
///
/// This is the difference between "Create a room: Failed to fetch" and a room: a fresh
/// install has no server, so G9 becomes one. It binds every interface when it can so a
/// second device on the same network can reach it, and falls back to a free port when the
/// usual one is taken.
#[tauri::command]
pub async fn social_hub_start(port: Option<u16>) -> Result<HubJson, String> {
    let preferred = port.unwrap_or(8787);
    if hub_answers(preferred).await {
        return Ok(hub_json(preferred, false));
    }
    let addr = g9_hub::spawn_local(preferred)
        .await
        .map_err(|e| format!("could not start a hub on port {preferred}: {e}"))?;
    // Wait for the listener to be answering before handing the address to the UI.
    for _ in 0..40 {
        if hub_answers(addr.port()).await {
            return Ok(hub_json(addr.port(), true));
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    Ok(hub_json(addr.port(), true))
}

#[tauri::command]
pub fn social_identity(state: State<'_, SocialState>) -> IdentityInfo {
    let name = state
        .store()
        .meta("name")
        .unwrap_or_else(|| "Guest".to_string());
    IdentityInfo {
        id: state.identity.id(),
        public: state.identity.public_b64(),
        name,
        device: state.identity.id(),
    }
}

/// Rename yourself. Local only — nothing is published anywhere.
#[tauri::command]
pub fn social_set_name(
    state: State<'_, SocialState>,
    name: String,
) -> Result<IdentityInfo, String> {
    let clean = name.trim().chars().take(40).collect::<String>();
    let clean = if clean.is_empty() {
        "Guest".to_string()
    } else {
        clean
    };
    state
        .store()
        .set_meta("name", &clean)
        .map_err(|e| e.to_string())?;
    Ok(social_identity(state))
}

/// Sign a hub handshake. The private key never crosses the IPC boundary; only the
/// signature does.
#[tauri::command]
pub fn social_handshake(
    state: State<'_, SocialState>,
    room: String,
    nonce: String,
    ts: i64,
) -> Handshake {
    let canonical = g9_social::hello_canonical(&room, &state.identity.id(), ts, &nonce);
    Handshake {
        device: state.identity.id(),
        public: state.identity.public_b64(),
        sig: state.identity.sign_b64(canonical.as_bytes()),
    }
}

/// Build the signed link (and its QR) for a room the hub already knows about.
///
/// This is the one function that makes "just send them the link" work: the room key is
/// generated here, put in the link's **fragment**, and handed back to the caller so it can
/// also be stored locally.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn social_invite(
    state: State<'_, SocialState>,
    hub: String,
    room: String,
    token: String,
    seats: u8,
    kind: String,
    name: String,
    ttl: i64,
) -> Result<MadeInvite, String> {
    let kind = InviteKind::parse(&kind).map_err(|e| e.to_string())?;
    let key = existing_key(&state, &room).unwrap_or_else(RoomKey::generate);
    let exp = g9_social::now() + if ttl > 0 { ttl } else { 86_400 };
    let invite = Invite::create(&state.identity, kind, &hub, &room, &token, seats, exp, key);

    if kind == InviteKind::Room {
        state
            .store()
            .upsert_thread(
                &room,
                if name.trim().is_empty() {
                    "Room"
                } else {
                    name.trim()
                },
                "room",
                &hub,
                seats,
                &invite.key,
                g9_social::now(),
            )
            .map_err(|e| e.to_string())?;
    }

    let link = invite.link();
    Ok(MadeInvite {
        qr_svg: qr_svg(&link),
        fingerprint: invite.key.fingerprint(),
        key_b64: invite.key.to_b64(),
        key: invite.to_json(),
        exp,
        link,
    })
}

/// A thread that already exists keeps its key: re-inviting someone must not lock out the
/// people who are already in the room.
fn existing_key(state: &State<'_, SocialState>, room: &str) -> Option<RoomKey> {
    state.store().thread_key(room)
}

/// Check a link without trusting it: signature, issuer, expiry — all local.
#[tauri::command]
pub fn social_parse_invite(state: State<'_, SocialState>, link: String) -> ParsedInvite {
    let refused = |error: &str| ParsedInvite {
        ok: false,
        error: error.to_string(),
        hub: String::new(),
        room: String::new(),
        token: String::new(),
        seats: 0,
        kind: String::new(),
        issuer: String::new(),
        fingerprint: String::new(),
        exp: 0,
        key_b64: String::new(),
        name: String::new(),
    };
    let invite = match Invite::parse(&link) {
        Ok(invite) => invite,
        Err(e) => return refused(&e.to_string()),
    };
    if let Err(e) = invite.verify() {
        return refused(&e.to_string());
    }

    let now = g9_social::now();
    if invite.kind == InviteKind::Room {
        let _ = state.store().upsert_thread(
            &invite.room,
            &format!("Room {}", invite.room),
            "room",
            &invite.hub,
            invite.seats,
            &invite.key,
            now,
        );
    }
    let _ = state
        .store()
        .upsert_contact(&invite.issuer, &invite.issuer, &invite.public_key, now);

    ParsedInvite {
        ok: true,
        error: String::new(),
        name: state
            .store()
            .thread(&invite.room)
            .map(|t| t.name)
            .unwrap_or_else(|| format!("Room {}", invite.room)),
        key_b64: invite.key.to_b64(),
        fingerprint: invite.key.fingerprint(),
        hub: invite.hub,
        room: invite.room,
        token: invite.token,
        seats: invite.seats,
        kind: invite.kind.as_str().to_string(),
        issuer: invite.issuer,
        exp: invite.exp,
    }
}

/// An SVG QR code for any string. Drawn in Rust so the UI needs no QR library.
#[tauri::command]
pub fn social_qr(text: String) -> String {
    qr_svg(&text)
}

fn qr_svg(text: &str) -> String {
    use qrcode::render::svg;
    use qrcode::{EcLevel, QrCode};
    match QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(240, 240)
            .quiet_zone(true)
            .dark_color(svg::Color("#0b0d13"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

#[tauri::command]
pub fn social_threads(state: State<'_, SocialState>) -> Result<Vec<ThreadJson>, String> {
    let store = state.store();
    let threads = store.threads().map_err(|e| e.to_string())?;
    Ok(threads
        .into_iter()
        .map(|t| ThreadJson {
            id: t.id,
            name: t.name,
            kind: t.kind,
            hub: t.hub,
            seats: t.seats,
            created_at: t.created_at,
            last_at: t.last_at,
            unread: t.unread,
        })
        .collect())
}

/// Create or refresh a thread. The key is only written the first time — see
/// `Store::upsert_thread`.
#[tauri::command]
pub fn social_upsert_thread(
    state: State<'_, SocialState>,
    thread: ThreadIn,
    key_b64: String,
) -> Result<bool, String> {
    let key = RoomKey::from_b64(&key_b64).map_err(|e| e.to_string())?;
    state
        .store()
        .upsert_thread(
            &thread.id,
            &thread.name,
            &thread.kind,
            &thread.hub,
            thread.seats,
            &key,
            g9_social::now(),
        )
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn social_messages(
    state: State<'_, SocialState>,
    thread: String,
    limit: Option<i64>,
    before: Option<i64>,
) -> Result<Vec<MessageJson>, String> {
    let store = state.store();
    let rows = store
        .messages(&thread, limit.unwrap_or(200), before)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|m| MessageJson {
            id: m.id,
            thread: m.thread,
            sender: m.sender,
            sender_name: m.sender_name,
            kind: m.kind,
            body: m.body,
            ts: m.ts,
            mine: m.mine,
            state: m.state,
        })
        .collect())
}

/// Store one message. Returns false when that id was already there, which is how the
/// receive path drops a duplicate the hub delivered twice.
#[tauri::command]
pub fn social_save_message(
    state: State<'_, SocialState>,
    message: MessageIn,
) -> Result<bool, String> {
    let row = Message {
        id: message.id,
        thread: message.thread,
        sender: message.sender,
        sender_name: message.sender_name,
        kind: message.kind,
        body: message.body,
        ts: message.ts,
        mine: message.mine,
        state: message.state,
    };
    state.store().add_message(&row).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn social_set_state(
    state: State<'_, SocialState>,
    id: String,
    new_state: String,
) -> Result<bool, String> {
    state
        .store()
        .set_message_state(&id, &new_state)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn social_mark_read(state: State<'_, SocialState>, thread: String) -> Result<bool, String> {
    state
        .store()
        .mark_read(&thread, g9_social::now())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn social_contacts(state: State<'_, SocialState>) -> Result<Vec<ContactJson>, String> {
    let store = state.store();
    let contacts = store.contacts().map_err(|e| e.to_string())?;
    Ok(contacts
        .into_iter()
        .map(|c| ContactJson {
            id: c.id,
            name: c.name,
            public_key: c.public_key,
            verified: c.verified,
        })
        .collect())
}

#[tauri::command]
pub fn social_devices(state: State<'_, SocialState>) -> Result<Vec<DeviceJson>, String> {
    let store = state.store();
    let devices = store.devices().map_err(|e| e.to_string())?;
    Ok(devices
        .into_iter()
        .map(|d| DeviceJson {
            id: d.id,
            name: d.name,
            verified: d.verified,
            revoked: d.revoked,
        })
        .collect())
}

/// Where the identity and history live, for the About page and for support.
#[tauri::command]
pub fn social_data_dir(state: State<'_, SocialState>) -> String {
    state.dir.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_codes_are_svg_and_survive_long_links() {
        let short = qr_svg("g9://join?x=1#k=abc");
        assert!(
            short.starts_with("<svg"),
            "not an svg: {}",
            &short[..40.min(short.len())]
        );
        let long = qr_svg(&format!(
            "g9://join?v=1&{}#k={}",
            "a".repeat(400),
            "b".repeat(43)
        ));
        assert!(long.starts_with("<svg"));
    }
}
