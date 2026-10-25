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
    var raw = b64dec(sealed);
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
    host.innerHTML =
      '<div class="social-top">' +
      '<span class="social-dot" id="social-dot"></span>' +
      "<b>G9 Social</b>" +
      '<span class="social-status" id="social-status">Not connected</span>' +
      '<span class="spacer"></span>' +
      '<button class="top-btn" id="social-close" title="Close (Esc)">Close</button>' +
      "</div>" +
      '<div class="social-body">' +
      '<aside class="social-rail" id="social-rail">' +
      '<div class="social-search">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="social-filter" placeholder="Search rooms and people" />' +
      "</div>" +
      '<div class="social-list" id="social-list"></div>' +
      '<div class="social-rail-foot" id="social-foot"></div>' +
      "</aside>" +
      '<main class="social-main" id="social-main"></main>' +
      "</div>";
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
      '<div class="social-compose">' +
      '<textarea id="social-input" rows="1" placeholder="Message ' +
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
      esc(S.hub || "http://127.0.0.1:8787") +
      '" placeholder="http://127.0.0.1:8787" />' +
      '<div class="row"><button class="top-btn" id="social-create">Create a room</button></div>' +
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

    if (!S.socket) {
      setStatus("Offline — the message is saved and will send when the room connects", "busy");
      return Promise.resolve(false);
    }
    return frame("chat", { type: "chat", id: message.id, text: text, ts: message.ts }).then(function (ok) {
      if (!ok) {
        message.state = "failed";
        paintMessages();
        invoke("social_set_state", { id: message.id, newState: "failed" }).catch(function () {});
      }
      return ok;
    });
  }

  /// Encrypt a payload and hand it to the hub. Resolves false when there is no socket.
  function frame(kind, payload, to) {
    if (!S.socket || !S.plainKey) return Promise.resolve(false);
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
    if (data.t === "ready") {
      S.peers = {};
      (data.peers || []).forEach(function (p) {
        S.peers[p.device] = { name: p.name, video: false };
      });
      S.joined = true;
      setStatus("Connected · " + hereCount() + " here", "on");
      renderRail();
      renderMain();
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
      answerOffer(envelope.from, payload).catch(function (e) {
        pushError("Answer", e);
      });
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

  function rtcConfig() {
    return {
      iceServers: S.iceServers || [],
      bundlePolicy: "max-bundle",
    };
  }

  function startCall(withVideo) {
    if (S.call) {
      if (withVideo && !S.call.video) return enableVideo();
      return Promise.resolve(false);
    }
    var media = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    if (withVideo) media.video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    return navigator.mediaDevices
      .getUserMedia(media)
      .then(function (stream) {
        S.call = {
          video: !!withVideo,
          local: stream,
          peers: new Map(),
          members: new Set(),
          started: nowSec(),
          muted: false,
          camOn: !!withVideo,
        };
        S.call.timer = setInterval(function () {
          var clock = document.getElementById("call-time");
          if (!S.call) return;
          if (clock) clock.textContent = formatClock(nowSec() - S.call.started);
        }, 1000);
        renderCall();
        addCallEvent((withVideo ? "Video" : "Voice") + " call started");
        // Announce, then wait to hear who is already in the call. Only people who answer
        // get a connection, so joining a call never dials the eight people still typing.
        var pending = S.callPending;
        S.callPending = {};
        return frame("call-join", { type: "call-join", video: !!withVideo }).then(function () {
          Object.keys(pending).forEach(function (device) {
            joinedCall(device, pending[device]);
          });
          // Whoever was not listening yet gets another chance: re-announce a few times
          // and re-offer to anyone we are supposed to dial, until the mesh is up.
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
      })
      .catch(function (e) {
        pushError(withVideo ? "Camera" : "Microphone", e);
        return false;
      });
  }

  function enableVideo() {
    return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } }).then(function (stream) {
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
    var entry = { pc: pc, device: device, name: name || (S.peers[device] && S.peers[device].name) || "Guest", stream: null, video: false };
    S.call.local.getTracks().forEach(function (track) {
      pc.addTrack(track, S.call.local);
    });
    pc.onicecandidate = function (ev) {
      if (ev.candidate) frame("call-ice", { type: "call-ice", candidate: ev.candidate.toJSON() }, device);
    };
    pc.ontrack = function (ev) {
      entry.stream = ev.streams[0];
      entry.video = ev.track.kind === "video";
      renderCall();
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        addCallEvent(entry.name + " dropped");
      }
    };
    S.call.peers.set(device, entry);
    renderCall();
    return entry;
  }

  /// Record a device as being in this call, greet it, and start negotiating if it is our turn.
  function joinedCall(device, payload) {
    if (!S.call || !device) return;
    var first = !S.call.members.has(device);
    S.call.members.add(device);
    if (first && !payload.ack) addCallEvent((payload.name || "Someone") + " joined the call");
    S.peers[device] = S.peers[device] || { name: payload.name };
    S.peers[device].video = !!payload.video;
    // Tell a newcomer we are here, so it knows who to expect.
    if (first && !payload.ack) {
      frame("call-join", { type: "call-join", video: S.call.video, ack: true }, device);
    }
    maybeOffer(device);
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

  function makeOffer(device) {
    var entry = peerFor(device);
    if (!entry || entry.offering) return Promise.resolve(false);
    entry.offering = true;
    return entry.pc
      .createOffer()
      .then(function (offer) {
        return entry.pc.setLocalDescription(offer).then(function () {
          entry.local = offer.sdp;
          entry.offering = false;
          return frame("call-offer", { type: "call-offer", sdp: offer.sdp }, device);
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
        return entry.pc.setLocalDescription(answer).then(function () {
          return frame("call-answer", { type: "call-answer", sdp: answer.sdp }, device);
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
        addCallEvent("Call ended · " + formatClock(seconds));
        S.call = null;
        var overlay = document.getElementById("social-call");
        if (overlay) overlay.hidden = true;
        renderMain();
        return true;
      });
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
      '<span class="spacer"></span>' +
      '<span class="call-count">' + (peers + 1) + " in the call</span>" +
      "</div>" +
      '<div class="call-grid' + (peers ? " has-peers" : " solo") + '" id="call-grid">' + tiles.join("") +
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
    document.getElementById("call-end").addEventListener("click", function () {
      endCall();
    });
  }

  function tileHtml(id, name, stream, hasVideo, tag) {
    return (
      '<div class="call-tile' + (hasVideo ? "" : " audioonly") + '" data-tile="' + esc(id) + '">' +
      '<video autoplay playsinline muted data-stream="' + esc(id) + '"></video>' +
      '<div class="face">' + esc(initials(name)) + "</div>" +
      '<span class="tag">' + esc(name) + (tag === "you" ? " (you)" : "") + "</span>" +
      "</div>"
    );
  }

  /* ---------------------------------------------------------------- 8. actions */

  function createRoom(hub) {
    if (!hub) throw new Error("A hub address is needed — run g9-hub and use http://127.0.0.1:8787");
    var base = hub.replace(/\/+$/, "").replace(/^ws/, "http");
    return fetchJson(base + "/v1/rooms", {
      method: "POST",
      body: JSON.stringify({ name: (S.identity && S.identity.name) + "'s room", seats: 9 }),
    })
      .then(function (room) {
        S.pendingRoom = { hub: hub, id: room.room, token: room.token, name: room.name, seats: room.seats };
        return makeInvite();
      })
      .then(function () {
        setStatus("Room ready — share the link", "on");
        return true;
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
            setStatus("Disconnected — press Reconnect", "busy");
            renderRail();
          });
          return true;
        });
      })
      .catch(function (e) {
        pushError("Connect", e);
        throw e;
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
      // Leaving one room to open another: keep the socket only for the room we are in.
      if (S.socket) {
        try {
          S.socket.close();
        } catch (e) {}
        S.socket = null;
      }
      S.room = null;
    }
    S.active = thread;
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
    var closeBtn = document.getElementById("social-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
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
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
