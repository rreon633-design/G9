/* G9 appearance engine — themes, type, shape, accent, profile, widgets and the
   notification centre. Everything here is local: the settings live in
   localStorage, the avatar never leaves the machine, and the only thing this
   file writes to the DOM is attributes and CSS variables that ui/styles.css
   already defines. No framework, no build step. */
(function () {
  "use strict";

  var KEY = "g9-appearance";
  var NKEY = "g9-notifications";
  var MAX_NOTIFS = 60;

  var DEFAULTS = {
    theme: "dark",            // dark | light | auto
    accent: "#4c9dff",
    radius: 10,
    density: "cozy",          // compact | cozy | spacious
    scale: 1,                 // 0.9 … 1.15
    font: "geist",            // geist | segoe | serif | mono
    motion: true,
    glass: true,
    icons: "regular",         // light | regular | bold
    widgets: { clock: true, now: true, library: true },
    notifications: { toasts: true, centre: true, downloads: true, playback: true, sources: true },
    name: "Guest",
    avatar: ""
  };

  var ACCENTS = [
    ["#4c9dff", "Blue"],
    ["#8b5cf6", "Violet"],
    ["#22c8a8", "Mint"],
    ["#3ddc97", "Green"],
    ["#ffb454", "Amber"],
    ["#ff6b6b", "Coral"],
    ["#f472b6", "Rose"],
    ["#94a3b8", "Slate"]
  ];

  var FONTS = [
    ["geist", "Geist", "The default"],
    ["segoe", "Segoe UI", "Windows native"],
    ["serif", "Georgia", "Editorial"],
    ["mono", "JetBrains Mono", "Technical"]
  ];

  var cat = { appearance: null, notifs: [], cur: null };

  /* ---------------- storage ---------------- */

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function merge(base, patch) {
    var out = clone(base);
    if (!patch || typeof patch !== "object") return out;
    Object.keys(patch).forEach(function (k) {
      if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && out[k]) {
        out[k] = merge(out[k], patch[k]);
      } else if (patch[k] !== undefined) {
        out[k] = patch[k];
      }
    });
    return out;
  }

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      raw = null;
    }
    var saved = null;
    try {
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) {
      saved = null;
    }
    cat.cur = merge(DEFAULTS, saved);
    return cat.cur;
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cat.cur));
    } catch (e) {}
  }

  /* ---------------- colour helpers ---------------- */

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [76, 157, 255];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map(function (n) {
          var v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
          return v.length === 1 ? "0" + v : v;
        })
        .join("")
    );
  }

  /// Black or white, whichever reads better on a fill of this colour.
  function inkOn(rgb) {
    var lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return lum > 0.62 ? "#0a1017" : "#ffffff";
  }

  /* ---------------- applying a look ---------------- */

  function resolvedTheme() {
    if (cat.cur.theme !== "auto") return cat.cur.theme;
    var mq =
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
    return mq && mq.matches ? "light" : "dark";
  }

  /// Attributes and custom properties only — safe to call from <head>, before
  /// the first paint, so a light theme never flashes dark on start-up.
  function applyVars() {
    var a = cat.cur;
    var root = document.documentElement;
    if (!root) return a;
    var rgb = hexToRgb(a.accent);
    root.setAttribute("data-theme", resolvedTheme());
    root.setAttribute("data-font", a.font);
    root.setAttribute("data-density", a.density);
    root.setAttribute("data-icons", a.icons);
    root.setAttribute("data-motion", a.motion ? "on" : "off");
    root.setAttribute("data-glass", a.glass ? "on" : "off");
    root.style.setProperty("--accent-rgb", rgb[0] + ", " + rgb[1] + ", " + rgb[2]);
    root.style.setProperty("--accent", "rgb(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ")");
    root.style.setProperty("--accent-soft", "rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", 0.14)");
    root.style.setProperty("--accent-ink", inkOn(rgb));
    var r = Math.max(0, Math.min(24, Number(a.radius) || 0));
    root.style.setProperty("--radius", r + "px");
    root.style.setProperty("--radius-sm", Math.max(0, r - 3) + "px");
    root.style.setProperty("--radius-lg", r + 4 + "px");
    root.style.setProperty("--scale", String(Math.max(0.85, Math.min(1.25, Number(a.scale) || 1))));
    return a;
  }

  /// Everything that needs a DOM: profile chips, widgets, the app's listeners.
  function apply() {
    var a = applyVars();
    if (!document.body) return a;
    paintProfile();
    paintWidgets();
    try {
      window.dispatchEvent(new CustomEvent("g9:appearance", { detail: a }));
    } catch (e) {}
    return a;
  }

  function set(patch, opts) {
    cat.cur = merge(cat.cur, patch || {});
    save();
    if (!opts || opts.paint !== false) apply();
    return cat.cur;
  }

  function reset() {
    cat.cur = clone(DEFAULTS);
    save();
    apply();
    buildBody();
    return cat.cur;
  }

  /* ---------------- profile ---------------- */

  function initials(name) {
    var parts = String(name || "G").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "G";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function paintProfile() {
    var name = cat.cur.name || "Guest";
    var img = cat.cur.avatar;
    ["initials", "pop-initials"].forEach(function (id) {
      var el = document.getElementById("avatar-" + id) || document.getElementById(id);
      if (el) el.textContent = initials(name);
    });
    ["avatar-img", "pop-img"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (img) {
        el.src = img;
        el.hidden = false;
      } else {
        el.removeAttribute("src");
        el.hidden = true;
      }
    });
    var nm = document.getElementById("pop-name");
    if (nm) nm.textContent = name;
    // Fun Mode's avatar is the same person: initial, or the picture.
    var fun = document.getElementById("fun-profile");
    if (fun) {
      if (img) {
        fun.textContent = "";
        fun.style.backgroundImage = "url(\"" + img + "\")";
        fun.style.backgroundSize = "cover";
        fun.style.backgroundPosition = "center";
      } else {
        fun.textContent = initials(name);
        fun.style.backgroundImage = "";
      }
    }
  }

  /* ---------------- notifications ---------------- */

  function loadNotifs() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(NKEY);
    } catch (e) {
      raw = null;
    }
    var list = null;
    try {
      list = raw ? JSON.parse(raw) : null;
    } catch (e) {
      list = null;
    }
    cat.notifs = Array.isArray(list) ? list.slice(0, MAX_NOTIFS) : [];
    return cat.notifs;
  }

  function saveNotifs() {
    try {
      window.localStorage.setItem(NKEY, JSON.stringify(cat.notifs.slice(0, MAX_NOTIFS)));
    } catch (e) {}
  }

  function unread() {
    return cat.notifs.filter(function (n) {
      return !n.read;
    }).length;
  }

  function categoryOf(text) {
    var t = String(text || "").toLowerCase();
    if (/error|failed|unavailable|cannot|could not|refused|no space/.test(t)) return "error";
    if (/download|saved|finished|queued|paused/.test(t)) return "download";
    if (/shader|picture|gpu|stream|reconnect|subtitle/.test(t)) return "playback";
    return "info";
  }

  var CAT_ICON = {
    error: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    playback: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>'
  };

  function allowed(c) {
    var n = cat.cur.notifications || {};
    if (!n.centre) return false;
    if (c === "download" && !n.downloads) return false;
    if (c === "playback" && !n.playback) return false;
    if (c === "error" && !n.sources) return false;
    return true;
  }

  /// Add one entry. Called by the app's toast() and by anything that wants a
  /// lasting record of something the player said.
  function push(entry) {
    var e = entry || {};
    var text = String(e.title == null ? "" : e.title).trim();
    if (!text) return null;
    var category = e.cat || categoryOf(text);
    var item = {
      id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: text,
      body: e.body ? String(e.body) : "",
      cat: category,
      at: Date.now(),
      read: false
    };
    if (allowed(category)) {
      cat.notifs.unshift(item);
      cat.notifs = cat.notifs.slice(0, MAX_NOTIFS);
      saveNotifs();
      paintNotifs();
    }
    return item;
  }

  /// Hook for the player's toast(): returns false when toasts are switched off,
  /// so the caller can skip painting one.
  function capture(text) {
    var t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return true;
    if (t.length > 96) t = t.slice(0, 94).replace(/[,;:.]$/, "") + "…";
    push({ title: t });
    return cat.cur.notifications.toasts !== false;
  }

  function timeAgo(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "now";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    var d = new Date(ms);
    return d.getDate() + "/" + (d.getMonth() + 1);
  }

  function paintNotifs() {
    var badge = document.getElementById("notif-badge");
    var n = unread();
    if (badge) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.hidden = n === 0;
    }
    var list = document.getElementById("notif-list");
    if (!list) return;
    if (!cat.notifs.length) {
      list.innerHTML =
        '<div class="notif-empty">Nothing yet.<br>Downloads, stream reconnects and errors show up here.</div>';
      return;
    }
    list.innerHTML = cat.notifs
      .map(function (it) {
        return (
          '<div class="notif-item ' +
          (it.read ? "" : "unread") +
          '" data-cat="' +
          it.cat +
          '" data-notif="' +
          it.id +
          '"><div class="n-ico">' +
          (CAT_ICON[it.cat] || CAT_ICON.info) +
          '</div><div class="n-txt"><b>' +
          esc(it.title) +
          "</b>" +
          (it.body ? "<span>" + esc(it.body) + "</span>" : "") +
          '</div><div class="n-time">' +
          timeAgo(it.at) +
          "</div></div>"
        );
      })
      .join("");
  }

  function readAll() {
    cat.notifs.forEach(function (n) {
      n.read = true;
    });
    saveNotifs();
    paintNotifs();
  }

  function clearAll() {
    cat.notifs = [];
    saveNotifs();
    paintNotifs();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------- panels ---------------- */

  function panel(id) {
    return document.getElementById(id);
  }

  function closePanels() {
    [["notif-panel", "notif-btn"], ["profile-pop", "profile-btn"]].forEach(function (pair) {
      var el = panel(pair[0]);
      var btn = panel(pair[1]);
      if (el) el.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function togglePanel(id, btnId) {
    var el = panel(id);
    var btn = panel(btnId);
    if (!el) return;
    var open = el.hidden;
    closePanels();
    el.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && id === "notif-panel") {
      paintNotifs();
      // Opening the centre is the point at which they have been seen.
      window.setTimeout(readAll, 900);
    }
  }

  /* ---------------- appearance sheet ---------------- */

  function themeCard(pick, name, sub) {
    return (
      '<button type="button" class="theme-card" data-theme-pick="' +
      pick +
      '" aria-pressed="' +
      (cat.cur.theme === pick ? "true" : "false") +
      '"><span class="tc-shot"></span><span class="tc-name">' +
      name +
      '</span><span class="tc-sub">' +
      sub +
      "</span></button>"
    );
  }

  function seg(name, items, current) {
    return (
      '<div class="seg" role="group" data-seg="' +
      name +
      '">' +
      items
        .map(function (it) {
          return (
            '<button type="button" data-val="' +
            it[0] +
            '" aria-pressed="' +
            (String(current) === String(it[0]) ? "true" : "false") +
            '">' +
            it[1] +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function switchRow(key, label, hint, on) {
    return (
      '<div class="appear-row"><div class="txt"><b>' +
      label +
      "</b><span>" +
      hint +
      '</span></div><label class="switch-row"><input type="checkbox" data-toggle="' +
      key +
      '"' +
      (on ? " checked" : "") +
      " /><span></span></label></div>"
    );
  }

  function buildBody() {
    var body = document.getElementById("appear-body");
    if (!body) return;
    var a = cat.cur;
    var html = "";

    html +=
      '<section class="ap-sec"><p class="ap-k">Theme</p><div class="theme-grid">' +
      themeCard("dark", "Dark", "Cinema default") +
      themeCard("light", "Light", "Daylight") +
      themeCard("auto", "Auto", "Follows Windows") +
      "</div></section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Accent</p><div class="swatches">' +
      ACCENTS.map(function (c) {
        return (
          '<button type="button" class="swatch" data-accent="' +
          c[0] +
          '" title="' +
          c[1] +
          '" aria-label="' +
          c[1] +
          '" aria-pressed="' +
          (a.accent.toLowerCase() === c[0] ? "true" : "false") +
          '" style="background:' +
          c[0] +
          '"></button>'
        );
      }).join("") +
      '<input type="color" class="swatch-custom" id="accent-custom" value="' +
      a.accent +
      '" title="Pick a colour" aria-label="Custom accent colour" />' +
      '</div><p class="ap-note">The accent colours buttons, the seek bar, the notification dot and every selection.</p></section>';

    html +=
      '<section class="ap-sec"><p class="ap-k">Profile</p>' +
      '<div class="appear-row"><div class="txt"><b>Name</b><span>Shown next to your avatar</span></div>' +
      '<input type="text" id="ap-name" maxlength="28" value="' +
      esc(a.name) +
      '" aria-label="Profile name" /></div>' +
      '<div class="appear-row"><div class="txt"><b>Avatar</b><span>' +
      (a.avatar ? "Custom picture" : "Initials from your name") +
      "</span></div><div style=\"display:flex;gap:8px;align-items:center\">" +
      '<span class="avatar av-lg" id="ap-avatar"><span>' +
      esc(initials(a.name)) +
      "</span>" +
      (a.avatar ? '<img src="' + esc(a.avatar) + '" alt="" />' : "") +
      "</span>" +
      '<button type="button" class="ghost" id="ap-avatar-pick">Upload</button>' +
      (a.avatar ? '<button type="button" class="ghost" id="ap-avatar-clear">Clear</button>' : "") +
      '<input type="file" id="ap-avatar-file" accept="image/*" hidden />' +
      "</div></div></section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Shape &amp; density</p>' +
      '<div class="appear-row"><div class="txt"><b>Corners</b><span>How round panels and buttons are</span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex:0 0 210px"><input type="range" id="ap-radius" min="0" max="20" step="1" value="' +
      a.radius +
      '" aria-label="Corner radius" /><output id="ap-radius-out">' +
      a.radius +
      "px</output></div></div>" +
      '<div class="appear-row"><div class="txt"><b>Density</b><span>Spacing in menus and sheets</span></div>' +
      seg(
        "density",
        [
          ["compact", "Compact"],
          ["cozy", "Cozy"],
          ["spacious", "Roomy"]
        ],
        a.density
      ) +
      "</div>" +
      '<div class="appear-row"><div class="txt"><b>Text size</b><span>Menus, sheets and widgets — never the picture</span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex:0 0 210px"><input type="range" id="ap-scale" min="0.9" max="1.15" step="0.05" value="' +
      a.scale +
      '" aria-label="Text size" /><output id="ap-scale-out">' +
      Math.round(a.scale * 100) +
      "%</output></div></div></section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Type</p>' +
      '<div class="appear-row" style="padding-top:0"><div class="txt"><b>Interface font</b><span>Subtitles keep their own style</span></div>' +
      seg(
        "font",
        FONTS.map(function (f) {
          return [f[0], f[1]];
        }),
        a.font
      ) +
      "</div></section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Feel</p>' +
      switchRow("motion", "Animation", "Panel and menu transitions", a.motion) +
      switchRow("glass", "Translucency", "Blur behind menus and panels", a.glass) +
      '<div class="appear-row"><div class="txt"><b>Icon weight</b><span>Line weight of every icon</span></div>' +
      seg(
        "icons",
        [
          ["light", "Light"],
          ["regular", "Regular"],
          ["bold", "Bold"]
        ],
        a.icons
      ) +
      "</div></section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Start-screen widgets</p>' +
      switchRow("widgets.clock", "Clock", "Time and date", a.widgets.clock) +
      switchRow("widgets.now", "Continue watching", "What is playing, with progress", a.widgets.now) +
      switchRow("widgets.library", "Library", "Titles played and channels", a.widgets.library) +
      "</section>";

    html +=
      '<section class="ap-sec"><p class="ap-k">Notifications</p>' +
      switchRow("notifications.toasts", "Toast messages", "The short line that appears over the picture", a.notifications.toasts) +
      switchRow("notifications.centre", "Keep a history", "Everything shown in the bell menu", a.notifications.centre) +
      switchRow("notifications.downloads", "Downloads", "Queued, finished, failed", a.notifications.downloads) +
      switchRow("notifications.playback", "Playback", "Reconnects, picture modes, subtitles", a.notifications.playback) +
      switchRow("notifications.sources", "Errors", "Anything that went wrong", a.notifications.sources) +
      '<div class="appear-row"><div class="txt"><b>History</b><span id="ap-notif-count">' +
      cat.notifs.length +
      " saved</span></div>" +
      '<div style="display:flex;gap:8px"><button type="button" class="ghost" id="ap-notif-read">Mark read</button>' +
      '<button type="button" class="ghost" id="ap-notif-clear">Clear</button></div></div></section>';

    body.innerHTML = html;
    bindBody();
  }

  function bindBody() {
    var body = document.getElementById("appear-body");
    if (!body) return;

    body.querySelectorAll("[data-theme-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        set({ theme: b.getAttribute("data-theme-pick") });
        paintThemeButtons();
      });
    });

    body.querySelectorAll("[data-accent]").forEach(function (b) {
      b.addEventListener("click", function () {
        set({ accent: b.getAttribute("data-accent") });
        paintAccents();
      });
    });

    var custom = document.getElementById("accent-custom");
    if (custom)
      custom.addEventListener("input", function () {
        set({ accent: custom.value });
        paintAccents();
      });

    var name = document.getElementById("ap-name");
    if (name)
      name.addEventListener("input", function () {
        set({ name: name.value || "Guest" }, { paint: false });
        paintProfile();
        var av = document.getElementById("ap-avatar");
        if (av) av.querySelector("span").textContent = initials(name.value);
      });

    var pick = document.getElementById("ap-avatar-pick");
    var file = document.getElementById("ap-avatar-file");
    if (pick && file) {
      pick.addEventListener("click", function () {
        file.click();
      });
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 900 * 1024) {
          push({ title: "That image is too large", body: "Pick one under 900 KB", cat: "error" });
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          set({ avatar: String(reader.result || "") });
          buildBody();
        };
        reader.readAsDataURL(f);
      });
    }
    var clearAv = document.getElementById("ap-avatar-clear");
    if (clearAv)
      clearAv.addEventListener("click", function () {
        set({ avatar: "" });
        buildBody();
      });

    var radius = document.getElementById("ap-radius");
    if (radius)
      radius.addEventListener("input", function () {
        var out = document.getElementById("ap-radius-out");
        if (out) out.textContent = radius.value + "px";
        set({ radius: Number(radius.value) });
      });

    var scale = document.getElementById("ap-scale");
    if (scale)
      scale.addEventListener("input", function () {
        var out = document.getElementById("ap-scale-out");
        if (out) out.textContent = Math.round(Number(scale.value) * 100) + "%";
        set({ scale: Number(scale.value) });
      });

    body.querySelectorAll("[data-seg]").forEach(function (group) {
      var key = group.getAttribute("data-seg");
      group.querySelectorAll("[data-val]").forEach(function (b) {
        b.addEventListener("click", function () {
          var val = b.getAttribute("data-val");
          var patch = {};
          patch[key] = key === "icons" || key === "font" || key === "density" ? val : Number(val);
          set(patch);
          group.querySelectorAll("[data-val]").forEach(function (o) {
            o.setAttribute("aria-pressed", o === b ? "true" : "false");
          });
          if (key === "font") buildBody();
        });
      });
    });

    body.querySelectorAll("[data-toggle]").forEach(function (input) {
      input.addEventListener("change", function () {
        var path = input.getAttribute("data-toggle").split(".");
        var patch = {};
        var cur = patch;
        for (var i = 0; i < path.length - 1; i++) {
          cur[path[i]] = {};
          cur = cur[path[i]];
        }
        cur[path[path.length - 1]] = input.checked;
        set(patch);
        paintWidgets();
        paintNotifs();
        var count = document.getElementById("ap-notif-count");
        if (count) count.textContent = cat.notifs.length + " saved";
      });
    });

    var nr = document.getElementById("ap-notif-read");
    if (nr)
      nr.addEventListener("click", function () {
        readAll();
      });
    var nc = document.getElementById("ap-notif-clear");
    if (nc)
      nc.addEventListener("click", function () {
        clearAll();
        var count = document.getElementById("ap-notif-count");
        if (count) count.textContent = "0 saved";
      });
  }

  function paintThemeButtons() {
    document.querySelectorAll("[data-theme-pick]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-theme-pick") === cat.cur.theme ? "true" : "false");
    });
  }

  function paintAccents() {
    document.querySelectorAll("[data-accent]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-accent") === cat.cur.accent.toLowerCase() ? "true" : "false");
    });
    var custom = document.getElementById("accent-custom");
    if (custom && custom.value !== cat.cur.accent) custom.value = cat.cur.accent;
  }

  function openAppearance() {
    closePanels();
    buildBody();
    var modal = document.getElementById("appearance-modal");
    if (modal) modal.hidden = false;
    paintThemeButtons();
  }

  function closeAppearance() {
    var modal = document.getElementById("appearance-modal");
    if (modal) modal.hidden = true;
  }

  /* ---------------- start-screen widgets ---------------- */

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function paintWidgets() {
    var box = document.getElementById("start-widgets");
    if (!box) return;
    var w = cat.cur.widgets || {};
    var any = false;
    box.querySelectorAll("[data-widget]").forEach(function (el) {
      var on = w[el.getAttribute("data-widget")] !== false;
      el.hidden = !on;
      if (on) any = true;
    });
    box.hidden = !any;

    var now = new Date();
    var t = document.getElementById("w-clock-time");
    var d = document.getElementById("w-clock-sub");
    if (t) t.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (d)
      d.textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

    var bridge = window.G9Bridge;
    var playing = null;
    try {
      playing = bridge && bridge.nowPlaying ? bridge.nowPlaying() : null;
    } catch (e) {
      playing = null;
    }
    var title = document.getElementById("w-now-title");
    var sub = document.getElementById("w-now-sub");
    var meter = document.getElementById("w-now-meter");
    if (title && sub) {
      if (playing && playing.title) {
        title.textContent = playing.title;
        var left = playing.duration ? Math.max(0, playing.duration - playing.time) : 0;
        sub.textContent = playing.paused
          ? "Paused" + (left ? " · " + Math.round(left / 60) + " min left" : "")
          : (playing.live ? "Live" : Math.round(playing.time / 60) + " min in" + (left ? " · " + Math.round(left / 60) + " left" : ""));
        if (meter && playing.duration) {
          meter.hidden = false;
          var fill = meter.querySelector("i");
          if (fill) fill.style.width = Math.min(100, Math.round((playing.time / playing.duration) * 100)) + "%";
        }
      } else {
        title.textContent = "Nothing playing";
        sub.textContent = "Open a file or a channel to begin";
        if (meter) meter.hidden = true;
      }
    }
    var big = document.getElementById("w-lib-big");
    var libSub = document.getElementById("w-lib-sub");
    if (big && libSub) {
      var st = null;
      try {
        st = bridge && bridge.stats ? bridge.stats() : null;
      } catch (e) {
        st = null;
      }
      var titles = st && st.history != null ? Number(st.history) : 0;
      var channels = st && st.channels != null ? Number(st.channels) : 0;
      big.textContent = String(titles);
      libSub.textContent =
        (titles === 1 ? "title played" : "titles played") +
        " · " +
        channels +
        (channels === 1 ? " channel" : " channels");
    }
  }

  /* ---------------- settings entry ---------------- */

  /// The Settings modal asks for this and drops it at the top of the sheet.
  function settingsGroup() {
    var a = cat.cur;
    var themeName = a.theme === "auto" ? "Auto (" + resolvedTheme() + ")" : a.theme === "light" ? "Light" : "Dark";
    return (
      '<div class="settings-group"><p class="settings-label">Appearance</p>' +
      '<div class="settings-row"><div class="txt"><b>Theme &amp; personalisation</b><span>' +
      themeName +
      " · accent " +
      a.accent +
      " · " +
      a.font +
      " · " +
      a.density +
      '</span></div><button type="button" data-set="appearance">Open</button></div>' +
      '<div class="settings-row"><div class="txt"><b>Notifications</b><span>' +
      (cat.notifs.length ? unread() + " unread · " + cat.notifs.length + " saved" : "Nothing saved yet") +
      '</span></div><button type="button" data-set="notifications">Open</button></div></div>'
    );
  }

  function bindSettings(root) {
    if (!root) return;
    var a = root.querySelector('[data-set="appearance"]');
    if (a)
      a.addEventListener("click", function () {
        var modal = document.getElementById("settings-modal");
        if (modal) modal.hidden = true;
        openAppearance();
      });
    var n = root.querySelector('[data-set="notifications"]');
    if (n)
      n.addEventListener("click", function () {
        var modal = document.getElementById("settings-modal");
        if (modal) modal.hidden = true;
        togglePanel("notif-panel", "notif-btn");
      });
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    var nb = document.getElementById("notif-btn");
    if (nb)
      nb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        togglePanel("notif-panel", "notif-btn");
      });
    var pb = document.getElementById("profile-btn");
    if (pb)
      pb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        togglePanel("profile-pop", "profile-btn");
      });
    var nc = document.getElementById("notif-close");
    if (nc)
      nc.addEventListener("click", function () {
        closePanels();
      });
    var nr = document.getElementById("notif-read");
    if (nr) nr.addEventListener("click", readAll);
    var ncl = document.getElementById("notif-clear");
    if (ncl) ncl.addEventListener("click", clearAll);

    var closeBtn = document.getElementById("appear-close");
    if (closeBtn) closeBtn.addEventListener("click", closeAppearance);
    var done = document.getElementById("appear-done");
    if (done) done.addEventListener("click", closeAppearance);
    var resetBtn = document.getElementById("appear-reset");
    if (resetBtn)
      resetBtn.addEventListener("click", function () {
        reset();
        paintThemeButtons();
        paintAccents();
      });
    var modal = document.getElementById("appearance-modal");
    if (modal)
      modal.addEventListener("click", function (ev) {
        if (ev.target === modal) closeAppearance();
      });

    document.querySelectorAll("#pop-theme [data-theme-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        set({ theme: b.getAttribute("data-theme-pick") });
        paintThemeButtons();
      });
    });
    document.querySelectorAll("#profile-pop [data-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        var what = b.getAttribute("data-open");
        closePanels();
        if (what === "appearance") openAppearance();
        else if (what === "notif") togglePanel("notif-panel", "notif-btn");
        else if (what === "settings") {
          var gear = document.getElementById("btn-gear");
          if (gear) gear.click();
        }
      });
    });

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest("#notif-panel") || t.closest("#profile-pop") || t.closest("#notif-btn") || t.closest("#profile-btn"))
        return;
      closePanels();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var ap = document.getElementById("appearance-modal");
      if (ap && !ap.hidden) {
        closeAppearance();
        ev.stopPropagation();
        return;
      }
      var open = document.getElementById("notif-panel");
      if (open && !open.hidden) {
        closePanels();
        ev.stopPropagation();
      }
    }, true);

    document.querySelectorAll("[data-theme-pick]").forEach(function (b) {
      b.addEventListener("click", paintThemeButtons);
    });

    // Auto theme follows Windows while the app is open.
    if (typeof window.matchMedia === "function") {
      var mq = window.matchMedia("(prefers-color-scheme: light)");
      var onMq = function () {
        if (cat.cur.theme === "auto") apply();
      };
      if (mq.addEventListener) mq.addEventListener("change", onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }

    window.setInterval(function () {
      paintWidgets();
    }, 15000);
  }

  /* ---------------- boot ---------------- */

  function boot() {
    load();
    loadNotifs();
    applyVars();          // the first paint is already the right theme
    apply();
    paintNotifs();
    wire();
    paintWidgets();
    // The player is defined last, so the first widget paint may have run before
    // G9Bridge existed. Paint once more as soon as the document is idle.
    window.setTimeout(paintWidgets, 400);
    window.setTimeout(paintWidgets, 1600);
  }

  window.G9Theme = {
    get: function () {
      return clone(cat.cur);
    },
    set: set,
    reset: reset,
    apply: apply,
    applyVars: applyVars,
    open: openAppearance,
    close: closeAppearance,
    settingsGroup: settingsGroup,
    bindSettings: bindSettings,
    refreshWidgets: paintWidgets,
    accents: ACCENTS.map(function (a) {
      return a[0];
    }),
    resolvedTheme: resolvedTheme
  };

  window.G9Notify = {
    push: push,
    capture: capture,
    list: function () {
      return cat.notifs.slice();
    },
    unread: unread,
    readAll: readAll,
    clear: clearAll,
    paint: paintNotifs,
    open: function () {
      togglePanel("notif-panel", "notif-btn");
    }
  };

  if (document.readyState === "loading") {
    // <head>: set the theme now so nothing flashes, finish when the DOM is here.
    load();
    loadNotifs();
    applyVars();
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
