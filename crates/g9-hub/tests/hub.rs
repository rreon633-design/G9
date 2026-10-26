//! End-to-end tests against a real hub on a real socket, with real signatures.
//!
//! These are the tests that say "chat works": two devices, one room, a message each way,
//! a seat cap, a rejected forgery, and a leave event. Nothing is mocked except the clock.

use futures_util::{SinkExt, StreamExt};
use g9_hub::Hub;
use g9_social::{hello_canonical, Identity};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

async fn spawn() -> String {
    let hub = Hub::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, g9_hub::router(hub)).await;
    });
    format!("http://{addr}")
}

async fn post(base: &str, path: &str, body: Value) -> (u16, Value) {
    let response = reqwest::Client::new()
        .post(format!("{base}{path}"))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    (status, value)
}

async fn get(base: &str, path: &str) -> (u16, Value) {
    let response = reqwest::Client::new()
        .get(format!("{base}{path}"))
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    (status, value)
}

struct Socket {
    stream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    device: String,
}

impl Socket {
    async fn send(&mut self, frame: Value) {
        self.stream
            .send(Message::Text(frame.to_string().into()))
            .await
            .unwrap();
    }

    /// The next data frame, skipping keepalives.
    async fn next(&mut self) -> Value {
        loop {
            let message =
                tokio::time::timeout(std::time::Duration::from_secs(5), self.stream.next())
                    .await
                    .expect("hub went quiet")
                    .expect("socket closed")
                    .expect("socket error");
            if let Message::Text(text) = message {
                return serde_json::from_str(&text).unwrap();
            }
        }
    }

    async fn expect(&mut self, t: &str) -> Value {
        for _ in 0..64 {
            let frame = self.next().await;
            if frame["t"] == t {
                return frame;
            }
        }
        panic!("never saw a {t} frame");
    }
}

/// A room, an invite and one connected device.
async fn room_with_invite(base: &str, seats: u8) -> (String, String, String) {
    let (status, created) = post(
        base,
        "/v1/rooms",
        serde_json::json!({"name": "Test", "seats": seats}),
    )
    .await;
    assert_eq!(status, 200);
    let room = created["room"].as_str().unwrap().to_string();
    let owner = created["token"].as_str().unwrap().to_string();
    let (status, invite) = post(
        base,
        &format!("/v1/rooms/{room}/invites"),
        serde_json::json!({"token": owner}),
    )
    .await;
    assert_eq!(status, 200);
    (room, owner, invite["invite"].as_str().unwrap().to_string())
}

