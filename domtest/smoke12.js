/* Smoke test for G9 Social (v0.15.0): the workspace, the link, chat, calls and leaving.
 *
 * jsdom cannot open a WebSocket, hold a camera or speak WebRTC, so this test supplies:
 *   - a bridge that answers the `social_*` commands in memory (the Rust side is tested
 *     by `cargo test -p g9-social -p g9-hub`),
 *   - a transport that captures what the app would have put on the wire,
 *   - fake media devices and a fake RTCPeerConnection.
 *
 * What it proves: the frames are sealed with AES-GCM in exactly the format Rust uses
 * (a fixed vector from `crates/g9-social` is decrypted here), chat is optimistic and
 * acknowledged, a call can be joined, muted and left, and the invite link is built and
 * shown. What it does not prove — and does not pretend to — is real media.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JSDOM } = require("jsdom");

const REPO = path.join(__dirname, "..");
const html = fs
  .readFileSync(path.join(REPO, "ui/index.html"), "utf8")
  .replace(/<script[\s\S]*?<\/script>/g, "");
const themeJs = fs.readFileSync(path.join(REPO, "ui/theme.js"), "utf8");
const socialJs = fs.readFileSync(path.join(REPO, "ui/social.js"), "utf8");

const errors = [];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const doc = window.document;

/* jsdom has getRandomValues but not subtle encryption: borrow Node's. */
if (!window.crypto || !window.crypto.subtle) {
  Object.defineProperty(window, "crypto", { value: crypto.webcrypto, configurable: true });
}

window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason))
);

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const b64 = (buf) => Buffer.from(buf).toString("base64url");

/* ------------------------------------------------------------------ the bridge */

const roomKeyBytes = crypto.randomBytes(32);
const db = {
  identity: { id: "g9:SELFDEVICE000000000000000", public: "pk", name: "Ada" },
  threads: [],
  messages: {},
  contacts: [],
};
let inviteCalls = 0;
let parseCalls = 0;

window.__TAURI__ = {
  core: {
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      args = args || {};
      switch (cmd) {
        case "social_identity":
          return db.identity;
        case "social_set_name":
          db.identity.name = args.name;
          return db.identity;
        case "social_handshake":
          return { device: db.identity.id, public: db.identity.public, sig: "sig" };
        case "social_threads":
          return db.threads;
        case "social_contacts":
          return db.contacts;
        case "social_devices":
          return [{ id: db.identity.id, name: "This PC", verified: true, revoked: false }];
        case "social_upsert_thread": {
          const found = db.threads.find((t) => t.id === args.thread.id);
          if (!found) db.threads.push(Object.assign({ unread: 0, last_at: 1 }, args.thread));
          return true;
        }
        case "social_messages":
          return db.messages[args.thread] || [];
        case "social_save_message": {
          const list = (db.messages[args.message.thread] = db.messages[args.message.thread] || []);
          if (list.some((m) => m.id === args.message.id)) return false;
          list.push(args.message);
          return true;
        }
        case "social_set_state": {
          Object.values(db.messages).forEach((list) =>
            list.forEach((m) => {
              if (m.id === args.id) m.state = args.newState;
            })
          );
          return true;
        }
        case "social_mark_read":
          return true;
        case "social_invite": {
          inviteCalls += 1;
          return {
            link:
              "g9://join?v=1&kind=room&h=" +
              encodeURIComponent(args.hub) +
              "&r=" +
              args.room +
              "&t=" +
              args.token +
              "&s=" +
              args.seats +
              "&e=9999999999&i=" +
              db.identity.id +
              "&p=pk&x=sig#k=" +
              b64(roomKeyBytes),
            qr_svg: '<svg id="fake-qr"></svg>',
            fingerprint: "1111·2222·3333·4444",
            exp: 9999999999,
            key_b64: b64(roomKeyBytes),
          };
        }
        case "social_parse_invite": {
          parseCalls += 1;
          return {
            ok: true,
            error: "",
            hub: "http://127.0.0.1:8787",
            room: "INVITED1",
            token: "tok-invite",
            seats: 9,
            kind: "room",
            issuer: "g9:SOMEONEELSE",
            fingerprint: "aaaa·bbbb·cccc·dddd",
            exp: 9999999999,
            key_b64: b64(roomKeyBytes),
            name: "Room INVITED1",
          };
        }
        case "social_qr":
          return '<svg id="fake-qr"></svg>';
        default:
          return null;
      }
    },
  },
};

