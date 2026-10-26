/* ==========================================================================
   G9 Social — connect, chat, voice, video, leave.
   --------------------------------------------------------------------------
   One file, no dependencies, no build step.

   The shape of it, so the next person can find things:

     1. helpers        base64, time, escape
     2. bridge         Tauri commands when they exist, localStorage when not
     3. crypto         AES-256-GCM with a room key that arrives in the link
     4. transport      one WebSocket, replaceable for tests
     5. state + render the sidebar, the thread, the invite card, the call grid
     6. chat           optimistic send, ack, read
     7. call           mesh WebRTC, voice or video, join and leave
     8. actions        create a room, join a link, leave
     9. wiring         window.G9Social, keys, title-bar button

   Everything secret stays in Rust (identity, signing, the stored room key).
   Everything network-shaped lives here.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- 1. helpers */

  var S = {
    identity: null,
    hub: "",
    threads: [],
    active: null, // thread object
    messages: [],
    room: null, // { id, token, key, name, seats, fingerprint }
    socket: null,
    peers: {}, // device -> { name, video }
    callPending: {}, // devices that announced a call while our microphone was still opening
    pendingRoster: null, // the hub's call roster, when it arrived before the camera did
    pendingOffers: {}, // offers that arrived while the camera was still opening
    hubRoster: false, // the hub keeps call state, so offers can skip a peer round trip
    callIntent: false, // the call button was pressed and the camera is still opening
    iceServers: null, // set by Settings; defaults to a public STUN list
    net: {}, // device -> { rtt, jitter, loss, kbpsIn, res, level }
    link: { rtt: null, sent: {}, seq: 0, jitter: null },
    outbox: [], // chat frames written while the socket was down
    reconnect: { tries: 0, timer: null },
    leaving: false,
    joined: false,
    call: null, // { video, local, peers: Map, started }
    invite: null,
    filter: "",
    unread: {},
    errors: [],
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function b64enc(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64dec(text) {
    var norm = String(text).replace(/-/g, "+").replace(/_/g, "/");
    while (norm.length % 4) norm += "=";
    var bin = atob(norm);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function uid() {
    var bytes = new Uint8Array(9);
    (window.crypto || {}).getRandomValues
      ? window.crypto.getRandomValues(bytes)
      : bytes.forEach(function (_, i) { bytes[i] = Math.floor(Math.random() * 256); });
    return b64enc(bytes);
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function formatClock(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    var pad = function (n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return h ? h + ":" + pad(m) + ":" + pad(sec) : m + ":" + pad(sec);
  }

  function when(ts) {
    var d = Date.now() / 1000 - ts;
    if (d < 60) return "now";
    if (d < 3600) return Math.floor(d / 60) + "m";
    if (d < 86400) return Math.floor(d / 3600) + "h";
    return Math.floor(d / 86400) + "d";
  }

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/);
    if (!parts[0]) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function pushError(where, err) {
    var text = where + ": " + (err && err.message ? err.message : err);
    if (unreachable(err) && /hub/i.test(where)) text = where + ": " + hubHint(S.hub, err);
    S.errors.push(text);
    if (S.errors.length > 20) S.errors.shift();
    setStatus(text, "busy");
    return text;
  }

  /* ---------------------------------------------------------------- 2. bridge */

  var TAURI = (window.__TAURI__ && window.__TAURI__.core) || null;
  var local = null; // set when there is no Tauri: the preview and the tests

  function localStore() {
    if (local) return local;
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem("g9-social-local") || "null");
    } catch (e) {
      raw = null;
    }
    local = raw || { threads: [], messages: {}, contacts: [] };
    if (!local.identity) {
      var bytes = new Uint8Array(20);
      window.crypto.getRandomValues(bytes);
      local.identity = { id: "g9:" + b64enc(bytes), public: "", name: "Guest" };
    }
    return local;
  }

  function saveLocal() {
    try {
      localStorage.setItem("g9-social-local", JSON.stringify(local));
    } catch (e) {}
  }

  /// Every call into Rust goes through here. When Rust is not there (browser preview,
  /// jsdom) the same shape is served from localStorage so the UI is never dead code.
  function invoke(cmd, args) {
    if (TAURI) return TAURI.invoke(cmd, args || {});
    var db = localStore();
    switch (cmd) {
      case "social_identity":
        return Promise.resolve(db.identity);
      case "social_set_name":
        db.identity.name = (args && args.name) || "Guest";
        saveLocal();
        return Promise.resolve(db.identity);
      case "social_handshake":
        return Promise.resolve({ device: db.identity.id, public: "", sig: "" });
      case "social_threads":
        return Promise.resolve(db.threads);
      case "social_upsert_thread": {
        var t = args.thread;
        var found = db.threads.filter(function (x) { return x.id === t.id; })[0];
        if (found) {
          found.name = t.name;
          found.hub = t.hub;
          found.seats = t.seats;
        } else {
          db.threads.push({
            id: t.id,
            name: t.name,
            kind: t.kind || "room",
            hub: t.hub,
            seats: t.seats || 9,
            unread: 0,
            last_at: nowSec(),
            created_at: nowSec(),
          });
        }
        saveLocal();
        return Promise.resolve(true);
      }
      case "social_messages":
        return Promise.resolve((db.messages[args.thread] || []).slice(-(args.limit || 200)));
      case "social_save_message": {
        var key = args.message.thread;
        db.messages[key] = db.messages[key] || [];
        var dup = db.messages[key].some(function (m) { return m.id === args.message.id; });
        if (!dup) db.messages[key].push(args.message);
        saveLocal();
        return Promise.resolve(!dup);
      }
      case "social_mark_read": {
        var th = db.threads.filter(function (x) { return x.id === args.thread; })[0];
        if (th) th.unread = 0;
        saveLocal();
        return Promise.resolve(true);
      }
      case "social_invite":
        return Promise.resolve({
          link: args.link,
          qr_svg: "",
          fingerprint: args.fingerprint || "",
          exp: args.exp,
        });
      case "social_parse_invite":
        return Promise.resolve({ ok: false, error: "Rust is not available in this preview" });
      case "social_qr":
        return Promise.resolve("");
      case "social_contacts":
        return Promise.resolve(db.contacts);
      case "social_devices":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  }

  /* ---------------------------------------------------------------- 3. crypto */

  var frameAad = function (room, sender, kind) {
    return "g9-frame|v1|" + room + "|" + sender + "|" + kind;
  };

  function importKey(keyB64) {
    var raw = b64dec(keyB64);
    return window.crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function sealFrame(key, aad, text) {
    var iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);
    var data = new TextEncoder().encode(text);
    return window.crypto.subtle
      .encrypt({ name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(aad) }, key, data)
      .then(function (ct) {
        var out = new Uint8Array(iv.length + ct.byteLength);
        out.set(iv, 0);
        out.set(new Uint8Array(ct), iv.length);
        return b64enc(out);
      });
  }

  function openFrame(key, aad, sealed) {
    // Anything on the wire can be garbage — a truncated body, a frame from another room,
    // a peer sending noise. None of that may throw out of a socket handler.
    var raw;
    try {
      raw = b64dec(sealed);
    } catch (e) {
      return Promise.reject(new Error("not a sealed frame"));
    }
    if (!raw || raw.length < 13) return Promise.reject(new Error("sealed frame is too short"));
    var iv = raw.slice(0, 12);
    var body = raw.slice(12);
    return window.crypto.subtle
      .decrypt(
        { name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(aad) },
        key,
        body
      )
      .then(function (plain) {
        return new TextDecoder().decode(plain);
      });
  }

  /* ---------------------------------------------------------------- 4. transport */

  /// The default transport is a plain WebSocket to the hub. A test can replace it with
  /// anything that speaks the same four methods.
  var transportFactory = function (url) {
    var ws = new WebSocket(url);
    return {
      send: function (text) {
        ws.send(text);
      },
      close: function () {
        try {
          ws.close();
        } catch (e) {}
      },
      onopen: function (fn) {
        ws.onopen = fn;
      },
      onmessage: function (fn) {
        ws.onmessage = function (event) {
          fn(event.data);
        };
      },
      onclose: function (fn) {
        ws.onclose = fn;
      },
      raw: ws,
    };
  };

  function fetchJson(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (options.body) options.headers["content-type"] = "application/json";
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch (e) {
          body = null;
        }
        if (!res.ok) {
          throw new Error((body && body.error) || res.status + " " + res.statusText);
        }
        return body;
      });
    });
  }

  /* ---------------------------------------------------------------- 5. state + render */

  function mount() {
    var host = document.getElementById("social");
    if (!host) return null;
    // Build the shell once. Rebuilding it on every open() replaced the elements the
    // listeners were attached to, so the room drawer and the close button went dead.
    if (host.querySelector(".social-top")) return host;
    host.innerHTML =
      '<div class="social-top">' +
      '<button class="social-icon" id="social-rooms" title="Rooms and people" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>' +
      "</button>" +
      '<span class="social-dot" id="social-dot"></span>' +
      "<b>Social</b>" +
      '<span class="social-status" id="social-status">Not connected</span>' +
      '<span class="social-rtt" id="social-rtt" title="Round trip to the room"></span>' +
      '<span class="spacer"></span>' +
      '<button class="social-icon" id="social-close" title="Close (Esc)" aria-label="Close social">' +
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="social-rail" id="social-rail" hidden>' +
      '<div class="social-search">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="social-filter" placeholder="Search rooms and people" />' +
      "</div>" +
      '<div class="social-list" id="social-list"></div>' +
      '<div class="social-rail-foot" id="social-foot"></div>' +
      "</div>" +
      '<main class="social-main" id="social-main"></main>' +
      '<div class="social-grip" id="social-grip" title="Drag to widen"></div>';
    wireShell();
    return host;
  }

  function hereCount() {
    return Object.keys(S.peers).length + 1;
  }

  function peerName(device) {
    return (S.peers[device] && S.peers[device].name) || "Guest";
  }

  /// Presence changes touch three places: the strip, the header line and the rail.
  function refreshPresence() {
    setStatus("Connected · " + hereCount() + " here", "on");
    var sub = document.getElementById("social-sub");
    if (sub) sub.textContent = hereCount() + " here · room " + ((S.room && S.room.id) || "");
    var badge = document.getElementById("call-badge");
    if (badge) badge.textContent = "encrypted · mesh";
    renderRail();
  }

  function setStatus(text, kind) {
    var node = document.getElementById("social-status");
    var dot = document.getElementById("social-dot");
    if (node) node.textContent = text;
    if (dot) dot.className = "social-dot " + (kind === "on" ? "on" : kind === "busy" ? "busy" : "");
  }

  function renderRail() {
    var list = document.getElementById("social-list");
    if (!list) return;
    var q = S.filter.toLowerCase();
    var rows = [];

    rows.push('<div class="s-section">Rooms</div>');
    var rooms = S.threads.filter(function (t) {
      return !q || (t.name || "").toLowerCase().indexOf(q) >= 0;
    });
    if (!rooms.length) {
      rows.push('<div class="s-empty">No rooms yet. Create one and share the link — or paste a link someone sent you.</div>');
    }
    rooms.forEach(function (t) {
      var unread = S.unread[t.id] || t.unread || 0;
      rows.push(
        '<button class="s-row' +
          (S.active && S.active.id === t.id ? " on" : "") +
          '" data-thread="' +
          esc(t.id) +
          '">' +
          '<span class="s-avatar">' +
          esc(initials(t.name)) +
          "</span>" +
          '<span class="s-body"><span class="s-title">' +
          esc(t.name) +
          '</span><span class="s-preview">' +
          (S.room && S.room.id === t.id ? "connected · " + hereCount() + " here" : "not connected") +
          "</span></span>" +
          (unread ? '<span class="s-badge">' + (unread > 9 ? "9+" : unread) + "</span>" : "") +
          "</button>"
      );
    });

    rows.push('<div class="s-section">People</div>');
    var live = [];
    if (S.room) {
      live.push(
        '<div class="s-row"><span class="s-avatar">' +
          esc(initials((S.identity && S.identity.name) || "You")) +
          '</span><span class="s-body"><span class="s-title">' +
          esc((S.identity && S.identity.name) || "You") +
          '</span><span class="s-preview">you · in this room</span></span></div>'
      );
      Object.keys(S.peers).forEach(function (device) {
        live.push(
          '<div class="s-row"><span class="s-avatar ghost">' +
            esc(initials(peerName(device))) +
            '</span><span class="s-body"><span class="s-title">' +
            esc(peerName(device)) +
            '</span><span class="s-preview">in this room</span></span></div>'
        );
      });
    }
    if (!live.length) rows.push('<div class="s-empty">Nobody yet — a link is all it takes.</div>');
    rows = rows.concat(live);

    var people = (S.contacts || []).filter(function (c) {
      return !q || (c.name || "").toLowerCase().indexOf(q) >= 0;
    });
    if (people.length) rows.push('<div class="s-section">Saved</div>');
    people.forEach(function (c) {
      rows.push(
        '<div class="s-row"><span class="s-avatar ghost">' +
          esc(initials(c.name)) +
          '</span><span class="s-body"><span class="s-title">' +
          esc(c.name) +
          '</span><span class="s-preview">' +
          esc(c.id.length > 14 ? c.id.slice(0, 14) + "…" : c.id) +
          "</span></span>" +
          (c.verified ? '<span class="s-when">✓</span>' : "") +
          "</div>"
      );
    });

    list.innerHTML = rows.join("");
    list.querySelectorAll("[data-thread]").forEach(function (node) {
      node.addEventListener("click", function () {
        selectThread(node.getAttribute("data-thread"));
      });
    });

    var foot = document.getElementById("social-foot");
    if (foot) {
      var me = S.identity || { name: "Guest", id: "g9:…" };
      foot.innerHTML =
        '<span class="s-avatar">' +
        esc(initials(me.name)) +
        '</span><span class="s-body"><span class="s-title">' +
        esc(me.name) +
        '</span><span class="s-preview">' +
        esc(me.id) +
        "</span></span>";
    }
  }

  function renderMain() {
    var main = document.getElementById("social-main");
    if (!main) return;

    if (!S.active) {
      main.innerHTML = welcomeHtml();
      wireWelcome(main);
      return;
    }

    var t = S.active;
    var here = hereCount();
    main.innerHTML =
      '<div class="social-head">' +
      "<h2>" +
      esc(t.name) +
      "</h2>" +
      '<span class="sub" id="social-sub">' +
      (S.room && S.room.id === t.id ? here + " here · room " + esc(t.id) : "offline — open to connect") +
      "</span>" +
      '<span class="lock" title="Everything in this room is encrypted with the room key">🔒 encrypted</span>' +
      '<span class="spacer"></span>' +
      '<button class="top-btn" id="social-invite-btn">Invite</button>' +
      '<button class="top-btn" id="social-call-voice">Voice</button>' +
      '<button class="top-btn" id="social-call-video">Video</button>' +
      "</div>" +
      '<div class="social-msgs" id="social-msgs"></div>' +
      '<div class="social-hint" id="social-hint" hidden></div>' +
      '<div class="social-compose">' +
      '<textarea id="social-input" rows="1" placeholder="Message" title="Message ' +
      esc(t.name) +
      ' — Enter to send"></textarea>' +
      '<button class="top-btn" id="social-send">Send</button>' +
      "</div>" +
      (S.invite ? '<div class="social-modal" id="social-invite-card">' + inviteHtml() + "</div>" : "");

    paintMessages();

    var inviteBtn = document.getElementById("social-invite-btn");
    if (inviteBtn)
      inviteBtn.addEventListener("click", function () {
        makeInvite().catch(function (e) {
          pushError("Invite", e);
        });
      });
    var voice = document.getElementById("social-call-voice");
    if (voice)
      voice.addEventListener("click", function () {
        startCall(false).catch(function (e) {
          pushError("Voice call", e);
        });
      });
    var video = document.getElementById("social-call-video");
    if (video)
      video.addEventListener("click", function () {
        startCall(true).catch(function (e) {
          pushError("Video call", e);
        });
      });
    var send = document.getElementById("social-send");
    if (send) send.addEventListener("click", sendFromComposer);
    var hint = document.getElementById("social-hint");
    if (hint && !S.socket) {
      hint.textContent = "Not connected to the hub — messages are saved and will send when it is back.";
      hint.hidden = false;
    }
    var input = document.getElementById("social-input");
    if (input) {
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          sendFromComposer();
        }
      });
      input.focus();
    }
    var copy = document.getElementById("social-copy");
    if (copy)
      copy.addEventListener("click", function () {
        var link = S.invite && S.invite.link;
        if (!link) return;
        if (navigator.clipboard) navigator.clipboard.writeText(link);
        copy.textContent = "Copied";
      });
    var closeInvite = document.getElementById("social-qr-hide");
    if (closeInvite)
      closeInvite.addEventListener("click", function () {
        S.invite = null;
        renderMain();
      });
    var modal = document.getElementById("social-invite-card");
    if (modal)
      modal.addEventListener("click", function (ev) {
        if (ev.target === modal) {
          S.invite = null;
          renderMain();
        }
      });
    if (S.invite) paintQr();
  }

  function welcomeHtml() {
    return (
      '<div class="social-welcome">' +
      "<h3>Chat, talk, see each other</h3>" +
      "<p>One link is the whole setup: it carries the hub, the room and the key.<br />Up to 9 devices in a room, encrypted end to end.</p>" +
      '<div class="social-card">' +
      "<label for=\"social-hub\">Hub</label>" +
      '<input type="text" id="social-hub" value="' +
      esc(S.hub || DEFAULT_HUB) +
      '" placeholder="' + DEFAULT_HUB + '" />' +
      '<div class="row"><button class="top-btn accent" id="social-create">Create a room</button></div>' +
      '<small class="hint">No server yet? G9 starts one on this PC when you press Create.</small>' +
      "</div>" +
      '<div class="social-card">' +
      "<label for=\"social-link\">Or join with a link</label>" +
      '<div class="row"><input type="text" id="social-link" placeholder="g9://join?…" />' +
      '<button class="top-btn" id="social-join">Join</button></div>' +
      "</div>" +
      (S.errors.length
        ? '<p class="s-empty" id="social-errors">' + esc(S.errors[S.errors.length - 1]) + "</p>"
        : "") +
      "</div>"
    );
  }

  function wireWelcome(main) {
    var create = main.querySelector("#social-create");
    if (create)
      create.addEventListener("click", function () {
        var hub = (main.querySelector("#social-hub").value || "").trim();
        S.hub = hub;
        createRoom(hub).catch(function (e) {
          pushError("Create room", e);
        });
      });
    var join = main.querySelector("#social-join");
    if (join)
      join.addEventListener("click", function () {
        var link = (main.querySelector("#social-link").value || "").trim();
        joinLink(link).catch(function (e) {
          pushError("Join", e);
        });
      });
    var input = main.querySelector("#social-link");
    if (input)
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          join.click();
        }
      });
  }

  function inviteHtml() {
    var i = S.invite;
    return (
      '<div class="social-card social-invite" role="dialog" aria-label="Invite to this room">' +
      "<label>Anyone with this link can join this room — no account, no app store</label>" +
      '<div class="qr" id="social-qr"></div>' +
      '<div class="fp">' +
      esc(i.fingerprint || "") +
      "</div>" +
      '<div class="link">' +
      esc(i.link) +
      "</div>" +
      '<div class="row" style="justify-content:center">' +
      '<button class="top-btn accent" id="social-copy">Copy link</button>' +
      '<button class="top-btn" id="social-qr-hide">Done</button>' +
      "</div></div>"
    );
  }

  function paintQr() {
    var host = document.getElementById("social-qr");
    if (!host || !S.invite || !S.invite.link) return;
    invoke("social_qr", { text: S.invite.link })
      .then(function (svg) {
        if (svg) host.innerHTML = svg;
        else host.textContent = "QR";
      })
      .catch(function () {
        host.textContent = "QR";
      });
  }

  function paintMessages() {
    var box = document.getElementById("social-msgs");
    if (!box) return;
    if (!S.messages.length) {
      box.innerHTML =
        '<div class="s-empty">No messages yet. Say something — it is encrypted before it leaves this machine.</div>';
      return;
    }
    box.innerHTML = S.messages
      .map(function (m) {
        if (m.kind !== "chat") {
          return '<div class="msg call"><div class="bubble">' + esc(m.body) + "</div></div>";
        }
        return (
          '<div class="msg' +
          (m.mine ? " mine" : "") +
          '">' +
          (m.mine ? "" : '<span class="who">' + esc(m.sender_name || "Guest") + "</span>") +
          '<div class="bubble">' +
          esc(m.body) +
          "</div>" +
          '<span class="tick">' +
          (m.mine ? tickFor(m.state) + " · " : "") +
          new Date(m.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function tickFor(state) {
    if (state === "pending") return "…";
    if (state === "delivered") return "✓✓";
    if (state === "read") return "✓✓";
    if (state === "failed") return "!";
    return "✓";
  }

  /* ---------------------------------------------------------------- 6. chat */

  function appendMessage(message) {
    S.messages.push(message);
    paintMessages();
  }

  function sendFromComposer() {
    var input = document.getElementById("social-input");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendChat(text);
  }

  function sendChat(text) {
    if (!S.active) return Promise.resolve(false);
    var message = {
      id: uid(),
      thread: S.active.id,
      sender: S.identity ? S.identity.id : "me",
      sender_name: S.identity ? S.identity.name : "Me",
      kind: "chat",
      body: text,
      ts: nowSec(),
      mine: true,
      state: S.socket ? "sent" : "pending",
    };
    appendMessage(message);
    invoke("social_save_message", { message: message }).catch(function () {});

    return frame("chat", { type: "chat", id: message.id, text: text, ts: message.ts }).then(function (ok) {
      if (ok === "queued") {
        message.state = "pending";
        setStatus("Queued — it will send the moment the room is back", "busy");
        paintMessages();
        return false;
      }
      if (!ok) {
        message.state = "failed";
        paintMessages();
        invoke("social_set_state", { id: message.id, newState: "failed" }).catch(function () {});
      } else {
        message.sentAt = Date.now();
      }
      return ok;
    });
  }

  /// Encrypt a payload and hand it to the hub. Chat written while the socket is down goes
  /// into the outbox and is sent the moment the room is back; control frames are dropped,
  /// because a stale offer is worse than no offer.
  function frame(kind, payload, to) {
    if (!S.plainKey) return Promise.resolve(false);
    if (!S.socket) {
      if (kind === "chat") {
        S.outbox.push({ kind: kind, payload: payload, to: to });
        return Promise.resolve("queued");
      }
      return Promise.resolve(false);
    }
    var sender = S.identity.id;
    var aad = frameAad(S.room.id, sender, kind);
    payload.v = 1;
    payload.name = S.identity.name;
    return sealFrame(S.plainKey, aad, JSON.stringify(payload))
      .then(function (sealed) {
        S.socket.send(JSON.stringify({ t: "msg", to: to || "*", kind: kind, body: sealed, id: payload.id || "" }));
        return true;
      })
      .catch(function (e) {
        pushError("Send", e);
        return false;
      });
  }

  function onMessage(raw) {
    var data;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!data || !data.t) return;
    if (data.t === "pong") {
      onPong(data);
      return;
    }
    if (data.t === "call") {
      onCallEvent(data);
      return;
    }
    if (data.t === "ready") {
      S.peers = {};
      (data.peers || []).forEach(function (p) {
        S.peers[p.device] = { name: p.name, video: !!p.video, call: !!p.call };
      });
      // A hub that sends `call` keeps the roster itself; one that does not is older and we
      // fall back to announcing over the room and waiting for answers.
      S.hubRoster = Object.prototype.hasOwnProperty.call(data, "call");
      if (S.hubRoster) S.pendingRoster = data.call || [];
      S.joined = true;
      S.reconnect.tries = 0;
      setStatus("Connected · " + hereCount() + " here", "on");
      startPing();
      flushOutbox();
      renderRail();
      renderMain();
      // Back from a reconnect in the middle of a call: re-state it and re-offer.
      if (S.call) {
        if (S.hubRoster && S.socket) {
          S.socket.send(JSON.stringify({ t: "call", state: "join", video: !!S.call.video }));
        }
        (data.call || []).forEach(function (p) {
          joinedCall(p.device, { name: p.name, video: p.video, silent: true });
        });
        startStats();
      }
      return;
    }
    if (data.t === "peer") {
      if (data.event === "join") {
        S.peers[data.device] = { name: data.name, video: false };
        addCallEvent(data.name + " joined the room");
        // If a call is up, the newcomer has announced itself; nothing else to do here.
      } else {
        delete S.peers[data.device];
        if (S.call) dropPeer(data.device);
        if (S.call) renderCall();
      }
      refreshPresence();
      return;
    }
    if (data.t === "msg") {
      var kind = data.kind || "chat";
      var aad = frameAad(S.room ? S.room.id : "", data.from, kind);
      openFrame(S.plainKey, aad, data.body)
        .then(function (plain) {
          handlePayload(data, JSON.parse(plain));
        })
        .catch(function () {
          addCallEvent("A message from " + (data.name || "someone") + " could not be read (different room key)");
        });
    }
  }

  /// The hub's view of the call: a roster on join, a line per person in and out.
  function onCallEvent(data) {
    if (!data || !data.event) return;
    if (data.event === "roster") {
      if (!S.call) {
        S.pendingRoster = data.peers || [];
        return;
      }
      (data.peers || []).forEach(function (p) {
        joinedCall(p.device, { name: p.name, video: p.video, silent: true });
      });
      return;
    }
    if (data.event === "join") {
      if (!S.call) {
        S.callPending[data.device] = { name: data.name, video: data.video };
        return;
      }
      joinedCall(data.device, { name: data.name, video: data.video, silent: true });
      return;
    }
    if (data.event === "leave" && S.call) {
      S.call.members.delete(data.device);
      dropPeer(data.device);
      renderCall();
    }
  }

  function handlePayload(envelope, payload) {
    var type = payload.type || envelope.kind;
    if (type === "chat") {
      var incoming = {
        id: payload.id,
        thread: S.active.id,
        sender: envelope.from,
        sender_name: payload.name || envelope.name || "Guest",
        kind: "chat",
        body: payload.text,
        ts: payload.ts || envelope.ts,
        mine: false,
        state: "delivered",
      };
      var dup = S.messages.some(function (m) { return m.id === incoming.id; });
      if (!dup) {
        appendMessage(incoming);
        if (document.hidden || !isOpen()) {
          S.unread[S.active.id] = (S.unread[S.active.id] || 0) + 1;
          renderRail();
          notify(payload.name || "New message", payload.text);
        }
      }
      invoke("social_save_message", { message: incoming }).catch(function () {});
      if (isOpen()) {
        frame("ack", { type: "read", id: payload.id }, envelope.from);
      } else {
        frame("ack", { type: "ack", id: payload.id }, envelope.from);
      }
      return;
    }
    if (type === "ack" || type === "read") {
      var mine = S.messages.filter(function (m) { return m.id === payload.id; })[0];
      if (mine) {
        mine.state = type === "read" ? "read" : "delivered";
        paintMessages();
        invoke("social_set_state", { id: mine.id, newState: mine.state }).catch(function () {});
      }
      return;
    }
    if (type === "call-join") {
      // Two people pressing the call button at the same moment race with getUserMedia:
      // an announcement can land before our own call exists. Keep it and replay it.
      if (!S.call) {
        S.callPending[envelope.from] = payload;
        return;
      }
      joinedCall(envelope.from, payload);
      return;
    }
    if (type === "call-offer") {
      // The camera may still be opening: keep the offer and answer it when it is ready.
      if (!S.call) {
        S.pendingOffers[envelope.from] = payload;
        return;
      }
      answerOffer(envelope.from, payload).catch(function (e) {
        pushError("Answer", e);
      });
      return;
    }
    if (type === "call-recover") {
      if (S.call && S.identity.id < envelope.from) makeOffer(envelope.from, true);
      return;
    }
    if (type === "call-answer") {
      var peer = S.call && S.call.peers.get(envelope.from);
      if (peer && peer.pc) {
        peer.remote = payload.sdp;
        peer.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp }).catch(function () {});
      }
      return;
    }
    if (type === "call-ice") {
      var target = S.call && S.call.peers.get(envelope.from);
      if (target && target.pc && payload.candidate) {
        target.pc.addIceCandidate(payload.candidate).catch(function () {});
      }
      return;
    }
    if (type === "call-leave") {
      if (S.call) S.call.members.delete(envelope.from);
      dropPeer(envelope.from);
      addCallEvent((payload.name || "Someone") + " left the call");
      return;
    }
    if (type === "call-state") {
      var p = S.call && S.call.peers.get(envelope.from);
      if (p) {
        p.video = !!payload.video;
        renderCall();
      }
    }
  }

  function addCallEvent(text) {
    if (!S.active) return;
    var entry = {
      id: uid(),
      thread: S.active.id,
      sender: "system",
      sender_name: "",
      kind: "call-event",
      body: text,
      ts: nowSec(),
      mine: false,
      state: "read",
    };
    appendMessage(entry);
    invoke("social_save_message", { message: entry }).catch(function () {});
  }

  function notify(title, body) {
    if (window.G9Notify && window.G9Notify.push) {
      window.G9Notify.push({ title: title, body: body, cat: "info" });
    }
  }

  /* ---------------------------------------------------------------- 7. call */

  /// A public STUN pair is enough to find the path between two home networks. A TURN
  /// server can be added in Settings for networks that block everything but 443/TCP.
  var DEFAULT_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

  function iceServers() {
    return S.iceServers && S.iceServers.length ? S.iceServers : DEFAULT_ICE;
  }

  function rtcConfig() {
    return {
      iceServers: iceServers(),
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      // Gathering starts the moment the connection object exists, so the first offer
      // already carries candidates instead of waiting for a fresh round of STUN.
      iceCandidatePoolSize: 4,
    };
  }

  /// One quality ladder for the whole call, chosen from how many people are in it.
  /// Nine people all sending 720p would need ~9 Mbps of uplink each; nobody has that,
  /// so the ladder trades pixels for the thing people actually notice — latency.
  function tier() {
    var people = S.call ? S.call.peers.size + 1 : 2;
    if (people <= 2) return { name: "720p", maxBitrate: 900000, width: 1280, height: 720, fps: 30, audioKbps: 40 };
    if (people <= 4) return { name: "540p", maxBitrate: 550000, width: 960, height: 540, fps: 30, audioKbps: 32 };
    if (people <= 6) return { name: "360p", maxBitrate: 320000, width: 640, height: 360, fps: 24, audioKbps: 28 };
    return { name: "240p", maxBitrate: 180000, width: 426, height: 240, fps: 15, audioKbps: 24 };
  }

  /// Opus defaults are tuned for streaming, not for talking: 20 ms packets, stereo, and a
  /// bitrate that does not care about your uplink. This rewrites the fmtp line so packets
  /// are 10 ms (half the time between mouth and ear), DTX is on, FEC protects loss, and
  /// the bitrate matches the size of the call.
  function tuneAudio(sdp, audioKbps) {
    var map = /a=rtpmap:(\d+) opus\/48000\/2/.exec(sdp);
    if (!map) return sdp;
    var pt = map[1];
    var params =
      "minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;ptime=10;maxptime=20;maxaveragebitrate=" +
      audioKbps * 1000;
    var line = new RegExp("a=fmtp:" + pt + " [^\\r\\n]*");
    if (line.test(sdp)) return sdp.replace(line, "a=fmtp:" + pt + " " + params);
    return sdp.replace(
      "a=rtpmap:" + pt + " opus/48000/2",
      "a=rtpmap:" + pt + " opus/48000/2\r\na=fmtp:" + pt + " " + params
    );
  }

  function tuneSdp(sdp, what) {
    var out = sdp;
    if (what === "offer" || what === "answer") out = tuneAudio(out, tier().audioKbps);
    return out;
  }

  /// Hardware decoding on Windows is H.264 through Media Foundation. Preferring it over
  /// VP9/AV1 keeps a nine-way call off the CPU and shaves the decode queue.
  var CODEC_ORDER = ["H264", "VP8", "VP9", "AV1"];

  function preferCodecs(entry) {
    if (!entry.pc.getTransceivers) return;
    var caps = window.RTCRtpSender && RTCRtpSender.getCapabilities ? RTCRtpSender.getCapabilities("video") : null;
    if (!caps || !caps.codecs || !caps.codecs.length) return;
    var audio = window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities ? RTCRtpReceiver.getCapabilities("audio") : null;
    var ranked = caps.codecs.slice().sort(function (a, b) {
      return CODEC_ORDER.indexOf(a.mimeType.split("/")[1]) - CODEC_ORDER.indexOf(b.mimeType.split("/")[1]);
    });
    entry.pc.getTransceivers().forEach(function (tr) {
      if (!tr.setCodecPreferences) return;
      var kind = tr.receiver && tr.receiver.track && tr.receiver.track.kind;
      if (kind === "video") {
        try {
          tr.setCodecPreferences(ranked);
        } catch (e) {}
      } else if (kind === "audio" && audio && audio.codecs) {
        try {
          tr.setCodecPreferences(audio.codecs);
        } catch (e) {}
      }
    });
  }

  /// Ask the browser to play as soon as it can: no playout smoothing, a small jitter buffer.
  function tuneReceiver(receiver, kind) {
    if (!receiver) return;
    try {
      receiver.playoutDelayHint = 0;
    } catch (e) {}
    try {
      receiver.jitterBufferTarget = kind === "video" ? 80 : 40;
    } catch (e) {}
  }

  function videoSender(pc) {
    if (!pc || !pc.getSenders) return null;
    return (
      pc.getSenders().filter(function (s) {
        return s.track && s.track.kind === "video";
      })[0] || null
    );
  }

  /// Push the ladder down to every outgoing video stream, and mark the audio senders as
  /// speech so the browser's own pacer gives them priority.
  function applyLimits() {
    if (!S.call) return;
    var t = tier();
    S.call.peers.forEach(function (entry) {
      var sender = videoSender(entry.pc);
      if (sender && sender.setParameters && sender.getParameters) {
        try {
          var params = sender.getParameters();
          params.degradationPreference = "balanced";
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = t.maxBitrate;
          params.encodings[0].maxFramerate = t.fps;
          params.encodings[0].scaleResolutionDownBy = 1;
          sender.setParameters(params);
        } catch (e) {}
      }
      entry.pc.getSenders().forEach(function (s) {
        if (s.track && s.track.kind === "audio" && "contentHint" in s.track) s.track.contentHint = "speech";
        if (s.track && s.track.kind === "video" && "contentHint" in s.track) s.track.contentHint = "motion";
      });
    });
  }

  /// Capture settings that keep the microphone's own buffer short and its audio clean.
  function mediaFor(withVideo) {
    var audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      latency: { ideal: 0.01 },
    };
    if (!withVideo) return { audio: audio };
    var t = tier();
    return {
      audio: audio,
      video: {
        width: { ideal: t.width },
        height: { ideal: t.height },
        frameRate: { ideal: t.fps, max: t.fps },
        facingMode: "user",
      },
    };
  }

  function startCall(withVideo) {
    // Never over a call: the invite is an invitation, the call is the conversation.
    if (S.invite) S.invite = null;
    if (S.call) {
      if (withVideo && !S.call.video) return enableVideo();
      return Promise.resolve(false);
    }
    var began = Date.now();
    // Ask the hub for the call roster *before* the camera opens. The answer arrives while
    // getUserMedia is still running, so the first offer has a destination the instant the
    // stream exists — no extra peer round trip between "call pressed" and "offer sent".
    S.callIntent = true;
    S.pendingRoster = null;
    if (S.hubRoster && S.socket) {
      S.socket.send(JSON.stringify({ t: "call", state: "join", video: !!withVideo }));
    }
    return navigator.mediaDevices
      .getUserMedia(mediaFor(withVideo))
      .then(function (stream) {
        S.call = {
          video: !!withVideo,
          local: stream,
          peers: new Map(),
          members: new Set(),
          started: nowSec(),
          muted: false,
          camOn: !!withVideo,
          full: false,
        };
        S.call.timer = setInterval(function () {
          var clock = document.getElementById("call-time");
          if (!S.call) return;
          if (clock) clock.textContent = formatClock(nowSec() - S.call.started);
        }, 1000);
        renderCall();
        addCallEvent((withVideo ? "Video" : "Voice") + " call started");
        startStats();
        startPing();
        S.callIntent = false;
        var setupMs = Date.now() - began;
        S.call.setupMs = setupMs;
        return announceCall(withVideo).then(function () {
          S.call.announceMs = Date.now() - began;
          return true;
        });
      })
      .catch(function (e) {
        S.callIntent = false;
        pushError(withVideo ? "Camera" : "Microphone", e);
        return false;
      });
  }

  /// Tell the room we are in the call, and start connecting to everyone already in it.
  function announceCall(withVideo) {
    var roster = S.pendingRoster;
    S.pendingRoster = null;
    // Anything that arrived while we were opening the camera is replayed now.
    Object.keys(S.pendingOffers).forEach(function (device) {
      var payload = S.pendingOffers[device];
      delete S.pendingOffers[device];
      answerOffer(device, payload).catch(function () {});
    });
    var pending = S.callPending;
    S.callPending = {};

    if (S.hubRoster && S.socket) {
      // The hub already knows we are in, and its roster came with the answer.
      (roster || []).forEach(function (p) {
        joinedCall(p.device, { name: p.name, video: p.video, silent: true });
      });
      // Somebody may have joined the call while our camera was still opening: their
      // arrival was buffered and is replayed here, not thrown away.
      Object.keys(pending).forEach(function (device) {
        joinedCall(device, pending[device]);
      });
      // Camera opening can outlast the roster answer; if it has not arrived yet, the
      // socket handler replays it the moment it does.
      applyLimits();
      return Promise.resolve(true);
    }

    // A hub too old to keep call state: announce over the room and wait to be answered.
    return frame("call-join", { type: "call-join", video: !!withVideo }).then(function () {
      Object.keys(pending).forEach(function (device) {
        joinedCall(device, pending[device]);
      });
      S.call.tries = 0;
      S.call.retry = setInterval(function () {
        if (!S.call) return;
        S.call.tries += 1;
        if (S.call.tries > 6) {
          clearInterval(S.call.retry);
          return;
        }
        if (!S.call.peers.size && S.call.tries <= 4) {
          frame("call-join", { type: "call-join", video: S.call.video, ack: true });
        }
        S.call.members.forEach(function (device) {
          maybeOffer(device, true);
        });
      }, 2500);
      return true;
    });
  }

  function enableVideo() {
    var t = tier();
    return navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: t.width }, height: { ideal: t.height }, frameRate: { ideal: t.fps } } })
      .then(function (stream) {
      var track = stream.getVideoTracks()[0];
      S.call.video = true;
      S.call.camOn = true;
      S.call.local.addTrack(track);
      S.call.peers.forEach(function (peer) {
        if (peer.pc) {
          var sender = peer.pc.getSenders().filter(function (s) { return s.track && s.track.kind === "video"; })[0];
          if (sender) sender.replaceTrack(track);
          else peer.pc.addTrack(track, S.call.local);
        }
      });
      frame("call-state", { type: "call-state", video: true });
      renderCall();
    });
  }

  function peerFor(device, name) {
    if (!S.call) return null;
    if (S.call.peers.has(device)) return S.call.peers.get(device);
    var pc = new RTCPeerConnection(rtcConfig());
    var entry = {
      pc: pc,
      device: device,
      name: name || (S.peers[device] && S.peers[device].name) || "Guest",
      stream: null,
      video: false,
      restarts: 0,
      connected: false,
    };
    S.call.local.getTracks().forEach(function (track) {
      pc.addTrack(track, S.call.local);
    });
    preferCodecs(entry);
    pc.onicecandidate = function (ev) {
      if (ev.candidate) frame("call-ice", { type: "call-ice", candidate: ev.candidate.toJSON() }, device);
    };
    pc.ontrack = function (ev) {
      entry.stream = ev.streams[0];
      entry.video = ev.track.kind === "video";
      tuneReceiver(ev.receiver, ev.track.kind);
      renderCall();
    };
    pc.onconnectionstatechange = function () {
      watchConnection(device, entry);
    };
    S.call.peers.set(device, entry);
    applyLimits();
    renderCall();
    return entry;
  }

  /// A dropped connection is not the end of a call: restart ICE, and let the other side
  /// ask us to restart if it is the one that noticed first.
  function watchConnection(device, entry) {
    if (!S.call || !entry || !entry.pc) return;
    var state = entry.pc.connectionState;
    if (state === "connected") {
      entry.restarts = 0;
      if (!entry.connected) {
        entry.connected = true;
        renderCall();
      }
      return;
    }
    if (state !== "failed" && state !== "disconnected") return;
    if (entry.recoverTimer) return;
    entry.recoverTimer = setTimeout(function () {
      entry.recoverTimer = null;
      if (!S.call || S.call.peers.get(device) !== entry) return;
      if (entry.pc.connectionState === "connected") return;
      entry.restarts += 1;
      if (entry.restarts > 4) {
        addCallEvent(entry.name + " dropped");
        return;
      }
      if (S.identity.id < device) makeOffer(device, true);
      else frame("call-recover", { type: "call-recover" }, device);
    }, 1200);
  }

  /// Record a device as being in this call, greet it, and start negotiating if it is our turn.
  function joinedCall(device, payload) {
    if (!S.call || !device) return;
    var first = !S.call.members.has(device);
    S.call.members.add(device);
    if (first && !payload.ack && !payload.silent && !S.hubRoster) {
      addCallEvent((payload.name || "Someone") + " joined the call");
    }
    S.peers[device] = S.peers[device] || { name: payload.name };
    S.peers[device].video = !!payload.video;
    // On a hub that keeps call state there is nothing to answer: the roster is the answer.
    if (first && !payload.ack && !S.hubRoster) {
      frame("call-join", { type: "call-join", video: S.call.video, ack: true }, device);
    }
    maybeOffer(device);
    applyLimits();
    renderCall();
  }

  /// Offer only when this side is the designated offerer and nothing is in flight yet.
  /// `again` lets the retry force a second offer if the first one went into the void.
  function maybeOffer(device, again) {
    if (!S.call || !device) return;
    if (!(S.identity.id < device)) return; // the smaller id offers
    var entry = S.call.peers.get(device);
    if (entry && entry.remote) return; // already negotiated
    if (entry && entry.offering) return; // an offer is being written right now
    if (entry && entry.pc.signalingState !== "stable") return; // still in flight
    makeOffer(device).catch(function (e) {
      pushError("Offer", e);
    });
  }

  function makeOffer(device, iceRestart) {
    var entry = peerFor(device);
    if (!entry || entry.offering) return Promise.resolve(false);
    entry.offering = true;
    return entry.pc
      .createOffer(iceRestart ? { iceRestart: true } : undefined)
      .then(function (offer) {
        var tuned = tuneSdp(offer.sdp, "offer");
        return entry.pc.setLocalDescription({ type: "offer", sdp: tuned }).then(function () {
          entry.local = tuned;
          entry.remote = null;
          entry.offering = false;
          applyLimits();
          return frame("call-offer", { type: "call-offer", sdp: tuned, restart: !!iceRestart }, device);
        });
      })
      .catch(function (e) {
        entry.offering = false;
        pushError("Offer", e);
        return false;
      });
  }

  function answerOffer(device, payload) {
    if (!S.call) return Promise.resolve(false);
    var entry = peerFor(device);
    if (!entry) return Promise.resolve(false);
    // Glare: both sides hit call at once. Our own offer loses, so start clean and answer.
    if (!entry.remote && entry.local && entry.pc.signalingState !== "stable") {
      try {
        entry.pc.close();
      } catch (e) {}
      S.call.peers.delete(device);
      entry = peerFor(device);
      if (!entry) return Promise.resolve(false);
    }
    return entry.pc
      .setRemoteDescription({ type: "offer", sdp: payload.sdp })
      .then(function () {
        entry.remote = payload.sdp;
        return entry.pc.createAnswer();
      })
      .then(function (answer) {
        var tuned = tuneSdp(answer.sdp, "answer");
        return entry.pc.setLocalDescription({ type: "answer", sdp: tuned }).then(function () {
          applyLimits();
          return frame("call-answer", { type: "call-answer", sdp: tuned }, device);
        });
      });
  }

  function dropPeer(device) {
    if (!S.call) return;
    var entry = S.call.peers.get(device);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch (e) {}
    S.call.peers.delete(device);
    delete S.net[device];
    renderCall();
  }

  function toggleMute() {
    if (!S.call) return;
    S.call.muted = !S.call.muted;
    S.call.local.getAudioTracks().forEach(function (t) {
      t.enabled = !S.call.muted;
    });
    renderCall();
  }

  function toggleCamera() {
    if (!S.call) return;
    if (!S.call.video) return enableVideo();
    S.call.camOn = !S.call.camOn;
    S.call.local.getVideoTracks().forEach(function (t) {
      t.enabled = S.call.camOn;
    });
    frame("call-state", { type: "call-state", video: S.call.camOn });
    renderCall();
  }

  function endCall() {
    if (!S.call) return Promise.resolve(false);
    if (S.hubRoster && S.socket) {
      try {
        S.socket.send(JSON.stringify({ t: "call", state: "leave", video: false }));
      } catch (e) {}
    }
    return frame("call-leave", { type: "call-leave", name: S.identity.name })
      .catch(function () {})
      .then(function () {
        S.call.peers.forEach(function (entry) {
          try {
            entry.pc.close();
          } catch (e) {}
        });
        S.call.local.getTracks().forEach(function (t) {
          t.stop();
        });
        var seconds = nowSec() - S.call.started;
        if (S.call.timer) clearInterval(S.call.timer);
        if (S.call.retry) clearInterval(S.call.retry);
        stopStats();
        addCallEvent("Call ended · " + formatClock(seconds));
        S.call = null;
        var overlay = document.getElementById("social-call");
        if (overlay) overlay.hidden = true;
        renderMain();
        return true;
      });
  }

  /* ---- link + media telemetry --------------------------------------------- */

  function netFor(device) {
    if (!S.net[device]) S.net[device] = { rtt: null, jitter: null, loss: 0, kbpsIn: null, res: "", fps: null, level: 0 };
    return S.net[device];
  }

  function ping() {
    if (!S.socket) return;
    S.link.seq += 1;
    S.link.sent[S.link.seq] = Date.now();
    try {
      S.socket.send(JSON.stringify({ t: "ping", n: S.link.seq }));
    } catch (e) {}
  }

  function startPing() {
    stopPing();
    S.link.rtt = null;
    ping();
    S.pinger = setInterval(ping, 2500);
  }

  function stopPing() {
    if (S.pinger) clearInterval(S.pinger);
    S.pinger = null;
  }

  /// The hub echoes our sequence number, so this is a true round trip — the number the
  /// user reads next to the call timer is the same path the frames take.
  function onPong(data) {
    var sent = S.link.sent[data.n];
    if (!sent) return;
    delete S.link.sent[data.n];
    var rtt = Date.now() - sent;
    S.link.rtt = S.link.rtt == null ? rtt : Math.round(S.link.rtt * 0.7 + rtt * 0.3);
    if (S.link.prev != null) S.link.jitter = Math.abs(rtt - S.link.prev);
    S.link.prev = rtt;
    paintNet();
  }

  function startStats() {
    stopStats();
    S.stats = setInterval(sampleStats, 1500);
    setTimeout(sampleStats, 400);
  }

  function stopStats() {
    if (S.stats) clearInterval(S.stats);
    S.stats = null;
  }

  function sampleStats() {
    if (!S.call) return;
    S.call.peers.forEach(function (entry) {
      if (!entry.pc || !entry.pc.getStats) return;
      var device = entry.device;
      entry.pc
        .getStats()
        .then(function (report) {
          var net = netFor(device);
          var now = Date.now();
          report.forEach(function (stat) {
            if (stat.type === "inbound-rtp") {
              if (stat.kind === "audio") {
                if (typeof stat.jitter === "number") net.jitter = Math.round(stat.jitter * 1000);
                if (typeof stat.audioLevel === "number") net.level = stat.audioLevel;
                if (typeof stat.packetsLost === "number") net.loss = stat.packetsLost;
              }
              if (stat.kind === "video") {
                if (stat.frameWidth) net.res = stat.frameWidth + "×" + stat.frameHeight;
                if (stat.framesPerSecond) net.fps = Math.round(stat.framesPerSecond);
              }
              if (typeof stat.bytesReceived === "number") {
                if (net.bytesAt != null && net.at && now > net.at) {
                  var kbps = ((stat.bytesReceived - net.bytesAt) * 8) / (now - net.at);
                  net.kbpsIn = Math.max(0, Math.round(kbps));
                }
                net.bytesAt = stat.bytesReceived;
                net.at = now;
              }
            } else if (stat.type === "candidate-pair" && stat.state === "succeeded") {
              if ((stat.selected || stat.nominated) && typeof stat.currentRoundTripTime === "number") {
                net.rtt = Math.round(stat.currentRoundTripTime * 1000);
              }
            }
          });
          paintNet();
        })
        .catch(function () {});
    });
  }

  function qualityOf(net) {
    if (!net) return "unknown";
    if (net.rtt != null && net.rtt > 250) return "poor";
    if (net.jitter != null && net.jitter > 60) return "poor";
    if (net.loss != null && net.loss > 8) return "poor";
    if (net.rtt != null && net.rtt > 120) return "fair";
    return "good";
  }

  /// Repaint only the numbers, never the whole call surface: a stats tick must not
  /// restart a video element or steal a click.
  function paintNet() {
    var link = document.getElementById("call-net");
    if (link) link.textContent = S.link.rtt == null ? "measuring…" : S.link.rtt + " ms";
    var strip = document.getElementById("social-rtt");
    if (strip) strip.textContent = S.link.rtt == null ? "" : S.link.rtt + " ms";
    var loudest = null;
    var level = 0.02;
    S.call &&
      S.call.peers.forEach(function (entry) {
        var net = S.net[entry.device];
        var chip = document.querySelector('.call-tile[data-tile="' + entry.device + '"] .net');
        if (chip) {
          var bits = [];
          if (net && net.rtt != null) bits.push(net.rtt + " ms");
          if (net && net.res) bits.push(net.res);
          if (net && net.kbpsIn) bits.push(net.kbpsIn + " kbps");
          if (net && qualityOf(net) === "poor") bits.push("weak");
          chip.textContent = bits.join(" · ");
          chip.setAttribute("data-quality", qualityOf(net));
        }
        var tile = document.querySelector('.call-tile[data-tile="' + entry.device + '"]');
        if (net && net.level > level) {
          level = net.level;
          loudest = entry.device;
        }
        if (tile) tile.classList.toggle("speaking", !!(net && net.level > 0.05 && S.call.active === entry.device));
      });
    if (S.call) {
      S.call.active = loudest;
      var grid = document.getElementById("call-grid");
      if (grid) grid.setAttribute("data-active", loudest || "");
    }
  }

  /* ---- outbox ------------------------------------------------------------- */

  function flushOutbox() {
    if (!S.socket || !S.outbox.length) return Promise.resolve(0);
    var queued = S.outbox.slice();
    S.outbox = [];
    return queued.reduce(function (chain, item) {
      return chain.then(function (count) {
        return frame(item.kind, item.payload, item.to).then(function (ok) {
          return count + (ok ? 1 : 0);
        });
      });
    }, Promise.resolve(0));
  }

  function renderCall() {
    var host = document.getElementById("social");
    if (!host) return;
    var overlay = document.getElementById("social-call");
    if (!S.call) {
      if (overlay) overlay.hidden = true;
      return;
    }
    if (!overlay) {
      overlay = el("div", "social-call");
      overlay.id = "social-call";
      host.appendChild(overlay);
    }
    overlay.hidden = false;
    overlay.classList.toggle("full", !!S.call.full);

    var tiles = [];
    var peers = S.call.peers.size;
    tiles.push(tileHtml("self", (S.identity && S.identity.name) || "You", S.call.local, S.call.camOn, "you"));
    S.call.peers.forEach(function (entry, device) {
      tiles.push(tileHtml(device, entry.name, entry.stream, entry.video, device));
    });

    overlay.innerHTML =
      '<div class="call-head">' +
      '<span class="call-title">' + (S.call.video ? "Video call" : "Voice call") +
      (S.active ? " · " + esc(S.active.name) : "") + "</span>" +
      '<span class="call-time" id="call-time">' + formatClock(nowSec() - S.call.started) + "</span>" +
      '<span class="call-net" id="call-net" title="Round trip to the room">' +
      (S.link.rtt == null ? "measuring…" : S.link.rtt + " ms") +
      "</span>" +
      '<span class="call-tier" title="Sending quality for this call size">' + esc(tier().name) + "</span>" +
      '<span class="spacer"></span>' +
      '<span class="call-count">' + (peers + 1) + " in the call</span>" +
      '<button class="call-btn ghost" id="call-full" title="' +
      (S.call.full ? "Back to the sidebar" : "Expand to full screen") +
      '" aria-label="Toggle full screen call">' +
      (S.call.full
        ? '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 20v-5h5"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 15v5h-5"/></svg>') +
      "</button>" +
      "</div>" +
      '<div class="call-grid' + (peers ? " has-peers" : " solo") +
      '" style="--call-cols:' + (peers <= 1 ? 1 : peers <= 4 ? 2 : 3) + '" id="call-grid">' + tiles.join("") +
      (peers ? "" : '<div class="call-wait" id="call-wait">Waiting for the others — share the room link and they appear here.</div>') +
      "</div>" +
      '<div class="call-bar">' +
      '<button class="call-btn' + (S.call.muted ? " off" : "") + '" id="call-mute" title="Microphone">' +
      (S.call.muted ? "Unmute" : "Mute") + "</button>" +
      '<button class="call-btn' + (S.call.video && !S.call.camOn ? " off" : "") + '" id="call-cam" title="Camera">' +
      (S.call.video && S.call.camOn ? "Camera off" : "Camera on") + "</button>" +
      '<button class="call-btn danger" id="call-end" title="Leave the call">Leave</button>' +
      '<span class="call-badge" id="call-badge">encrypted · mesh</span>' +
      "</div>";

    overlay.querySelectorAll("video[data-stream]").forEach(function (video) {
      var owner = video.getAttribute("data-stream");
      var stream = owner === "self" ? S.call.local : (S.call.peers.get(owner) || {}).stream;
      if (stream && video.srcObject !== stream) video.srcObject = stream;
    });

    document.getElementById("call-mute").addEventListener("click", toggleMute);
    document.getElementById("call-cam").addEventListener("click", toggleCamera);
    document.getElementById("call-full").addEventListener("click", function () {
      if (!S.call) return;
      S.call.full = !S.call.full;
      renderCall();
    });
    document.getElementById("call-end").addEventListener("click", function () {
      endCall();
    });
  }

  function tileHtml(id, name, stream, hasVideo, tag) {
    var net = S.net[id];
    return (
      '<div class="call-tile' + (hasVideo ? "" : " audioonly") + '" data-tile="' + esc(id) + '">' +
      '<video autoplay playsinline' + (tag === "you" ? " muted" : "") + ' data-stream="' + esc(id) + '"></video>' +
      '<div class="face">' + esc(initials(name)) + "</div>" +
      '<span class="tag">' + esc(name) + (tag === "you" ? " (you)" : "") + "</span>" +
      '<span class="net" data-quality="' + (net ? qualityOf(net) : "unknown") + '">' +
      (net && net.rtt != null ? net.rtt + " ms" : "") +
      "</span>" +
      "</div>"
    );
  }

  /* ---------------------------------------------------------------- 8. actions */

  var DEFAULT_HUB = "http://127.0.0.1:8787";

  /// A `fetch` that failed to reach anything looks like a TypeError with no status. That is
  /// the difference between "the server said no" and "there is no server", and the two need
  /// different words.
  function unreachable(err) {
    return !err || err.name === "TypeError" || /failed to fetch|network|load failed/i.test(String(err.message || ""));
  }

  function hubHint(hub, err) {
    var where = hub || DEFAULT_HUB;
    if (unreachable(err)) {
      return "No hub is answering at " + where + ". Press Create again and G9 will start one on this PC.";
    }
    return (err && err.message) || String(err);
  }

  /// Ask Rust to put a hub on this machine. Returns where it can be reached.
  function startLocalHub(port) {
    if (!TAURI) return Promise.reject(new Error("Starting a hub needs the desktop app"));
    return invoke("social_hub_start", { port: port || null }).then(function (info) {
      if (!info || !info.url) throw new Error("The hub did not report an address");
      S.localHub = info;
      return info;
    });
  }

  function createRoomAt(base) {
    return fetchJson(base.replace(/\/+$/, "").replace(/^ws/, "http") + "/v1/rooms", {
      method: "POST",
      body: JSON.stringify({ name: (S.identity && S.identity.name) + "'s room", seats: 9 }),
    });
  }

  function createRoom(hub) {
    if (!hub) hub = DEFAULT_HUB;
    var base = hub.replace(/\/+$/, "").replace(/^ws/, "http");
    return createRoomAt(base)
      .catch(function (err) {
        // Nothing on this machine answers: become the server instead of telling the user to
        // go and start one. This is what makes a fresh install work with one click.
        if (!unreachable(err)) throw err;
        setStatus("Starting a hub on this PC…", "busy");
        return startLocalHub().then(function (info) {
          S.hub = info.share_url || info.url;
          // The address inside the invite must be one other devices can reach, so the room
          // is created against the network address when there is one.
          return createRoomAt(info.share_url || info.url).then(function (room) {
            room.local = true;
            return room;
          });
        });
      })
      .then(function (room) {
        var chosen = S.hub || base;
        S.pendingRoom = {
          hub: chosen,
          id: room.room,
          token: room.token,
          name: room.name,
          seats: room.seats,
        };
        return makeInvite();
      })
      .then(function () {
        setStatus("Room ready — share the link", "on");
        return true;
      })
      .catch(function (err) {
        S.hub = hub;
        throw new Error(hubHint(hub, err));
      });
  }

  /// Ask the hub for an invite token, then have Rust sign the link and draw the QR.
  function makeInvite() {
    var pending = S.pendingRoom || (S.room && { hub: hubBase(), id: S.room.id, token: S.room.token, name: S.room.name, seats: S.room.seats });
    if (!pending) return Promise.reject(new Error("no room yet"));
    var base = pending.hub.replace(/\/+$/, "").replace(/^ws/, "http");
    return fetchJson(base + "/v1/rooms/" + pending.id + "/invites", {
      method: "POST",
      body: JSON.stringify({ token: pending.token, seats: pending.seats, ttl: 86400 }),
    })
      .then(function (invite) {
        return invoke("social_invite", {
          hub: pending.hub,
          room: pending.id,
          token: invite.invite,
          seats: pending.seats,
          kind: "room",
          name: pending.name,
          ttl: 86400,
        });
      })
      .then(function (made) {
        S.invite = made;
        S.pendingRoom = null;
        // Inviting people must never disturb the room we are already in — dropping the
        // socket here would end an active call for no reason.
        if (S.room && S.room.id === pending.id && S.room.key_b64 && S.socket) {
          renderMain();
          return true;
        }
        return enterRoom({
          id: pending.id,
          token: pending.token,
          hub: pending.hub,
          key_b64: made.key_b64,
          name: pending.name,
          seats: pending.seats,
          fingerprint: made.fingerprint,
        });
      });
  }

  function hubBase() {
    return (S.hub || "").replace(/\/+$/, "");
  }

  /// Open the socket for a room and become reachable.
  function enterRoom(room) {
    S.room = room;
    S.hub = room.hub;
    var thread = {
      id: room.id,
      name: room.name,
      kind: "room",
      hub: room.hub,
      seats: room.seats,
      unread: 0,
      last_at: nowSec(),
      created_at: nowSec(),
    };
    var existing = S.threads.filter(function (t) {
      return t.id === room.id;
    })[0];
    if (!existing) S.threads.unshift(thread);
    S.active = existing || thread;
    invoke("social_upsert_thread", { thread: S.active, keyB64: room.key_b64 }).catch(function () {});
    // The key comes in with the link; it is used for every frame in this room.
    return importKey(room.key_b64)
      .then(function (key) {
        S.plainKey = key;
        return loadMessages(S.active.id);
      })
      .then(function () {
        renderRail();
        renderMain();
        return connectSocket(room);
      });
  }

  /// A dropped socket is normal on a laptop that sleeps, a train, a hotel Wi-Fi. Come back
  /// on your own, with backoff, and keep everything that was typed meanwhile.
  function scheduleReconnect() {
    if (!S.room || S.leaving) return;
    if (S.reconnect.timer) clearTimeout(S.reconnect.timer);
    S.reconnect.tries += 1;
    if (S.reconnect.tries > 12) {
      setStatus("Offline — the stored conversation is still here", "busy");
      return;
    }
    var wait = Math.min(8000, Math.round(300 * Math.pow(1.55, S.reconnect.tries - 1)));
    setStatus("Reconnecting · attempt " + S.reconnect.tries, "busy");
    S.reconnect.timer = setTimeout(function () {
      S.reconnect.timer = null;
      reconnectNow();
    }, wait);
  }

  function reconnectNow() {
    var room = S.room;
    if (!room) return Promise.resolve(false);
    return connectSocket(room).catch(function () {
      scheduleReconnect();
      return false;
    });
  }

  function connectSocket(room) {
    var base = room.hub.replace(/\/+$/, "");
    var http = base.replace(/^ws/, "http");
    var wsBase = base.replace(/^http/, "ws");
    if (S.socket) {
      try {
        S.socket.close();
      } catch (e) {}
      S.socket = null;
    }
    return fetchJson(http + "/v1/nonce")
      .then(function (body) {
        var nonce = body.nonce;
        var ts = nowSec();
        return invoke("social_handshake", { room: room.id, nonce: nonce, ts: ts }).then(function (hand) {
          var url =
            wsBase +
            "/v1/ws?room=" +
            encodeURIComponent(room.id) +
            "&token=" +
            encodeURIComponent(room.token) +
            "&device=" +
            encodeURIComponent(hand.device) +
            "&public=" +
            encodeURIComponent(hand.public) +
            "&name=" +
            encodeURIComponent((S.identity && S.identity.name) || "Guest") +
            "&ts=" +
            ts +
            "&nonce=" +
            encodeURIComponent(nonce) +
            "&sig=" +
            encodeURIComponent(hand.sig);
          S.socket = transportFactory(url);
          S.socket.onmessage(onMessage);
          S.socket.onclose(function () {
            S.socket = null;
            stopPing();
            if (S.leaving) return;
            setStatus("Reconnecting…", "busy");
            renderRail();
            scheduleReconnect();
          });
          return true;
        });
      })
      .catch(function (e) {
        pushError("Connect", e);
        throw e;
      });
  }

  /// Reconnect a thread whose room was opened on a previous run: the hub may be gone.
  function reviveRoom(thread) {
    if (!thread || !thread.hub) return Promise.resolve(false);
    return connectSocket({
      id: thread.id,
      token: thread.token || "",
      hub: thread.hub,
    }).catch(function () {
      return false;
    });
  }

  function loadMessages(threadId) {
    return invoke("social_messages", { thread: threadId, limit: 200 })
      .then(function (list) {
        S.messages = (list || []).map(function (m) {
          m.mine = !!m.mine;
          return m;
        });
        if (S.active && S.active.id === threadId) paintMessages();
        return true;
      })
      .catch(function () {
        S.messages = [];
        return false;
      });
  }

  function selectThread(id) {
    var thread = S.threads.filter(function (t) {
      return t.id === id;
    })[0];
    if (!thread) return;
    S.unread[id] = 0;
    invoke("social_mark_read", { thread: id }).catch(function () {});
    if (S.room && S.room.id !== id) {
      // Leaving one room to open another: end the call with it, then keep the socket
      // only for the room we are in.
      if (S.call) endCall();
      if (S.socket) {
        try {
          S.socket.close();
        } catch (e) {}
        S.socket = null;
      }
      S.room = null;
    }
    S.active = thread;
    toggleRooms(false); // picking a room closes the drawer: it is a drawer, not a column
    renderRail();
    renderMain();
    loadMessages(id).then(function () {
      if (!S.room && thread.hub) {
        var key = thread.key_b64;
        if (key) {
          enterRoom({
            id: thread.id,
            token: thread.token || "",
            hub: thread.hub,
            key_b64: key,
            name: thread.name,
            seats: thread.seats,
            fingerprint: thread.fingerprint || "",
          });
        }
      }
    });
  }

  function joinLink(link) {
    if (!link) throw new Error("Paste the link first");
    return invoke("social_parse_invite", { link: link }).then(function (parsed) {
      if (!parsed || !parsed.ok) throw new Error((parsed && parsed.error) || "That link is not valid");
      S.hub = parsed.hub;
      S.invite = null;
      return enterRoom({
        id: parsed.room,
        token: parsed.token,
        hub: parsed.hub,
        key_b64: parsed.key_b64,
        name: parsed.name || "Room " + parsed.room,
        seats: parsed.seats,
        fingerprint: parsed.fingerprint,
      });
    });
  }

  function isOpen() {
    var host = document.getElementById("social");
    return !!host && !host.hidden;
  }

  /* ---------------------------------------------------------------- 9. wiring */

  function open() {
    var host = mount() || document.getElementById("social");
    if (!host) return false;
    host.hidden = false;
    setStatus(S.socket ? "Connected" : "Not connected", S.socket ? "on" : "");
    renderRail();
    renderMain();
    if (S.active) invoke("social_mark_read", { thread: S.active.id }).catch(function () {});
    return true;
  }

  function close() {
    // Closing the workspace closes what is in it: leaving a call running with no visible
    // controls would keep the camera on with nothing on screen to stop it.
    if (S.call) endCall();
    if (S.invite) S.invite = null;
    var host = document.getElementById("social");
    if (host) host.hidden = true;
    return true;
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function boot() {
    var host = document.getElementById("social");
    if (!host) return;
    try {
      var saved = localStorage.getItem("g9.social.ice");
      if (saved) S.iceServers = JSON.parse(saved);
    } catch (e) {}
    mount();
    invoke("social_identity")
      .then(function (identity) {
        S.identity = identity || { id: "g9:unknown", name: "Guest", public: "" };
        return invoke("social_threads");
      })
      .then(function (threads) {
        S.threads = threads || [];
        return invoke("social_contacts");
      })
      .then(function (contacts) {
        S.contacts = contacts || [];
        renderRail();
        renderMain();
      })
      .catch(function (e) {
        pushError("Social", e);
      });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && isOpen()) {
        if (S.call) endCall();
        else close();
      }
      if (ev.key === "Escape" && S.invite) {
        S.invite = null;
        renderMain();
      }
    });
    var filter = document.getElementById("social-filter");
    if (filter)
      filter.addEventListener("input", function () {
        S.filter = filter.value;
        renderRail();
      });
  }

  /// Listeners for the parts of the panel that never change: close, the room drawer,
  /// the filter box and the resize grip.
  function wireShell() {
    var closeBtn = document.getElementById("social-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    var roomsBtn = document.getElementById("social-rooms");
    if (roomsBtn) {
      roomsBtn.addEventListener("click", function () {
        toggleRooms();
      });
    }
    var filter = document.getElementById("social-filter");
    if (filter)
      filter.addEventListener("input", function () {
        S.filter = filter.value;
        renderRail();
      });
    wireGrip();
    try {
      var saved = parseFloat(localStorage.getItem("g9.social.width"));
      if (saved >= 300 && saved <= 720) setWidth(saved);
    } catch (e) {}
  }

  /// The room list is a drawer inside the panel, not a second column: this is a sidebar.
  function toggleRooms(force) {
    var rail = document.getElementById("social-rail");
    var button = document.getElementById("social-rooms");
    if (!rail) return false;
    var open = typeof force === "boolean" ? force : rail.hidden;
    rail.hidden = !open;
    if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderRail();
      var filter = document.getElementById("social-filter");
      if (filter) filter.focus();
    }
    return open;
  }

  function setWidth(px) {
    var host = document.getElementById("social");
    if (!host) return;
    host.style.width = Math.round(px) + "px";
    document.documentElement.style.setProperty("--social-w", Math.round(px) + "px");
  }

  function wireGrip() {
    var grip = document.getElementById("social-grip");
    if (!grip) return;
    grip.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      var host = document.getElementById("social");
      if (!host) return;
      var startX = ev.clientX;
      var startW = host.getBoundingClientRect().width;
      var move = function (e) {
        var width = Math.min(720, Math.max(300, startW + (startX - e.clientX)));
        setWidth(width);
      };
      var up = function () {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        try {
          localStorage.setItem("g9.social.width", String(Math.round(host.getBoundingClientRect().width)));
        } catch (e) {}
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  window.G9Social = {
    open: open,
    close: close,
    toggle: toggle,
    boot: boot,
    state: S,
    // actions, also used by tests
    createRoom: createRoom,
    joinLink: joinLink,
    makeInvite: makeInvite,
    sendChat: sendChat,
    startCall: startCall,
    endCall: endCall,
    toggleMute: toggleMute,
    toggleCamera: toggleCamera,
    reconnect: reconnectNow,
    /// Point the calls at your own STUN/TURN pair. Anything reachable works; the default
    /// is a public STUN service, which is enough for two home networks. Saved locally, so
    /// a TURN server you add for a locked-down office survives a restart.
    setIceServers: function (list) {
      S.iceServers = Array.isArray(list) && list.length ? list : null;
      try {
        if (S.iceServers) localStorage.setItem("g9.social.ice", JSON.stringify(S.iceServers));
        else localStorage.removeItem("g9.social.ice");
      } catch (e) {}
      return S.iceServers;
    },
    selectThread: selectThread,
    sendFromComposer: sendFromComposer,
    _internal: {
      frameAad: frameAad,
      seal: sealFrame,
      open: openFrame,
      onMessage: onMessage,
      handlePayload: handlePayload,
      enterRoom: enterRoom,
      connectSocket: connectSocket,
      render: function () {
        renderRail();
        renderMain();
      },
      setIdentity: function (identity) {
        S.identity = identity;
      },
      setTransport: function (factory) {
        transportFactory = factory;
      },
      setHub: function (hub) {
        S.hub = hub;
      },
      setPeers: function (peers) {
        S.peers = peers;
      },
      setPlainKey: function (key) {
        S.plainKey = key;
      },
      importKey: importKey,
      importRoomKey: function (b64) {
        return importKey(b64).then(function (key) {
          S.plainKey = key;
          return key;
        });
      },
      fetchJson: fetchJson,
      frame: frame,
      tier: tier,
      tuneSdp: tuneSdp,
      applyLimits: applyLimits,
      rtcConfig: rtcConfig,
      netFor: netFor,
      paintNet: paintNet,
      onPong: onPong,
      onCallEvent: onCallEvent,
      sampleStats: sampleStats,
      startStats: startStats,
      stopStats: stopStats,
      scheduleReconnect: scheduleReconnect,
      flushOutbox: flushOutbox,
      announceCall: announceCall,
      watchConnection: watchConnection,
      qualityOf: qualityOf,
      startPing: startPing,
      stopPing: stopPing,
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
