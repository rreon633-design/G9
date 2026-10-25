//! The hub: as little server as a chat can get away with.
//!
//! It knows three things — **which rooms exist**, **who is connected to them**, and
//! **how many seats each invite still has**. It does not know what a message says, because
//! every frame's `body` is ciphertext sealed with a room key that never reaches the hub.
//!
//! ```text
//! GET  /health                     liveness and counters
//! GET  /v1/nonce                   a one-shot nonce to sign the connect handshake
//! POST /v1/rooms                   {name, seats} → {room, token}      (this makes you owner)
//! POST /v1/rooms/{room}/invites    {token, seats?, exp?} → {invite}   (owner only)
//! GET  /v1/rooms/{room}?token=…    room preview for the join screen
//! GET  /v1/ws?room&token&device&public&name&ts&nonce&sig              the socket
//! ```
//!
//! One binary, no database, no accounts. Restart it and rooms are gone — which is the
//! correct default for something that is supposed to hold ciphertext for minutes, not
//! years. (A durable mailbox is a later release, and it will still only hold ciphertext.)

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

/// Everything the hub keeps, in memory, behind one lock. Rooms are small; contention is
/// one mutex for a few dozen people, which is nothing next to a WebSocket write.
pub struct Hub {
    rooms: Mutex<HashMap<String, Room>>,
    nonces: Mutex<HashMap<String, Instant>>,
}

#[derive(Default)]
pub struct Room {
    pub name: String,
    pub seats: u8,
    pub owner_token: String,
    /// invite token → when it stops working
    pub invites: HashMap<String, i64>,
    pub peers: HashMap<String, Peer>,
}

pub struct Peer {
    pub name: String,
    pub tx: tokio::sync::mpsc::UnboundedSender<String>,
}