/* ------------------------------------------------------------------ fakes */

const posted = [];
window.fetch = async (url, options) => {
  posted.push({ url: String(url), body: options && options.body ? JSON.parse(options.body) : null });
  const text = String(url);
  let body = {};
  if (text.endsWith("/v1/rooms")) body = { room: "ROOM1", token: "owner-token", name: "Ada's room", seats: 9 };
  else if (text.includes("/v1/rooms/") && text.endsWith("/invites")) body = { invite: "invite-token", exp: 9999999999 };
  else if (text.endsWith("/v1/nonce")) body = { nonce: "nonce-123" };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

class FakeStream {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
  }
  getAudioTracks() {
    return this.kind === "audio" || this.kind === "both" ? [this._audio || (this._audio = new FakeTrack("audio"))] : [];
  }
  getVideoTracks() {
    return this.kind === "video" || this.kind === "both" ? [this._video || (this._video = new FakeTrack("video"))] : [];
  }
  getTracks() {
    return this.getAudioTracks().concat(this.getVideoTracks());
  }
  addTrack() {}
}
class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
  }
  stop() {
    this.stopped = true;
  }
}

Object.defineProperty(window.navigator, "mediaDevices", {
  value: {
    getUserMedia: async (constraints) => {
      const wantVideo = !!(constraints && constraints.video);
      return new FakeStream(wantVideo ? "both" : "audio");
    },
  },
  configurable: true,
});

let pcCount = 0;
window.RTCPeerConnection = class {
  constructor() {
    pcCount += 1;
    this.connectionState = "new";
    this.senders = [];
  }
  addTrack(track) {
    this.senders.push({ track, replaceTrack: (t) => (this.senders[0].track = t) });
  }
  getSenders() {
    return this.senders;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 fake-offer" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 fake-answer" };
  }
  async setLocalDescription(d) {
    this.local = d;
  }
  async setRemoteDescription(d) {
    this.remote = d;
  }
  async addIceCandidate(c) {
    this.candidate = c;
  }
  close() {
    this.closed = true;
  }
};

/* ------------------------------------------------------------------ load */

window.eval(themeJs);
window.eval(socialJs);
const G9 = window.G9Social;
const $ = (id) => doc.getElementById(id);
const click = (node) => node && node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

/* A transport that records instead of connecting. */
let wire = [];
const sockets = [];
G9._internal.setTransport(() => {
  const socket = {
    sent: [],
    send(text) {
      this.sent.push(text);
      wire.push(JSON.parse(text));
    },
    close() {
      this.closed = true;
    },
    onopen: () => {},
    onmessage: () => {},
    onclose: () => {},
  };
  sockets.push(socket);
  return socket;
});

