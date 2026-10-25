/* G9 cinema shell — vanilla JS */

(function () {
  "use strict";

  var ICO_PLAY =
    '<svg viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor" stroke="none" /></svg>';
  var ICO_PAUSE =
    '<svg viewBox="0 0 24 24"><path d="M7 6h3.2v12H7zM13.8 6H17v12h-3.2z" fill="currentColor" stroke="none" /></svg>';
  var ICO_VOL =
    '<svg viewBox="0 0 24 24"><path d="M4 10v4h3l4 3V7L7 10H4zM16 9a4 4 0 010 6" /></svg>';
  var ICO_MUTE =
    '<svg viewBox="0 0 24 24"><path d="M4 10v4h3l4 3V7L7 10H4zM16 10l5 5M21 10l-5 5" /></svg>';

  var state = {
    view: "watch",
    info: null,
    groups: [],
    channels: [],
    sources: [],
    history: [],
    stats: null,
    group: "All",
    query: "",
    favOnly: false,
    current: null,
    showDiag: false,
    zapDigits: "",
    zapTimer: 0,
    hideTimer: 0,
    repeat: false,
    shuffle: false,
    tv: false,
    title: "Ready",
    lastQuery: "",
    dlnaServers: [],
    dlnaControl: "",
    dlnaParent: "0",
    mediaUrl: "",
    mediaPath: "",
    mediaKind: "",
    subsOn: false,
    autoSubs: false,
    subMeta: null,
    subBlob: null,
    subRaw: "",
    subDelay: 0,
    subSize: 20,
    cuePos: 14,
    cueColor: "#ffffff",
    cues: [],
    boost: 100,
    eq: [0, 0, 0, 0, 0, 0],
    abA: null,
    abB: null,
    resumeTimer: 0,
    queue: [],
    queueIdx: -1,
    vizOn: false,
    lineRepeat: false,
    lastCueIdx: -1,
    onTop: false,
    shaderOn: false,
    shaderName: "Off",
  };

  var video = document.getElementById("video");
  var app = document.getElementById("app");
  var zapEl = document.getElementById("zap");
  var poster = document.getElementById("poster");
  var diag = document.getElementById("diag");
  var listEl = document.getElementById("list");
  var chipsEl = document.getElementById("chips");
  var sheet = document.getElementById("sheet");
  var importModal = document.getElementById("import-modal");
  var aboutModal = document.getElementById("about-modal");
  var infoModal = document.getElementById("info-modal");
  var toastEl = document.getElementById("toast");
  var seekEl = document.getElementById("seek");
  var eqPanel = document.getElementById("eq-panel");
  var subPanel = document.getElementById("sub-panel");
  var fxPanel = document.getElementById("fx-panel");
  var speedPanel = document.getElementById("speed-panel");
  var markPanel = document.getElementById("mark-panel");
  var recorder = null;
  var hlsSession = null;
  var audioGraph = null;
  var EQ_FREQ = [60, 170, 350, 1000, 3500, 10000];
  var EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0],
    bass: [8, 5, 1, 0, -1, -2],
    voice: [-2, -1, 3, 6, 4, 0],
    movie: [3, 1, 0, 1, 3, 2],
  };

  function tauri() {
    return window.__TAURI__ || null;
  }
  function invoke(cmd, args) {
    var api = tauri();
    if (!api || !api.core) return Promise.reject(new Error("Open G9 as the desktop app."));
    return api.core.invoke(cmd, args || {});
  }
  function convertFileSrc(path) {
    var api = tauri();
    return api && api.core && api.core.convertFileSrc ? api.core.convertFileSrc(path) : path;
  }
  function openDialog(opts) {
    var api = tauri();
    if (!api || !api.dialog) return Promise.reject(new Error("Dialog unavailable"));
    return api.dialog.open(opts);
  }
  async function win() {
    var api = tauri();
    if (!api || !api.window) return null;
    return api.window.getCurrentWindow();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(t) {
    if (!isFinite(t) || t < 0) return "00:00";
    var s = Math.floor(t % 60).toString().padStart(2, "0");
    var m = Math.floor((t / 60) % 60).toString().padStart(2, "0");
    var h = Math.floor(t / 3600);
    return h ? h + ":" + m + ":" + s : m + ":" + s;
  }
  function shortError(e, fallback) {
    var msg = String((e && e.message) || e || "").replace(/https?:\/\/\S+/g, " ");
    msg = msg
      .replace(/\b(Local|Embedded|TheSubDB|OpenSubtitles|Podnapisi|Whisper|MyMemory)\b\s*:?/gi, " ")
      .replace(/["“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!msg) return fallback || "Something went wrong";
    if (/no subtitles|not found|no match/i.test(msg)) return "No subtitles found";
    if (msg.length > 72) msg = msg.slice(0, 70).replace(/[,;:.\s]+$/, "") + "…";
    return msg;
  }
  function fail(e) {
    var msg = shortError(e);
    toast(msg);
    var meta = document.getElementById("info-meta");
    var modal = document.getElementById("info-modal");
    if (meta && modal && !modal.hidden) meta.textContent = msg;
  }

  function toast(msg) {
    if (!toastEl) return;
    var text = String(msg == null ? "" : msg).replace(/\s+/g, " ").trim();
    if (text.length > 96) text = text.slice(0, 94).replace(/[,;:.]$/, "") + "…";
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2800);
  }

  /// One reusable dialog: text input, a row of choices, or a confirm.
  /// WebView2 never shows window.prompt(), so everything goes through this.
  function ask(opts) {
    var back = document.getElementById("ask-back");
    if (!back) return Promise.resolve(opts.input ? window.prompt(opts.title || "", opts.value || "") : null);
    return new Promise(function (resolve) {
      var title = document.getElementById("ask-title");
      var hint = document.getElementById("ask-hint");
      var input = document.getElementById("ask-input");
      var choices = document.getElementById("ask-choices");
      var okBtn = document.getElementById("ask-ok");
      var cancelBtn = document.getElementById("ask-cancel");
      title.textContent = opts.title || "";
      var icon = document.getElementById("ask-icon");
      if (icon) {
        icon.classList.toggle("warn", !!opts.warn);
        icon.innerHTML = opts.warn
          ? '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></svg>';
      }
      hint.textContent = opts.hint || "";
      hint.hidden = !opts.hint;
      input.hidden = !opts.input;
      input.value = opts.value || "";
      choices.hidden = !opts.choices;
      choices.innerHTML = "";
      okBtn.textContent = opts.okText || "OK";
      okBtn.hidden = !!opts.choices && !!opts.autoPick;
      var picked = opts.choices ? opts.choices[0] : "ok";
      if (opts.choices) {
        opts.choices.forEach(function (c) {
          var b = document.createElement("button");
          b.type = "button";
          if (c === picked) b.classList.add("is-default");
          b.textContent = c;
          b.addEventListener("mouseenter", function () {
            picked = c;
            choices.querySelectorAll("button").forEach(function (x) {
              x.classList.toggle("is-default", x === b);
            });
          });
          b.addEventListener("click", function () {
            done(c);
          });
          choices.appendChild(b);
        });
      }
      function cleanup() {
        back.hidden = true;
        document.removeEventListener("keydown", onKey, true);
      }
      function done(v) {
        cleanup();
        resolve(v);
      }
      function onKey(ev) {
        if (ev.key === "Tab" && opts.choices) {
          var list = Array.prototype.slice.call(choices.querySelectorAll("button"));
          if (list.length) {
            ev.preventDefault();
            var at = list.indexOf(document.activeElement);
            var nextIdx = (at + (ev.shiftKey ? -1 : 1) + list.length) % list.length;
            picked = list[nextIdx].textContent;
            list.forEach(function (x, i) {
              x.classList.toggle("is-default", i === nextIdx);
            });
            list[nextIdx].focus();
            return;
          }
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          done(null);
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          ev.stopPropagation();
          done(opts.input ? input.value.trim() || null : picked);
        }
      }
      okBtn.onclick = function () {
        done(opts.input ? input.value.trim() || null : picked);
      };
      cancelBtn.onclick = function () {
        done(null);
      };
      back.onmousedown = function (ev) {
        if (ev.target === back) done(null);
      };
      back.hidden = false;
      document.addEventListener("keydown", onKey, true);
      window.setTimeout(function () {
        if (opts.input) {
          input.focus();
          input.select();
        } else okBtn.focus();
      }, 40);
    });
  }
  function askText(title, value, hint, okText) {
    return ask({ title: title, value: value, hint: hint, input: true, okText: okText });
  }

  function clearSubs() {
    if (state.subBlob) {
      try {
        URL.revokeObjectURL(state.subBlob);
      } catch (e) {}
      state.subBlob = null;
    }
    Array.prototype.slice.call(video.querySelectorAll("track")).forEach(function (t) {
      t.remove();
    });
    if (video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = "disabled";
    }
    state.subsOn = false;
    state.subMeta = null;
    state.subRaw = "";
    state.cues = [];
    paintCue();
    var cc = document.getElementById("btn-cc");
    if (cc) cc.classList.remove("on");
  }

  function showCueTrack() {
    if (!video.textTracks) return;
    for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = "hidden";
    paintCue();
  }

  function applyVtt(result) {
    state.autoSubs = true;
    try {
      localStorage.setItem("g9-subs", "1");
    } catch (e) {}
    state.subMeta = result;
    state.subRaw = result.vtt || "";
    applyVttText(shiftVtt(state.subRaw, state.subDelay || 0), result);
    var lang = (result.language || "en").toUpperCase();
    toast("Subtitles ready · " + lang);
  }

  function parseVttTime(s) {
    var p = String(s).trim().split(":");
    if (p.length === 3) return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]);
    if (p.length === 2) return Number(p[0]) * 60 + Number(p[1]);
    return Number(s) || 0;
  }
  function fmtVttTime(t) {
    if (t < 0) t = 0;
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t - h * 3600 - m * 60;
    var whole = Math.floor(s);
    var ms = Math.round((s - whole) * 1000);
    function z(n, w) {
      return String(n).padStart(w, "0");
    }
    return z(h, 2) + ":" + z(m, 2) + ":" + z(whole, 2) + "." + z(ms, 3);
  }
  function shiftVtt(vtt, delay) {
    return String(vtt).replace(/(\d+:\d{2}:\d{2}[.,]\d+|\d+:\d{2}[.,]\d+)\s*-->\s*(\d+:\d{2}:\d{2}[.,]\d+|\d+:\d{2}[.,]\d+)/g, function (_, a, b) {
      return fmtVttTime(parseVttTime(a.replace(",", ".")) + delay) + " --> " + fmtVttTime(parseVttTime(b.replace(",", ".")) + delay);
    });
  }
  function applyVttText(vtt, result) {
    clearSubsKeepMeta();
    var blob = new Blob([vtt], { type: "text/vtt" });
    var url = URL.createObjectURL(blob);
    state.subBlob = url;
    var track = document.createElement("track");
    track.kind = "subtitles";
    track.label = (result && result.language) || "English";
    track.srclang = ((result && result.language) || "en").slice(0, 2);
    track.src = url;
    track.default = true;
    video.appendChild(track);
    track.addEventListener("load", showCueTrack);
    window.setTimeout(showCueTrack, 80);
    state.subsOn = true;
    state.cues = parseCues(vtt);
    var cc = document.getElementById("btn-cc");
    if (cc) cc.classList.add("on");
  }
  function parseCues(vtt) {
    var cues = [];
    String(vtt)
      .replace(/\r/g, "")
      .split(/\n\n+/)
      .forEach(function (block) {
        var lines = block.split("\n").filter(Boolean);
        if (!lines.length || lines[0] === "WEBVTT") return;
        var time = lines[0].indexOf("-->") >= 0 ? lines[0] : lines[1];
        if (!time || time.indexOf("-->") < 0) return;
        var parts = time.split("-->");
        var text = lines.slice(time === lines[0] ? 1 : 2).join("\n");
        cues.push({
          start: parseVttTime(parts[0].replace(",", ".").trim()),
          end: parseVttTime(parts[1].replace(",", ".").trim().split(" ")[0]),
          text: text,
        });
      });
    return cues;
  }
  function paintCue() {
    var el = document.getElementById("cue-text");
    if (!el) return;
    var t = video.currentTime + (state.subDelay || 0);
    var hit = null;
    var idx = -1;
    for (var i = 0; i < state.cues.length; i++) {
      if (t >= state.cues[i].start && t < state.cues[i].end) {
        hit = state.cues[i];
        idx = i;
        break;
      }
    }
    if (state.lineRepeat && state.lastCueIdx >= 0 && idx < 0) {
      video.pause();
    }
    state.lastCueIdx = idx;
    if (!hit) {
      el.textContent = "";
      return;
    }
    el.textContent = hit.tx || hit.text;
    if (state.liveTx && !hit.tx && !hit.txBusy) {
      hit.txBusy = true;
      invoke("translate_text", { text: hit.text, from: "en", to: state.txLang || "es" })
        .then(function (t) {
          hit.tx = t || hit.text;
          paintCue();
        })
        .catch(function () {
          hit.txBusy = false;
        });
    }
  }
  function clearSubsKeepMeta() {
    if (state.subBlob) {
      try {
        URL.revokeObjectURL(state.subBlob);
      } catch (e) {}
      state.subBlob = null;
    }
    Array.prototype.slice.call(video.querySelectorAll("track")).forEach(function (t) {
      t.remove();
    });
  }
  function setSubDelay(delta, abs) {
    state.subDelay = abs ? delta : Math.round((state.subDelay + delta) * 100) / 100;
    var el = document.getElementById("sub-delay-val");
    if (el) el.textContent = (state.subDelay >= 0 ? "+" : "") + state.subDelay.toFixed(2) + "s";
    if (state.subRaw) applyVttText(shiftVtt(state.subRaw, state.subDelay), state.subMeta || {});
    toast("Subtitle delay " + (state.subDelay >= 0 ? "+" : "") + state.subDelay.toFixed(2) + "s");
    saveResume();
  }
  function setSubSize(n) {
    state.subSize = n;
    document.documentElement.style.setProperty("--cue-size", n + "px");
    var el = document.getElementById("sub-size-val");
    if (el) el.textContent = n + "px";
    try {
      localStorage.setItem("g9-cue", String(n));
    } catch (e) {}
  }
  function setCuePos(n) {
    state.cuePos = n;
    document.documentElement.style.setProperty("--cue-bottom", n + "%");
    var el = document.getElementById("sub-pos-val");
    if (el) el.textContent = n + "%";
  }
  function setCueColor(c) {
    state.cueColor = c;
    document.documentElement.style.setProperty("--cue-color", c);
  }
  function mediaKey() {
    return state.mediaPath || state.mediaUrl || "";
  }
  function loadResumeMap() {
    try {
      return JSON.parse(localStorage.getItem("g9-resume") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function saveResume() {
    var key = mediaKey();
    if (!key || state.mediaKind === "live") return;
    if (!isFinite(video.currentTime)) return;
    var map = loadResumeMap();
    map[key] = {
      t: video.currentTime,
      dur: video.duration || 0,
      title: state.title,
      subDelay: state.subDelay,
      boost: state.boost,
      eq: state.eq,
    };
    var keys = Object.keys(map);
    if (keys.length > 80) delete map[keys[0]];
    try {
      localStorage.setItem("g9-resume", JSON.stringify(map));
    } catch (e) {}
    if (key && isFinite(video.currentTime)) {
      invoke("add_history", {
        title: state.title || key,
        url: key,
        kind: state.mediaKind || "file",
        position: video.currentTime,
        duration: video.duration || 0,
      }).catch(function () {});
    }
  }
  function restoreResume() {
    if (state.mediaKind === "live") return;
    var rec = loadResumeMap()[mediaKey()];
    if (!rec) return;
    if (typeof rec.subDelay === "number") state.subDelay = rec.subDelay;
    if (rec.eq) {
      state.eq = rec.eq;
      if (audioGraph) applyEq();
    }
    if (rec.boost) {
      state.boost = Number(rec.boost) || 100;
      var bv = document.getElementById("eq-boost-val");
      if (bv) bv.textContent = state.boost + "%";
      var bi = document.getElementById("eq-boost");
      if (bi) bi.value = String(state.boost);
      if (audioGraph) audioGraph.gain.gain.value = state.boost / 100;
    }
    if (rec.t > 5 && isFinite(video.duration) && rec.t < video.duration - 5) {
      video.currentTime = rec.t;
      toast("Resumed " + fmt(rec.t));
    }
  }
  function ensureAudio() {
    if (audioGraph) {
      if (audioGraph.ctx.state === "suspended") audioGraph.ctx.resume().catch(function () {});
      return audioGraph;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = null;
    var src = null;
    try {
      ctx = new AC();
      src = ctx.createMediaElementSource(video);
      var last = src;
      var filters = EQ_FREQ.map(function (freq, i) {
        var f = ctx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = freq;
        f.Q.value = 0.9;
        f.gain.value = state.eq[i] || 0;
        last.connect(f);
        last = f;
        return f;
      });
      var gain = ctx.createGain();
      gain.gain.value = state.boost / 100;
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      last.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      audioGraph = { ctx: ctx, filters: filters, gain: gain, analyser: analyser };
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      return audioGraph;
    } catch (e) {
      // Once a MediaElementSource exists the element is silent unless it reaches
      // the speakers, so always finish the chain even when a node failed.
      try {
        if (src && ctx) src.connect(ctx.destination);
      } catch (e2) {}
      return null;
    }
  }
  /// WebView may create the context suspended; a gesture unlocks it.
  function unlockAudio() {
    if (audioGraph && audioGraph.ctx.state === "suspended") {
      audioGraph.ctx.resume().catch(function () {});
    }
  }

  function applyEq() {
    var g = ensureAudio();
    if (!g) return;
    g.filters.forEach(function (f, i) {
      f.gain.value = state.eq[i] || 0;
    });
    var bands = document.getElementById("eq-bands");
    if (bands) {
      Array.prototype.forEach.call(bands.querySelectorAll("input"), function (inp, i) {
        inp.value = String(state.eq[i] || 0);
      });
    }
  }
  function setBoost(n, silent) {
    state.boost = Number(n) || 100;
    var g = ensureAudio();
    if (g) g.gain.gain.value = state.boost / 100;
    var el = document.getElementById("eq-boost-val");
    if (el) el.textContent = state.boost + "%";
    var inp = document.getElementById("eq-boost");
    if (inp) inp.value = String(state.boost);
    if (!silent) toast("Boost " + state.boost + "%");
  }
  function buildEqUi() {
    var host = document.getElementById("eq-bands");
    if (!host || host.childNodes.length) return;
    EQ_FREQ.forEach(function (freq, i) {
      var col = document.createElement("div");
      col.className = "eq-band";
      var inp = document.createElement("input");
      inp.type = "range";
      inp.min = "-12";
      inp.max = "12";
      inp.value = String(state.eq[i] || 0);
      inp.addEventListener("input", function () {
        state.eq[i] = Number(inp.value);
        applyEq();
      });
      var lab = document.createElement("span");
      lab.textContent = freq >= 1000 ? freq / 1000 + "k" : String(freq);
      col.appendChild(inp);
      col.appendChild(lab);
      host.appendChild(col);
    });
  }
  function safeName(ext) {
    var base = String(state.title || "g9")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    if (base.length > 70) base = base.slice(0, 70);
    return (base || "g9") + ext;
  }
  var picsDir = null;
  function initPicsDir() {
    invoke("pictures_dir")
      .then(function (dir) {
        picsDir = typeof dir === "string" && dir ? dir : null;
      })
      .catch(function () {});
  }
  /// { path } when chosen, { cancelled } when the dialog was dismissed,
  /// { unsupported } when there is no native dialog (browser fallback).
  function pickSave(name, label, ext) {
    var api = tauri();
    if (!api || !api.dialog || !api.dialog.save) return Promise.resolve({ unsupported: true });
    var path = name;
    if (picsDir) {
      var sep = picsDir.indexOf("\\") >= 0 ? "\\" : "/";
      path = picsDir.replace(/[\\/]+$/, "") + sep + name;
    }
    return api.dialog
      .save({ defaultPath: path, filters: [{ name: label, extensions: [ext] }] })
      .then(function (chosen) {
        return chosen ? { path: chosen } : { cancelled: true };
      })
      .catch(function () {
        return { cancelled: true };
      });
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 6000);
  }
  function frameCanvas() {
    if (!video.videoWidth || !video.videoHeight) return null;
    var c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    var ctx = c.getContext("2d");
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  function snapshot() {
    if (!video.videoWidth) {
      toast("Nothing to capture yet");
      return;
    }
    var name = safeName(".jpg");
    var destP = pickSave(name, "JPEG image", "jpg");
    var data = null;
    var canvas = null;
    try {
      canvas = frameCanvas();
      data = canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
    } catch (e) {
      data = null; // protected/foreign stream: canvas is tainted
    }
    destP
      .then(function (pick) {
        if (pick.cancelled) return null;
        var dest = pick.path;
        if (data) {
          if (!dest) {
            var bin = atob(data.split(",")[1] || "");
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            downloadBlob(new Blob([bytes], { type: "image/jpeg" }), name);
            toast("Frame saved");
            return null;
          }
          return invoke("save_data_url", { path: dest, dataUrl: data }).then(function () {
            toast("Frame saved");
          });
        }
        if (state.mediaKind === "file" && state.mediaPath && dest) {
          return invoke("save_frame", {
            path: state.mediaPath,
            seconds: video.currentTime || 0,
            dest: dest,
          }).then(function () {
            toast("Frame saved");
          });
        }
        toast("This source won't allow a screenshot");
        return null;
      })
      .catch(function (e) {
        toast(shortError(e, "Could not save the frame"));
      });
  }
  function exportGif() {
    if (!video.videoWidth || typeof encodeGif !== "function") {
      toast("Nothing to export");
      return;
    }
    var start = state.abA != null ? state.abA : Math.max(0, video.currentTime - 1.2);
    var end = state.abB != null ? state.abB : Math.min(video.duration || start + 2.4, start + 2.4);
    if (end <= start) end = start + 1.5;
    toast("Encoding GIF…");
    var w = 160;
    var h = Math.max(90, Math.round((video.videoHeight / video.videoWidth) * w));
    var fps = 8;
    var frames = [];
    var t = start;
    var wasPaused = video.paused;
    var origin = video.currentTime;
    function grab() {
      if (t > end || frames.length >= 24) {
        video.currentTime = origin;
        if (!wasPaused) video.play();
        if (!frames.length) {
          toast("Nothing to export");
          return;
        }
        var bytes = encodeGif(frames, w, h, Math.max(2, Math.round(100 / fps)));
        var blob = new Blob([bytes], { type: "image/gif" });
        saveBlob(blob, safeName(".gif"), "GIF image", "gif");
        toast("GIF · " + frames.length + " frames");
        return;
      }
      video.pause();
      video.currentTime = t;
      video.onseeked = function () {
        video.onseeked = null;
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        try {
          c.getContext("2d").drawImage(video, 0, 0, w, h);
          frames.push(c.getContext("2d").getImageData(0, 0, w, h).data);
        } catch (e) {}
        t += 1 / fps;
        window.setTimeout(grab, 20);
      };
    }
    grab();
  }
  function applyVideoFilter() {
    var br = document.getElementById("fx-br");
    var ct = document.getElementById("fx-ct");
    var sat = document.getElementById("fx-sat");
    var sh = document.getElementById("fx-sh");
    if (!br) return;
    var b = Number(br.value) / 100;
    var c = Number(ct.value) / 100;
    var s = Number(sat.value) / 100;
    var sharp = Number(sh.value);
    document.getElementById("fx-br-val").textContent = br.value + "%";
    document.getElementById("fx-ct-val").textContent = ct.value + "%";
    document.getElementById("fx-sat-val").textContent = sat.value + "%";
    document.getElementById("fx-sh-val").textContent = String(sharp);
    video.style.filter =
      "brightness(" + b + ") contrast(" + (c + sharp * 0.04) + ") saturate(" + s + ")";
  }
  function setSpeed(pct) {
    var rate = Math.max(0.25, Math.min(2, Number(pct) / 100));
    video.playbackRate = rate;
    if ("preservesPitch" in video) video.preservesPitch = document.getElementById("speed-pitch").checked;
    var el = document.getElementById("speed-val");
    if (el) el.textContent = rate.toFixed(2) + "×";
  }
  function frameStep(dir) {
    video.pause();
    var fps = 24;
    if (video.getVideoPlaybackQuality && video.getVideoPlaybackQuality().totalVideoFrames && video.currentTime > 0) {
      fps = 24;
    }
    video.currentTime = Math.max(0, video.currentTime + dir / fps);
  }
  function marksMap() {
    try {
      return JSON.parse(localStorage.getItem("g9-marks") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function saveMarks(map) {
    try {
      localStorage.setItem("g9-marks", JSON.stringify(map));
    } catch (e) {}
  }
  function addMark() {
    var key = mediaKey();
    if (!key) {
      toast("Open a video first");
      return;
    }
    var at = video.currentTime;
    askText("Bookmark", fmt(at), "Name this position", "Add").then(function (name) {
      if (name == null) return;
      var map = marksMap();
      if (!map[key]) map[key] = [];
      map[key].push({ t: at, name: name || fmt(at) });
      saveMarks(map);
      renderMarks();
      toast("Bookmark saved");
    });
  }
  function renderMarks() {
    var host = document.getElementById("mark-list");
    if (!host) return;
    var list = (marksMap()[mediaKey()] || []).slice();
    if (!list.length) {
      host.innerHTML = '<div class="empty">No bookmarks for this video.</div>';
      return;
    }
    host.innerHTML = list
      .map(function (m, i) {
        return (
          '<div class="mark-row" data-mi="' +
          i +
          '"><span>' +
          escapeHtml(m.name) +
          "</span><b>" +
          fmt(m.t) +
          "</b></div>"
        );
      })
      .join("");
    host.querySelectorAll("[data-mi]").forEach(function (row) {
      row.addEventListener("click", function () {
        var m = list[Number(row.getAttribute("data-mi"))];
        if (m) video.currentTime = m.t;
      });
    });
  }
  function enableAudioDescription() {
    var tracks = video.audioTracks;
    if (!tracks || !tracks.length) {
      toast("No extra audio tracks");
      return;
    }
    var found = false;
    for (var i = 0; i < tracks.length; i++) {
      var lab = (tracks[i].label || tracks[i].language || "") + "";
      var ad = /desc|narrat|commentary|audio description|\bad\b/i.test(lab);
      tracks[i].enabled = ad;
      if (ad) found = true;
    }
    if (!found) {
      for (var j = 0; j < tracks.length; j++) tracks[j].enabled = j === 0;
      toast(tracks.length + " audio track(s) — none tagged as description");
    } else toast("Audio description on");
  }
  function translateCaptions() {
    if (!state.cues.length) {
      toast("No captions to translate");
      return;
    }
    askText("Translate captions to", "es", "Language code: es, hi, fr, de…", "Translate").then(function (to) {
      if (!to) return;
      translateCues(to);
    });
  }
  function translateCues(to) {
    toast("Translating…");
    var i = 0;
    function next() {
      if (i >= state.cues.length) {
        state.subRaw = "WEBVTT\n\n" + state.cues.map(function (c) {
          return fmtVttTime(c.start) + " --> " + fmtVttTime(c.end) + "\n" + c.text;
        }).join("\n\n");
        paintCue();
        toast("Captions translated");
        return;
      }
      var cue = state.cues[i];
      invoke("translate_text", { text: cue.text, from: "en", to: to })
        .then(function (t) {
          if (t) cue.text = t;
        })
        .catch(function () {})
        .then(function () {
          i++;
          next();
        });
    }
    next();
  }
  function sidecarDest(ext) {
    var src = state.mediaPath || "";
    if (!src || src.indexOf("http") === 0) {
      return askText("Save as", "g9-out." + ext, "File name next to your media folder", "Save");
    }
    return Promise.resolve(src.replace(/\.[^.]+$/, "") + "." + ext);
  }
  function extractAudio() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    var path = state.mediaPath;
    sidecarDest("mp3")
      .then(function (dest) {
        if (!dest) return null;
        toast("Extracting audio…");
        return invoke("extract_audio", { path: path, dest: dest }).then(function () {
          toast("Audio saved");
        });
      })
      .catch(function (e) {
        toast(shortError(e, "Could not extract audio"));
      });
  }
  function repairFile() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    var path = state.mediaPath;
    sidecarDest("fixed.mp4")
      .then(function (dest) {
        if (!dest) return null;
        toast("Repairing…");
        return invoke("remux_repair", { path: path, dest: dest }).then(function () {
          toast("Repaired copy saved");
        });
      })
      .catch(function (e) {
        toast(shortError(e, "Repair failed"));
      });
  }
  function recordSource() {
    var stream = null;
    try {
      if (video.captureStream) stream = video.captureStream();
      else if (video.mozCaptureStream) stream = video.mozCaptureStream();
    } catch (e) {
      stream = null;
    }
    if (stream && stream.getTracks().length) return stream;
    if (!video.videoWidth) return null;
    var c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    var ctx2 = c.getContext("2d");
    var cs = null;
    try {
      cs = c.captureStream(30);
    } catch (e2) {
      return null;
    }
    var alive = true;
    (function draw() {
      if (!alive) return;
      try {
        ctx2.drawImage(video, 0, 0, c.width, c.height);
      } catch (e3) {}
      requestAnimationFrame(draw);
    })();
    cs.addEventListener("inactive", function () {
      alive = false;
    });
    return cs;
  }
  function toggleRecord() {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    var stream = recordSource();
    if (!stream) {
      toast("Open something to record");
      return;
    }
    startRecorder(stream);
  }
  function recordWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("No camera here");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(function (stream) {
        startRecorder(stream);
      })
      .catch(function () {
        toast("Camera not available");
      });
  }
  function b64bytes(bytes) {
    var out = "";
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(out);
  }
  function saveRecording(blob) {
    saveBlob(blob, safeName(".webm"), "WebM video", "webm");
  }
  function saveBlob(blob, name, label, ext) {
    pickSave(name, label, ext)
      .then(function (pick) {
        if (pick.cancelled) return null;
        var dest = pick.path;
        if (!dest) {
          downloadBlob(blob, name);
          toast("Saved");
          return null;
        }
        return blob.arrayBuffer().then(function (ab) {
          var bytes = new Uint8Array(ab);
          var step = 512 * 1024;
          var chain = Promise.resolve();
          var first = true;
          for (var i = 0; i < bytes.length; i += step) {
            (function (slice, isFirst) {
              chain = chain.then(function () {
                return invoke("write_chunk", {
                  path: dest,
                  dataB64: b64bytes(slice),
                  append: !isFirst,
                });
              });
            })(bytes.subarray(i, Math.min(i + step, bytes.length)), first);
            first = false;
          }
          return chain.then(function () {
            toast(ext === "gif" ? "GIF saved" : "Recording saved");
          });
        });
      })
      .catch(function (e) {
        toast(shortError(e, "Could not save the file"));
      });
  }
  function startRecorder(stream, extraStop) {
    if (typeof window.MediaRecorder !== "function") {
      toast("Recording isn't available here");
      return;
    }
    var mime = "";
    var hasVideo = (stream.getVideoTracks ? stream.getVideoTracks() : []).length > 0;
    var wants = hasVideo
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "video/webm"];
    wants.some(function (m) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m)) {
        mime = m;
        return true;
      }
      return false;
    });
    var chunks = [];
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      toast("Recording isn't available here");
      return;
    }
    recorder.ondataavailable = function (ev) {
      if (ev.data && ev.data.size) chunks.push(ev.data);
    };
    recorder.onstop = function () {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      if (extraStop) extraStop();
      var type = mime ? mime.split(";")[0] : "video/webm";
      var blob = new Blob(chunks, { type: type });
      recorder = null;
      if (!blob.size) {
        toast("Nothing was recorded");
        return;
      }
      saveRecording(blob);
    };
    recorder.start(1000);
    toast("Recording · press again to stop");
  }
  function convertMedia() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    ask({ title: "Convert / Save", choices: ["mp4", "webm", "mp3"] }).then(function (kind) {
      if (!kind) return;
      var path = state.mediaPath;
      return sidecarDest(kind).then(function (dest) {
        if (!dest) return null;
        toast("Converting…");
        return invoke("convert_media", { path: path, dest: dest }).then(function () {
          toast("Saved " + kind.toUpperCase());
        });
      });
    }).catch(function (e) {
      toast(shortError(e, "Conversion failed"));
    });
  }
  var look360 = { on: false, yaw: 0, pitch: 0, drag: null, raf: 0 };
  function toggle360() {
    var canvas = document.getElementById("view360");
    look360.on = !look360.on;
    canvas.hidden = !look360.on;
    if (!look360.on) {
      window.cancelAnimationFrame(look360.raf);
      toast("360 off");
      return;
    }
    var gl = canvas.getContext("webgl");
    if (!gl) {
      look360.on = false;
      canvas.hidden = true;
      toast("WebGL unavailable");
      return;
    }
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(
      vs,
      "attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }"
    );
    gl.compileShader(vs);
    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(
      fs,
      "precision mediump float; uniform sampler2D uTex; uniform vec2 uYawPitch; uniform vec2 uRes;\n" +
        "void main(){ vec2 uv=gl_FragCoord.xy/uRes; vec2 ndc=uv*2.0-1.0; ndc.x*=uRes.x/uRes.y;\n" +
        "float cy=cos(uYawPitch.y), sy=sin(uYawPitch.y), cx=cos(uYawPitch.x), sx=sin(uYawPitch.x);\n" +
        "vec3 d=normalize(vec3(ndc.x, ndc.y, 1.2));\n" +
        "d=vec3(d.x, d.y*cy-d.z*sy, d.y*sy+d.z*cy);\n" +
        "d=vec3(d.x*cx+d.z*sx, d.y, -d.x*sx+d.z*cx);\n" +
        "float lon=atan(d.x,d.z), lat=asin(clamp(d.y,-1.0,1.0));\n" +
        "vec2 t=vec2(lon/6.2831853+0.5, lat/3.1415926+0.5);\n" +
        "gl_FragColor=texture2D(uTex, t); }"
    );
    gl.compileShader(fs);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var uTex = gl.getUniformLocation(prog, "uTex");
    var uYP = gl.getUniformLocation(prog, "uYawPitch");
    var uRes = gl.getUniformLocation(prog, "uRes");
    function draw() {
      if (!look360.on) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      } catch (e) {}
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uYP, look360.yaw, look360.pitch);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      look360.raf = requestAnimationFrame(draw);
    }
    draw();
    toast("360 on · drag to look");
  }
  (function bind360() {
    var canvas = document.getElementById("view360");
    if (!canvas) return;
    canvas.addEventListener("mousedown", function (ev) {
      look360.drag = { x: ev.clientX, y: ev.clientY, yaw: look360.yaw, pitch: look360.pitch };
    });
    window.addEventListener("mouseup", function () {
      look360.drag = null;
    });
    window.addEventListener("mousemove", function (ev) {
      if (!look360.drag || !look360.on) return;
      look360.yaw = look360.drag.yaw + (ev.clientX - look360.drag.x) * 0.005;
      look360.pitch = Math.max(-1.2, Math.min(1.2, look360.drag.pitch + (ev.clientY - look360.drag.y) * 0.005));
    });
  })();
  function setLiveTx() {
    var turningOn = !state.liveTx;
    if (turningOn && !state.txLang) {
      askText("Live translate to", "es", "Language code: es, hi, fr…", "Start").then(function (lang) {
        if (!lang) return;
        state.txLang = lang;
        state.liveTx = true;
        toast("Live translate → " + state.txLang);
      });
      return;
    }
    state.liveTx = turningOn;
    toast(state.liveTx ? "Live translate → " + state.txLang : "Live translate off");
  }
  function openPodcast() {
    askText("Subscribe to podcast", "", "Paste the RSS feed URL", "Subscribe").then(function (url) {
      if (url) loadPodcast(url);
    });
  }
  function loadPodcast(url) {
    toast("Loading feed…");
    invoke("fetch_url", { url: url })
      .then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, "text/xml");
        var items = doc.querySelectorAll("item");
        state.podcasts = [];
        items.forEach(function (it) {
          var enc = it.querySelector("enclosure");
          var href = enc && enc.getAttribute("url");
          var t = (it.querySelector("title") && it.querySelector("title").textContent) || "Episode";
          if (href) state.podcasts.push({ title: t, url: href });
        });
        state.view = "podcast";
        paint();
        renderSheet();
        showChrome();
        toast(state.podcasts.length + " episode(s)");
      })
      .catch(function () {
        toast("Could not load that feed");
      });
  }
  function handleIpc(msg) {
    if (!msg || typeof msg !== "object") return;
    var cmd = msg.cmd || msg.command;
    if (cmd === "play") video.play();
    if (cmd === "pause") video.pause();
    if (cmd === "toggle") togglePlay();
    if (cmd === "stop") stop();
    if (cmd === "seek" && msg.to != null) video.currentTime = Number(msg.to);
    if (cmd === "skip") skip(Number(msg.dt || 10));
    if (cmd === "mute") video.muted = true;
    if (cmd === "unmute") video.muted = false;
  }
  function enqueue(title, url) {
    if (!url) return;
    var i = -1;
    state.queue.forEach(function (q, n) {
      if (q.url === url) i = n;
    });
    if (i >= 0) {
      state.queueIdx = i;
      return;
    }
    state.queue.push({
      title: title || url,
      url: url,
      path: state.mediaPath,
      kind: state.mediaKind,
    });
    state.queueIdx = state.queue.length - 1;
  }
  function playQueueNext() {
    var n = state.queueIdx + 1;
    if (n <= 0 || n >= state.queue.length) return false;
    var item = state.queue[n];
    state.queueIdx = n;
    state.mediaKind = item.kind;
    state.mediaPath = item.path;
    playUrl(item.title, item.url);
    return true;
  }
  function toggleViz() {
    state.vizOn = !state.vizOn;
    var canvas = document.getElementById("viz");
    canvas.hidden = !state.vizOn;
    if (state.vizOn) {
      ensureAudio();
      drawViz();
      toast("Visualizer on");
    } else toast("Visualizer off");
  }
  function drawViz() {
    var canvas = document.getElementById("viz");
    if (!state.vizOn || !canvas) return;
    var g = ensureAudio();
    var ctx2 = canvas.getContext("2d");
    canvas.width = canvas.clientWidth || 640;
    canvas.height = canvas.clientHeight || 120;
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    if (g && g.analyser) {
      var data = new Uint8Array(g.analyser.frequencyBinCount);
      g.analyser.getByteFrequencyData(data);
      var n = 48;
      var w = canvas.width / n;
      for (var i = 0; i < n; i++) {
        var v = data[Math.floor((i * data.length) / n)] / 255;
        var h = v * canvas.height;
        ctx2.fillStyle = "rgba(78,163,255," + (0.35 + v * 0.65) + ")";
        ctx2.fillRect(i * w + 1, canvas.height - h, w - 2, h);
      }
    }
    requestAnimationFrame(drawViz);
  }
  function toggleOnTop() {
    state.onTop = !state.onTop;
    win().then(function (w) {
      if (w && w.setAlwaysOnTop) return w.setAlwaysOnTop(state.onTop);
    }).then(function () {
      toast(state.onTop ? "Always on top" : "On top off");
    }).catch(function () {
      toast("Always on top unavailable");
    });
  }
  function showCues() {
    var host = document.getElementById("cue-list");
    var panel = document.getElementById("cue-panel");
    if (!host || !panel) return;
    if (!state.cues.length) {
      host.innerHTML = '<div class="empty">No subtitle lines.</div>';
    } else {
      host.innerHTML = state.cues
        .map(function (c, i) {
          return (
            '<div class="mark-row" data-ci="' +
            i +
            '"><span>' +
            escapeHtml(c.text).slice(0, 80) +
            "</span><b>" +
            fmt(c.start) +
            "</b></div>"
          );
        })
        .join("");
      host.querySelectorAll("[data-ci]").forEach(function (row) {
        row.addEventListener("click", function () {
          var c = state.cues[Number(row.getAttribute("data-ci"))];
          if (c) video.currentTime = c.start;
        });
      });
    }
    panel.hidden = false;
    showChrome();
  }

  /* ---------- managed FFmpeg ---------- */
  function ffPaint(st) {
    var el = document.getElementById("ff-state");
    if (!el) return;
    if (!st) {
      el.textContent = "Unavailable";
      return;
    }
    var lines = [st.available ? "Ready" : "Not installed"];
    if (st.version) lines.push(st.version);
    if (st.ffmpeg) lines.push(st.ffmpeg);
    if (st.dir) lines.push("Folder: " + st.dir);
    el.textContent = lines.join("\n");
    var btn = document.getElementById("ff-install");
    if (btn) btn.textContent = st.managed ? "Re-download" : "Download FFmpeg";
  }
  function openFfmpeg() {
    var panel = document.getElementById("ff-panel");
    if (!panel) return;
    panel.hidden = false;
    showChrome();
    invoke("ffmpeg_status")
      .then(ffPaint)
      .catch(function (e) {
        var el = document.getElementById("ff-state");
        if (el) el.textContent = String(e.message || e);
      });
  }
  function installFfmpeg() {
    var el = document.getElementById("ff-state");
    if (el) el.textContent = "Downloading FFmpeg… 0%";
    invoke("ffmpeg_install")
      .then(function (st) {
        ffPaint(st);
        toast("FFmpeg ready");
      })
      .catch(function (e) {
        if (el) el.textContent = String(e.message || e);
      });
  }
  function removeFfmpeg() {
    invoke("ffmpeg_remove")
      .then(function (st) {
        ffPaint(st);
        toast("Managed FFmpeg removed");
      })
      .catch(function (e) {
        toast(String(e.message || e));
      });
  }

  /* ---------- extra player window ---------- */
  function openNewWindow() {
    var src = "";
    if (state.mediaKind === "file" && state.mediaPath) src = convertFileSrc(state.mediaPath);
    else src = state.mediaUrl || video.currentSrc || "";
    invoke("open_player_window", { src: src || null, title: "G9 — " + (state.title || "player") })
      .then(function () {
        toast("Opened in a new window");
      })
      .catch(function (e) {
        toast(String(e.message || e));
      });
  }

  /* ---------- transcript ---------- */
  function openTranscript() {
    var panel = document.getElementById("transcript-panel");
    var host = document.getElementById("tr-list");
    if (!panel || !host) return;
    if (!state.cues.length) {
      host.innerHTML =
        '<div class="empty">No captions loaded. Use CC to search subtitles, or Settings → Generate captions.</div>';
    } else {
      host.innerHTML = state.cues
        .map(function (c, i) {
          return (
            '<div class="tr-row" data-tri="' +
            i +
            '"><time>' +
            fmt(c.start) +
            "</time><span>" +
            escapeHtml(c.text) +
            "</span></div>"
          );
        })
        .join("");
      host.querySelectorAll("[data-tri]").forEach(function (row) {
        row.addEventListener("click", function () {
          var c = state.cues[Number(row.getAttribute("data-tri"))];
          if (c) {
            video.currentTime = c.start + 0.01;
            if (video.paused) togglePlay();
          }
        });
      });
    }
    panel.hidden = false;
    showChrome();
    syncTranscript._i = -9;
    syncTranscript();
  }
  function syncTranscript() {
    var panel = document.getElementById("transcript-panel");
    if (!panel || panel.hidden || !state.cues.length) return;
    var t = video.currentTime - (state.subDelay || 0);
    var idx = -1;
    for (var i = 0; i < state.cues.length; i++) {
      if (t >= state.cues[i].start && t < state.cues[i].end) {
        idx = i;
        break;
      }
    }
    if (idx === syncTranscript._i) return;
    syncTranscript._i = idx;
    var rows = document.querySelectorAll("#tr-list .tr-row");
    for (var j = 0; j < rows.length; j++) rows[j].classList.toggle("now", j === idx);
    if (idx >= 0 && rows[idx] && rows[idx].scrollIntoView) rows[idx].scrollIntoView({ block: "nearest" });
  }

  /* ---------- WebGL shaders ---------- */
  var glState = null;
  var glRaf = 0;
  var BUILTIN_SHADERS = [
    { name: "Off", src: null },
    {
      name: "Sharpen",
      src:
        "void main(){ vec4 c = texture2D(tex, vUv); vec4 n = texture2D(tex, vUv + vec2(0.0, -px.y)) + texture2D(tex, vUv + vec2(0.0, px.y)) + texture2D(tex, vUv + vec2(-px.x, 0.0)) + texture2D(tex, vUv + vec2(px.x, 0.0)); gl_FragColor = clamp(c * 2.2 - n * 0.3, 0.0, 1.0); }",
    },
    {
      name: "Vivid",
      src:
        "void main(){ vec4 c = texture2D(tex, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(mix(vec3(l), c.rgb, 1.5), c.a); }",
    },
    {
      name: "Mono",
      src:
        "void main(){ vec4 c = texture2D(tex, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(vec3(l * 1.06), c.a); }",
    },
    {
      name: "Night",
      src:
        "void main(){ vec4 c = texture2D(tex, vUv); gl_FragColor = vec4(pow(c.rgb, vec3(1.25)) * vec3(0.92, 0.98, 1.08), c.a); }",
    },
  ];
  var VERT_SRC =
    "attribute vec2 p; varying vec2 vUv; void main(){ vUv = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
  function glCompile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function glBuild(frag) {
    var canvas = document.getElementById("glsl");
    var gl = canvas.getContext("webgl", { alpha: false });
    if (!gl) throw new Error("WebGL unavailable");
    var prog = gl.createProgram();
    gl.attachShader(prog, glCompile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(
      gl,
      glCompile(
        gl,
        gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec2 vUv; uniform sampler2D tex; uniform vec2 px; " + frag
      )
    );
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    return {
      gl: gl,
      canvas: canvas,
      tex: tex,
      uTex: gl.getUniformLocation(prog, "tex"),
      uPx: gl.getUniformLocation(prog, "px"),
    };
  }
  function shaderLoop() {
    if (!glState) return;
    var v = video;
    var canvas = glState.canvas;
    var w = v.videoWidth || 640;
    var h = v.videoHeight || 360;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      glState.gl.viewport(0, 0, w, h);
    }
    try {
      var gl = glState.gl;
      gl.bindTexture(gl.TEXTURE_2D, glState.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      gl.uniform1i(glState.uTex, 0);
      gl.uniform2f(glState.uPx, 1 / w, 1 / h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (e) {
      toast("Shader needs a local file or a CORS-allowed stream");
      stopShader();
      return;
    }
    glRaf = requestAnimationFrame(shaderLoop);
  }
  function stopShader() {
    if (glRaf) cancelAnimationFrame(glRaf);
    glRaf = 0;
    glState = null;
    state.shaderOn = false;
    var canvas = document.getElementById("glsl");
    if (canvas) canvas.hidden = true;
  }
  function startShader(name, frag) {
    stopShader();
    if (!frag) {
      toast("Shader off");
      paintShaderList(name);
      return;
    }
    try {
      glState = glBuild(frag);
    } catch (e) {
      toast(String(e.message || e));
      return;
    }
    document.getElementById("glsl").hidden = false;
    state.shaderOn = true;
    state.shaderName = name;
    shaderLoop();
    toast("Shader: " + name);
    paintShaderList(name);
  }
  function paintShaderList(active) {
    document.querySelectorAll("#shader-list [data-sh]").forEach(function (row) {
      row.classList.toggle("on", row.getAttribute("data-sh") === active);
    });
  }
  function openShaderPanel() {
    var panel = document.getElementById("shader-panel");
    var host = document.getElementById("shader-list");
    if (!panel || !host) return;
    function render(extra) {
      var all = BUILTIN_SHADERS.concat(extra || []);
      host.innerHTML = all
        .map(function (s) {
          return '<div class="row" data-sh="' + escapeHtml(s.name) + '"><div class="meta"><b>' + escapeHtml(s.name) + "</b></div></div>";
        })
        .join("");
      host.querySelectorAll("[data-sh]").forEach(function (row) {
        row.addEventListener("click", function () {
          var name = row.getAttribute("data-sh");
          var hit = all.filter(function (s) {
            return s.name === name;
          })[0];
          startShader(name, hit ? hit.src : null);
        });
      });
      paintShaderList(state.shaderName || "Off");
    }
    render([]);
    invoke("shaders_dir")
      .then(function (dir) {
        var hint = document.getElementById("shader-hint");
        if (hint && dir) hint.textContent = "Drop .frag files here: " + dir;
      })
      .catch(function () {});
    invoke("list_user_shaders")
      .then(function (list) {
        render(
          (list || []).map(function (s) {
            return { name: s.name, src: s.source };
          })
        );
      })
      .catch(function () {});
    panel.hidden = false;
    showChrome();
  }

  /* ---------- PC power (sleep timer) ---------- */
  function cancelPcShutdown() {
    invoke("cancel_pc_shutdown")
      .then(function (m) {
        toast(m);
      })
      .catch(function (e) {
        toast(String(e.message || e));
      });
  }

  function loadChapters() {
    if (!state.mediaPath || state.mediaKind !== "file") {
      toast("Open a local file");
      return;
    }
    toast("Reading chapters…");
    invoke("probe_media", { path: state.mediaPath })
      .then(function (json) {
        var data = JSON.parse(json);
        var ch = data.chapters || [];
        if (!ch.length) {
          toast("No chapters");
          return;
        }
        state.view = "queue";
        state.queue = ch.map(function (c, i) {
          var t = Number(c.start_time || 0);
          return {
            title: (c.tags && (c.tags.title || c.tags.TITLE)) || "Chapter " + (i + 1),
            url: video.currentSrc || state.mediaUrl,
            path: state.mediaPath,
            kind: state.mediaKind,
            t: t,
          };
        });
        paint();
        listEl; // render via view chapters as queue jump
        var title = document.getElementById("sheet-title");
        state.view = "live";
        sheet.hidden = false;
        document.getElementById("sheet-title").textContent = "Chapters";
        document.getElementById("sheet-count").textContent = String(ch.length);
        chipsEl.innerHTML = "";
        listEl.innerHTML = ch
          .map(function (c, i) {
            var t = Number(c.start_time || 0);
            var name = (c.tags && (c.tags.title || c.tags.TITLE)) || "Chapter " + (i + 1);
            return (
              '<div class="row" data-chp="' +
              t +
              '"><div class="n">' +
              (i + 1) +
              '</div><div class="meta"><b>' +
              escapeHtml(name) +
              "</b><span>" +
              fmt(t) +
              "</span></div></div>"
            );
          })
          .join("");
        listEl.querySelectorAll("[data-chp]").forEach(function (row) {
          row.addEventListener("click", function () {
            video.currentTime = Number(row.getAttribute("data-chp"));
          });
        });
        state.view = "watch";
        sheet.hidden = false;
        showChrome();
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function inspectFile() {
    if (!state.mediaPath || state.mediaKind !== "file") {
      openInfo();
      return;
    }
    invoke("probe_media", { path: state.mediaPath })
      .then(function (json) {
        diag.classList.add("on");
        state.showDiag = true;
        diag.textContent = json.slice(0, 4000);
        toast("Inspect (ffprobe)");
      })
      .catch(function () {
        openInfo();
      });
  }
  function scenePoster() {
    if (!video.videoWidth || !video.duration) {
      toast("Nothing to capture");
      return;
    }
    var cols = 3;
    var rows = 2;
    var fw = 320;
    var fh = Math.round((video.videoHeight / video.videoWidth) * fw);
    var c = document.createElement("canvas");
    c.width = cols * fw;
    c.height = rows * fh;
    var ctx = c.getContext("2d");
    var n = cols * rows;
    var i = 0;
    var origin = video.currentTime;
    var paused = video.paused;
    video.pause();
    function step() {
      if (i >= n) {
        video.currentTime = origin;
        if (!paused) video.play();
        c.toBlob(function (blob) {
          if (!blob) return;
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = (state.title || "g9") + "-poster.jpg";
          a.click();
          toast("Poster saved");
        }, "image/jpeg", 0.88);
        return;
      }
      video.currentTime = ((i + 0.5) / n) * video.duration;
      video.onseeked = function () {
        video.onseeked = null;
        var x = (i % cols) * fw;
        var y = Math.floor(i / cols) * fh;
        try {
          ctx.drawImage(video, x, y, fw, fh);
        } catch (e) {}
        i++;
        setTimeout(step, 40);
      };
    }
    step();
  }
  function sleepTimer() {
    askText("Sleep after minutes", "30", "0 turns the timer off", "Next").then(function (min) {
      var m = Number(min);
      window.clearTimeout(state.sleepId);
      if (!m || m < 0) {
        toast("Sleep timer off");
        return;
      }
      ask({
        title: "When " + m + " minutes pass",
        hint: "G9 can pause, or also shut the PC down (Windows).",
        choices: ["Pause G9", "Shut down the PC"],
      }).then(function (choice) {
        if (!choice) return;
        state.sleepId = window.setTimeout(function () {
          video.pause();
          toast("Sleep timer");
        }, m * 60 * 1000);
        if (choice === "Shut down the PC") {
          invoke("schedule_pc_shutdown", { seconds: Math.round(m * 60) })
            .then(function (msg) {
              toast(msg);
            })
            .catch(function () {
              toast("PC shutdown unavailable");
            });
        }
        toast("Sleep in " + m + " min");
      });
    });
  }
  function exportCfg() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("g9-") === 0) data[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "g9-settings.json";
    a.click();
    toast("Settings exported");
  }
  function importCfg() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var data = JSON.parse(r.result);
          Object.keys(data).forEach(function (k) {
            if (k.indexOf("g9-") === 0) localStorage.setItem(k, data[k]);
          });
          toast("Settings imported — reopen G9 to apply all");
        } catch (e) {
          toast("Invalid settings file");
        }
      };
      r.readAsText(f);
    };
    inp.click();
  }
  function broadcastRtmp() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    askText("Broadcast RTMP", "rtmp://", "Server URL, e.g. rtmp://host/live/key", "Start").then(function (url) {
      if (!url) return;
      startRtmp(url);
    });
  }
  function startRtmp(url) {
    toast("Starting broadcast…");
    invoke("rtmp_out", { path: state.mediaPath, rtmp: url })
      .then(function () {
        toast("Broadcast finished");
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function openPath() {
    askText("Open path", "", "Local path or UNC share", "Open").then(function (raw) {
      var p = (raw || "").trim();
      if (!p) return;
      state.mediaKind = p.indexOf("http") === 0 ? "url" : "file";
      state.mediaPath = p;
      var title = p.split(/[/\\]/).pop() || p;
      var src = p.indexOf("http") === 0 ? p : convertFileSrc(p);
      playUrl(title, src);
      maybeAutoSubs();
    });
  }
  function openDlna() {
    toast("Searching DLNA…");
    invoke("dlna_discover")
      .then(function (list) {
        state.dlnaServers = list || [];
        state.view = "dlna";
        paint();
        renderSheet();
        showChrome();
        toast(state.dlnaServers.length ? state.dlnaServers.length + " server(s)" : "No DLNA servers");
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function paintAb() {
    var btn = document.getElementById("btn-ab");
    if (!btn) return;
    btn.classList.toggle("on", state.abA != null);
    if (state.abA != null && state.abB != null) btn.title = "A–B " + fmt(state.abA) + "–" + fmt(state.abB);
    else if (state.abA != null) btn.title = "A set · click for B";
    else btn.title = "A–B loop";
  }
  function cycleAb() {
    if (state.abA == null) {
      state.abA = video.currentTime;
      toast("A · " + fmt(state.abA));
    } else if (state.abB == null) {
      state.abB = Math.max(video.currentTime, state.abA + 0.4);
      toast("A–B loop " + fmt(state.abA) + "–" + fmt(state.abB));
    } else {
      state.abA = null;
      state.abB = null;
      toast("A–B off");
    }
    paintAb();
  }
  function bindMediaSession() {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.title || "G9",
        artist: "G9",
      });
      navigator.mediaSession.setActionHandler("play", function () {
        video.play();
      });
      navigator.mediaSession.setActionHandler("pause", function () {
        video.pause();
      });
      navigator.mediaSession.setActionHandler("previoustrack", function () {
        zap(-1);
      });
      navigator.mediaSession.setActionHandler("nexttrack", function () {
        zap(1);
      });
      navigator.mediaSession.setActionHandler("seekbackward", function () {
        skip(-10);
      });
      navigator.mediaSession.setActionHandler("seekforward", function () {
        skip(10);
      });
    } catch (e) {}
  }
  function seekTimeFromEvent(ev) {
    var rect = seekEl.getBoundingClientRect();
    var x = (ev.clientX - rect.left) / rect.width;
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    return x * (video.duration || 0);
  }
  function mediaQuery() {
    return state.lastQuery || state.title || "";
  }

  function fetchBestSubs() {
    var q = mediaQuery();
    if (!q || q === "Ready") {
      toast("Open a video first");
      return Promise.resolve();
    }
    toast("Searching subtitles…");
    var path = state.mediaKind === "file" && state.mediaPath ? state.mediaPath : null;
    return invoke("apply_best_subtitles", {
      query: q,
      language: "en",
      path: path,
      generate: !!state.wantGenerate,
    }).finally(function () {
      state.wantGenerate = false;
    })
      .then(applyVtt)
      .catch(fail);
  }

  function maybeAutoSubs() {
    if (!state.autoSubs) return;
    if (state.mediaKind === "live") return;
    fetchBestSubs();
  }

  function readyStateName(n) {
    return ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA", "HAVE_FUTURE_DATA", "HAVE_ENOUGH_DATA"][n] || String(n);
  }

  function networkStateName(n) {
    return ["EMPTY", "IDLE", "LOADING", "NO_SOURCE"][n] || String(n);
  }

  function openInfo() {
    var reveal = document.getElementById("info-reveal");
    if (reveal) reveal.hidden = !(state.mediaKind === "file" && state.mediaPath);
    var rows = [];
    function add(k, v, wide) {
      if (v == null || v === "") return;
      rows.push({ k: k, v: String(v), wide: !!wide });
    }
    add("Title", state.title, true);
    add("Source", state.mediaPath || state.mediaUrl || video.currentSrc || "—", true);
    add("Kind", state.mediaKind || (state.current ? "live" : video.src ? "file" : "none"));
    add("Playing", video.paused ? "Paused" : "Playing");
    add("Current time", fmt(video.currentTime));
    add("Duration", isFinite(video.duration) ? fmt(video.duration) : "Live / unknown");
    if (isFinite(video.duration) && video.duration > 0) {
      add("Remaining", fmt(Math.max(0, video.duration - video.currentTime)));
    }
    if (video.videoWidth) add("Picture", video.videoWidth + " × " + video.videoHeight);
    add("Volume", Math.round(video.volume * 100) + "%" + (video.muted ? " (muted)" : ""));
    add("Playback rate", video.playbackRate + "×");
    add("Ready", readyStateName(video.readyState));
    add("Network", networkStateName(video.networkState));
    add("Loop", state.repeat ? "On" : "Off");
    add("Shuffle", state.shuffle ? "On" : "Off");
    add("TV mode", state.tv ? "On" : "Off");
    if (state.current) {
      add("Channel", String(state.current.number).padStart(3, "0") + "  " + state.current.name);
      add("Group", state.current.group_name);
      add("Favourite", state.current.is_favourite ? "Yes" : "No");
      add("Channel id", state.current.id);
    }
    if (state.subMeta) {
      add("Subtitles", "On · " + (state.subMeta.movie || state.subMeta.query));
      add("Sub source", state.subMeta.provider || "online");
      add("Sub language", state.subMeta.language);
      add("Sub release", state.subMeta.release);
    } else {
      add("Subtitles", state.subsOn ? "On" : "Off");
    }
    if (state.info) add("G9", "v" + state.info.version);
    add("Platform", navigator.platform || "WebView");
    add("Decoder", "WebView2 hardware (DXVA / D3D11)");
    if (video.getVideoPlaybackQuality) {
      var q = video.getVideoPlaybackQuality();
      add("Dropped frames", q.droppedVideoFrames + " / " + q.totalVideoFrames);
    }
    var list = document.getElementById("info-list");
    list.innerHTML = rows
      .map(function (r) {
        return (
          "<li" +
          (r.wide ? ' class="span2"' : "") +
          "><span>" +
          escapeHtml(r.k) +
          "</span><b>" +
          escapeHtml(r.v) +
          "</b></li>"
        );
      })
      .join("");
    infoModal.hidden = false;
    showChrome();
  }

  function showChrome() {
    app.classList.add("chrome-on");
    window.clearTimeout(state.hideTimer);
    if (
      !video.paused &&
      sheet.hidden &&
      importModal.hidden &&
      aboutModal.hidden &&
      infoModal.hidden &&
      eqPanel.hidden &&
      subPanel.hidden &&
      (!fxPanel || fxPanel.hidden) &&
      (!speedPanel || speedPanel.hidden) &&
      (!markPanel || markPanel.hidden)
    ) {
      state.hideTimer = window.setTimeout(function () {
        app.classList.remove("chrome-on");
        closeMenus();
      }, 2800);
    }
  }

  function closeMenus() {
    document.querySelectorAll(".menu.open").forEach(function (m) {
      m.classList.remove("open");
    });
  }

  function paintAudioStage() {
    var stage = document.getElementById("audio-stage");
    if (!stage) return;
    var only = !video.videoWidth && !video.videoHeight && (video.duration > 0 || !!video.currentSrc);
    var live = state.mediaKind === "live" || (video.duration === Infinity);
    stage.hidden = !only || live;
    if (stage.hidden) return;
    document.getElementById("audio-title").textContent = state.title || "Audio";
    var bits = [];
    if (video.duration && isFinite(video.duration)) bits.push(fmt(video.duration));
    bits.push("Audio track");
    var sub = document.getElementById("audio-sub");
    if (sub) sub.textContent = bits.join(" · ");
    stage.classList.toggle("playing", !video.paused);
  }
  var audioWarned = false;
  function warnIfSilent() {
    if (audioWarned) return;
    window.setTimeout(function () {
      if (state.mediaKind === "live" || video.paused) return;
      var decoded = video.webkitAudioDecodedByteCount;
      if (
        typeof decoded === "number" &&
        decoded === 0 &&
        !video.muted &&
        video.volume > 0
      ) {
        audioWarned = true;
        toast("No audio this engine can decode — try Convert / Save");
      }
    }, 3500);
  }
  function showGate() {
    var gate = document.getElementById("gate");
    if (!gate) return;
    // While the channel wall is open the user is choosing, not watching.
    if (tvVisible()) return;
    gate.hidden = false;
  }
  function hideGate() {
    var gate = document.getElementById("gate");
    if (gate) gate.hidden = true;
  }
  function setPlaying(on) {
    document.getElementById("play").innerHTML = on ? ICO_PAUSE : ICO_PLAY;
    document.getElementById("play").title = on ? "Pause" : "Play";
  }

  function setTitle(name) {
    state.title = name || "Ready";
    document.getElementById("status-text").textContent = state.title;
  }

  function updateMeta() {
    var bits = [];
    if (!video.videoWidth && (video.duration > 0 || !!video.currentSrc)) bits.push("Audio");
    if (video.videoWidth) bits.push(video.videoWidth + " × " + video.videoHeight);
    if (video.duration && isFinite(video.duration)) bits.push(fmt(video.duration));
    var ch = state.current;
    if (ch && ch.group_name) bits.push(ch.group_name);
    if (!bits.length) bits.push(state.info ? "v" + state.info.version : "G9");
    document.getElementById("info-meta").textContent = bits.join("   |   ");
  }

  function paint() {
    poster.style.display = state.current || video.src ? "none" : "grid";
    sheet.hidden = state.view === "watch";
    document.getElementById("btn-repeat").classList.toggle("on", state.repeat);
    document.getElementById("btn-shuffle").classList.toggle("on", state.shuffle);
    paintAb();
    app.classList.toggle("tv", state.tv);
    document.getElementById("btn-tv").classList.toggle("on", state.tv);
    document.getElementById("btn-tv").textContent = state.tv ? "Exit TV" : "TV Mode";
    tvOpenButton();
    if (state.info) {
      var legal = document.getElementById("legal");
      if (legal) legal.textContent = state.info.content_policy;
      var av = document.getElementById("about-ver");
      var ap = document.getElementById("about-policy");
      if (av) av.textContent = "v" + state.info.version;
      if (ap) ap.textContent = state.info.content_policy;
    }
  }

  function openSettings() {
    var modal = document.getElementById("settings-modal");
    var body = document.getElementById("settings-body");
    if (!modal || !body) return;
    var html = "";
    html +=
      '<div class="settings-group"><p class="settings-label">Display</p>' +
      '<div class="settings-row"><div class="txt"><b>TV Mode</b><span>Large type and spacing for a living-room screen</span></div>' +
      '<button type="button" data-set="tv" class="' + (state.tv ? "on" : "") + '">' + (state.tv ? "On" : "Off") + "</button></div></div>";

    html +=
      '<div class="settings-group"><p class="settings-label">Engine</p>' +
      '<div class="settings-row"><div class="txt"><b>FFmpeg</b><span id="set-ff">Checking…</span></div>' +
      '<button type="button" data-set="ffmpeg">Manage</button></div>' +
      '<div class="settings-row"><div class="txt"><b>Video downloads</b><span id="set-dl">YouTube, Instagram, Facebook and other sites</span></div>' +
      '<button type="button" data-set="dl">Open</button></div>' +
      '<div class="settings-row"><div class="txt"><b>About G9</b><span id="set-ver">Version, license, content policy</span></div>' +
      '<button type="button" data-set="about">Open</button></div></div>';

    html += '<div class="settings-group"><p class="settings-label">Playlists</p>';
    if (!(state.sources || []).length) {
      html += '<p class="settings-empty">No playlists yet — Media → Add playlist / IPTV.</p>';
    } else {
      state.sources.forEach(function (src) {
        html +=
          '<div class="settings-row"><div class="txt"><b>' +
          escapeHtml(src.name) +
          "</b><span>" +
          src.channel_count +
          " channels · " +
          escapeHtml(src.kind) +
          '</span></div><button type="button" class="ghost" data-del="' +
          src.id +
          '">Remove</button></div>';
      });
    }
    html += "</div>";
    body.innerHTML = html;

    var ver = document.getElementById("set-ver");
    if (ver && state.info) ver.textContent = "G9 v" + state.info.version + " · Apache-2.0 OR MIT";

    body.querySelectorAll("[data-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var what = btn.getAttribute("data-set");
        if (what === "tv") {
          setTv(!state.tv);
          openSettings();
        }
        if (what === "about") {
          modal.hidden = true;
          aboutModal.hidden = false;
        }
        if (what === "ffmpeg") {
          modal.hidden = true;
          openFfmpeg();
        }
        if (what === "dl") {
          modal.hidden = true;
          openDownloads();
        }
      });
    });
    body.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        invoke("delete_source", { id: Number(btn.getAttribute("data-del")) })
          .then(function () {
            return refresh();
          })
          .then(openSettings)
          .catch(function (e) {
            toast(shortError(e, "Could not remove that playlist"));
          });
      });
    });

    invoke("ffmpeg_status")
      .then(function (st) {
        var el = document.getElementById("set-ff");
        if (!el) return;
        el.textContent = st && st.available
          ? (st.managed ? "Installed in G9" : "Using the copy on PATH") + (st.version ? " · " + String(st.version).replace(/^ffmpeg version /, "") : "")
          : "Not installed — convert, chapters and repair are off";
      })
      .catch(function () {
        var el = document.getElementById("set-ff");
        if (el) el.textContent = "Not installed";
      });

    modal.hidden = false;
    showChrome();
  }

  function renderSheet() {
    var title = document.getElementById("sheet-title");
    var count = document.getElementById("sheet-count");
    if (state.view === "queue") {
      title.textContent = "Playlist";
      chipsEl.innerHTML = "";
      count.textContent = String(state.queue.length);
      if (!state.queue.length) {
        listEl.innerHTML = '<div class="empty">Queue is empty. Open files to add them.</div>';
        return;
      }
      listEl.innerHTML = state.queue
        .map(function (q, i) {
          return (
            '<div class="row' +
            (i === state.queueIdx ? " on" : "") +
            '" data-qi="' +
            i +
            '"><div class="n">' +
            (i + 1) +
            '</div><div class="meta"><b>' +
            escapeHtml(q.title) +
            "</b><span>queued</span></div><button type=\"button\" data-qrm=\"" +
            i +
            '">✕</button></div>'
          );
        })
        .join("");
      listEl.querySelectorAll("[data-qi]").forEach(function (row) {
        row.addEventListener("click", function (ev) {
          if (ev.target.closest("[data-qrm]")) return;
          var i = Number(row.getAttribute("data-qi"));
          var item = state.queue[i];
          if (!item) return;
          state.queueIdx = i;
          state.mediaKind = item.kind;
          state.mediaPath = item.path;
          playUrl(item.title, item.url);
        });
      });
      listEl.querySelectorAll("[data-qrm]").forEach(function (btn) {
        btn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          state.queue.splice(Number(btn.getAttribute("data-qrm")), 1);
          renderSheet();
        });
      });
      return;
    }
    if (state.view === "podcast") {
      title.textContent = "Podcast";
      chipsEl.innerHTML = "";
      count.textContent = String((state.podcasts || []).length);
      if (!state.podcasts || !state.podcasts.length) {
        listEl.innerHTML = '<div class="empty">Media → Subscribe to podcast.</div>';
        return;
      }
      listEl.innerHTML = state.podcasts
        .map(function (p, i) {
          return (
            '<div class="row" data-pod="' +
            i +
            '"><div class="n">▶</div><div class="meta"><b>' +
            escapeHtml(p.title) +
            "</b><span>episode</span></div></div>"
          );
        })
        .join("");
      listEl.querySelectorAll("[data-pod]").forEach(function (row) {
        row.addEventListener("click", function () {
          var p = state.podcasts[Number(row.getAttribute("data-pod"))];
          if (!p) return;
          state.mediaKind = "url";
          state.mediaPath = p.url;
          playUrl(p.title, p.url);
        });
      });
      return;
    }
    if (state.view === "dlna") {
      title.textContent = "DLNA";
      chipsEl.innerHTML = "";
      count.textContent = String((state.dlnaItems || state.dlnaServers || []).length);
      var rows = "";
      if (state.dlnaItems) {
        rows += '<div class="row" data-dlna-back="1"><div class="n">..</div><div class="meta"><b>Back</b><span>Servers</span></div></div>';
        state.dlnaItems.forEach(function (it) {
          rows +=
            '<div class="row" data-dlna-id="' +
            escapeHtml(it.id) +
            '" data-folder="' +
            (it.is_container ? "1" : "0") +
            '" data-url="' +
            escapeHtml(it.url || "") +
            '"><div class="n">' +
            (it.is_container ? "▣" : "▶") +
            '</div><div class="meta"><b>' +
            escapeHtml(it.title) +
            "</b><span>" +
            (it.is_container ? "Folder" : "Play") +
            "</span></div></div>";
        });
      } else {
        if (!state.dlnaServers.length) rows = '<div class="empty">No DLNA/UPnP servers on the LAN.</div>';
        state.dlnaServers.forEach(function (s, i) {
          rows +=
            '<div class="row" data-dlna-srv="' +
            i +
            '"><div class="n">TV</div><div class="meta"><b>' +
            escapeHtml(s.name) +
            "</b><span>" +
            escapeHtml(s.location) +
            "</span></div></div>";
        });
      }
      listEl.innerHTML = rows;
      listEl.querySelectorAll("[data-dlna-srv]").forEach(function (row) {
        row.addEventListener("click", function () {
          var s = state.dlnaServers[Number(row.getAttribute("data-dlna-srv"))];
          if (!s) return;
          state.dlnaControl = s.control_url;
          toast("Browsing " + s.name);
          invoke("dlna_browse", { controlUrl: s.control_url, objectId: "0" })
            .then(function (items) {
              state.dlnaItems = items;
              renderSheet();
            })
            .catch(fail);
        });
      });
      listEl.querySelectorAll("[data-dlna-back]").forEach(function (row) {
        row.addEventListener("click", function () {
          state.dlnaItems = null;
          renderSheet();
        });
      });
      listEl.querySelectorAll("[data-dlna-id]").forEach(function (row) {
        row.addEventListener("click", function () {
          if (row.getAttribute("data-folder") === "1") {
            invoke("dlna_browse", {
              controlUrl: state.dlnaControl,
              objectId: row.getAttribute("data-dlna-id"),
            })
              .then(function (items) {
                state.dlnaItems = items;
                renderSheet();
              })
              .catch(fail);
            return;
          }
          var url = row.getAttribute("data-url");
          if (url) {
            state.mediaKind = "url";
            state.mediaPath = url;
            playUrl(row.querySelector("b").textContent, url);
          }
        });
      });
      return;
    }
    if (state.view === "library") {
      title.textContent = "Library";
      chipsEl.innerHTML = "";
      count.textContent = String(state.history.length);
      if (!state.history.length) {
        listEl.innerHTML = '<div class="empty">Recently opened files and channels appear here.</div>';
        return;
      }
      listEl.innerHTML = state.history
        .map(function (h) {
          return (
            '<div class="row" data-hist="' +
            escapeHtml(h.url) +
            '" data-title="' +
            escapeHtml(h.title) +
            '"><div class="n">' +
            escapeHtml((h.kind || "f")[0].toUpperCase()) +
            '</div><div class="meta"><b>' +
            escapeHtml(h.title) +
            "</b><span>" +
            escapeHtml(h.played_at) +
            "</span></div></div>"
          );
        })
        .join("");
      listEl.querySelectorAll("[data-hist]").forEach(function (row) {
        row.addEventListener("click", function () {
          var url = row.getAttribute("data-hist") || "";
          state.mediaKind = url.indexOf("http") === 0 ? "url" : "file";
          state.mediaPath = url;
          playUrl(row.getAttribute("data-title"), url);
          maybeAutoSubs();
        });
      });
      return;
    }

    title.textContent = "Live TV";
    count.textContent = String(state.channels.length);
    refreshGuide();
    var chips = [
      '<button type="button" class="chip' +
        (!state.favOnly && state.group === "All" ? " on" : "") +
        '" data-group="All">All</button>',
      '<button type="button" class="chip' + (state.favOnly ? " on" : "") + '" data-fav="1">Favourites</button>',
    ];
    state.groups.forEach(function (g) {
      chips.push(
        '<button type="button" class="chip' +
          (state.group === g.name && !state.favOnly ? " on" : "") +
          '" data-group="' +
          escapeHtml(g.name) +
          '">' +
          escapeHtml(g.name) +
          "</button>"
      );
    });
    chipsEl.innerHTML = chips.join("");
    chipsEl.querySelectorAll("[data-group]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.favOnly = false;
        state.group = el.getAttribute("data-group") || "All";
        loadChannels();
      });
    });
    var fav = chipsEl.querySelector("[data-fav]");
    if (fav)
      fav.addEventListener("click", function () {
        state.favOnly = true;
        loadChannels();
      });

    if (!state.channels.length) {
      listEl.innerHTML = '<div class="empty">Media → Add playlist.</div>';
      return;
    }
    listEl.innerHTML = state.channels
      .map(function (c) {
        var on = state.current && state.current.id === c.id ? " on" : "";
        return (
          '<div class="row' +
          on +
          '" data-ch="' +
          c.id +
          '"><div class="n">' +
          String(c.number).padStart(3, "0") +
          '</div><div class="meta"><b>' +
          escapeHtml(c.name) +
          "</b><span>" +
          escapeHtml(c.group_name || "") +
          '</span><span class="epg" data-epg></span></div><button type="button" class="star' +
          (c.is_favourite ? " on" : "") +
          '" data-star="' +
          c.id +
          '">★</button></div>'
        );
      })
      .join("");
    listEl.querySelectorAll("[data-ch]").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-star]")) return;
        var id = Number(row.getAttribute("data-ch"));
        var ch = state.channels.find(function (c) {
          return c.id === id;
        });
        if (ch) tune(ch);
      });
    });
    listEl.querySelectorAll("[data-star]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        invoke("toggle_favourite", { id: Number(btn.getAttribute("data-star")) }).then(loadChannels).catch(fail);
      });
    });
    paintGuide();
  }

  function refresh() {
    return invoke("app_info")
      .then(function (info) {
        state.info = info;
        return invoke("stats");
      })
      .then(function (stats) {
        state.stats = stats;
        return invoke("list_sources");
      })
      .then(function (sources) {
        state.sources = sources;
        return invoke("list_groups");
      })
      .then(function (groups) {
        state.groups = groups;
        return invoke("list_history");
      })
      .then(function (history) {
        state.history = history;
        return loadChannels();
      })
      .catch(fail);
  }

  function loadChannels() {
    return invoke("list_channels", {
      group: state.favOnly ? null : state.group,
      query: state.query || null,
      favouritesOnly: state.favOnly,
      limit: 250,
      offset: 0,
    })
      .then(function (chs) {
        state.channels = chs;
        paint();
        renderSheet();
      })
      .catch(fail);
  }

  function showZap(ch) {
    zapEl.classList.add("show");
    zapEl.innerHTML =
      '<div class="num">' +
      String(ch.number).padStart(3, "0") +
      '</div><div class="ch">' +
      escapeHtml(ch.name) +
      '</div><div class="now">' +
      escapeHtml(ch.group_name || "") +
      "</div>";
    window.setTimeout(function () {
      zapEl.classList.remove("show");
    }, 2000);
  }

  function tune(ch) {
    state.current = ch;
    try {
      localStorage.setItem("g9.tv.last", String(ch.id));
    } catch (e) {}
    state.mediaKind = "live";
    state.mediaPath = ch.stream_url;
    showZap(ch);
    playUrl(ch.name, ch.stream_url);
    invoke("add_history", { title: ch.name, url: ch.stream_url, kind: "live", position: 0, duration: 0 }).catch(function () {});
    renderSheet();
  }

  function stopHls() {
    if (hlsSession && hlsSession.abort) hlsSession.abort();
    hlsSession = null;
  }

  function playUrl(title, url) {
    setTitle(title);
    state.lastQuery = title || url || "";
    state.mediaUrl = url || "";
    enqueue(title, url);
    poster.style.display = "none";
    stopHls();
    clearSubs();
    state.abA = null;
    state.abB = null;
    paintAb();
    video.removeAttribute("src");
    video.load();
    var isHls = /\.m3u8(\?|$)/i.test(url);
    var nativeHls = video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl");
    if (isHls && !nativeHls) {
      hlsSession = playHlsMse(video, url, fail);
      return;
    }
    video.src = url;
    bindMediaSession();
    video.play().then(function () {
      setPlaying(true);
      updateMeta();
      paintAudioStage();
      hideGate();
      unlockAudio();
    }).catch(function () {
      // Autoplay policy or an unsupported container: give the user one tap.
      showGate();
    });
  }

  function playHlsMse(el, url, onError) {
    var aborted = false;
    if (!window.MediaSource) {
      onError(new Error("HLS not supported"));
      return { abort: function () {} };
    }
    var ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    ms.addEventListener("sourceopen", function () {
      fetch(url)
        .then(function (r) {
          return r.text();
        })
        .then(function (text) {
          var lines = text.split(/\r?\n/);
          var segs = [];
          var pending = false;
          var variants = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) variants.push((lines[i + 1] || "").trim());
            else if (line.indexOf("#EXTINF") === 0) pending = true;
            else if (pending && line && line[0] !== "#") {
              segs.push(new URL(line, url).href);
              pending = false;
            }
          }
          if (variants.length && !segs.length) return playHlsMse(el, new URL(variants[0], url).href, onError);
          var mime = "video/mp2t";
          var sb = ms.addSourceBuffer(mime);
          var n = 0;
          function next() {
            if (aborted || n >= segs.length) {
              try {
                if (ms.readyState === "open") ms.endOfStream();
              } catch (e) {}
              return el.play();
            }
            return fetch(segs[n++])
              .then(function (r) {
                return r.arrayBuffer();
              })
              .then(function (buf) {
                return new Promise(function (res, rej) {
                  sb.addEventListener("updateend", res, { once: true });
                  try {
                    sb.appendBuffer(buf);
                  } catch (e) {
                    rej(e);
                  }
                });
              })
              .then(next);
          }
          return next();
        })
        .then(function () {
          setPlaying(true);
        })
        .catch(onError);
    });
    return {
      abort: function () {
        aborted = true;
      },
    };
  }

  function togglePlay() {
    if (video.paused) video.play();
    else video.pause();
  }
  function stop() {
    video.pause();
    stopHls();
    video.removeAttribute("src");
    video.load();
    state.current = null;
    state.lastQuery = "";
    state.mediaUrl = "";
    state.mediaPath = "";
    state.mediaKind = "";
    clearSubs();
    setPlaying(false);
    poster.style.display = "grid";
    setTitle("Ready");
    document.getElementById("info-meta").textContent = "Open a file to begin";
    paint();
  }
  function skip(dt) {
    if (isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + dt);
  }
  function zap(dir) {
    if (!state.channels.length) {
      state.view = "live";
      paint();
      renderSheet();
      return;
    }
    if (!state.current) {
      tune(state.channels[0]);
      return;
    }
    invoke("neighbours", { id: state.current.id }).then(function (pair) {
      var id = dir > 0 ? pair[1] : pair[0];
      if (state.shuffle && state.channels.length) {
        var pick = state.channels[Math.floor(Math.random() * state.channels.length)];
        tune(pick);
        return;
      }
      if (id == null) return;
      var ch = state.channels.find(function (c) {
        return c.id === id;
      });
      if (ch) tune(ch);
      else
        invoke("get_channel", { id: id }).then(function (found) {
          if (found) tune(found);
        });
    });
  }

  function doImport() {
    var name = document.getElementById("imp-name").value.trim() || "Playlist";
    var url = document.getElementById("imp-url").value.trim();
    var text = document.getElementById("imp-text").value.trim();
    var job = url
      ? invoke("import_m3u_url", { name: name, url: url })
      : text
        ? invoke("import_m3u_text", { name: name, text: text, origin: "url" })
        : null;
    if (!job) return fail(new Error("Paste a playlist or enter a URL"));
    job
      .then(function (r) {
        importModal.hidden = true;
        state.view = "live";
        setTitle("Imported " + r.channel_count + " channels");
        return refresh();
      })
      .catch(fail);
  }

  document.querySelectorAll(".menu-btn").forEach(function (btn) {
    if (btn.id === "btn-tv") return;
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var menu = btn.parentElement;
      var open = menu.classList.contains("open");
      closeMenus();
      if (!open) menu.classList.add("open");
      showChrome();
    });
  });
  document.addEventListener("click", closeMenus);

  document.getElementById("btn-file").addEventListener("click", function () {
    openDialog({
      multiple: false,
      filters: [
        {
          name: "Video and audio",
          extensions: [
            "mp4", "mkv", "webm", "m4v", "mov", "avi", "ts", "mpg", "mpeg",
            "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma",
          ],
        },
        { name: "All files", extensions: ["*"] },
      ],
    }).then(function (path) {
      if (typeof path !== "string") return;
      var title = path.split(/[/\\]/).pop() || path;
      state.mediaKind = "file";
      state.mediaPath = path;
      playUrl(title, convertFileSrc(path));
      maybeAutoSubs();
      invoke("add_history", { title: title, url: path, kind: "file", position: 0, duration: 0 }).catch(function () {});
    }).catch(fail);
  });
  document.getElementById("btn-path").addEventListener("click", openPath);
  document.getElementById("btn-podcast").addEventListener("click", openPodcast);
  document.getElementById("btn-dlna").addEventListener("click", openDlna);
  document.getElementById("btn-url").addEventListener("click", function () {
    askText("Open URL", "https://", "Stream, HLS playlist or direct file link", "Open").then(function (url) {
      if (!url) return;
      state.mediaKind = "url";
      state.mediaPath = url;
      playUrl(url.split(/[/\\]/).pop() || url, url);
      maybeAutoSubs();
    });
  });
  document.getElementById("btn-import").addEventListener("click", function () {
    importModal.hidden = false;
    showChrome();
  });

  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function () {
      var target = el.getAttribute("data-view");
      if (target === "settings") {
        openSettings();
        return;
      }
      if (target === "live" && state.tv) {
        tvShow();
        return;
      }
      state.view = target;
      paint();
      renderSheet();
      showChrome();
      if (state.view !== "watch") refresh();
    });
  });
  document.querySelectorAll("[data-act]").forEach(function (el) {
    el.addEventListener("click", function () {
      var act = el.getAttribute("data-act");
      if (act === "toggle") togglePlay();
      if (act === "stop") stop();
      if (act === "seek-back") skip(-10);
      if (act === "seek-fwd") skip(10);
      if (act === "mute") video.muted = !video.muted;
      if (act === "fs" && video.requestFullscreen) video.requestFullscreen();
      if (act === "diag") {
        state.showDiag = !state.showDiag;
        diag.classList.toggle("on", state.showDiag);
      }
      if (act === "about") openAbout();
      if (act === "info") openInfo();
      if (act === "eq") {
        buildEqUi();
        applyEq();
        setBoost(state.boost, true);
        eqPanel.hidden = false;
        subPanel.hidden = true;
        showChrome();
      }
      if (act === "substyle") {
        subPanel.hidden = false;
        eqPanel.hidden = true;
        document.getElementById("sub-delay-val").textContent =
          (state.subDelay >= 0 ? "+" : "") + state.subDelay.toFixed(2) + "s";
        document.getElementById("sub-size").value = String(state.subSize);
        document.getElementById("sub-size-val").textContent = state.subSize + "px";
        showChrome();
      }
      if (act === "snap") snapshot();
      if (act === "gif") exportGif();
      if (act === "gen") {
        state.wantGenerate = true;
        toast("Generating captions…");
        fetchBestSubs();
      }
      if (act === "subs") fetchBestSubs();
      if (act === "filters") {
        fxPanel.hidden = false;
        showChrome();
      }
      if (act === "speed") {
        speedPanel.hidden = false;
        showChrome();
      }
      if (act === "marks") {
        renderMarks();
        markPanel.hidden = false;
        showChrome();
      }
      if (act === "record") toggleRecord();
      if (act === "webcamrtc") recordWebcam();
      if (act === "convert") convertMedia();
      if (act === "360") toggle360();
      if (act === "livetx") setLiveTx();
      if (act === "ontop") toggleOnTop();
      if (act === "viz") toggleViz();
      if (act === "chapters") loadChapters();
      if (act === "cues") showCues();
      if (act === "linerep") {
        state.lineRepeat = !state.lineRepeat;
        toast(state.lineRepeat ? "Pause after each line" : "Line repeat off");
      }
      if (act === "sleep") sleepTimer();
      if (act === "ffmpeg") openFfmpeg();
      if (act === "newwin") openNewWindow();
      if (act === "transcript") openTranscript();
      if (act === "shader") openShaderPanel();
      if (act === "pcoff") cancelPcShutdown();
      if (act === "poster") scenePoster();
      if (act === "inspect") inspectFile();
      if (act === "rtmp") broadcastRtmp();
      if (act === "exportcfg") exportCfg();
      if (act === "importcfg") importCfg();
      if (act === "ad") enableAudioDescription();
      if (act === "translate") translateCaptions();
      if (act === "extract") extractAudio();
      if (act === "repair") repairFile();
      if (act === "subs-off") {
        state.autoSubs = false;
        try {
          localStorage.setItem("g9-subs", "0");
        } catch (e2) {}
        clearSubs();
        toast("Subtitles off");
      }
    });
  });

  var gateBtn = document.getElementById("gate-play");
  if (gateBtn)
    gateBtn.addEventListener("click", function () {
      video.play().then(hideGate).catch(function () {
        toast("This file can't play here");
        hideGate();
      });
    });
  document.getElementById("play").addEventListener("click", togglePlay);
  document.getElementById("seek-back").addEventListener("click", function () {
    skip(-10);
  });
  document.getElementById("seek-fwd").addEventListener("click", function () {
    skip(10);
  });
  document.getElementById("zap-up").addEventListener("click", function () {
    zap(-1);
  });
  document.getElementById("zap-down").addEventListener("click", function () {
    zap(1);
  });
  document.getElementById("btn-playlist").addEventListener("click", function () {
    state.view = state.view === "live" ? "watch" : "live";
    paint();
    renderSheet();
    showChrome();
  });
  document.getElementById("btn-cc").addEventListener("click", function () {
    if (state.subsOn) {
      state.autoSubs = false;
      try {
        localStorage.setItem("g9-subs", "0");
      } catch (e2) {}
      clearSubs();
      toast("Subtitles off");
      return;
    }
    fetchBestSubs();
  });
  document.getElementById("btn-info").addEventListener("click", openInfo);
  document.getElementById("info-close").addEventListener("click", function () {
    infoModal.hidden = true;
  });
  document.getElementById("info-subs").addEventListener("click", function () {
    fetchBestSubs();
  });
  document.getElementById("info-reveal").addEventListener("click", function () {
    if (state.mediaKind !== "file" || !state.mediaPath) return;
    invoke("reveal_in_folder", { path: state.mediaPath })
      .then(function (msg) {
        toast(msg);
      })
      .catch(function (e) {
        toast(shortError(e, "Could not open the folder"));
      });
  });
  document.getElementById("btn-gear").addEventListener("click", openSettings);
  document.getElementById("settings-close").addEventListener("click", function () {
    document.getElementById("settings-modal").hidden = true;
  });
  document.getElementById("settings-export").addEventListener("click", exportCfg);
  document.getElementById("settings-import").addEventListener("click", importCfg);
  document.getElementById("btn-repeat").addEventListener("click", function () {
    state.repeat = !state.repeat;
    paint();
  });
  document.getElementById("btn-shuffle").addEventListener("click", function () {
    state.shuffle = !state.shuffle;
    paint();
  });
  document.getElementById("btn-ab").addEventListener("click", cycleAb);
  document.getElementById("btn-snap").addEventListener("click", snapshot);
  document.getElementById("btn-gif").addEventListener("click", exportGif);
  document.getElementById("sub-pos").addEventListener("input", function (ev) {
    setCuePos(Number(ev.target.value));
  });
  ["fx-br", "fx-ct", "fx-sat", "fx-sh"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", applyVideoFilter);
  });
  document.getElementById("fx-reset").addEventListener("click", function () {
    document.getElementById("fx-br").value = "100";
    document.getElementById("fx-ct").value = "100";
    document.getElementById("fx-sat").value = "100";
    document.getElementById("fx-sh").value = "0";
    applyVideoFilter();
  });
  document.getElementById("fx-close").addEventListener("click", function () {
    fxPanel.hidden = true;
  });
  document.getElementById("speed").addEventListener("input", function (ev) {
    setSpeed(ev.target.value);
  });
  document.getElementById("speed-pitch").addEventListener("change", function () {
    setSpeed(document.getElementById("speed").value);
  });
  document.getElementById("speed-close").addEventListener("click", function () {
    speedPanel.hidden = true;
  });
  document.getElementById("mark-add").addEventListener("click", addMark);
  document.getElementById("mark-close").addEventListener("click", function () {
    markPanel.hidden = true;
  });
  ["ff", "tr", "shader"].forEach(function (id) {
    var btn = document.getElementById(id + "-close");
    var panel = document.getElementById(id === "tr" ? "transcript-panel" : id + "-panel");
    if (btn && panel)
      btn.addEventListener("click", function () {
        panel.hidden = true;
        if (id === "shader") stopShader();
      });
  });
  (function ffWiring() {
    var inst = document.getElementById("ff-install");
    if (inst) inst.addEventListener("click", installFfmpeg);
    var rem = document.getElementById("ff-remove");
    if (rem) rem.addEventListener("click", removeFfmpeg);
    var api = tauri();
    if (api && api.event && api.event.listen) {
      api.event.listen("ffmpeg-progress", function (ev) {
        var pct = ev && ev.payload != null ? ev.payload : 0;
        var el = document.getElementById("ff-state");
        if (el && el.textContent.indexOf("Downloading") === 0) {
          el.textContent = "Downloading FFmpeg… " + pct + "%";
        }
        // A download that needs the engine shows the same percentage.
        var dlEl = document.getElementById("dl-state");
        if (dlEl && dlEl.textContent.indexOf("Setting up the media engine") === 0) {
          dlEl.textContent = "Installing the media engine… " + pct + "%";
        }
        var startBtn = document.getElementById("dl-start");
        if (startBtn && startBtn.textContent.indexOf("Preparing the media engine") === 0) {
          startBtn.textContent = "Preparing the media engine… " + pct + "%";
        }
      });
    }
  })();
  var cueClose = document.getElementById("cue-close");
  if (cueClose)
    cueClose.addEventListener("click", function () {
      document.getElementById("cue-panel").hidden = true;
    });
  (function gestures() {
    var startX = 0;
    var startY = 0;
    var startT = 0;
    var startVol = 1;
    app.addEventListener(
      "touchstart",
      function (ev) {
        if (!ev.touches.length) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        startT = video.currentTime;
        startVol = video.volume;
      },
      { passive: true }
    );
    app.addEventListener(
      "touchend",
      function (ev) {
        var t = ev.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - startX;
        var dy = t.clientY - startY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          video.currentTime = Math.max(0, startT + (dx / app.clientWidth) * 60);
        } else if (Math.abs(dy) > 60) {
          video.volume = Math.max(0, Math.min(1, startVol - dy / 300));
          paintMute();
        }
      },
      { passive: true }
    );
  })();
  if ("preservesPitch" in video) video.preservesPitch = true;
  document.querySelectorAll("[data-cue-color]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setCueColor(btn.getAttribute("data-cue-color"));
    });
  });
  document.getElementById("eq-close").addEventListener("click", function () {
    eqPanel.hidden = true;
  });
  document.getElementById("sub-close").addEventListener("click", function () {
    subPanel.hidden = true;
  });
  document.getElementById("eq-boost").addEventListener("input", function (ev) {
    setBoost(Number(ev.target.value), true);
  });
  document.querySelectorAll("[data-eq]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-eq");
      state.eq = (EQ_PRESETS[name] || EQ_PRESETS.flat).slice();
      applyEq();
      toast("EQ · " + name);
    });
  });
  document.getElementById("sub-delay-down").addEventListener("click", function () {
    setSubDelay(-0.1);
  });
  document.getElementById("sub-delay-up").addEventListener("click", function () {
    setSubDelay(0.1);
  });
  document.getElementById("sub-delay-zero").addEventListener("click", function () {
    setSubDelay(0, true);
  });
  document.getElementById("sub-size").addEventListener("input", function (ev) {
    setSubSize(Number(ev.target.value));
  });
  function setTv(on) {
    state.tv = !!on;
    try {
      localStorage.setItem("g9-tv", state.tv ? "1" : "0");
    } catch (e) {}
    paint();
    showChrome();
    if (state.tv) {
      if (app.requestFullscreen) app.requestFullscreen().catch(function () {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    }
  }
  document.getElementById("btn-tv").addEventListener("click", toggleTv);
  document.getElementById("btn-fav").addEventListener("click", function () {
    if (!state.current) {
      toast("Tune a live channel first");
      return;
    }
    invoke("toggle_favourite", { id: state.current.id }).then(loadChannels).catch(fail);
  });
  document.getElementById("fs").addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (app.requestFullscreen) app.requestFullscreen();
  });
  document.getElementById("sheet-close").addEventListener("click", function () {
    state.view = "watch";
    paint();
  });
  document.getElementById("q").addEventListener("input", function (ev) {
    state.query = ev.target.value;
    loadChannels();
  });
  function openAbout() {
    if (state.info) {
      document.getElementById("about-ver").textContent = "v" + state.info.version;
      document.getElementById("about-policy").textContent = state.info.content_policy;
    }
    aboutModal.hidden = false;
    showChrome();
  }
  document.getElementById("about-close").addEventListener("click", function () {
    aboutModal.hidden = true;
  });
  document.getElementById("imp-cancel").addEventListener("click", function () {
    importModal.hidden = true;
  });
  document.getElementById("imp-go").addEventListener("click", doImport);
  document.getElementById("imp-file").addEventListener("click", function () {
    var name = document.getElementById("imp-name").value.trim() || "Playlist";
    openDialog({
      multiple: false,
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "txt"] }],
    })
      .then(function (path) {
        if (typeof path !== "string") return null;
        return invoke("import_m3u_file", { name: name, path: path });
      })
      .then(function (r) {
        if (!r) return;
        importModal.hidden = true;
        state.view = "live";
        return refresh();
      })
      .catch(fail);
  });

  seekEl.addEventListener("input", function () {
    if (video.duration) video.currentTime = (Number(seekEl.value) / 1000) * video.duration;
  });
  function paintMute() {
    var btn = document.getElementById("btn-mute");
    if (!btn) return;
    var off = video.muted || video.volume === 0;
    btn.innerHTML = off ? ICO_MUTE : ICO_VOL;
    btn.title = off ? "Unmute" : "Mute";
    btn.classList.toggle("on", off);
    paintVol();
  }
  function paintVol() {
    var pct = Math.round((video.muted ? 0 : video.volume) * 100);
    var inp = document.getElementById("vol");
    if (inp) {
      if (document.activeElement !== inp) inp.value = String(pct);
      inp.style.setProperty("--p", pct + "%");
    }
    var lab = document.getElementById("vol-val");
    if (lab) lab.textContent = String(pct);
  }
  function nudgeVolume(delta) {
    video.volume = Math.max(0, Math.min(1, Math.round((video.volume + delta) * 100) / 100));
    if (video.volume > 0) video.muted = false;
    paintMute();
  }
  document.getElementById("btn-mute").addEventListener("click", function () {
    video.muted = !video.muted;
    paintMute();
  });
  document.getElementById("vol").addEventListener("input", function (ev) {
    video.volume = Number(ev.target.value) / 100;
    if (video.volume > 0) video.muted = false;
    paintMute();
  });
  var volWrap = document.getElementById("vol-wrap");
  if (volWrap)
    volWrap.addEventListener(
      "wheel",
      function (ev) {
        ev.preventDefault();
        nudgeVolume(ev.deltaY < 0 ? 0.05 : -0.05);
        showChrome();
      },
      { passive: false }
    );
  video.addEventListener("volumechange", paintMute);
  paintMute();

  video.addEventListener("timeupdate", function () {
    document.getElementById("time-cur").textContent = fmt(video.currentTime);
    document.getElementById("time-end").textContent = fmt(video.duration || 0);
    var p = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    seekEl.value = String(Math.floor(p * 10));
    seekEl.style.setProperty("--p", p + "%");
    paintCue();
    syncTranscript();
    if (state.abA != null && state.abB != null && video.currentTime >= state.abB) {
      video.currentTime = state.abA;
    }
    if (!state.resumeTimer) {
      state.resumeTimer = window.setTimeout(function () {
        state.resumeTimer = 0;
        saveResume();
      }, 4000);
    }
    if (navigator.mediaSession && navigator.mediaSession.setPositionState && video.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: video.duration,
          playbackRate: video.playbackRate,
          position: video.currentTime,
        });
      } catch (e) {}
    }
  });
  video.addEventListener("loadedmetadata", function () {
    updateMeta();
    if (state.subsOn) showCueTrack();
    restoreResume();
    paintAudioStage();
  });
  video.addEventListener("play", function () {
    var stage = document.getElementById("audio-stage");
    if (stage) stage.classList.add("playing");
    setPlaying(true);
    showChrome();
    bindMediaSession();
    unlockAudio();
    warnIfSilent();
  });
  video.addEventListener("pause", function () {
    var stage = document.getElementById("audio-stage");
    if (stage) stage.classList.remove("playing");
    setPlaying(false);
    showChrome();
    saveResume();
  });
  video.addEventListener("ended", function () {
    if (state.repeat) {
      video.currentTime = 0;
      video.play();
    } else if (playQueueNext()) {
      return;
    } else setPlaying(false);
  });
  video.addEventListener("error", function () {
    fail(new Error("Playback error"));
  });

  document.getElementById("win-min").addEventListener("click", function () {
    win().then(function (w) {
      if (w) w.minimize();
    });
  });
  document.getElementById("win-max").addEventListener("click", function () {
    win().then(function (w) {
      if (w) w.toggleMaximize();
    });
  });
  function snapWindow(side) {
    invoke("snap_window", { side: side })
      .then(function (msg) {
        toast(msg);
      })
      .catch(function (e) {
        toast(shortError(e, "Could not snap the window"));
      });
  }
  ["left", "right"].forEach(function (side) {
    var btn = document.getElementById("win-snap-" + side);
    if (btn) {
      btn.addEventListener("click", function () {
        snapWindow(side);
      });
    }
  });
  document.getElementById("win-close").addEventListener("click", function () {
    win().then(function (w) {
      if (w) w.close();
    });
  });

  app.addEventListener("mousemove", showChrome);
  window.addEventListener("contextmenu", function (ev) {
    var t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    ev.preventDefault();
  });
  window.addEventListener("dragstart", function (ev) {
    if (ev.target && ev.target.tagName !== "INPUT") ev.preventDefault();
  });
  document.addEventListener("selectstart", function (ev) {
    var t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    ev.preventDefault();
  });
  ["pointerdown", "keydown"].forEach(function (evt) {
    window.addEventListener(evt, unlockAudio, { passive: true });
  });
  showChrome();

  window.addEventListener("keydown", function (ev) {
    var typing = ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA");
    if (ev.ctrlKey && ev.altKey) {
      var map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "full", ArrowDown: "bottom" };
      var side = map[ev.key];
      if (side) {
        ev.preventDefault();
        snapWindow(side);
        return;
      }
    }
    if (ev.key === "Escape") {
      if (tvVisible()) {
        ev.preventDefault();
        tvHide();
        return;
      }
      importModal.hidden = true;
      aboutModal.hidden = true;
      infoModal.hidden = true;
      var settingsModal = document.getElementById("settings-modal");
      if (settingsModal) settingsModal.hidden = true;
      hideGate();
      eqPanel.hidden = true;
      subPanel.hidden = true;
      if (fxPanel) fxPanel.hidden = true;
      if (speedPanel) speedPanel.hidden = true;
      if (markPanel) markPanel.hidden = true;
      hideGate();
      if (state.tv) {
        setTv(false);
        return;
      }
      state.view = "watch";
      paint();
      return;
    }
    if (state.tv && (ev.key === "Enter" || ev.key === "MediaPlayPause")) {
      ev.preventDefault();
      togglePlay();
      return;
    }
    if (typing) return;
    if (ev.key === " ") {
      ev.preventDefault();
      togglePlay();
    }
    if (ev.key === "ArrowLeft") skip(-10);
    if (ev.key === "ArrowRight") skip(10);
    if (ev.key === "ArrowUp") zap(-1);
    if (ev.key === "ArrowDown") zap(1);
    if (ev.key === "f" || ev.key === "F") {
      if (app.requestFullscreen) app.requestFullscreen();
    }
    if (ev.key === "d" || ev.key === "D") {
      state.showDiag = !state.showDiag;
      diag.classList.toggle("on", state.showDiag);
      diag.textContent = "G9 " + (state.info ? state.info.version : "") + "\n" + (state.title || "");
    }
    if (ev.key === "[" || ev.key === "z" || ev.key === "Z") setSubDelay(-0.1);
    if (ev.key === "]" || ev.key === "x" || ev.key === "X") setSubDelay(0.1);
    if (ev.key === "a" || ev.key === "A") cycleAb();
    if (ev.key === "s" || ev.key === "S") snapshot();
    if (ev.key === "e" || ev.key === "E") {
      buildEqUi();
      eqPanel.hidden = !eqPanel.hidden;
      if (!eqPanel.hidden) subPanel.hidden = true;
    }
    if (ev.key === "." || ev.key === ">") frameStep(1);
    if (ev.key === "," || ev.key === "<") frameStep(-1);
    if (ev.key === "m" || ev.key === "M") addMark();
    if (ev.key === "[" && ev.shiftKey) setSpeed((video.playbackRate - 0.25) * 100);
    if (ev.key === "]" && ev.shiftKey) setSpeed((video.playbackRate + 0.25) * 100);
  });

  try {
    if (localStorage.getItem("g9-tv") === "1") setTv(true);
    if (localStorage.getItem("g9-subs") === "1") state.autoSubs = true;
    var cue = Number(localStorage.getItem("g9-cue"));
    if (cue) setSubSize(cue);
  } catch (e) {}
  window.addEventListener("beforeunload", saveResume);
  buildEqUi();
  try {
    var api = tauri();
    if (api && api.event && api.event.listen) {
      api.event.listen("g9-ipc", function (ev) {
        handleIpc(ev && ev.payload);
      });
    }
  } catch (e3) {}
  (function popupInit() {
    var q = null;
    try {
      q = new URLSearchParams(window.location.search);
    } catch (e) {
      q = null;
    }
    if (!q || q.get("popup") !== "1") return;
    document.body.classList.add("popup");
    if (poster) poster.style.display = "none";
    var src = q.get("src");
    if (!src) {
      toast("Open a file in this window");
      return;
    }
    state.mediaUrl = src;
    state.mediaKind = /^https?:/i.test(src) ? "url" : "file";
    playUrl(decodeURIComponent((src.split("/").pop() || "G9").split("?")[0]), src);
    video.play().catch(function () {});
  })();

  /* ---------- web video downloads ---------- */
  var dlPick = null;
  var dlPaintAt = 0;

  function humanBytes(n) {
    n = Number(n) || 0;
    if (n <= 0) return "";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n = n / 1024;
      i++;
    }
    return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + " " + units[i];
  }

  function humanEta(sec) {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return "";
    if (sec < 60) return Math.round(sec) + "s left";
    if (sec < 3600) return Math.round(sec / 60) + " min left";
    return Math.round(sec / 3600) + " h left";
  }

  function prettyDlError(raw) {
    var msg = String(raw || "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/^ERROR:\s*/i, "")
      .replace(/^\[[a-z0-9_.-]+\]\s*[^:]*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!msg) return "";
    if (/requested format is not available/i.test(msg)) return "That video offers no downloadable format";
    if (/sign in to confirm|not a bot|cookies/i.test(msg)) return "This site wants a sign-in for that video";
    if (/video unavailable|private video|removed by the uploader/i.test(msg)) return "That video is not available";
    if (/ffmpeg/i.test(msg)) return "The media engine could not be prepared";
    if (/unsupported url|no video formats found/i.test(msg)) return "No video found on that page";
    return msg.slice(0, 140);
  }

  function dlError(e) {
    var msg = String((e && e.message) || e || "").trim();
    if (!msg) return "Could not read that link";
    if (/not installed|not found|no downloader/i.test(msg)) return "Downloader is not installed";
    return prettyDlError(msg) || shortError(msg, "Could not read that link").slice(0, 120);
  }

  function dlTool() {
    return invoke("dl_tool")
      .then(function (st) {
        var el = document.getElementById("dl-state");
        var inst = document.getElementById("dl-install");
        var folder = document.getElementById("dl-folder");
        if (el) {
          if (!st) el.textContent = "Unavailable";
          else if (st.available)
            el.textContent =
              "Downloader ready" + (st.version ? " · " + st.version : "") + (st.managed ? " · managed copy" : "");
          else el.textContent = "Downloader not installed";
        }
        if (inst) {
          inst.hidden = !!(st && st.available);
          inst.textContent = "Install downloader";
        }
        if (folder) folder.hidden = !(st && st.download_dir);
        state.dlTool = st || null;
        return st;
      })
      .catch(function () {
        return null;
      });
  }

  function dlStatusWord(job) {
    switch (job.status) {
      case "running":
        return job.percent > 0 ? Math.round(job.percent) + "%" : "Starting";
      case "queued":
        return "Queued";
      case "paused":
        return job.percent > 0 ? "Paused · " + Math.round(job.percent) + "%" : "Paused";
      case "done":
        return "Done";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Stopped";
      default:
        return String(job.status || "");
    }
  }

  function dlDetail(job) {
    if (job.status === "failed")
      return { text: prettyDlError(job.error) || "Could not finish this one", err: true };
    if (job.status === "done") {
      var size = humanBytes(job.total || job.downloaded);
      return { text: size ? size + " saved" : "Saved", err: false };
    }
    if (job.status === "paused" || job.status === "cancelled")
      return { text: humanBytes(job.downloaded) + (job.total ? " of " + humanBytes(job.total) : ""), err: false };
    var bits = [];
    if (job.downloaded || job.total)
      bits.push(humanBytes(job.downloaded) + (job.total ? " of " + humanBytes(job.total) : ""));
    if (job.speed) bits.push(humanBytes(job.speed) + "/s");
    var eta = humanEta(job.eta);
    if (eta) bits.push(eta);
    return { text: bits.join(" · ") || "Working…", err: false };
  }

  function dlJobHtml(job) {
    var pct = Math.max(0, Math.min(100, Number(job.percent) || 0));
    if (job.status === "done") pct = 100;
    var detail = dlDetail(job);
    var canToggle = job.status === "running" || job.status === "queued" || job.status === "paused";
    var done = job.status === "done" && job.path;
    return (
      '<div class="dl-job ' +
      escapeHtml(job.status) +
      '" data-job="' +
      escapeHtml(job.id) +
      '">' +
      '<div class="dl-job-top"><b title="' +
      escapeHtml(job.title || job.url) +
      '">' +
      escapeHtml(job.title || job.url) +
      "</b><span>" +
      escapeHtml(job.site || "web") +
      "</span></div>" +
      '<div class="dl-bar"><i style="width:' +
      pct +
      '%"></i></div>' +
      '<div class="dl-job-info' +
      (detail.err ? " err" : "") +
      '">' +
      escapeHtml(dlStatusWord(job) + (detail.text ? " · " + detail.text : "")) +
      "</div>" +
      '<div class="dl-job-btns">' +
      '<button type="button" data-dl-play' +
      (done ? "" : " hidden") +
      ">Play</button>" +
      '<button type="button" data-dl-toggle' +
      (canToggle ? "" : " hidden") +
      ">" +
      (job.status === "paused" ? "Resume" : "Pause") +
      "</button>" +
      '<button type="button" data-dl-retry' +
      (job.status === "failed" || job.status === "cancelled" ? "" : " hidden") +
      ">Retry</button>" +
      '<button type="button" data-dl-folder' +
      (job.path ? "" : " hidden") +
      ">Folder</button>" +
      '<button type="button" data-dl-del>Delete</button>' +
      "</div></div>"
    );
  }

  function dlPaint() {
    var list = document.getElementById("dl-list");
    if (list) {
      list.innerHTML = (state.downloads || []).map(dlJobHtml).join("");
      list.querySelectorAll("[data-job]").forEach(function (row) {
        var id = row.getAttribute("data-job");
        var btn;
        btn = row.querySelector("[data-dl-play]");
        if (btn) btn.addEventListener("click", function () { dlPlay(id); });
        btn = row.querySelector("[data-dl-toggle]");
        if (btn) btn.addEventListener("click", function () { dlToggle(id); });
        btn = row.querySelector("[data-dl-retry]");
        if (btn) btn.addEventListener("click", function () { dlRetry(id); });
        btn = row.querySelector("[data-dl-folder]");
        if (btn) btn.addEventListener("click", function () { dlReveal(id); });
        btn = row.querySelector("[data-dl-del]");
        if (btn) btn.addEventListener("click", function () { dlDelete(id); });
      });
    }
    var badge = document.getElementById("dl-count");
    if (badge) {
      var live = (state.downloads || []).filter(function (j) {
        return j.status === "running" || j.status === "queued" || j.status === "paused";
      }).length;
      badge.hidden = !live;
      badge.textContent = String(live);
    }
  }

  function downloadsRefresh() {
    return invoke("dl_list")
      .then(function (jobs) {
        state.downloads = Array.isArray(jobs) ? jobs : [];
        dlPaint();
        return state.downloads;
      })
      .catch(function () {
        return [];
      });
  }

  function openDownloads() {
    var panel = document.getElementById("dl-panel");
    if (!panel) return;
    panel.hidden = false;
    showChrome();
    downloadsRefresh();
    dlTool();
  }

  function dlToggle(id) {
    invoke("dl_toggle", { id: id })
      .then(function () {
        return downloadsRefresh();
      })
      .catch(function (e) {
        toast(dlError(e));
      });
  }

  function dlRetry(id) {
    invoke("dl_retry", { id: id })
      .then(function () {
        toast("Trying again");
        return downloadsRefresh();
      })
      .catch(function (e) {
        toast(dlError(e));
      });
  }

  function dlPlay(id) {
    invoke("dl_play", { id: id })
      .then(function (path) {
        var panel = document.getElementById("dl-panel");
        if (panel) panel.hidden = true;
        state.mediaKind = "file";
        state.mediaPath = path;
        var name = String(path).split(/[\\/]/).pop();
        playUrl(name, convertFileSrc(path));
        maybeAutoSubs();
      })
      .catch(function (e) {
        toast(dlError(e));
      });
  }

  function dlReveal(id) {
    invoke("dl_reveal", { id: id }).catch(function (e) {
      toast(dlError(e));
    });
  }

  function dlDelete(id) {
    var job = (state.downloads || []).find(function (j) {
      return j.id === id;
    });
    ask({
      title: "Delete this download?",
      hint: job ? job.title || job.url : "",
      warn: true,
      choices: ["Delete the file too", "Keep the file"],
      okText: "Delete",
    }).then(function (pick) {
      if (!pick) return;
      var file = pick === "Delete the file too";
      invoke("dl_remove", { id: id, deleteFile: file })
        .then(function () {
          return downloadsRefresh();
        })
        .then(function () {
          toast(file ? "Download deleted" : "Removed from the list");
        })
        .catch(function (e) {
          toast(dlError(e));
        });
    });
  }

  function dlPickPaint(info) {
    var box = document.getElementById("dl-result");
    if (!box) return;
    var picks = (info && info.choices) || [];
    if (!picks.length) {
      box.hidden = false;
      box.innerHTML = '<p class="dl-fail">No downloadable formats on that page</p>';
      return;
    }
    if (!dlPick || !picks.some(function (c) { return c.height === dlPick.height; })) {
      dlPick = picks.filter(function (c) { return c.height === 1080; })[0] || picks[0];
    }
    var mins = info.duration ? Math.round(info.duration / 60) : 0;
    var sub = [info.site || "Web", mins ? mins + " min" : "", info.uploader || ""]
      .filter(function (x) { return !!x; })
      .join(" · ");
    box.hidden = false;
    box.innerHTML =
      '<div class="dl-title">' +
      escapeHtml(info.title || "Untitled") +
      "</div>" +
      '<div class="dl-sub">' +
      escapeHtml(sub) +
      "</div>" +
      '<div class="dl-picks">' +
      picks
        .map(function (c) {
          var size = humanBytes(c.size);
          return (
            '<button type="button" class="dl-pick' +
            (dlPick && dlPick.height === c.height ? " on" : "") +
            '" data-h="' +
            c.height +
            '"><span>' +
            escapeHtml(c.label) +
            "</span>" +
            (size ? "<small>~" + size + "</small>" : c.audio_only ? "<small>audio</small>" : "") +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="dl-actions"><button type="button" class="primary" id="dl-start">Download ' +
      escapeHtml(dlPick ? dlPick.label : "") +
      "</button></div>" +
      (state.dlEngineNeeded
        ? '<p class="dl-note dl-engine">First download also prepares the media engine (~100 MB, once).</p>'
        : "");
    box.querySelectorAll("[data-h]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var h = Number(btn.getAttribute("data-h"));
        dlPick = picks.find(function (c) {
          return c.height === h;
        });
        dlPickPaint(info);
      });
    });
    var start = box.querySelector("#dl-start");
    if (start) start.addEventListener("click", function () { dlStart(info); });
  }

  function dlProbe() {
    var input = document.getElementById("dl-url");
    var box = document.getElementById("dl-result");
    var url = input ? String(input.value || "").trim() : "";
    if (!url) {
      toast("Paste a video link first");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast("Links start with http:// or https://");
      return;
    }
    if (box) {
      box.hidden = false;
      box.innerHTML = '<p class="dl-sub">Checking the link…</p>';
    }
    dlTool().then(function (st) {
      if (!st || !st.available) {
        if (box)
          box.innerHTML =
            '<p class="dl-fail">The downloader is not installed yet</p>' +
            '<div class="dl-actions"><button type="button" class="primary" id="dl-install-inline">Install downloader</button></div>';
        var again = document.getElementById("dl-install-inline");
        if (again)
          again.addEventListener("click", function () {
            again.disabled = true;
            again.textContent = "Installing…";
            dlInstall();
          });
        return;
      }
      return invoke("ffmpeg_status")
        .then(function (ff) {
          state.dlEngineNeeded = !(ff && ff.available);
        })
        .catch(function () {
          state.dlEngineNeeded = false;
        })
        .then(function () {
          return invoke("dl_probe", { url: url });
        })
        .then(function (info) {
          state.dlUrl = url;
          state.dlInfo = info;
          dlPickPaint(info);
        })
        .catch(function (e) {
          if (box) box.innerHTML = '<p class="dl-fail">' + escapeHtml(dlError(e)) + "</p>";
        });
    });
  }

  function dlStart() {
    var url = state.dlUrl || "";
    if (!url || !dlPick) return;
    var btn = document.getElementById("dl-start");
    if (btn) {
      btn.disabled = true;
      btn.textContent = state.dlEngineNeeded ? "Preparing the media engine…" : "Starting…";
    }
    invoke("dl_start", { url: url, height: Number(dlPick.height) || 0, title: (state.dlInfo || {}).title || "" })
      .then(function () {
        var input = document.getElementById("dl-url");
        if (input) input.value = "";
        var box = document.getElementById("dl-result");
        if (box) box.hidden = true;
        toast("Downloading in the background");
        return downloadsRefresh();
      })
      .then(openDownloads)
      .catch(function (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Download " + dlPick.label;
        }
        toast(dlError(e));
      });
  }

  function dlInstall() {
    var el = document.getElementById("dl-state");
    if (el) el.textContent = "Installing downloader… 0%";
    invoke("dl_install")
      .then(function (st) {
        var stateEl = document.getElementById("dl-state");
        if (stateEl) stateEl.textContent = st && st.available ? "Downloader ready" : "Not installed";
        toast(st && st.available ? "Downloader ready" : "Downloader did not start");
        return dlTool();
      })
      .then(function () {
        return downloadsRefresh();
      })
      .catch(function (e) {
        if (el) el.textContent = dlError(e);
        toast(dlError(e));
      });
  }

  /* ---------- IPTV guide ---------- */
  function guidePaint(st) {
    var bar = document.getElementById("guide-bar");
    var txt = document.getElementById("guide-state");
    if (!bar || !txt) return;
    bar.hidden = false;
    var btn = document.getElementById("guide-load");
    if (!st || !st.loaded) {
      txt.textContent = "No guide loaded";
      if (btn) btn.textContent = "Load guide";
      return;
    }
    var chans = st.channels || 0;
    txt.textContent = "Guide · " + chans + " channels · " + (st.programmes || 0) + " programmes";
    if (btn) btn.textContent = "Refresh";
  }

  function refreshGuide() {
    var bar = document.getElementById("guide-bar");
    if (bar) bar.hidden = state.view !== "live";
    if (state.view !== "live") return;
    invoke("epg_status").then(guidePaint).catch(function () {});
  }

  function paintGuide() {
    if (!listEl) return;
    var rows = listEl.querySelectorAll("[data-ch]");
    if (!rows.length) return;
    var keys = [];
    var keyOf = {};
    rows.forEach(function (row) {
      var id = row.getAttribute("data-ch");
      var ch = (state.channels || []).find(function (c) {
        return String(c.id) === id;
      });
      if (!ch) return;
      var key = ch.tvg_id || ch.name;
      if (!key) return;
      keyOf[id] = key;
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    if (!keys.length) return;
    invoke("epg_now", { ids: keys })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var byKey = {};
        list.forEach(function (g) {
          if (g && g.now_title) byKey[g.channel] = g;
        });
        rows.forEach(function (row) {
          var slot = row.querySelector("[data-epg]");
          var g = byKey[keyOf[row.getAttribute("data-ch")]];
          if (!slot || !g) return;
          slot.innerHTML =
            '<span class="epg-now">' +
            escapeHtml(g.now_title) +
            "</span>" +
            (g.next_title ? '<span class="epg-next">Next · ' + escapeHtml(g.next_title) + "</span>" : "");
        });
      })
      .catch(function () {});
  }

  function loadGuideNow() {
    var btn = document.getElementById("guide-load");
    if (btn) btn.disabled = true;
    var src = (state.sources || []).filter(function (s) {
      return s.kind === "url" && s.channel_count >= 0;
    })[0];
    var fromSource = src
      ? invoke("epg_load_source", { id: src.id })
      : Promise.reject(new Error("no source"));
    fromSource
      .then(function (st) {
        guidePaint(st);
        paintGuide();
        toast("Guide loaded");
      })
      .catch(function () {
        return ask({
          title: "Guide address",
          hint: "Paste an XMLTV guide (.xml) address",
          input: true,
          value: "",
          okText: "Load",
        }).then(function (url) {
          if (!url) return null;
          return invoke("epg_load", { url: url }).then(function (st) {
            guidePaint(st);
            paintGuide();
            toast("Guide loaded");
          });
        });
      })
      .catch(function (e) {
        toast(dlError(e));
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  /* ---------- Xtream portal ---------- */
  function xtreamImport() {
    var server = String((document.getElementById("xt-server") || {}).value || "").trim();
    var user = String((document.getElementById("xt-user") || {}).value || "").trim();
    var pass = String((document.getElementById("xt-pass") || {}).value || "").trim();
    if (!server || !user || !pass) {
      toast("Server, username and password are needed");
      return;
    }
    var btn = document.getElementById("xt-go");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Connecting…";
    }
    invoke("xtream_import", { server: server, user: user, pass: pass, name: null })
      .then(function (r) {
        importModal.hidden = true;
        state.view = "live";
        toast("Added " + (r && r.channel_count ? r.channel_count : 0) + " channels");
        return refresh();
      })
      .catch(function (e) {
        toast(dlError(e));
      })
      .then(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Import portal";
        }
      });
  }

  (function dlWire() {
    var fetchBtn = document.getElementById("dl-fetch");
    if (fetchBtn) fetchBtn.addEventListener("click", dlProbe);
    var input = document.getElementById("dl-url");
    if (input)
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          dlProbe();
        }
      });
    var openBtn = document.getElementById("dl-open");
    if (openBtn) openBtn.addEventListener("click", openDownloads);
    var menuBtn = document.getElementById("btn-downloads");
    if (menuBtn) menuBtn.addEventListener("click", openDownloads);
    var close = document.getElementById("dl-close");
    if (close)
      close.addEventListener("click", function () {
        document.getElementById("dl-panel").hidden = true;
      });
    var inst = document.getElementById("dl-install");
    if (inst) inst.addEventListener("click", dlInstall);
    var folder = document.getElementById("dl-folder");
    if (folder)
      folder.addEventListener("click", function () {
        var st = state.dlTool;
        if (st && st.download_dir) invoke("reveal_in_folder", { path: st.download_dir }).catch(function (e) {
          toast(dlError(e));
        });
      });
    var gl = document.getElementById("guide-load");
    if (gl) gl.addEventListener("click", loadGuideNow);
    // Now/next goes stale while the list sits open.
    window.setInterval(function () {
      var sheet = document.getElementById("sheet");
      if (state.view === "live" && sheet && !sheet.hidden) paintGuide();
    }, 60000);
    var xt = document.getElementById("xt-go");
    if (xt) xt.addEventListener("click", xtreamImport);

    var api = tauri();
    if (api && api.event && api.event.listen) {
      api.event.listen("dl-progress", function (ev) {
        var p = (ev && ev.payload) || null;
        if (!p) return;
        if (typeof p === "string") {
          var el = document.getElementById("dl-state");
          if (p === "start:engine") {
            if (el) el.textContent = "Setting up the media engine…";
            var startBtn = document.getElementById("dl-start");
            if (startBtn) startBtn.textContent = "Preparing the media engine…";
          } else if (p === "setup:" || p.indexOf("setup:") === 0) {
            var bytes = Number(p.split(":")[1]) || 0;
            if (el) {
              if (el.textContent.indexOf("Installing the media engine") === 0) {
                el.textContent = "Installing the media engine… " + humanBytes(bytes);
              } else {
                el.textContent = "Installing downloader… " + humanBytes(bytes);
              }
            }
          }
          return;
        }
        if (!p.id || !p.job) return;
        var jobs = state.downloads || [];
        var at = -1;
        for (var i = 0; i < jobs.length; i++) if (jobs[i].id === p.id) at = i;
        if (at >= 0) jobs[at] = p.job;
        else jobs.unshift(p.job);
        state.downloads = jobs;
        var now = Date.now();
        var panel = document.getElementById("dl-panel");
        if (panel && !panel.hidden && now - dlPaintAt > 350) {
          dlPaintAt = now;
          dlPaint();
        } else {
          var badge = document.getElementById("dl-count");
          if (badge) {
            var live = jobs.filter(function (j) {
              return j.status === "running" || j.status === "queued" || j.status === "paused";
            }).length;
            badge.hidden = !live;
            badge.textContent = String(live);
          }
        }
        if (p.job.status === "done" && !p.job.seen) {
          p.job.seen = true;
          downloadsRefresh();
        }
      });
    }
    downloadsRefresh();
  })();


  /* ---------- TV mode: the channel browser ---------- */
  var tvFilter = { country: "", language: "", quality: "", sort: "number", q: "", fav: false };
  // Playlists carry ISO-ish codes; the wall says what they mean.
  var TV_COUNTRY = {
    UK: "United Kingdom", GB: "United Kingdom", US: "United States", CA: "Canada",
    IN: "India", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal",
    DE: "Germany", AT: "Austria", CH: "Switzerland", FR: "France", BE: "Belgium",
    NL: "Netherlands", ES: "Spain", PT: "Portugal", IT: "Italy", GR: "Greece",
    IE: "Ireland", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
    PL: "Poland", CZ: "Czechia", SK: "Slovakia", HU: "Hungary", RO: "Romania",
    BG: "Bulgaria", HR: "Croatia", RS: "Serbia", SI: "Slovenia", AL: "Albania",
    UA: "Ukraine", RU: "Russia", TR: "Turkey", IL: "Israel", IR: "Iran", IQ: "Iraq",
    AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", EG: "Egypt",
    MA: "Morocco", DZ: "Algeria", TN: "Tunisia", ZA: "South Africa", NG: "Nigeria",
    KE: "Kenya", AU: "Australia", NZ: "New Zealand", JP: "Japan", CN: "China",
    KR: "South Korea", HK: "Hong Kong", TW: "Taiwan", SG: "Singapore", MY: "Malaysia",
    ID: "Indonesia", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
    MX: "Mexico", BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia",
    PE: "Peru", VE: "Venezuela", LT: "Lithuania", LV: "Latvia", EE: "Estonia",
  };

  function tvCountry(code) {
    if (!code) return "";
    return TV_COUNTRY[String(code).toUpperCase()] || code;
  }
  var tvList = [];
  var tvFacets = null;
  var tvTimer = 0;

  function tvEl(id) {
    return document.getElementById(id);
  }

  function tvInitials(name) {
    var words = String(name || "?")
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    var out = (words[0] || "?").charAt(0);
    if (words[1]) out += words[1].charAt(0);
    return out.toUpperCase();
  }

  function tvCardHtml(c) {
    var playing = state.current && state.current.id === c.id ? " playing" : "";
    var country = tvCountry(c.country);
    var group = c.group_name || "";
    // Plenty of playlists use the country as the group; say it once.
    if (group && country && group.toLowerCase() === country.toLowerCase()) group = "";
    if (group && c.country && group.toLowerCase() === String(c.country).toLowerCase()) group = "";
    var bits = [];
    [group, country, c.language].forEach(function (bit) {
      if (bit && bits.indexOf(bit) < 0) bits.push(bit);
    });
    var logo = c.logo_url
      ? '<img src="' + escapeHtml(c.logo_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
      : '<span class="initials">' + escapeHtml(tvInitials(c.name)) + "</span>";
    var badge = c.quality
      ? '<span class="tv-badge">' + escapeHtml(c.quality) + "</span>"
      : '<span class="tv-badge live">LIVE</span>';
    return (
      '<div class="tv-card' +
      playing +
      '" data-tv-ch="' +
      c.id +
      '" role="button" tabindex="0" aria-label="' +
      escapeHtml(c.name) +
      '">' +
      '<div class="tv-thumb">' +
      logo +
      badge +
      '<button type="button" class="tv-fav' +
      (c.is_favourite ? " on" : "") +
      '" data-tv-fav="' +
      c.id +
      '" title="Favourite">★</button>' +
      "</div>" +
      '<div class="tv-text"><b>' +
      escapeHtml(c.name) +
      "</b><span>" +
      escapeHtml(bits.join(" · ") || "Live") +
      '</span><span class="tv-now" data-tv-now="' +
      c.id +
      '"></span></div></div>'
    );
  }

  function tvRender() {
    var grid = tvEl("tv-grid");
    var empty = tvEl("tv-empty");
    if (!grid) return;
    var count = tvEl("tv-count");
    if (count) count.textContent = tvList.length ? tvList.length + " channels" : "";
    if (!tvList.length) {
      grid.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = state.sources && state.sources.length
          ? "No channel matches these filters.<br />Clear one of the chips to widen the search."
          : "No playlists yet.<br />Media → Add playlist / IPTV, or an Xtream Codes portal.";
      }
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = tvList.map(tvCardHtml).join("");

    grid.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () {
        var card = img.closest(".tv-card");
        var name = card ? card.getAttribute("aria-label") : "";
        var span = document.createElement("span");
        span.className = "initials";
        span.textContent = tvInitials(name);
        img.replaceWith(span);
      });
    });
    grid.querySelectorAll("[data-tv-ch]").forEach(function (card) {
      var id = Number(card.getAttribute("data-tv-ch"));
      card.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-tv-fav]")) return;
        tvTune(id);
      });
      card.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          tvTune(id);
        }
      });
    });
    grid.querySelectorAll("[data-tv-fav]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        invoke("toggle_favourite", { id: Number(btn.getAttribute("data-tv-fav")) })
          .then(function () {
            return tvLoad();
          })
          .catch(function (e) {
            toast(shortError(e, "Could not change that"));
          });
      });
    });
    tvPaintGuide();
  }

  function tvPaintGuide() {
    var cards = tvEl("tv-grid") ? tvEl("tv-grid").querySelectorAll("[data-tv-now]") : [];
    if (!cards.length) return;
    var keys = [];
    var keyOf = {};
    cards.forEach(function (slot) {
      var id = Number(slot.getAttribute("data-tv-now"));
      var ch = tvList.find(function (c) {
        return c.id === id;
      });
      if (!ch) return;
      var key = ch.tvg_id || ch.name;
      if (!key) return;
      keyOf[id] = key;
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    if (!keys.length) return;
    invoke("epg_now", { ids: keys })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var byKey = {};
        list.forEach(function (g) {
          if (g && g.now_title) byKey[g.channel] = g;
        });
        cards.forEach(function (slot) {
          var id = Number(slot.getAttribute("data-tv-now"));
          var g = byKey[keyOf[id]];
          if (!g) return;
          slot.textContent = "Now · " + g.now_title;
          slot.classList.add("tv-now-now");
        });
      })
      .catch(function () {});
  }

  function tvChips() {
    var row = tvEl("tv-chips");
    if (!row) return;
    var f = tvFacets || { countries: [], languages: [], qualities: [] };
    var html = "";
    html +=
      '<button type="button" class="tv-chip' + (tvFilter.fav ? " on" : "") + '" data-tv-f="fav">Favourites</button>';
    function chip(kind, label, values) {
      if (!values || values.length < 2) return "";
      var active = tvFilter[kind];
      return (
        '<button type="button" class="tv-chip' +
        (active ? " on" : "") +
        '" data-tv-open="' +
        kind +
        '">' +
        escapeHtml(active ? (kind === "country" ? tvCountry(active) : active) : label) +
        ' <span class="caret">▾</span></button>'
      );
    }
    html += chip("country", "Country", f.countries);
    html += chip("language", "Language", f.languages);
    html += chip("quality", "Quality", f.qualities);
    var sorts = { number: "Channel order", name: "Name", country: "Country", quality: "Quality", group: "Group" };
    html +=
      '<button type="button" class="tv-chip sep" data-tv-open="sort">Sort: ' +
      escapeHtml(sorts[tvFilter.sort] || "Channel order") +
      ' <span class="caret">▾</span></button>';
    var anyFilter = tvFilter.country || tvFilter.language || tvFilter.quality || tvFilter.fav;
    if (anyFilter)
      html += '<button type="button" class="tv-chip" data-tv-f="clear">Clear filters</button>';
    row.innerHTML = html;

    row.querySelectorAll("[data-tv-f]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var what = btn.getAttribute("data-tv-f");
        if (what === "fav") {
          tvFilter.fav = !tvFilter.fav;
        } else {
          tvFilter = { country: "", language: "", quality: "", sort: tvFilter.sort, q: tvFilter.q, fav: false };
        }
        tvLoad();
      });
    });
    row.querySelectorAll("[data-tv-open]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        tvOpenPop(btn.getAttribute("data-tv-open"), btn);
      });
    });
  }

  function tvOpenPop(kind, anchor) {
    var pop = tvEl("tv-pop");
    var list = tvEl("tv-pop-list");
    var head = tvEl("tv-pop-head");
    if (!pop || !list) return;
    var f = tvFacets || { countries: [], languages: [], qualities: [] };
    var items;
    if (kind === "sort") {
      head.textContent = "Sort by";
      items = [
        { value: "number", label: "Channel order" },
        { value: "name", label: "Name" },
        { value: "country", label: "Country" },
        { value: "quality", label: "Quality (best first)" },
        { value: "group", label: "Group" },
      ];
    } else {
      head.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
      items = [{ value: "", label: "All" }].concat(
        (kind === "country" ? f.countries : kind === "language" ? f.languages : f.qualities).map(function (x) {
          return {
            value: x.value,
            label: kind === "country" ? tvCountry(x.value) : x.value,
            count: x.count,
          };
        })
      );
    }
    var current = kind === "sort" ? tvFilter.sort : tvFilter[kind];
    list.innerHTML = items
      .map(function (it) {
        return (
          '<button type="button" class="' +
          (it.value === current ? "on" : "") +
          '" data-tv-pick="' +
          escapeHtml(it.value) +
          '">' +
          (it.value === current ? '<span class="tick">✓</span>' : "") +
          escapeHtml(it.label) +
          (it.count ? "<em>" + it.count + "</em>" : "") +
          "</button>"
        );
      })
      .join("");
    list.querySelectorAll("[data-tv-pick]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var value = btn.getAttribute("data-tv-pick");
        if (kind === "sort") tvFilter.sort = value || "number";
        else tvFilter[kind] = value;
        tvClosePop();
        tvLoad();
      });
    });
    var rect = anchor.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 340)) + "px";
    pop.style.top = rect.bottom + 8 + "px";
  }

  function tvClosePop() {
    var pop = tvEl("tv-pop");
    if (pop) pop.hidden = true;
  }

  function tvLoad() {
    tvChips();
    if (state.sources && !state.sources.length) {
      tvList = [];
      tvRender();
      return Promise.resolve([]);
    }
    return invoke("list_channels", {
      group: null,
      query: tvFilter.q || null,
      favouritesOnly: !!tvFilter.fav,
      country: tvFilter.country || null,
      language: tvFilter.language || null,
      quality: tvFilter.quality || null,
      sort: tvFilter.sort,
      limit: 2000,
      offset: 0,
    })
      .then(function (list) {
        tvList = Array.isArray(list) ? list : [];
        state.channels = tvList.length ? tvList : state.channels;
        tvRender();
        return tvList;
      })
      .catch(function () {
        tvList = [];
        tvRender();
        return [];
      });
  }

  function tvFacetsLoad() {
    return invoke("channel_facets")
      .then(function (f) {
        tvFacets = f || null;
        tvChips();
        return f;
      })
      .catch(function () {
        return null;
      });
  }

  function tvTune(id) {
    var ch = tvList.find(function (c) {
      return c.id === id;
    });
    if (!ch) return;
    tvHide();
    tune(ch);
  }

  function tvAutoTune() {
    if (state.current || !tvList.length) return;
    var last = 0;
    try {
      last = Number(localStorage.getItem("g9.tv.last") || 0);
    } catch (e) {
      last = 0;
    }
    var pick =
      tvList.find(function (c) {
        return c.id === last;
      }) || tvList[0];
    if (!pick) return;
    state.current = pick;
    state.mediaKind = "live";
    state.mediaPath = pick.stream_url;
    playUrl(pick.name, pick.stream_url);
    invoke("add_history", { title: pick.name, url: pick.stream_url, kind: "live", position: 0, duration: 0 }).catch(function () {});
    if (tvVisible()) tvRender();
    toast("Tuned " + pick.name);
  }

  function tvShow() {
    var el = tvEl("tv");
    if (!el) return;
    el.hidden = false;
    hideGate();
    tvOpenButton();
    showChrome();
    tvFacetsLoad();
    tvLoad().then(function () {
      tvAutoTune();
    });
  }

  function tvHide() {
    var el = tvEl("tv");
    if (el) el.hidden = true;
    tvClosePop();
    tvOpenButton();
  }

  function tvVisible() {
    var el = tvEl("tv");
    return !!(el && !el.hidden);
  }

  function enterTv() {
    // The browser replaces the windowed channel sheet.
    state.view = "watch";
    setTv(true);
    paint();
    tvShow();
  }

  function exitTv() {
    tvHide();
    setTv(false);
  }

  function toggleTv() {
    if (state.tv) exitTv();
    else enterTv();
  }

  function tvOpenButton() {
    var btn = tvEl("tv-open");
    if (btn) btn.hidden = !state.tv || tvVisible();
  }

  (function tvWire() {
    var close = tvEl("tv-close");
    if (close) close.addEventListener("click", tvHide);
    var open = tvEl("tv-open");
    if (open) open.addEventListener("click", tvShow);
    var q = tvEl("tv-q");
    if (q)
      q.addEventListener("input", function () {
        tvFilter.q = String(q.value || "").trim();
        window.clearTimeout(tvTimer);
        tvTimer = window.setTimeout(tvLoad, 220);
      });
    document.addEventListener("click", function (ev) {
      var pop = tvEl("tv-pop");
      if (!pop || pop.hidden) return;
      if (!ev.target.closest("#tv-pop") && !ev.target.closest("[data-tv-open]")) tvClosePop();
    });
  })();

  initPicsDir();
  (function openStartupFile() {
    invoke("startup_file")
      .then(function (f) {
        if (!f || !f.path) return;
        state.mediaKind = f.is_url ? "url" : "file";
        state.mediaPath = f.path;
        playUrl(f.name || "G9", f.is_url ? f.path : convertFileSrc(f.path));
        if (!f.is_url) maybeAutoSubs();
      })
      .catch(function () {});
  })();
  refresh()
    .then(function () {
      // Left in TV mode last time: come back to a playing channel.
      if (state.tv) tvShow();
    })
    .catch(function () {});
})();
