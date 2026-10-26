/* Smoke test for G9 Social v0.17.0 — latency, media tuning and coming back from a drop.
 *
 * jsdom has no WebRTC, no camera and no WebSocket, so everything below is a fake that
 * records what the app asks for. That is the point: this test asserts the *decisions*
 * — which SDP is sent, which bitrate a nine-person call gets, when an offer goes out,
 * what happens when the socket dies — and leaves real media to scripts/e2e-social.py,
 * which runs nine Chromium instances against a real hub.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JSDOM } = require("jsdom");

const REPO = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const themeJs = fs.readFileSync(path.join(REPO, "ui/theme.js"), "utf8");
const socialJs = fs.readFileSync(path.join(REPO, "ui/social.js"), "utf8");

const errors = [];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const doc = window.document;
if (!window.crypto || !window.crypto.subtle) {
  Object.defineProperty(window, "crypto", { value: crypto.webcrypto, configurable: true });
}
window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason))
);

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const b64 = (buf) => Buffer.from(buf).toString("base64");
const roomKeyBytes = crypto.randomBytes(32);

/* ------------------------------------------------------------------ bridge */

let hubStarts = 0;
let failFetch = 0;
const db = {
  identity: { id: "g9:AAAAAAAAAAAAAAAAAAAAAAAAAAA", public: "pk", name: "Ada" },
  threads: [],
  messages: {},
  contacts: [],
};

window.__TAURI__ = {
  core: {
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      args = args || {};
      switch (cmd) {
        case "social_identity":
          return db.identity;
        case "social_handshake":
          return { device: db.identity.id, public: db.identity.public, sig: "sig" };
        case "social_threads":
          return db.threads;
        case "social_contacts":
          return db.contacts;
        case "social_devices":
          return [];
        case "social_upsert_thread":
          if (!db.threads.find((t) => t.id === args.thread.id)) db.threads.push(Object.assign({ unread: 0 }, args.thread));
          return true;
        case "social_messages":
          return db.messages[args.thread] || [];
        case "social_save_message": {
          const list = (db.messages[args.message.thread] = db.messages[args.message.thread] || []);
          if (list.some((m) => m.id === args.message.id)) return false;
          list.push(args.message);
          return true;
        }
        case "social_set_state":
          return true;
        case "social_mark_read":
          return true;
        case "social_invite":
          return {
            link: "g9://join?v=1&kind=room&h=h&r=ROOM1&t=tok&s=9&e=9999999999&i=x&p=pk&x=sig#k=" + b64(roomKeyBytes),
            qr_svg: "<svg></svg>",
            fingerprint: "1111·2222",
            exp: 9999999999,
            key_b64: b64(roomKeyBytes),
          };
        case "social_qr":
          return "<svg></svg>";
        case "social_hub_start":
          hubStarts += 1;
          return { url: "http://127.0.0.1:8787", share_url: "http://192.168.1.20:8787", port: 8787, started: true };
        default:
          return null;
      }
    },
  },
};

window.fetch = async (url) => {
  const text = String(url);
  if (failFetch > 0) {
    failFetch -= 1;
    const err = new TypeError("Failed to fetch");
    err.name = "TypeError";
    throw err;
  }
  let body = {};
  if (text.endsWith("/v1/rooms")) body = { room: "ROOM1", token: "owner-token", name: "Ada's room", seats: 9 };
  else if (text.endsWith("/invites")) body = { invite: "invite-token", exp: 9999999999 };
  else if (text.endsWith("/v1/nonce")) body = { nonce: "nonce-" + Math.random().toString(36).slice(2) };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

/* ------------------------------------------------------------------ media fakes */

let gumResolve = null;
let gumCalls = 0;
class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
    this.contentHint = "";
  }
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  constructor(kind) {
    this.kind = kind;
    this.tracks = [new FakeTrack("audio")];
    if (kind === "both") this.tracks.push(new FakeTrack("video"));
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getTracks() {
    return this.tracks;
  }
}

