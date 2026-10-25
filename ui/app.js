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
    storyBusy: false,
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
  var preview = document.getElementById("preview");
  var scrubEl = document.getElementById("scrub");
  var scrubCanvas = document.getElementById("scrub-canvas");
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
  function fail(e) {
    document.getElementById("info-meta").textContent = e && e.message ? e.message : String(e);
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2800);
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
    var label = result.movie || result.release || result.query || "captions";
    var src = result.provider ? " · " + result.provider : "";
    toast("Subtitles · " + label + src);
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
      applyEq();
    }
    if (rec.boost) setBoost(rec.boost, true);
    if (rec.t > 5 && isFinite(video.duration) && rec.t < video.duration - 5) {
      video.currentTime = rec.t;
      toast("Resumed " + fmt(rec.t));
    }
  }
  function ensureAudio() {
    if (audioGraph) return audioGraph;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      var ctx = new AC();
      var src = ctx.createMediaElementSource(video);
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
      return audioGraph;
    } catch (e) {
      return null;
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
  function snapshot() {
    if (!video.videoWidth) {
      toast("Nothing to capture");
      return;
    }
    var c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    c.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (state.title || "g9").replace(/[\\/:*?"<>|]/g, "_") + ".jpg";
      a.click();
      toast("Saved frame");
    }, "image/jpeg", 0.92);
  }
  function buildStoryboard() {
    var canvas = document.getElementById("story");
    if (!canvas || !video.duration || !isFinite(video.duration) || state.mediaKind === "live") {
      if (canvas) canvas.classList.remove("has-thumbs");
      return;
    }
    if (state.storyBusy) return;
    state.storyBusy = true;
    var n = 12;
    var w = Math.max(640, canvas.clientWidth || 640);
    canvas.width = w;
    canvas.height = 48;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, 48);
    if (!preview.src && video.src) preview.src = video.currentSrc || video.src;
    var i = 0;
    var tw = w / n;
    function step() {
      if (i >= n) {
        state.storyBusy = false;
        canvas.classList.add("has-thumbs");
        return;
      }
      try {
        preview.currentTime = ((i + 0.5) / n) * video.duration;
      } catch (e) {
        state.storyBusy = false;
        return;
      }
      preview.onseeked = function () {
        preview.onseeked = null;
        try {
          ctx.drawImage(preview, i * tw, 0, tw - 1, 48);
        } catch (e2) {}
        i++;
        window.setTimeout(step, 30);
      };
    }
    window.setTimeout(step, 200);
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
        var bytes = encodeGif(frames, w, h, Math.round(100 / fps));
        var blob = new Blob([bytes], { type: "image/gif" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (state.title || "g9") + ".gif";
        a.click();
        toast("Saved GIF · " + frames.length + " frames");
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
    var map = marksMap();
    if (!map[key]) map[key] = [];
    var name = window.prompt("Bookmark name", fmt(video.currentTime));
    if (name == null) return;
    map[key].push({ t: video.currentTime, name: name || fmt(video.currentTime) });
    saveMarks(map);
    renderMarks();
    toast("Bookmark saved");
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
    var to = window.prompt("Translate captions to language code (es, hi, fr, de…)", "es");
    if (!to) return;
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
      return window.prompt("Save as", "g9-out." + ext);
    }
    return src.replace(/\.[^.]+$/, "") + "." + ext;
  }
  function extractAudio() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    var dest = sidecarDest("mp3");
    if (!dest) return;
    toast("Extracting audio…");
    invoke("extract_audio", { path: state.mediaPath, dest: dest })
      .then(function (r) {
        toast("Saved " + (r.output || dest));
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function repairFile() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    var dest = sidecarDest("fixed.mp4");
    if (!dest) return;
    toast("Remuxing…");
    invoke("remux_repair", { path: state.mediaPath, dest: dest })
      .then(function (r) {
        toast("Repaired " + (r.output || dest));
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function startRecorder(stream, extraStop) {
    var chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = function (ev) {
      if (ev.data && ev.data.size) chunks.push(ev.data);
    };
    recorder.onstop = function () {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      if (extraStop) extraStop();
      var blob = new Blob(chunks, { type: "video/webm" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "g9-record.webm";
      a.click();
      recorder = null;
      toast("Recording saved");
    };
    recorder.start();
    toast("Recording… Record again to stop");
  }
  function toggleRecord() {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    var kind = window.prompt("Record: screen  |  webcam  |  region", "screen");
    if (!kind) return;
    kind = kind.toLowerCase();
    if (kind.indexOf("region") >= 0) {
      beginRegionRecord();
      return;
    }
    var job =
      kind.indexOf("cam") >= 0
        ? navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        : navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    job.then(function (stream) {
      startRecorder(stream);
    }).catch(function (e) {
      toast(String(e && e.message ? e.message : e));
    });
  }
  function beginRegionRecord() {
    var layer = document.getElementById("region");
    var box = document.getElementById("region-box");
    layer.hidden = false;
    var drag = null;
    function pos(ev) {
      return { x: ev.clientX, y: ev.clientY };
    }
    function onDown(ev) {
      drag = pos(ev);
      box.style.left = drag.x + "px";
      box.style.top = drag.y + "px";
      box.style.width = "0";
      box.style.height = "0";
    }
    function onMove(ev) {
      if (!drag) return;
      var p = pos(ev);
      var x = Math.min(drag.x, p.x);
      var y = Math.min(drag.y, p.y);
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.width = Math.abs(p.x - drag.x) + "px";
      box.style.height = Math.abs(p.y - drag.y) + "px";
    }
    function finish() {
      layer.hidden = true;
      layer.removeEventListener("mousedown", onDown);
      layer.removeEventListener("mousemove", onMove);
      layer.removeEventListener("mouseup", onUp);
      var r = box.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) {
        toast("Region too small");
        return;
      }
      navigator.mediaDevices
        .getDisplayMedia({ video: true, audio: false })
        .then(function (stream) {
          var src = document.createElement("video");
          src.srcObject = stream;
          src.muted = true;
          src.play();
          var c = document.createElement("canvas");
          c.width = Math.round(r.width);
          c.height = Math.round(r.height);
          var ctx = c.getContext("2d");
          var run = true;
          function tick() {
            if (!run) return;
            try {
              var vw = src.videoWidth || window.screen.width;
              var vh = src.videoHeight || window.screen.height;
              var sx = ((r.left + (window.screenX || 0)) / window.screen.width) * vw;
              var sy = ((r.top + (window.screenY || 0)) / window.screen.height) * vh;
              var sw = (r.width / window.screen.width) * vw;
              var sh = (r.height / window.screen.height) * vh;
              ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
            } catch (e) {}
            requestAnimationFrame(tick);
          }
          src.addEventListener("loadedmetadata", tick);
          var mixed = c.captureStream(24);
          startRecorder(mixed, function () {
            run = false;
            src.srcObject = null;
          });
        })
        .catch(function (e) {
          toast(String(e && e.message ? e.message : e));
        });
    }
    function onUp() {
      if (drag) finish();
      drag = null;
    }
    layer.addEventListener("mousedown", onDown);
    layer.addEventListener("mousemove", onMove);
    layer.addEventListener("mouseup", onUp);
    toast("Drag a region");
  }
  function convertMedia() {
    if (state.mediaKind !== "file" || !state.mediaPath) {
      toast("Open a local file first");
      return;
    }
    var kind = window.prompt("Convert to: mp4  |  webm  |  mp3", "mp4");
    if (!kind) return;
    kind = kind.replace(".", "").toLowerCase();
    if (kind !== "mp4" && kind !== "webm" && kind !== "mp3") kind = "mp4";
    var dest = sidecarDest(kind);
    if (!dest) return;
    toast("Converting…");
    invoke("convert_media", { path: state.mediaPath, dest: dest })
      .then(function (r) {
        toast("Saved " + (r.output || dest));
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
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
    state.liveTx = !state.liveTx;
    if (state.liveTx && !state.txLang) {
      state.txLang = window.prompt("Live translate to (es, hi, fr…)", "es") || "es";
    }
    toast(state.liveTx ? "Live translate → " + state.txLang : "Live translate off");
  }
  function openPodcast() {
    var url = window.prompt("Podcast RSS URL");
    if (!url) return;
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
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
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
  function togglePip() {
    if (!document.pictureInPictureEnabled) {
      toast("PiP not available");
      return;
    }
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else video.requestPictureInPicture().catch(function (e) {
      toast(String(e.message || e));
    });
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
    var m = Number(window.prompt("Sleep after minutes (0 cancels)", "30"));
    window.clearTimeout(state.sleepId);
    if (!m) {
      toast("Sleep timer off");
      return;
    }
    state.sleepId = window.setTimeout(function () {
      video.pause();
      toast("Sleep timer");
    }, m * 60 * 1000);
    toast("Sleep in " + m + " min");
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
    var url = window.prompt("RTMP URL (rtmp://…)");
    if (!url) return;
    toast("Starting ffmpeg broadcast…");
    invoke("rtmp_out", { path: state.mediaPath, rtmp: url })
      .then(function () {
        toast("Broadcast finished");
      })
      .catch(function (e) {
        toast(String(e && e.message ? e.message : e));
      });
  }
  function openPath() {
    var p = window.prompt("File path or SMB share (\\\\server\\share\\video.mp4)");
    if (!p) return;
    p = p.trim();
    state.mediaKind = p.indexOf("http") === 0 ? "url" : "file";
    state.mediaPath = p;
    var title = p.split(/[/\\]/).pop() || p;
    var src = p.indexOf("http") === 0 ? p : convertFileSrc(p);
    playUrl(title, src);
    maybeAutoSubs();
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
  var scrubTimer = 0;
  function showScrub(ev) {
    if (state.storyBusy) return;
    if (!video.duration || !isFinite(video.duration)) return;
    var t = seekTimeFromEvent(ev);
    var rect = seekEl.getBoundingClientRect();
    var x = ev.clientX;
    if (x < rect.left + 90) x = rect.left + 90;
    if (x > rect.right - 90) x = rect.right - 90;
    scrubEl.style.left = x + "px";
    document.getElementById("scrub-time").textContent = fmt(t);
    scrubEl.classList.add("show");
    window.clearTimeout(scrubTimer);
    scrubTimer = window.setTimeout(function () {
      if (!preview.src && video.src) preview.src = video.currentSrc || video.src;
      if (!preview.src) return;
      try {
        preview.currentTime = t;
      } catch (e) {}
    }, 40);
  }
  preview.addEventListener("seeked", function () {
    try {
      var ctx = scrubCanvas.getContext("2d");
      ctx.drawImage(preview, 0, 0, scrubCanvas.width, scrubCanvas.height);
    } catch (e) {}
  });

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
      .catch(function (e) {
        toast(e && e.message ? e.message : String(e));
        fail(e);
      });
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
    if (state.info) {
      var legal = document.getElementById("legal");
      if (legal) legal.textContent = state.info.content_policy;
      var av = document.getElementById("about-ver");
      var ap = document.getElementById("about-policy");
      if (av) av.textContent = "v" + state.info.version;
      if (ap) ap.textContent = state.info.content_policy;
    }
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
    if (state.view === "settings") {
      title.textContent = "Settings";
      chipsEl.innerHTML = "";
      count.textContent = String((state.sources || []).length);
      var html = '<p class="legal">' + escapeHtml(state.info ? state.info.content_policy : "") + "</p>";
      html +=
        '<div class="row" id="row-tv"><div class="n">TV</div><div class="meta"><b>TV Mode</b><span>Large type, living-room controls. Esc to exit.</span></div><button type="button" id="sheet-tv">' +
        (state.tv ? "On" : "Off") +
        "</button></div>";
      html +=
        '<div class="row" id="row-about"><div class="n">i</div><div class="meta"><b>About G9</b><span>Version, license, content policy</span></div><button type="button" id="sheet-about">Open</button></div>';
      if (!state.sources.length) html += '<div class="empty">No playlists yet. Media → Add playlist.</div>';
      state.sources.forEach(function (s) {
        html +=
          '<div class="row"><div class="n">' +
          s.id +
          '</div><div class="meta"><b>' +
          escapeHtml(s.name) +
          "</b><span>" +
          s.channel_count +
          " · " +
          escapeHtml(s.kind) +
          '</span></div><button type="button" data-del="' +
          s.id +
          '">Remove</button></div>';
      });
      listEl.innerHTML = html;
      var sheetTv = document.getElementById("sheet-tv");
      if (sheetTv)
        sheetTv.addEventListener("click", function () {
          setTv(!state.tv);
          renderSheet();
        });
      var sheetAbout = document.getElementById("sheet-about");
      if (sheetAbout) sheetAbout.addEventListener("click", openAbout);
      listEl.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          invoke("delete_source", { id: Number(btn.getAttribute("data-del")) }).then(refresh).catch(fail);
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
          '</span></div><button type="button" class="star' +
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
    if (preview) {
      preview.removeAttribute("src");
      preview.load();
    }
    var isHls = /\.m3u8(\?|$)/i.test(url);
    var nativeHls = video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl");
    if (isHls && !nativeHls) {
      hlsSession = playHlsMse(video, url, fail);
      return;
    }
    video.src = url;
    if (preview) preview.src = url;
    bindMediaSession();
    video.play().then(function () {
      setPlaying(true);
      updateMeta();
      ensureAudio();
      if (audioGraph && audioGraph.ctx.state === "suspended") audioGraph.ctx.resume();
    }).catch(function () {
      fail("Could not play this source");
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
      filters: [{ name: "Media", extensions: ["mp4", "mkv", "webm", "mp3", "m4v", "mov", "avi"] }],
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
    var url = window.prompt("Stream or file URL");
    if (url) {
      state.mediaKind = "url";
      state.mediaPath = url;
      playUrl(url.split(/[/\\]/).pop() || url, url);
      maybeAutoSubs();
    }
  });
  document.getElementById("btn-import").addEventListener("click", function () {
    importModal.hidden = false;
    showChrome();
  });

  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function () {
      state.view = el.getAttribute("data-view");
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
      if (act === "convert") convertMedia();
      if (act === "360") toggle360();
      if (act === "livetx") setLiveTx();
      if (act === "pip") togglePip();
      if (act === "ontop") toggleOnTop();
      if (act === "viz") toggleViz();
      if (act === "chapters") loadChapters();
      if (act === "cues") showCues();
      if (act === "linerep") {
        state.lineRepeat = !state.lineRepeat;
        toast(state.lineRepeat ? "Pause after each line" : "Line repeat off");
      }
      if (act === "sleep") sleepTimer();
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
  document.getElementById("btn-gear").addEventListener("click", function () {
    state.view = "settings";
    paint();
    renderSheet();
    showChrome();
  });
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
  document.getElementById("story").addEventListener("click", function (ev) {
    if (!video.duration) return;
    var r = ev.currentTarget.getBoundingClientRect();
    video.currentTime = ((ev.clientX - r.left) / r.width) * video.duration;
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
  document.getElementById("btn-tv").addEventListener("click", function () {
    setTv(!state.tv);
  });
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
  seekEl.addEventListener("mousemove", showScrub);
  seekEl.addEventListener("mouseleave", function () {
    scrubEl.classList.remove("show");
  });
  function paintMute() {
    var btn = document.getElementById("btn-mute");
    if (!btn) return;
    var off = video.muted || video.volume === 0;
    btn.innerHTML = off ? ICO_MUTE : ICO_VOL;
    btn.title = off ? "Unmute" : "Mute";
    btn.classList.toggle("on", off);
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
  video.addEventListener("volumechange", paintMute);
  paintMute();

  video.addEventListener("timeupdate", function () {
    document.getElementById("time-cur").textContent = fmt(video.currentTime);
    document.getElementById("time-end").textContent = fmt(video.duration || 0);
    var p = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    seekEl.value = String(Math.floor(p * 10));
    seekEl.style.setProperty("--p", p + "%");
    paintCue();
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
    window.setTimeout(buildStoryboard, 400);
  });
  video.addEventListener("play", function () {
    setPlaying(true);
    showChrome();
    bindMediaSession();
    if (audioGraph && audioGraph.ctx.state === "suspended") audioGraph.ctx.resume();
  });
  video.addEventListener("pause", function () {
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
  document.getElementById("win-close").addEventListener("click", function () {
    win().then(function (w) {
      if (w) w.close();
    });
  });

  app.addEventListener("mousemove", showChrome);
  showChrome();

  window.addEventListener("keydown", function (ev) {
    var typing = ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA");
    if (ev.key === "Escape") {
      importModal.hidden = true;
      aboutModal.hidden = true;
      infoModal.hidden = true;
      eqPanel.hidden = true;
      subPanel.hidden = true;
      if (fxPanel) fxPanel.hidden = true;
      if (speedPanel) speedPanel.hidden = true;
      if (markPanel) markPanel.hidden = true;
      var region = document.getElementById("region");
      if (region) region.hidden = true;
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
  refresh();
})();