const NONCE_TTL: Duration = Duration::from_secs(120);
const CLOCK_SKEW: i64 = 120;
const MAX_BODY: usize = 64 * 1024;
const MAX_SEATS: u8 = 32;
const DEFAULT_SEATS: u8 = 9;

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            rooms: Mutex::new(HashMap::new()),
            nonces: Mutex::new(HashMap::new()),
        })
    }

    pub fn counters(&self) -> (usize, usize) {
        let rooms = self.rooms.lock().expect("rooms lock");
        (
            rooms.len(),
            rooms.values().map(|r| r.peers.len()).sum::<usize>(),
        )
    }

    fn issue_nonce(&self) -> String {
        let nonce = g9_social::id::random_b64(18);
        let mut nonces = self.nonces.lock().expect("nonce lock");
        nonces.retain(|_, at| at.elapsed() < NONCE_TTL);
        nonces.insert(nonce.clone(), Instant::now());
        nonce
    }

    fn take_nonce(&self, nonce: &str) -> bool {
        let mut nonces = self.nonces.lock().expect("nonce lock");
        nonces.retain(|_, at| at.elapsed() < NONCE_TTL);
        nonces.remove(nonce).is_some()
    }

    /// The whole authentication model, in one function: a signature over the room, the
    /// device id, the time and a nonce the hub issued. No passwords, no accounts.
    fn authorise(&self, q: &Connect) -> Result<(), (StatusCode, String)> {
        let device = g9_social::identity::device_id_for(&q.public)
            .map_err(|_| (StatusCode::BAD_REQUEST, "bad public key".into()))?;
        if device != q.device {
            return Err((StatusCode::FORBIDDEN, "device id does not match key".into()));
        }
        let now = g9_social::now();
        if (now - q.ts).abs() > CLOCK_SKEW {
            return Err((StatusCode::FORBIDDEN, "clock too far off".into()));
        }
        let canonical = g9_social::hello_canonical(&q.room, &q.device, q.ts, &q.nonce);
        if !g9_social::verify_b64(&q.public, canonical.as_bytes(), &q.sig) {
            return Err((StatusCode::UNAUTHORIZED, "signature rejected".into()));
        }
        if !self.take_nonce(&q.nonce) {
            return Err((StatusCode::UNAUTHORIZED, "nonce expired".into()));
        }

        let rooms = self.rooms.lock().expect("rooms lock");
        let room = rooms
            .get(&q.room)
            .ok_or((StatusCode::NOT_FOUND, "no such room".into()))?;
        let token_ok = room.owner_token == q.token
            || room
                .invites
                .get(&q.token)
                .map(|exp| *exp > now)
                .unwrap_or(false);
        if !token_ok {
            return Err((StatusCode::FORBIDDEN, "invite is not valid".into()));
        }
        // A device that is already in the room may reconnect even when it is full: that is
        // the network coming back, not an extra person joining.
        if !room.peers.contains_key(&q.device) && room.peers.len() >= room.seats as usize {
            return Err((StatusCode::CONFLICT, "this room is full".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct Connect {
    pub room: String,
    pub token: String,
    pub device: String,
    pub public: String,
    #[serde(default)]
    pub name: String,
    pub ts: i64,
    pub nonce: String,
    pub sig: String,
}

#[derive(Deserialize)]
struct NewRoom {
    #[serde(default)]
    name: String,
    #[serde(default)]
    seats: u8,
}

#[derive(Deserialize)]
struct NewInvite {
    token: String,
    #[serde(default)]
    seats: u8,
    #[serde(default)]
    ttl: i64,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: String,
}

/// The frame a client sends. Unknown fields are ignored, unknown `kind`s are forwarded, so
/// an old hub never breaks a new client.
#[derive(Debug, Deserialize)]
struct ClientFrame {
    t: String,
    #[serde(default)]
    to: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    id: String,
}

/// The webview (`http://tauri.localhost`) and the hub are different origins, and so is the
/// preview during development, so the REST endpoints have to allow cross-origin calls.
/// Nothing here is authenticated by a cookie, so a wildcard origin gives an attacker
/// nothing they could not get by calling the hub directly.
async fn cors(request: axum::extract::Request, next: Next) -> Response {
    let mut response = if request.method() == axum::http::Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("content-type"),
    );
    headers.insert("access-control-max-age", HeaderValue::from_static("600"));
    response
}

pub fn router(hub: Arc<Hub>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/nonce", get(nonce))
        .route("/v1/rooms", post(create_room))
        .route("/v1/rooms/{room}", get(room_info))
        .route("/v1/rooms/{room}/invites", post(create_invite))
        .route("/v1/ws", get(ws))
        .layer(axum::middleware::from_fn(cors))
        .with_state(hub)
}

/// Bind and serve until the process ends.
pub async fn serve(hub: Arc<Hub>, addr: SocketAddr) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("g9-hub listening on http://{addr}");
    axum::serve(listener, router(hub)).await
}

async fn health(State(hub): State<Arc<Hub>>) -> Json<serde_json::Value> {
    let (rooms, peers) = hub.counters();
    Json(serde_json::json!({ "ok": true, "rooms": rooms, "peers": peers, "v": 1 }))
}

async fn nonce(State(hub): State<Arc<Hub>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "nonce": hub.issue_nonce() }))
}

async fn create_room(
    State(hub): State<Arc<Hub>>,
    Json(body): Json<NewRoom>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let seats = if body.seats == 0 {
        DEFAULT_SEATS
    } else {
        body.seats.min(MAX_SEATS)
    };
    let room_id = g9_social::new_room_id();
    let token = g9_social::id::random_b64(18);
    let name = if body.name.trim().is_empty() {
        "New room".to_string()
    } else {
        body.name.trim().to_string()
    };
    let room = Room {
        name: name.clone(),
        seats,
        owner_token: token.clone(),
        invites: HashMap::new(),
        peers: HashMap::new(),
    };
    hub.rooms
        .lock()
        .expect("rooms lock")
        .insert(room_id.clone(), room);
    Ok(Json(serde_json::json!({
        "room": room_id, "token": token, "name": name, "seats": seats
    })))
}

async fn create_invite(
    State(hub): State<Arc<Hub>>,
    Path(room): Path<String>,
    Json(body): Json<NewInvite>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let ttl = if body.ttl <= 0 { 24 * 3600 } else { body.ttl };
    let exp = g9_social::now() + ttl;
    let invite = g9_social::id::random_b64(18);
    let mut rooms = hub.rooms.lock().expect("rooms lock");
    let entry = rooms
        .get_mut(&room)
        .ok_or((StatusCode::NOT_FOUND, "no such room".into()))?;
    if entry.owner_token != body.token {
        return Err((StatusCode::FORBIDDEN, "owner token required".into()));
    }
    entry.invites.insert(invite.clone(), exp);
    Ok(Json(serde_json::json!({
        "invite": invite, "exp": exp,
        "seats": if body.seats == 0 { entry.seats } else { body.seats.min(MAX_SEATS) }
    })))
}