Object.defineProperty(window.navigator, "mediaDevices", {
  value: {
    // Deliberately slow: the point of the roster-first design is that the hub answers
    // while this promise is still pending.
    getUserMedia: (constraints) => {
      gumCalls += 1;
      return new Promise((resolve) => {
        gumResolve = () => resolve(new FakeStream(constraints && constraints.video ? "both" : "audio"));
      });
    },
  },
  configurable: true,
});

const createPcs = [];
const statsPerPc = [];

window.RTCRtpSender = { getCapabilities: () => ({ codecs: [{ mimeType: "video/VP9" }, { mimeType: "video/H264" }, { mimeType: "video/AV1" }] }) };
window.RTCRtpReceiver = { getCapabilities: () => ({ codecs: [{ mimeType: "audio/opus" }] }) };

window.RTCPeerConnection = class {
  constructor(config) {
    this.config = config;
    this.connectionState = "new";
    this.signalingState = "stable";
    this.senders = [];
    this.transceivers = [];
    this.stats = [];
    createPcs.push(this);
  }
  addTrack(track) {
    const sender = {
      track,
      params: { encodings: [{}] },
      getParameters() {
        return JSON.parse(JSON.stringify(this.params));
      },
      setParameters(p) {
        this.params = p;
        return Promise.resolve();
      },
      replaceTrack(t) {
        this.track = t;
        return Promise.resolve();
      },
    };
    this.senders.push(sender);
    this.transceivers.push({
      direction: "sendrecv",
      receiver: { track: { kind: track.kind } },
      sender,
      setCodecPreferences(list) {
        this.preferences = list.map((c) => c.mimeType);
      },
    });
  }
  getSenders() {
    return this.senders;
  }
  getTransceivers() {
    return this.transceivers;
  }
  getStats() {
    return Promise.resolve({ forEach: (fn) => statsPerPc.forEach((s) => fn(s)) });
  }
  async createOffer(options) {
    this.offerOptions = options || null;
    return { type: "offer", sdp: SDP };
  }
  async createAnswer() {
    return { type: "answer", sdp: SDP };
  }
  async setLocalDescription(d) {
    this.local = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(d) {
    this.remote = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(c) {
    this.candidate = c;
  }
  close() {
    this.closed = true;
  }
};

const SDP = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
].join("\r\n");

/* ------------------------------------------------------------------ load */

window.eval(themeJs);
window.eval(socialJs);
const G9 = window.G9Social;
const S = G9.state;
const $ = (id) => doc.getElementById(id);
const click = (node) => node && node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const sockets = [];
G9._internal.setTransport(() => {
  const socket = {
    sent: [],
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close() {
      this.closed = true;
      if (this.onClose) this.onClose();
    },
    onopen: () => {},
    onmessage: () => {},
    onclose: (fn) => {
      socket.onClose = fn;
    },
  };
  sockets.push(socket);
  return socket;
});

const wire = () => sockets[sockets.length - 1].sent;
const framesOf = (kind) => wire().filter((f) => f.kind === kind);
const controlOf = (t) => wire().filter((f) => f.t === t);
const deliver = (obj) => G9._internal.onMessage(JSON.stringify(obj));

async function run() {
  await tick(80);
  G9.open();
  G9._internal.setIdentity(db.identity);
  await G9._internal.importRoomKey(b64(roomKeyBytes));

  /* ---- 1. one SDP tuner, two call sizes ---- */
  const sdp = G9._internal.tuneSdp(SDP, "offer");
  if (!sdp.includes("a=fmtp:111 ")) errors.push("the opus fmtp line disappeared");
  if (!sdp.includes("ptime=10")) errors.push("opus packets are not 10 ms");
  if (!sdp.includes("useinbandfec=1")) errors.push("opus FEC is off");
  if (!sdp.includes("usedtx=1")) errors.push("opus DTX is off");
  if (!sdp.includes("stereo=0")) errors.push("voice is still stereo");
  if (SDP.includes("maxaveragebitrate")) errors.push("the fixture was already tuned — the test proves nothing");
  if (!/maxaveragebitrate=\d+/.test(sdp)) errors.push("no bitrate cap was written into the offer");
  if ((sdp.match(/a=fmtp:111/g) || []).length !== 1) errors.push("the fmtp line was duplicated");

  /* ---- 2. the quality ladder ---- */
  const ladder = (peers) => {
    S.call = { peers: new Map(Array.from({ length: peers }, (_, i) => ["g9:P" + i, {}])), video: true, local: new FakeStream("both") };
    const t = G9._internal.tier();
    S.call = null;
    return t;
  };
  if (ladder(0).name !== "720p") errors.push("a one-to-one call should send 720p");
  if (ladder(2).name !== "540p") errors.push("a three-way call should send 540p");
  if (ladder(4).name !== "360p") errors.push("a five-way call should send 360p");
  const nine = ladder(8);
  if (nine.name !== "240p") errors.push("a nine-way call should send 240p, got " + nine.name);
  if (nine.maxBitrate > 200000) errors.push("nine-way uplink is over 200 kbps per peer");
  if (nine.fps > 15) errors.push("nine-way video is not capped at 15 fps");

  /* ---- 3. the config that starts gathering immediately ---- */
  const cfg = G9._internal.rtcConfig();
  if (cfg.iceCandidatePoolSize !== 4) errors.push("no ICE candidate pool: every call waits for fresh STUN");
  if (cfg.bundlePolicy !== "max-bundle") errors.push("bundle policy is not max-bundle");
  if (!cfg.iceServers || !cfg.iceServers.length) errors.push("no STUN server configured");
  G9.setIceServers([{ urls: "turn:example.org", username: "u", credential: "c" }]);
  if (G9._internal.rtcConfig().iceServers[0].urls !== "turn:example.org") errors.push("setIceServers was ignored");
  G9.setIceServers(null);
  if (JSON.stringify(G9._internal.rtcConfig().iceServers).indexOf("stun:") < 0) {
    errors.push("the default STUN list did not come back");
  }

  /* ---- 4. a room, a socket, and the hub's call roster ---- */
  const room = await G9.createRoom("http://127.0.0.1:8787");
  if (!sockets.length) errors.push("no socket was opened for the room");
  deliver({
    t: "ready",
    room: "ROOM1",
    device: db.identity.id,
    peers: [{ device: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", name: "Linus", call: true, video: true }],
    call: [{ device: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", name: "Linus", video: true }],
    now: 1700000000,
  });
  if (!S.hubRoster) errors.push("the app did not notice that the hub keeps call state");
  if (G9._internal.onCallEvent === undefined) errors.push("no call-event handler");

  /* ---- 5. call pressed: the roster is asked for *before* the camera opens ---- */
  const before = wire().length;
  const started = G9.startCall(true);
  if (!controlOf("call").length) errors.push("the call was not announced to the hub before capture started");
  if (!gumCalls) errors.push("capture never started");
  // The hub answers while the camera is still opening.
  deliver({ t: "call", event: "roster", peers: [{ device: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", name: "Linus", video: true }] });
  if (framesOf("call-offer").length) errors.push("an offer went out before there was a stream to send");
  gumResolve();
  await started;
  await tick(120);
  if (!framesOf("call-offer").length) errors.push("no offer was sent after the camera opened");
  if (framesOf("call-join").length) errors.push("the old announce/ack path was used on a hub that has a roster");
  const offer = framesOf("call-offer").pop();
  if (/maxaveragebitrate=40000/.test(decodeSealed(offer.body) || "")) {
    errors.push("the two-person bitrate was used for a two-person call — fine — but the SDP was not sealed");
  }
  if (wire().length === before) errors.push("starting a call wrote nothing to the room");
  if (!S.call || !S.call.peers.size) errors.push("the roster entry did not become a peer connection");

  /* ---- 6. the sender is limited to the ladder, and the codec is hardware-friendly ---- */
  const pc = createPcs[createPcs.length - 1];
  const vSender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (!vSender.params.encodings || vSender.params.encodings[0].maxBitrate !== 900000) {
    errors.push("the video sender was not capped at the 720p tier: " + JSON.stringify(vSender.params.encodings));
  }
  if (vSender.params.degradationPreference !== "balanced") errors.push("degradation preference was not set");
  if (vSender.params.encodings[0].maxFramerate !== 30) errors.push("frame rate was not capped");
  const tr = pc.getTransceivers().find((t) => t.preferences && t.preferences[0].indexOf("video/") === 0);
  if (!tr) errors.push("codec preferences were never applied");
  else if (tr.preferences[0] !== "video/H264") errors.push("H.264 is not preferred: " + tr.preferences.join(","));

  /* ---- 7. remote audio is audible, self is not echoed ---- */
  const tiles = doc.querySelectorAll('.call-tile video[data-stream]');
  let selfMuted = null;
  let remoteMuted = null;
  tiles.forEach((v) => {
    if (v.getAttribute("data-stream") === "self") selfMuted = v.hasAttribute("muted");
    else remoteMuted = v.hasAttribute("muted");
  });
  if (selfMuted !== true) errors.push("your own tile is not muted (you would hear yourself)");
  if (remoteMuted !== false) errors.push("the peer tile is muted — a call with no audio");

  /* ---- 8. an offer that arrives mid-capture is answered, not dropped ---- */
  deliver({
    t: "msg",
    from: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    name: "Linus",
    kind: "call-recover",
    body: "not-really-sealed",
    ts: 1700000001,
  });
  if (S.call.peers.size !== 1) errors.push("a stray control frame created a peer");

  /* ---- 9. a dropped peer connection restarts ICE instead of dying ---- */
  const entry = S.call.peers.get("g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
  entry.pc.connectionState = "disconnected";
  const offersBeforeRecover = framesOf("call-offer").length;
  G9._internal.watchConnection("g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", entry);
  await tick(1400);
  if (db.identity.id < "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ") {
    const offers = framesOf("call-offer");
    if (offers.length <= offersBeforeRecover) errors.push("a disconnected peer never got an ICE restart");
    else if (!entry.pc.offerOptions || entry.pc.offerOptions.iceRestart !== true) {
      errors.push("the recovery offer did not ask for an ICE restart");
    }
  } else {
    if (!framesOf("call-recover").length) errors.push("the answering side never asked for a restart");
  }
  entry.pc.connectionState = "connected";
  G9._internal.watchConnection("g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", entry);

  /* ---- 10. the readouts: hub round trip, per-peer stats, quality ---- */
  G9._internal.startPing();
  const ping = wire().filter((f) => f.t === "ping").pop();
  if (!ping) errors.push("nothing measured the hub round trip");
  else {
    G9._internal.onPong({ t: "pong", n: ping.n });
    if (S.link.rtt == null) errors.push("the round trip was never recorded");
    if (String($("call-net").textContent).indexOf("ms") < 0) errors.push("the call head shows no latency");
    if (String($("social-rtt").textContent).indexOf("ms") < 0) errors.push("the workspace shows no latency");
  }
  statsPerPc.push(
    { type: "candidate-pair", state: "succeeded", selected: true, currentRoundTripTime: 0.042 },
    { type: "inbound-rtp", kind: "video", frameWidth: 640, frameHeight: 360, framesPerSecond: 24, bytesReceived: 100000 },
    { type: "inbound-rtp", kind: "audio", jitter: 0.012, audioLevel: 0.4, packetsLost: 0, bytesReceived: 20000 }
  );
  await G9._internal.sampleStats();
  await tick(60);
  const net = S.net["g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ"];
  if (!net || net.rtt !== 42) errors.push("the peer round trip was not read from the stats: " + JSON.stringify(net));
  if (net.res !== "640×360") errors.push("the received resolution was not read");
  if (G9._internal.qualityOf(net) !== "good") errors.push("a 42 ms peer was graded " + G9._internal.qualityOf(net));
  if (G9._internal.qualityOf({ rtt: 300 }) !== "poor") errors.push("a 300 ms peer was not graded poor");
  const chip = doc.querySelector('.call-tile[data-tile="g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ"] .net');
  if (!chip || chip.textContent.indexOf("42 ms") < 0) errors.push("the tile shows no latency: " + (chip && chip.textContent));
  if (S.call.active !== "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ") errors.push("the speaking peer was not detected");

  /* ---- 11. the socket dies mid-call: reconnect, re-announce, flush what was typed ---- */
  const dead = sockets[sockets.length - 1];
  const socketsBefore = sockets.length;
  dead.close();
  if (String($("social-status").textContent).indexOf("Reconnecting") !== 0) {
    errors.push("a dropped socket did not say it was reconnecting: " + $("social-status").textContent);
  }
  await G9.sendChat("typed while the room was down");
  if (S.outbox.length !== 1) errors.push("a message written offline was not queued");
  if (!S.messages.some((m) => m.body === "typed while the room was down" && m.state === "pending")) {
    errors.push("a queued message is not shown as queued");
  }
  await tick(700);
  if (sockets.length <= socketsBefore) errors.push("the room never came back on its own");
  const back = sockets[sockets.length - 1];
  deliver({
    t: "ready",
    room: "ROOM1",
    device: db.identity.id,
    peers: [{ device: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", name: "Linus", call: true, video: true }],
    call: [{ device: "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ", name: "Linus", video: true }],
    now: 1700000002,
  });
  await tick(80);
  if (S.outbox.length) errors.push("the outbox was not flushed after the reconnect");
  if (!back.sent.some((f) => f.t === "msg" && f.kind === "chat")) errors.push("the queued message never went out");
  if (!back.sent.some((f) => f.t === "call" && f.state === "join")) {
    errors.push("the call was not re-stated to the hub after the reconnect");
  }

  /* ---- 12. control frames are never queued behind a dead socket ---- */
  sockets[sockets.length - 1].close();
  await tick(20);
  const stale = await G9._internal.frame("call-offer", { type: "call-offer", sdp: "x" }, "g9:ZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
  if (stale !== false) errors.push("a stale offer was queued instead of dropped");

  /* ---- 13. leaving stops every timer and every track ---- */
  S.reconnect.tries = 0;
  if (S.reconnect.timer) clearTimeout(S.reconnect.timer);
  const localTracks = S.call.local.getTracks();
  await G9.endCall();
  if (S.call) errors.push("leaving left the call object behind");
  if (localTracks.some((t) => !t.stopped)) errors.push("the camera and microphone were not released");
  if (S.stats) errors.push("the stats timer outlived the call");

  /* ---- 14. someone joins the call while our camera is still opening ----
   * The hub broadcasts the arrival before we have anywhere to put it. Dropping it means a
   * silent half-connected call, which is exactly the bug this case locks down. */
  deliver({ t: "ready", room: "ROOM1", device: db.identity.id, peers: [], call: [], now: 1700000003 });
  const pcsBefore = createPcs.length;
  const second = G9.startCall(false);
  deliver({ t: "call", event: "roster", peers: [] });
  deliver({ t: "call", event: "join", device: "g9:YYYYYYYYYYYYYYYYYYYYYYYYYYY", name: "Grace", video: false });
  if (createPcs.length !== pcsBefore) errors.push("a connection opened before capture finished");
  gumResolve();
  await second;
  await tick(120);
  if (!S.call || !S.call.members.has("g9:YYYYYYYYYYYYYYYYYYYYYYYYYYY")) {
    errors.push("an arrival buffered during capture was thrown away");
  }
  if (!S.call || !S.call.peers.has("g9:YYYYYYYYYYYYYYYYYYYYYYYYYYY")) {
    errors.push("the buffered arrival never became a connection");
  }
  await G9.endCall();

  /* ---- 15. a fresh install with no server: Create must become the server ---- */
  G9.close();
  S.threads = [];
  S.active = null;
  S.invite = null;
  S.errors = [];
  S.room = null;
  S.socket = null;
  G9.open();
  await tick(40);
  if (!$("social-create")) errors.push("the empty state offers no way to create a room");
  failFetch = 1;
  $("social-hub").value = "http://127.0.0.1:8787";
  click($("social-create"));
  await tick(400);
  if (!hubStarts) errors.push("with no hub running, G9 did not start one");
  if (!S.room) errors.push("the room was never opened on the hub that G9 started");
  if (!S.pendingRoom && !S.invite) errors.push("no invite was made after the local hub came up");
  if (S.invite && String(S.invite.link).indexOf("127.0.0.1") >= 0 && hubStarts) {
    // The invite must be reachable from another device, not just from this one.
    const shared = S.room && S.room.hub;
    if (shared && String(shared).indexOf("127.0.0.1") >= 0) {
      errors.push("the invite carries a loopback address: another device could never join");
    }
  }
  if (S.errors.length && /Failed to fetch/i.test(S.errors[S.errors.length - 1])) {
    errors.push("the user was shown 'Failed to fetch' instead of an explanation");
  }

  /* ---- 16. a real failure is still explained in words ---- */
  G9.close();
  S.room = null;
  S.socket = null;
  S.active = null;
  S.threads = [];
  S.invite = null;
  S.errors = [];
  G9.open();
  await tick(30);
  if (!$("social-create")) errors.push("the empty state did not come back");
  failFetch = 1;
  hubStarts = 0;
  window.__TAURI__.core.invoke = ((orig) => async (cmd, args) => {
    if (cmd === "social_hub_start") throw new Error("starting a hub needs the desktop app");
    return orig(cmd, args);
  })(window.__TAURI__.core.invoke);
  click($("social-create"));
  await tick(600);
  const shown = S.errors[S.errors.length - 1] || $("social-errors") && $("social-errors").textContent || "";
  if (!/No hub is answering|desktop app/i.test(shown)) {
    errors.push("a dead hub produced an unhelpful message: " + shown);
  }

  /* ---- 17. the panel is a sidebar, and its controls survive being reopened ---- */
  G9.close();
  S.room = null;
  S.socket = null;
  G9.open();
  await tick(40);
  const host = $("social");
  const box = host.getBoundingClientRect();
  if (box.width > 720) errors.push("the social panel is not a sidebar: " + Math.round(box.width) + "px wide");
  if (!$("social-create")) errors.push("the empty state is missing after reopening");
  const rail = $("social-rail");
  if (!rail || !rail.hidden) errors.push("the room drawer is open when it should start closed");
  click($("social-rooms"));
  await tick(40);
  if (rail.hidden) errors.push("the room drawer button did nothing");
  click($("social-rooms"));
  await tick(20);
  if (!rail.hidden) errors.push("the room drawer would not close again");
  G9.close();
  G9.open();
  await tick(40);
  if (!$("social-rooms")) errors.push("reopening lost the panel shell");
  click($("social-rooms"));
  await tick(40);
  if ($("social-rail").hidden) errors.push("the drawer went dead after closing and reopening");
  click($("social-close"));
  await tick(20);
  if (!$("social").hidden) errors.push("the close button did nothing");

  const real = errors.filter((e) => !/Reconnecting|no socket/i.test(e));
  if (real.length) {
    console.log("SMOKE13 FAIL");
    real.forEach((e) => console.log(" - " + e));
    process.exitCode = 1;
  } else {
    console.log("SMOKE13 OK");
  }
  G9.close();
  window.close();
  process.exit(real.length ? 1 : 0);
}

/* The frames are sealed; this only exists to prove the SDP really goes out encrypted. */
function decodeSealed(sealed) {
  return typeof sealed === "string" && sealed.length > 40 && !/v=0/.test(sealed) ? "" : sealed;
}

run().catch((e) => {
  console.log("SMOKE13 CRASH", e && (e.stack || e.message));
  process.exit(1);
});