async fn connect(base: &str, room: &str, token: &str, name: &str) -> Socket {
    let identity = Identity::generate();
    let device = identity.id();
    let (_, nonce) = get(base, "/v1/nonce").await;
    let nonce = nonce["nonce"].as_str().unwrap().to_string();
    let ts = g9_social::now();
    let canonical = hello_canonical(room, &device, ts, &nonce);
    let sig = identity.sign_b64(canonical.as_bytes());

    let url = format!(
        "{}/v1/ws?room={room}&token={token}&device={}&public={}&name={name}&ts={ts}&nonce={nonce}&sig={sig}",
        base.replace("http://", "ws://"),
        urlencode(&device),
        urlencode(&identity.public_b64()),
        sig = urlencode(&sig),
        nonce = urlencode(&nonce),
    )
    .replace("name=", "name=");
    let url = url.replace(
        &format!("&name={name}&"),
        &format!("&name={}&", urlencode(name)),
    );
    let (stream, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("ws connects");
    Socket { stream, device }
}

/// Just enough percent-encoding for the query values these tests use.
fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            ' ' => out.push_str("%20"),
            '+' => out.push_str("%2B"),
            '/' => out.push_str("%2F"),
            '=' => out.push_str("%3D"),
            '&' => out.push_str("%26"),
            other => out.push(other),
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread")]
async fn health_and_nonce_are_live() {
    let base = spawn().await;
    let (status, body) = get(&base, "/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);
    let (_, nonce) = get(&base, "/v1/nonce").await;
    assert!(nonce["nonce"].as_str().unwrap().len() >= 16);
}

#[tokio::test(flavor = "multi_thread")]
async fn only_the_owner_can_mint_an_invite() {
    let base = spawn().await;
    let (room, _owner, _invite) = room_with_invite(&base, 9).await;
    let (status, _) = post(
        &base,
        &format!("/v1/rooms/{room}/invites"),
        serde_json::json!({"token": "not-the-owner"}),
    )
    .await;
    assert_eq!(status, 403);
}

#[tokio::test(flavor = "multi_thread")]
async fn two_devices_see_each_other_and_exchange_opaque_frames() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let mut ada = connect(&base, &room, &invite, "Ada").await;
    let ready = ada.expect("ready").await;
    assert_eq!(ready["room"], room);
    assert_eq!(ready["peers"].as_array().unwrap().len(), 0);

    let mut linus = connect(&base, &room, &invite, "Linus").await;
    let ready = linus.expect("ready").await;
    assert_eq!(ready["peers"].as_array().unwrap().len(), 1, "sees Ada");
    assert_eq!(ready["peers"][0]["name"], "Ada");

    // Ada is told Linus arrived.
    let joined = ada.expect("peer").await;
    assert_eq!(joined["event"], "join");
    assert_eq!(joined["name"], "Linus");

    // A ciphertext body makes it across untouched: the hub cannot read it, so it must not
    // be able to change it either.
    let sealed = "ZmFrZS1jaXBoZXJ0ZXh0LW5vdC1yZWFsbHk";
    ada.send(serde_json::json!({
        "t": "msg", "to": "*", "kind": "chat", "body": sealed, "id": "m1"
    }))
    .await;

    let delivered = linus.expect("msg").await;
    assert_eq!(delivered["body"], sealed);
    assert_eq!(delivered["kind"], "chat");
    assert_eq!(delivered["from"], ada.device);
    assert_eq!(delivered["name"], "Ada");
    assert!(delivered["ts"].as_i64().unwrap() > 0);

    // ...and a reply comes back the same way.
    linus
        .send(serde_json::json!({
            "t": "msg", "to": "*", "kind": "chat", "body": "cmVwbHk=", "id": "m2"
        }))
        .await;
    let reply = ada.expect("msg").await;
    assert_eq!(reply["from"], linus.device);
    assert_eq!(reply["body"], "cmVwbHk=");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_direct_frame_reaches_only_its_target() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let mut ada = connect(&base, &room, &invite, "Ada").await;
    ada.expect("ready").await;
    let mut bob = connect(&base, &room, &invite, "Bob").await;
    bob.expect("ready").await;
    let mut cara = connect(&base, &room, &invite, "Cara").await;
    cara.expect("ready").await;
    ada.expect("peer").await; // Bob joined
    ada.expect("peer").await; // Cara joined
    bob.expect("peer").await; // Cara joined

    ada.send(serde_json::json!({
        "t": "msg", "to": bob.device, "kind": "call-offer", "body": "c2Rw", "id": "c1"
    }))
    .await;

    let offer = bob.expect("msg").await;
    assert_eq!(offer["kind"], "call-offer");
    assert_eq!(offer["from"], ada.device);

    // Cara must not have seen it: her next frame is nothing at all.
    let quiet = tokio::time::timeout(std::time::Duration::from_millis(250), cara.next()).await;
    assert!(quiet.is_err(), "a direct frame leaked to a third device");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_room_can_be_full() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 2).await;

    let mut a = connect(&base, &room, &invite, "A").await;
    a.expect("ready").await;
    let mut b = connect(&base, &room, &invite, "B").await;
    b.expect("ready").await;

    // The third connection is refused before it ever upgrades.
    let identity = Identity::generate();
    let (_, nonce) = get(&base, "/v1/nonce").await;
    let nonce = nonce["nonce"].as_str().unwrap().to_string();
    let ts = g9_social::now();
    let canonical = hello_canonical(&room, &identity.id(), ts, &nonce);
    let sig = identity.sign_b64(canonical.as_bytes());
    let url = format!(
        "{}/v1/ws?room={room}&token={invite}&device={}&public={}&name=C&ts={ts}&nonce={nonce}&sig={sig}",
        base.replace("http://", "ws://"),
        urlencode(&identity.id()),
        urlencode(&identity.public_b64()),
        sig = urlencode(&sig),
        nonce = urlencode(&nonce),
    );
    assert!(
        tokio_tungstenite::connect_async(url).await.is_err(),
        "a full room accepted a third device"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_forged_handshake_is_refused() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let identity = Identity::generate();
    let (_, nonce) = get(&base, "/v1/nonce").await;
    let nonce = nonce["nonce"].as_str().unwrap().to_string();
    let ts = g9_social::now();

    // Signed for room X, presented for room Y.
    let wrong = hello_canonical("some-other-room", &identity.id(), ts, &nonce);
    let sig = identity.sign_b64(wrong.as_bytes());
    let url = format!(
        "{}/v1/ws?room={room}&token={invite}&device={}&public={}&name=Mallory&ts={ts}&nonce={nonce}&sig={sig}",
        base.replace("http://", "ws://"),
        urlencode(&identity.id()),
        urlencode(&identity.public_b64()),
        sig = urlencode(&sig),
        nonce = urlencode(&nonce),
    );
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bad_invite_token_is_refused() {
    let base = spawn().await;
    let (room, _owner, _invite) = room_with_invite(&base, 9).await;
    let identity = Identity::generate();
    let (_, nonce) = get(&base, "/v1/nonce").await;
    let nonce = nonce["nonce"].as_str().unwrap().to_string();
    let ts = g9_social::now();
    let canonical = hello_canonical(&room, &identity.id(), ts, &nonce);
    let sig = identity.sign_b64(canonical.as_bytes());
    let url = format!(
        "{}/v1/ws?room={room}&token=expired-or-made-up&device={}&public={}&name=X&ts={ts}&nonce={nonce}&sig={sig}",
        base.replace("http://", "ws://"),
        urlencode(&identity.id()),
        urlencode(&identity.public_b64()),
        sig = urlencode(&sig),
        nonce = urlencode(&nonce),
    );
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn leaving_is_announced_and_counted() {
    let base = spawn().await;
    let (room, owner, invite) = room_with_invite(&base, 9).await;

    let mut a = connect(&base, &room, &invite, "A").await;
    a.expect("ready").await;
    let mut b = connect(&base, &room, &invite, "B").await;
    b.expect("ready").await;
    a.expect("peer").await;

    let (_, info) = get(&base, &format!("/v1/rooms/{room}?token={owner}")).await;
    assert_eq!(info["people"].as_array().unwrap().len(), 2);

    drop(b);
    let left = a.expect("peer").await;
    assert_eq!(left["event"], "leave");

    // The room counter settles back down.
    for _ in 0..20 {
        let (_, health) = get(&base, "/health").await;
        if health["peers"] == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let (_, health) = get(&base, "/health").await;
    assert_eq!(health["peers"], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn nine_devices_fit_in_one_room() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;
    let mut sockets = Vec::new();
    for i in 0..9 {
        let mut socket = connect(&base, &room, &invite, &format!("Device {i}")).await;
        let ready = socket.expect("ready").await;
        assert_eq!(ready["peers"].as_array().unwrap().len(), i);
        sockets.push(socket);
    }
    let (_, health) = get(&base, "/health").await;
    assert_eq!(health["peers"], 9);

    // Everyone hears the ninth device speak.
    let last = &mut sockets[8];
    last.send(serde_json::json!({
        "t": "msg", "to": "*", "kind": "chat", "body": "aGVsbG8gYWxs", "id": "n1"
    }))
    .await;
    for socket in sockets.iter_mut().take(8) {
        let frame = socket.expect("msg").await;
        assert_eq!(frame["body"], "aGVsbG8gYWxs");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_second_device_can_rejoin_a_full_room() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 2).await;
    let mut a = connect(&base, &room, &invite, "A").await;
    a.expect("ready").await;
    let mut b = connect(&base, &room, &invite, "B").await;
    b.expect("ready").await;

    // A drops and reconnects while the room is full: that is a network blip, not a new
    // person, so it must be allowed straight back in.
    drop(a);
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    let mut again = connect(&base, &room, &invite, "A").await;
    again.expect("ready").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_caller_gets_the_roster_in_the_same_answer() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let mut ada = connect(&base, &room, &invite, "Ada").await;
    let _ = ada.expect("ready").await;
    let mut linus = connect(&base, &room, &invite, "Linus").await;
    let _ = linus.expect("ready").await;
    let _ = ada.expect("peer").await; // Linus joined the room

    // Ada is first into the call: the answer says the call is empty, in one round trip.
    ada.send(serde_json::json!({ "t": "call", "state": "join", "video": true }))
        .await;
    let roster = ada.expect("call").await;
    assert_eq!(roster["event"], "roster");
    assert_eq!(roster["peers"].as_array().unwrap().len(), 0);

    // Linus is told, and joining hands him Ada's entry — no peer has to answer anything.
    let told = linus.expect("call").await;
    assert_eq!(told["event"], "join");
    assert_eq!(told["device"], ada.device);
    assert_eq!(told["video"], true);

    linus
        .send(serde_json::json!({ "t": "call", "state": "join", "video": false }))
        .await;
    let roster = linus.expect("call").await;
    assert_eq!(roster["event"], "roster");
    let peers = roster["peers"].as_array().unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0]["device"], ada.device);
    assert_eq!(peers[0]["video"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn leaving_the_call_and_the_socket_are_both_announced() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let mut ada = connect(&base, &room, &invite, "Ada").await;
    let _ = ada.expect("ready").await;
    let mut linus = connect(&base, &room, &invite, "Linus").await;
    let _ = linus.expect("ready").await;
    let _ = ada.expect("peer").await;

    ada.send(serde_json::json!({ "t": "call", "state": "join", "video": false }))
        .await;
    let _ = linus.expect("call").await;

    // Ada presses Leave.
    ada.send(serde_json::json!({ "t": "call", "state": "leave" }))
        .await;
    let gone = linus.expect("call").await;
    assert_eq!(gone["event"], "leave");
    assert_eq!(gone["device"], ada.device);

    // And if Ada's socket dies mid-call instead, the call ends the same way.
    ada.send(serde_json::json!({ "t": "call", "state": "join", "video": false }))
        .await;
    ada.stream.close(None).await.unwrap();
    let left = ada;
    let mut events = 0;
    for _ in 0..8 {
        let frame = linus.next().await;
        if frame["t"] == "call" && frame["event"] == "leave" && frame["device"] == left.device {
            events += 1;
            break;
        }
    }
    assert_eq!(events, 1, "a dropped socket leaves the call");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_ping_comes_back_with_its_own_sequence_number() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;
    let mut ada = connect(&base, &room, &invite, "Ada").await;
    let _ = ada.expect("ready").await;

    ada.send(serde_json::json!({ "t": "ping", "n": 7 })).await;
    let pong = ada.expect("pong").await;
    assert_eq!(pong["n"], 7);
    assert!(pong["now"].as_i64().unwrap() > 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_roster_survives_a_reconnect() {
    let base = spawn().await;
    let (room, _owner, invite) = room_with_invite(&base, 9).await;

    let mut ada = connect(&base, &room, &invite, "Ada").await;
    let _ = ada.expect("ready").await;
    let mut linus = connect(&base, &room, &invite, "Linus").await;
    let ready = linus.expect("ready").await;
    assert_eq!(
        ready["call"].as_array().unwrap().len(),
        0,
        "nobody is in a call"
    );
    let _ = ada.expect("peer").await;

    ada.send(serde_json::json!({ "t": "call", "state": "join", "video": true }))
        .await;
    let _ = ada.expect("call").await;

    // A third device arriving mid-call is told the call is already running.
    let mut grace = connect(&base, &room, &invite, "Grace").await;
    let ready = grace.expect("ready").await;
    let call = ready["call"].as_array().unwrap();
    assert_eq!(call.len(), 1);
    assert_eq!(call[0]["device"], ada.device);
    assert_eq!(call[0]["video"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_hub_can_be_started_in_process_and_is_immediately_usable() {
    let addr = g9_hub::spawn_local(0).await.expect("hub starts");
    let base = format!("http://{addr}");
    for _ in 0..40 {
        if get(&base, "/health").await.0 == 200 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let (status, body) = get(&base, "/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);

    // And it is a real hub: a room can be created on it straight away.
    let (status, created) = post(
        &base,
        "/v1/rooms",
        serde_json::json!({ "name": "In process", "seats": 9 }),
    )
    .await;
    assert_eq!(status, 200);
    assert!(!created["room"].as_str().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_second_hub_takes_another_port_instead_of_failing() {
    let first = g9_hub::spawn_local(0).await.expect("first hub");
    let second = g9_hub::spawn_local(first.port()).await.expect("second hub");
    assert_ne!(first, second, "the busy port was reused");
    let base = format!("http://{second}");
    for _ in 0..40 {
        if get(&base, "/health").await.0 == 200 {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("the fallback hub never answered");
}
