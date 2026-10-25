/* G9 player UI — HTML / CSS / vanilla JS. Cadence shell. */

(function () {
  "use strict";

  var ICO_PLAY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z" fill="currentColor" stroke="none" /></svg>';
  var ICO_PAUSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none" /></svg>';

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
    lastId: null,
    showDiag: false,
    zapDigits: "",
    zapTimer: 0,
    status: "Ready",
    error: "",
    playing: false,
  };

  var video = document.getElementById("video");
  var zapEl = document.getElementById("zap");
  var poster = document.getElementById("poster");
  var diag = document.getElementById("diag");
  var listEl = document.getElementById("list");
  var chipsEl = document.getElementById("chips");
  var sheet = document.getElementById("sheet");
  var importModal = document.getElementById("import-modal");
  var hlsSession = null;

  function tauri() {
    return window.__TAURI__ || null;
  }

  function invoke(cmd, args) {
    var api = tauri();
    if (!api || !api.core || !api.core.invoke) {
      return Promise.reject(new Error("Open G9 via the desktop app."));
    }
    return api.core.invoke(cmd, args || {});
  }

  function convertFileSrc(path) {
    var api = tauri();
    if (api && api.core && api.core.convertFileSrc) return api.core.convertFileSrc(path);
    return path;
  }

  function openDialog(opts) {
    var api = tauri();
    if (!api || !api.dialog || !api.dialog.open) {
      return Promise.reject(new Error("Dialog plugin unavailable"));
    }
    return api.dialog.open(opts);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) return "00:00";
    var s = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    var m = Math.floor((t / 60) % 60)
      .toString()
      .padStart(2, "0");
    var h = Math.floor(t / 3600);
    return h ? h + ":" + m + ":" + s : m + ":" + s;
  }

  function setStatus(text, err) {
    state.status = text || "Ready";
    state.error = err ? String(err) : "";
    document.getElementById("status-text").textContent = state.status;
    document.getElementById("stat-err").textContent = state.error;
  }

  function fail(e) {
    setStatus("Error", e && e.message ? e.message : e);
  }

  function setPlaying(on) {
    state.playing = on;
    var btn = document.getElementById("play");
    btn.innerHTML = on ? ICO_PAUSE : ICO_PLAY;
    btn.title = on ? "Pause" : "Play";
  }

  function paintChrome() {
    var live = !!state.current;
    document.getElementById("tally").classList.toggle("live", live);
    document.getElementById("tally-label").textContent = live ? "On air" : "Standby";
    document.getElementById("stat-ch").textContent = state.stats ? state.stats.channels : 0;
    document.getElementById("stat-src").textContent = state.stats ? state.stats.sources : 0;
    document.getElementById("stat-ver").textContent = "v" + (state.info ? state.info.version : "0.1.0");
    var legal = document.getElementById("legal");
    if (legal) legal.textContent = state.info ? state.info.content_policy : "";
    poster.style.display = live || video.src ? "none" : "grid";
    document.querySelectorAll("#nav [data-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
    });
    sheet.hidden = state.view === "watch";
  }

  function renderSheet() {
    var title = document.getElementById("sheet-title");
    var count = document.getElementById("sheet-count");

    if (state.view === "settings") {
      title.textContent = "Settings";
      chipsEl.innerHTML = "";
      count.textContent = String(state.sources.length);
      var html = '<p class="legal">' + escapeHtml(state.info ? state.info.content_policy : "") + "</p>";
      if (!state.sources.length) html += '<div class="empty">No playlists yet.</div>';
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
      html +=
        '<div style="padding:8px 10px"><button type="button" class="primary" id="demo">Load demo clips</button></div>';
      listEl.innerHTML = html;
      var demo = document.getElementById("demo");
      if (demo) demo.addEventListener("click", loadDemo);
      listEl.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          invoke("delete_source", { id: Number(btn.getAttribute("data-del")) })
            .then(refresh)
            .catch(fail);
        });
      });
      return;
    }

    if (state.view === "library") {
      title.textContent = "Library";
      chipsEl.innerHTML = "";
      count.textContent = String(state.history.length);
      if (!state.history.length) {
        listEl.innerHTML = '<div class="empty">Open a file or tune a channel. Recent items appear here.</div>';
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
            escapeHtml((h.kind || "?").charAt(0).toUpperCase()) +
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
          playUrl(row.getAttribute("data-title"), row.getAttribute("data-hist"), "file");
        });
      });
      return;
    }

    title.textContent = "Channels";
    count.textContent = String(state.channels.length);
    var chips = [
      '<button type="button" class="chip' +
        (state.group === "All" && !state.favOnly ? " on" : "") +
        '" data-group="All">All</button>',
      '<button type="button" class="chip' +
        (state.favOnly ? " on" : "") +
        '" data-fav="1">Favourites</button>',
    ];
    state.groups.forEach(function (g) {
      chips.push(
        '<button type="button" class="chip' +
          (state.group === g.name && !state.favOnly ? " on" : "") +
          '" data-group="' +
          escapeHtml(g.name) +
          '">' +
          escapeHtml(g.name) +
          " " +
          g.count +
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
    var favBtn = chipsEl.querySelector("[data-fav]");
    if (favBtn) {
      favBtn.addEventListener("click", function () {
        state.favOnly = true;
        loadChannels();
      });
    }

    if (!state.channels.length) {
      listEl.innerHTML =
        '<div class="empty">Add a playlist from the list icon in the top bar, or load demo clips in Settings.</div>';
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
          escapeHtml(c.group_name || "Ungrouped") +
          '</span></div><button type="button" class="star' +
          (c.is_favourite ? " on" : "") +
          '" data-star="' +
          c.id +
          '" title="Favourite">★</button></div>'
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
        invoke("toggle_favourite", { id: Number(btn.getAttribute("data-star")) })
          .then(loadChannels)
          .catch(fail);
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
        paintChrome();
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
    }, 2200);
  }

  function tune(ch) {
    if (state.current) state.lastId = state.current.id;
    state.current = ch;
    showZap(ch);
    playUrl(ch.name, ch.stream_url, "live");
    invoke("add_history", {
      title: ch.name,
      url: ch.stream_url,
      kind: "live",
      position: 0,
      duration: 0,
    }).catch(function () {});
    paintChrome();
    renderSheet();
  }

  function stopHls() {
    if (hlsSession && hlsSession.abort) hlsSession.abort();
    hlsSession = null;
  }

  function playUrl(title, url, _kind) {
    setStatus(title);
    poster.style.display = "none";
    stopHls();
    video.removeAttribute("src");
    video.load();

    var isHls = /\.m3u8(\?|$)/i.test(url);
    var nativeHls = video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl");

    if (isHls && !nativeHls) {
      hlsSession = playHlsMse(video, url, function (err) {
        fail(err || "HLS playback failed");
      });
      return;
    }

    video.src = url;
    video.play().then(function () {
      setPlaying(true);
    }).catch(function () {
      fail("Could not play this source");
    });
  }

  function playHlsMse(el, url, onError) {
    var aborted = false;
    if (!window.MediaSource) {
      onError("This webview cannot play HLS");
      return { abort: function () {} };
    }
    var ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    ms.addEventListener("sourceopen", function () {
      fetchText(url)
        .then(function (text) {
          if (aborted) return;
          return resolvePlaylist(url, text);
        })
        .then(function (media) {
          if (aborted || !media) return;
          var mime = 'video/mp2t; codecs="avc1.42E01E,mp4a.40.2"';
          if (!MediaSource.isTypeSupported(mime)) mime = "video/mp2t";
          if (!MediaSource.isTypeSupported(mime)) {
            onError("MPEG-TS HLS not supported");
            return;
          }
          var sb = ms.addSourceBuffer(mime);
          return appendSegments(sb, media.segments, function () {
            return aborted;
          });
        })
        .then(function () {
          if (!aborted && ms.readyState === "open") {
            try {
              ms.endOfStream();
            } catch (e) {}
          }
          return el.play();
        })
        .then(function () {
          setPlaying(true);
        })
        .catch(function (e) {
          if (!aborted) onError(e);
        });
    });
    return {
      abort: function () {
        aborted = true;
        try {
          if (ms.readyState === "open") ms.endOfStream();
        } catch (e) {}
      },
    };
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function resolvePlaylist(url, text) {
    var lines = text.split(/\r?\n/);
    var variants = [];
    var segments = [];
    var pendingDur = 0;
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
        var next = (lines[i + 1] || "").trim();
        if (next && next.charAt(0) !== "#") variants.push(next);
      } else if (line.indexOf("#EXTINF") === 0) {
        pendingDur = 1;
      } else if (line.charAt(0) !== "#" && pendingDur) {
        segments.push(line);
        pendingDur = 0;
      }
    }
    if (variants.length) {
      var abs = absolutize(url, variants[0]);
      return fetchText(abs).then(function (t) {
        return resolvePlaylist(abs, t);
      });
    }
    return {
      segments: segments.slice(0, 40).map(function (s) {
        return absolutize(url, s);
      }),
    };
  }

  function absolutize(base, ref) {
    try {
      return new URL(ref, base).href;
    } catch (e) {
      return ref;
    }
  }

  function appendSegments(sb, urls, isAborted) {
    var i = 0;
    function next() {
      if (isAborted() || i >= urls.length) return Promise.resolve();
      return fetch(urls[i])
        .then(function (r) {
          return r.arrayBuffer();
        })
        .then(function (buf) {
          i += 1;
          return new Promise(function (resolve, reject) {
            if (isAborted()) return resolve();
            sb.addEventListener(
              "updateend",
              function onEnd() {
                sb.removeEventListener("updateend", onEnd);
                resolve();
              },
              { once: true }
            );
            try {
              sb.appendBuffer(buf);
            } catch (e) {
              reject(e);
            }
          });
        })
        .then(next);
    }
    return next();
  }

  function togglePlay() {
    if (video.paused) {
      video.play().then(function () {
        setPlaying(true);
      });
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function stop() {
    video.pause();
    stopHls();
    video.removeAttribute("src");
    video.load();
    state.current = null;
    setPlaying(false);
    poster.style.display = "grid";
    paintChrome();
    renderSheet();
  }

  function zap(dir) {
    if (!state.current) {
      if (state.channels[0]) tune(state.channels[0]);
      return;
    }
    invoke("neighbours", { id: state.current.id }).then(function (pair) {
      var id = dir > 0 ? pair[1] : pair[0];
      if (id == null) return;
      var ch = state.channels.find(function (c) {
        return c.id === id;
      });
      if (ch) {
        tune(ch);
        return;
      }
      return invoke("get_channel", { id: id }).then(function (found) {
        if (found) tune(found);
      });
    });
  }

  function loadDemo() {
    invoke("load_demo_playlist")
      .then(function (r) {
        state.view = "live";
        setStatus("Loaded " + r.channel_count + " demo clips");
        return refresh();
      })
      .catch(fail);
  }

  function doImport() {
    var name = document.getElementById("imp-name").value.trim() || "Playlist";
    var url = document.getElementById("imp-url").value.trim();
    var text = document.getElementById("imp-text").value.trim();
    var job;
    if (url) job = invoke("import_m3u_url", { name: name, url: url });
    else if (text) job = invoke("import_m3u_text", { name: name, text: text, origin: "url" });
    else {
      fail("Paste a playlist or enter a URL");
      return;
    }
    job
      .then(function (r) {
        importModal.hidden = true;
        state.view = "live";
        setStatus("Imported " + r.channel_count + " channels");
        return refresh();
      })
      .catch(fail);
  }

  function importFile() {
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
        setStatus("Imported " + r.channel_count + " channels");
        return refresh();
      })
      .catch(fail);
  }

  function openFile() {
    openDialog({
      multiple: false,
      filters: [{ name: "Media", extensions: ["mp4", "mkv", "webm", "mp3", "m4v", "mov", "avi"] }],
    })
      .then(function (path) {
        if (typeof path !== "string") return;
        var title = path.split(/[/\\]/).pop() || path;
        playUrl(title, convertFileSrc(path), "file");
        invoke("add_history", { title: title, url: path, kind: "file", position: 0, duration: 0 }).catch(function () {});
      })
      .catch(fail);
  }

  function openUrlPrompt() {
    var url = window.prompt("Stream or file URL");
    if (!url) return;
    playUrl(url, url, "url");
  }

  document.getElementById("nav").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-view]");
    if (!btn) return;
    state.view = btn.getAttribute("data-view");
    paintChrome();
    renderSheet();
    if (state.view !== "watch") refresh();
  });

  document.getElementById("sheet-close").addEventListener("click", function () {
    state.view = "watch";
    paintChrome();
  });

  document.getElementById("q").addEventListener("input", function (ev) {
    state.query = ev.target.value;
    if (state.view === "watch") state.view = "live";
    loadChannels();
  });

  document.getElementById("btn-import").addEventListener("click", function () {
    importModal.hidden = false;
  });
  document.getElementById("imp-cancel").addEventListener("click", function () {
    importModal.hidden = true;
  });
  document.getElementById("imp-go").addEventListener("click", doImport);
  document.getElementById("imp-file").addEventListener("click", importFile);
  document.getElementById("btn-file").addEventListener("click", openFile);
  document.getElementById("btn-url").addEventListener("click", openUrlPrompt);
  document.getElementById("play").addEventListener("click", togglePlay);
  document.getElementById("stop").addEventListener("click", stop);
  document.getElementById("zap-up").addEventListener("click", function () {
    zap(-1);
  });
  document.getElementById("zap-down").addEventListener("click", function () {
    zap(1);
  });
  document.getElementById("fs").addEventListener("click", function () {
    if (video.requestFullscreen) video.requestFullscreen();
  });
  document.getElementById("seek").addEventListener("input", function (ev) {
    if (video.duration) video.currentTime = (Number(ev.target.value) / 1000) * video.duration;
  });
  document.getElementById("vol").addEventListener("input", function (ev) {
    video.volume = Number(ev.target.value) / 100;
  });
  video.addEventListener("timeupdate", function () {
    document.getElementById("time").textContent = fmt(video.currentTime) + " / " + fmt(video.duration || 0);
    if (video.duration) {
      document.getElementById("seek").value = String(Math.floor((video.currentTime / video.duration) * 1000));
    }
  });
  video.addEventListener("play", function () {
    setPlaying(true);
  });
  video.addEventListener("pause", function () {
    setPlaying(false);
  });
  video.addEventListener("error", function () {
    fail("Playback error");
  });

  window.addEventListener("keydown", function (ev) {
    var tag = ev.target && ev.target.tagName;
    var typing = tag === "INPUT" || tag === "TEXTAREA";
    if (ev.key === "/" && !typing) {
      ev.preventDefault();
      document.getElementById("q").focus();
      return;
    }
    if (ev.key === "Escape") {
      importModal.hidden = true;
      if (state.view !== "watch") {
        state.view = "watch";
        paintChrome();
      }
      return;
    }
    if (typing) return;
    if (ev.key === " ") {
      ev.preventDefault();
      togglePlay();
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      zap(-1);
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      zap(1);
    }
    if (ev.key === "f" || ev.key === "F") {
      if (video.requestFullscreen) video.requestFullscreen();
    }
    if (ev.key === "d" || ev.key === "D") {
      state.showDiag = !state.showDiag;
      diag.classList.toggle("on", state.showDiag);
      diag.textContent =
        "G9 " +
        (state.info ? state.info.version : "") +
        "\nch " +
        (state.current ? state.current.name : "-") +
        "\nurl " +
        (state.current ? state.current.stream_url : video.currentSrc || "-") +
        "\n";
    }
    if (/^[0-9]$/.test(ev.key)) {
      state.zapDigits += ev.key;
      var n = Number(state.zapDigits);
      var ch = state.channels.find(function (c) {
        return c.number === n;
      });
      zapEl.classList.add("show");
      zapEl.innerHTML =
        '<div class="num">' + state.zapDigits + '</div><div class="ch">' + (ch ? escapeHtml(ch.name) : "…") + "</div>";
      window.clearTimeout(state.zapTimer);
      state.zapTimer = window.setTimeout(function () {
        if (ch) tune(ch);
        state.zapDigits = "";
      }, 1200);
    }
  });

  refresh();
})();