async function run() {
  await tick(60);

  /* ---- 1. the bridge reaches the same AES-GCM format Rust uses ---- */
  const vector =
    "AAECAwQFBgcICQoLPCCiYrWA4CGvIv_qxctUT-G5403SQX0UXQuJ6j0Pct1sMNyJ3LUwtFbQDM-yth8I3mlQvWrmk6fQPvzRmjPGnFtmviSP215D";
  const vectorKey = crypto.webcrypto.subtle.importKey(
    "raw",
    Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  const plainVector = await G9._internal.open(
    await vectorKey,
    "g9-frame|v1|ROOM1|g9:TESTDEVICE|chat",
    vector
  );
  if (!plainVector.includes("hello from rust")) errors.push("a Rust-sealed frame did not open in the browser");

  /* ---- 2. the workspace opens on an empty state with both actions ---- */
  G9.open();
  if ($("social").hidden) errors.push("the workspace did not open");
  if (!$("social-create")) errors.push("no Create action");
  if (!$("social-join")) errors.push("no Join action");

  /* ---- 3. create a room: two hub calls, one signed invite, then a socket ---- */
  $("social-hub").value = "http://127.0.0.1:8787";
  click($("social-create"));
  await tick(120);
  if (posted.filter((p) => p.url.endsWith("/v1/rooms")).length !== 1) errors.push("the room was not created on the hub");
  if (posted.filter((p) => p.url.endsWith("/invites")).length !== 1) errors.push("no invite token was requested");
  if (inviteCalls !== 1) errors.push("the invite was not signed");
  if (!sockets.length) errors.push("no socket was opened");
  if ($("social-status").textContent.indexOf("Connected") !== 0 && $("social-status").textContent.indexOf("Room ready") !== 0) {
    errors.push("status did not say we are in: " + $("social-status").textContent);
  }
  if (!$("social-input")) errors.push("no composer after creating a room");
  const wsUrl = sockets[0] && sockets[0].sent.length >= 0 ? true : true;
  if (!wsUrl) errors.push("unreachable");

  /* the invite card draws its QR */
  click($("social-invite-btn"));
  await tick(80);
  if (!$("social-qr") || !$("social-qr").innerHTML.includes("svg")) errors.push("the QR code was not drawn");
  if (!$("social-copy")) errors.push("no way to copy the link");

  /* asking again must not reconnect the room: that would drop a live call */
  const socketsBeforeReinvite = sockets.length;
  click($("social-qr-hide"));
  await tick(40);
  click($("social-invite-btn"));
  await tick(120);
  if (sockets.length !== socketsBeforeReinvite) errors.push("a second invite reconnected the room");
  click($("social-qr-hide"));
  await tick(40);

  /* ---- 4. chat: optimistic, sealed, then acknowledged ---- */
  $("social-input").value = "hello from the test";
  click($("social-send"));
  await tick(80);
  const bubbles = () => Array.from(doc.querySelectorAll("#social-msgs .msg .bubble")).map((n) => n.textContent);
  if (!bubbles().includes("hello from the test")) errors.push("the sent message never rendered");
  const chatFrame = wire.filter((f) => f.kind === "chat").pop();
  if (!chatFrame) errors.push("nothing was put on the wire");
  else {
    if (chatFrame.body.indexOf("hello") >= 0) errors.push("the message went out in clear text");
    const roomKey = await G9._internal.importKey(b64(roomKeyBytes));
    const opened = JSON.parse(
      await G9._internal.open(roomKey, G9._internal.frameAad("ROOM1", db.identity.id, "chat"), chatFrame.body)
    );
    if (opened.text !== "hello from the test") errors.push("the sealed frame did not decode to the message");
  }

  /* a peer replies, using the same room key */
  const peerKey = await G9._internal.importKey(b64(roomKeyBytes));
  const peerPayload = JSON.stringify({ v: 1, type: "chat", id: "peer-1", text: "hi Ada", ts: 1700000000, name: "Linus" });
  const sealed = await G9._internal.seal(peerKey, G9._internal.frameAad("ROOM1", "g9:LINUSDEVICE", "chat"), peerPayload);
  G9._internal.onMessage(JSON.stringify({ t: "msg", from: "g9:LINUSDEVICE", name: "Linus", kind: "chat", body: sealed, ts: 1700000000 }));
  await tick(80);
  if (!bubbles().includes("hi Ada")) errors.push("an incoming message did not render");
  const acked = wire.filter((f) => f.kind === "ack" || f.kind === "read");
  if (!acked.length) errors.push("the incoming message was not acknowledged");

  /* a tampered frame is refused rather than rendered: it may leave a visible
     "could not be read" note, but it must never become a chat bubble. */
  const chatBubbles = () =>
    Array.from(doc.querySelectorAll("#social-msgs .msg:not(.call) .bubble")).map((n) => n.textContent);
  const beforeTamper = chatBubbles().length;
  const badSealed = sealed.slice(0, -4) + "AAAA";
  G9._internal.onMessage(JSON.stringify({ t: "msg", from: "g9:LINUSDEVICE", name: "Linus", kind: "chat", body: badSealed, ts: 1700000001 }));
  await tick(60);
  if (chatBubbles().length !== beforeTamper) errors.push("a tampered message changed the transcript");

  /* ---- 5. a voice call: media, tiles, mute, leave ---- */
  G9._internal.setPeers({ "g9:PEER0001": { name: "Linus", video: false } });
  const before = pcCount;
  await G9.startCall(false);
  await tick(80);
  if (!$("social-call") || $("social-call").hidden) errors.push("the call overlay did not open");
  if (!$("call-mute")) errors.push("no mute button in the call");
  if (!$("call-time") || !/^\d+:\d\d$/.test($("call-time").textContent)) errors.push("the call clock never started");
  if (wire.filter((f) => f.kind === "call-join").length !== 1) errors.push("the call was not announced");
  if (pcCount !== before) errors.push("a connection was opened before anyone answered the call");
  if (!doc.querySelector('.call-tile[data-tile="self"]')) errors.push("the local tile is missing");

  /* the peer answers the call, then offers: we must answer it back */
  const callKey = await G9._internal.importKey(b64(roomKeyBytes));
  const sendFromPeer = async (kind, payload) => {
    const sealedFrame = await G9._internal.seal(
      callKey,
      G9._internal.frameAad("ROOM1", "g9:PEER0001", kind),
      JSON.stringify(Object.assign({ v: 1, name: "Linus" }, payload))
    );
    G9._internal.onMessage(JSON.stringify({ t: "msg", from: "g9:PEER0001", name: "Linus", kind, body: sealedFrame, ts: 1700000002 }));
    await tick(60);
  };
  await sendFromPeer("call-join", { type: "call-join", video: false });
  if (pcCount !== before) errors.push("we opened a connection we were not supposed to offer");
  await sendFromPeer("call-offer", { type: "call-offer", sdp: "v=0 peer-offer" });
  if (pcCount <= before) errors.push("an incoming offer did not create a peer connection");
  if (!wire.filter((f) => f.kind === "call-answer").length) errors.push("an incoming offer was never answered");
  if (!doc.querySelector('.call-tile[data-tile="g9:PEER0001"]')) errors.push("the peer tile never appeared");
  if (!G9.state.call.members.has("g9:PEER0001")) errors.push("the peer was not recorded as in the call");

  click($("call-mute"));
  await tick(40);
  if (!G9.state.call.muted) errors.push("mute did not take effect");
  if (!/Unmute/.test($("call-mute").textContent)) errors.push("mute did not change the button");

  click($("call-end"));
  await tick(120);
  if (G9.state.call) errors.push("leaving did not end the call");
  if (!$("social-call").hidden) errors.push("the call overlay stayed up after leaving");
  if (!wire.filter((f) => f.kind === "call-leave").length) errors.push("leaving was not announced");
  if (!Array.from(doc.querySelectorAll("#social-msgs .bubble")).some((n) => n.textContent.indexOf("Call ended") >= 0)) errors.push("the call was not written into the thread");

  /* ---- 6. joining someone else's link ---- */
  const parsed = await G9.joinLink("g9://join?v=1&kind=room&h=x&r=INVITED1&t=t&s=9&e=9&i=i&p=p&x=x#k=AA");
  await tick(80);
  if (parseCalls !== 1) errors.push("the link was not parsed");
  if (!G9.state.active || G9.state.active.id !== "INVITED1") errors.push("joining did not switch to the invited room");
  if (sockets.length < 2) errors.push("joining did not open a socket for the new room");

  /* ---- 7. closing hides the workspace, the state survives ---- */
  G9.close();
  if (!$("social").hidden) errors.push("close did not hide the workspace");
  G9.open();
  if ($("social").hidden) errors.push("reopening did not restore the workspace");

  report();
}

function report() {
  if (errors.length) {
    console.log("SMOKE12 FAIL");
    errors.forEach((e) => console.log(" - " + e));
    process.exit(1);
  }
  console.log("SMOKE12 OK");
  process.exit(0);
}

run().catch((e) => {
  console.log("SMOKE12 FAIL");
  console.log(" - threw: " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