async fn room_info(
    State(hub): State<Arc<Hub>>,
    Path(room): Path<String>,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rooms = hub.rooms.lock().expect("rooms lock");
    let entry = rooms
        .get(&room)
        .ok_or((StatusCode::NOT_FOUND, "no such room".into()))?;
    let now = g9_social::now();
    let allowed = entry.owner_token == q.token
        || entry
            .invites
            .get(&q.token)
            .map(|exp| *exp > now)
            .unwrap_or(false);
    if !allowed {
        return Err((StatusCode::FORBIDDEN, "invite is not valid".into()));
    }
    Ok(Json(serde_json::json!({
        "room": room,
        "name": entry.name,
        "seats": entry.seats,
        "people": entry.peers.values().map(|p| p.name.clone()).collect::<Vec<_>>(),
    })))
}

async fn ws(
    State(hub): State<Arc<Hub>>,
    Query(q): Query<Connect>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if let Err((code, why)) = hub.authorise(&q) {
        return (code, why).into_response();
    }
    let device = q.device.clone();
    let name = if q.name.trim().is_empty() {
        "Guest".to_string()
    } else {
        q.name.trim().to_string()
    };
    let room = q.room.clone();
    upgrade
        .max_message_size(MAX_BODY + 4096)
        .on_upgrade(move |socket| session(hub, room, device, name, socket))
}

/// One connection: register, greet, forward, clean up.
async fn session(hub: Arc<Hub>, room: String, device: String, name: String, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let ready = {
        let mut rooms = hub.rooms.lock().expect("rooms lock");
        let Some(entry) = rooms.get_mut(&room) else {
            return;
        };
        let peers: Vec<serde_json::Value> = entry
            .peers
            .iter()
            .map(|(d, p)| serde_json::json!({ "device": d, "name": p.name }))
            .collect();
        entry.peers.insert(
            device.clone(),
            Peer {
                name: name.clone(),
                tx: tx.clone(),
            },
        );
        serde_json::json!({
            "t": "ready", "room": room, "device": device, "name": name, "peers": peers
        })
        .to_string()
    };
    if sink.send(Message::Text(ready.into())).await.is_err() {
        return;
    }
    broadcast(
        &hub,
        &room,
        &device,
        serde_json::json!({ "t": "peer", "event": "join", "device": device, "name": name }),
    );

    loop {
        tokio::select! {
            outgoing = rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if text.len() > MAX_BODY + 4096 { continue; }
                        let Ok(frame) = serde_json::from_str::<ClientFrame>(&text) else { continue };
                        if frame.t == "msg" {
                            forward(&hub, &room, &device, &name, frame);
                        } else if frame.t == "ping" {
                            let _ = tx.send(serde_json::json!({ "t": "pong" }).to_string());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }

    if let Some(entry) = hub.rooms.lock().expect("rooms lock").get_mut(&room) {
        entry.peers.remove(&device);
    }
    broadcast(
        &hub,
        &room,
        &device,
        serde_json::json!({ "t": "peer", "event": "leave", "device": device }),
    );
}

/// Deliver one frame. The hub never looks at `body` — it is ciphertext, and that is the
/// contract the UI relies on.
fn forward(hub: &Arc<Hub>, room: &str, sender: &str, name: &str, frame: ClientFrame) {
    let out = serde_json::json!({
        "t": "msg",
        "from": sender,
        "name": name,
        "kind": frame.kind,
        "body": frame.body,
        "id": frame.id,
        "ts": g9_social::now(),
    })
    .to_string();

    let rooms = hub.rooms.lock().expect("rooms lock");
    let Some(entry) = rooms.get(room) else {
        return;
    };
    if frame.to.is_empty() || frame.to == "*" {
        for (device, peer) in &entry.peers {
            if device != sender {
                let _ = peer.tx.send(out.clone());
            }
        }
    } else if frame.to != sender {
        if let Some(peer) = entry.peers.get(&frame.to) {
            let _ = peer.tx.send(out);
        }
    }
}

fn broadcast(hub: &Arc<Hub>, room: &str, except: &str, value: serde_json::Value) {
    let text = value.to_string();
    let rooms = hub.rooms.lock().expect("rooms lock");
    if let Some(entry) = rooms.get(room) {
        for (device, peer) in &entry.peers {
            if device != except {
                let _ = peer.tx.send(text.clone());
            }
        }
    }
}
