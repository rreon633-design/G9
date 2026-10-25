/* G9 Fun Mode — movies, series, anime and manga from sources you add.
   Vanilla JS, no build step, no libraries. Talks to the Rust side with invoke(). */

(function () {
  "use strict";

  var el = function (id) { return document.getElementById(id); };
  var fun = el("fun");
  if (!fun) return;

  var state = {
    open: false,
    home: null,          // last fun_home answer
    items: [],           // every item currently on the wall
    rows: [],            // [{id,title,kind,items,tag,more}]
    tab: "all",
    query: "",
    browse: null,        // {title, items}
    sort: "quality",
    detail: null,        // current sheet payload
    layer: null,         // "sheet" | "sources" | "profile" | "reader"
    heroIdx: 0,
    heroes: [],
    demo: false,
    reader: null,
    timer: 0
  };

  // ---------------------------------------------------------------- helpers

  function tauri() { return window.__TAURI__ || null; }
  function invoke(cmd, args) {
    var api = tauri();
    if (!api || !api.core) return Promise.reject(new Error("Open G9 as the desktop app."));
    return api.core.invoke(cmd, args || {});
  }
  function bridge() { return window.G9Bridge || null; }

  var toastTimer = 0;
  function toast(msg) {
    var box = el("fun-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "fun-toast";
      box.className = "fun-toast";
      box.innerHTML = "<i></i><span></span>";
      document.body.appendChild(box);
    }
    box.lastChild.textContent = msg;
    box.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { box.classList.remove("show"); }, 2600);
  }

  function esc(raw) {
    return String(raw == null ? "" : raw)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initials(title) {
    return String(title || "")
      .split(/[\s&:'’\-—]+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  }

  // Deterministic palette per title, so a card looks the same every visit even
  // when the source has no artwork.
  var PALETTES = [
    ["#0b1b2b", "#123a5e", "#2f7fd0"], ["#1a0f1a", "#3d1338", "#8b3ba0"],
    ["#0d1f18", "#1a3f31", "#39a06f"], ["#1b1206", "#3d2a08", "#c98a2b"],
    ["#160b0b", "#3a1414", "#b13a3a"], ["#0a1620", "#123246", "#3fb0c9"],
    ["#111018", "#26224a", "#6d5bd0"], ["#1a1410", "#3a2a1e", "#a06a3f"],
    ["#0f1116", "#232a3a", "#5a7cae"], ["#14101c", "#2c1938", "#9b4fbf"],
    ["#101509", "#253214", "#7d9a3a"], ["#1a0d12", "#3c1622", "#c85a7a"]
  ];
  function palette(title) {
    var h = 0, s = String(title || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTES[h % PALETTES.length];
  }
  function artBg(title) {
    var p = palette(title);
    return "radial-gradient(120% 95% at 82% 10%, " + p[2] + "66 0%, transparent 56%)," +
      "radial-gradient(95% 85% at 14% 92%, " + p[1] + "99 0%, transparent 62%)," +
      "linear-gradient(152deg, " + p[0] + " 0%, #050608 80%)";
  }

  var QUAL_LABEL = { uhd: "4K", fhd: "1080p", hd: "720p", sd: "SD", unknown: "—" };
  function qualLabel(q) { return QUAL_LABEL[String(q || "unknown").toLowerCase()] || "—"; }

  function kindWord(kind, item) {
    if (kind === "movie") return "Film";
    if (kind === "series") return "Series";
    if (kind === "anime") return "Anime";
    if (kind === "drama") return "Drama";
    if (kind === "serial") return "Serial";
    if (kind === "manga") return (item && item.subtitle) || "Manga";
    return "Title";
  }

  function metaLine(item) {
    var bits = [];
    if (item.year) bits.push(item.year);
    if (item.subtitle) bits.push(item.subtitle);
    else if (item.genres && item.genres.length) bits.push(item.genres[0]);
    return bits.join(" · ");
  }

  function isPortrait(item) { return String(item.kind) === "manga"; }

  // ---------------------------------------------------------------- cards

  function cardHTML(item, opts) {
    opts = opts || {};
    var portrait = isPortrait(item);
    var bg = artBg(item.title);
    var img = item.poster
      ? '<img src="' + esc(item.poster) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />'
      : "";
    var top = "";
    var right = "";
    if (opts.rank) {
      top = '<span class="num' + (opts.rank <= 3 ? " top" : "") + '">' + opts.rank + "</span>";
    }
    var badge = item.badge ? String(item.badge) : "";
    var badgeHTML = badge && !opts.noBadge
      ? '<span class="fun-badge ' + (/NEW|ONGOING|TOP/i.test(badge) ? "new" : "") + '">' + esc(badge) + "</span>"
      : "<span></span>";
    if (portrait) {
      right = '<span class="fun-badge">' + esc((item.subtitle || "MANGA").toUpperCase()) + "</span>";
    } else if (item.quality && qualLabel(item.quality) !== "—") {
      right = '<span class="fun-badge q">' + qualLabel(item.quality) + "</span>";
    }
    var meta = portrait
      ? (item.subtitle ? esc(item.subtitle) : "Manga")
      : [metaLine(item), item.score ? "<b>★ " + Number(item.score).toFixed(1) + "</b>" : ""]
          .filter(Boolean).join(" ");
    var progress = opts.progress
      ? '<div class="fun-prog"><i style="width:' + Math.round(opts.progress * 100) + '%"></i></div>'
      : "";

    return '<button type="button" class="fun-card ' + (portrait ? "port" : "land") + '"' +
      ' data-item="' + esc(item.id) + '" aria-label="' + esc(item.title) + '">' +
      '<span class="art" style="background:' + bg + '"><span class="rings"></span>' + img +
      '<span class="mark">' + esc(initials(item.title)) + "</span></span>" +
      '<span class="scrim"></span>' +
      '<span class="hoverplay"><span class="b"><svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg></span></span>' +
      '<span class="top">' + badgeHTML + right + "</span>" +
      '<span class="body"><span class="c-title">' + esc(item.title) + "</span>" +
      (meta ? '<span class="c-meta">' + meta + "</span>" : "") + "</span>" +
      progress + "</button>";
  }

  // ---------------------------------------------------------------- rails

  function railHTML(row) {
    var cards = row.items.map(function (item, i) {
      var opts = { progress: item.__progress, noBadge: !!row.ranked };
      if (row.ranked) {
        return '<div class="fun-rank">' +
          '<span class="num' + (i < 3 ? " top" : "") + '">' + (i + 1) + "</span>" +
          cardHTML(item, opts) + "</div>";
      }
      return cardHTML(item, opts);
    }).join("");

    return '<section class="fun-row" data-row="' + esc(row.id) + '" data-kind="' + esc(row.kind || "") + '">' +
      '<div class="fun-row-head"><h2 class="fun-row-title">' + esc(row.title) +
      (row.tag ? '<span class="tag">' + esc(row.tag) + "</span>" : "") + "</h2>" +
      (row.more ? '<button type="button" class="fun-row-more" data-see-all="' + esc(row.id) + '">See all ' +
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg></button>' : "") +
      "</div>" +
      '<div class="fun-rail-wrap">' +
      '<button type="button" class="fun-rail-btn prev" data-dir="-1" hidden aria-label="Scroll left"><span>' +
      '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></span></button>' +
      '<div class="fun-rail">' + cards + "</div>" +
      '<button type="button" class="fun-rail-btn next" data-dir="1" aria-label="Scroll right"><span>' +
      '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span></button>' +
      "</div></section>";
  }

  function paintRows() {
    var host = el("fun-rows");
    if (!host) return;
    var rows = state.rows.filter(function (r) {
      if (state.tab === "all") return true;
      return (r.kind || "") === state.tab || (r.kinds || []).indexOf(state.tab) >= 0;
    });
    if (!rows.length) {
      host.innerHTML = '<div class="fun-empty"><div class="big">Nothing here yet</div>' +
        "Add a source to fill this shelf — Sources, top right.</div>";
      return;
    }
    host.innerHTML = rows.map(railHTML).join("");
    host.querySelectorAll(".fun-rail-wrap").forEach(function (wrap) {
      var rail = wrap.querySelector(".fun-rail");
      var prev = wrap.querySelector(".prev");
      var next = wrap.querySelector(".next");
      function sync() {
        prev.hidden = rail.scrollLeft < 8;
        next.hidden = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
      }
      rail.addEventListener("scroll", sync, { passive: true });
      sync();
    });
  }

  // ---------------------------------------------------------------- hero

  function paintHero() {
    var host = el("fun-hero");
    if (!host) return;
    if (!state.heroes.length) { host.innerHTML = ""; host.hidden = true; return; }
    host.hidden = false;
    var item = state.heroes[state.heroIdx % state.heroes.length];
    var bg = artBg(item.title);
    var img = item.backdrop || item.poster
      ? '<img src="' + esc(item.backdrop || item.poster) + '" alt="" onerror="this.style.display=\'none\'" style="width:100%;height:100%;object-fit:cover" />'
      : "";
    var genres = (item.genres || []).slice(0, 3).join(" · ");
    var reading = isPortrait(item);

    host.innerHTML =
      '<div class="fun-hero-art" style="background:' + bg + '">' + img +
      '<span class="mark">' + esc(initials(item.title)) + "</span></div>" +
      '<div class="fun-hero-inner">' +
      '<div class="fun-kicker"><span class="n">G9 · FUN</span><span class="t">' +
      esc(kindWord(item.kind, item)) + " · featured</span></div>" +
      "<h1>" + esc(item.title) + "</h1>" +
      '<div class="fun-hero-meta">' +
      (item.score ? '<span class="score">★ ' + Number(item.score).toFixed(1) + "</span><span class=\"dot\"></span>" : "") +
      (item.year ? "<span>" + item.year + "</span>" : "") +
      (item.subtitle ? "<span>" + esc(item.subtitle) + "</span>" : "") +
      (genres ? "<span>" + esc(genres) + "</span>" : "") +
      "</div>" +
      (item.synopsis ? '<p class="fun-syn">' + esc(item.synopsis) + "</p>" : "") +
      '<div class="fun-hero-btns">' +
      '<button type="button" class="fun-btn is-play" data-hero-play>' +
      '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg>' + (reading ? "Read" : "Play") + "</button>" +
      '<button type="button" class="fun-btn is-info" data-hero-info>More info</button>' +
      "</div></div>" +
      '<div class="fun-hero-dots">' + state.heroes.map(function (_, i) {
        return '<button type="button" data-hero="' + i + '" aria-current="' + (i === state.heroIdx) + '" aria-label="Featured ' + (i + 1) + '"></button>';
      }).join("") + "</div>";

    host.querySelector("[data-hero-play]").addEventListener("click", function () { openItem(item); });
    host.querySelector("[data-hero-info]").addEventListener("click", function () { openItem(item, true); });
    host.querySelectorAll("[data-hero]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.heroIdx = Number(b.getAttribute("data-hero"));
        paintHero();
      });
    });
  }

  // ---------------------------------------------------------------- wall

  var DEMO_SHELVES = [
    { id: "demo-movies", title: "Movies", kind: "movie", more: true, items: demoItems("movie", 8) },
    { id: "demo-series", title: "Web series", kind: "series", more: true, items: demoItems("series", 8) },
    { id: "demo-anime", title: "Anime", kind: "anime", tag: "SUB · DUB", more: true, items: demoItems("anime", 8) },
    { id: "demo-drama", title: "Drama & serials", kind: "drama", more: true, items: demoItems("drama", 8) },
    { id: "demo-manga", title: "Manga · Manhwa · Manhua", kind: "manga", tag: "READER", more: true, items: demoItems("manga", 8) }
  ];

  function demoItems(kind, n) {
    var names = {
      movie: ["Nightfall Protocol", "Iron Meridian", "The Last Cartographer", "Salt & Static", "Vantablack", "Harbour Lights", "Seventh Signal", "Cold Orbit"],
      series: ["The Longest Winter", "Ashfall District", "Static Bloom", "Bureau 7", "Neon Pilgrims", "Divide & Conquer", "Second Shift", "The Understudy"],
      anime: ["Kagerou Requiem", "Skybound Saga", "Mecha Hana", "Overdrive Zero", "Ronin of the Cloud Sea", "Aozora Signal", "Paper Cranes", "Beast Tamer"],
      drama: ["Hanbando Nights", "The Promise of Spring", "Sea of Glass", "Gyeongseong Diary", "Kaali Raat", "The Tenant Upstairs", "My Second Husband", "Sultan's Daughter"],
      manga: ["Shadow Sovereign", "Tower of Cinders", "Cultivation Chronicles", "Frost Lotus", "Blood & Ink", "Jade Pavilion", "Nine Realms", "Devil's Apprentice"]
    };
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        id: "demo:" + kind + ":" + i,
        title: names[kind][i % names[kind].length],
        kind: kind,
        year: 2023 + (i % 3),
        score: 7.4 + ((i * 7) % 16) / 10,
        subtitle: kind === "manga" ? ["Manhwa", "Manhua", "Manga"][i % 3] : null,
        quality: kind === "manga" ? "unknown" : ["uhd", "fhd", "hd"][i % 3],
        genres: ["Preview"],
        badge: "SAMPLE",
        demo: true
      });
    }
    return out;
  }

  function applyHome(home) {
    state.home = home;
    state.demo = !!home.demo;
    var rows = [];
    (home.shelves || []).forEach(function (s) {
      var items = (s.items || []).map(function (i) { return i; });
      rows.push({
        id: s.id,
        title: s.title,
        kind: s.kind === "manga" ? "manga" : (s.kind || ""),
        kinds: [],
        items: items,
        more: items.length > 6,
        ranked: s.id === "top10"
      });
    });

    if (home.demo) {
      rows = DEMO_SHELVES.map(function (r) { return Object.assign({}, r); });
    }
    // A Top 10 row makes the wall feel alive when there is enough to rank.
    var pool = [];
    rows.forEach(function (r) { if (!isPortraitKind(r.kind)) pool = pool.concat(r.items); });
    if (pool.length >= 10) {
      var ranked = pool.slice(0, 10);
      rows.splice(rows.length > 1 ? 1 : 0, 0, {
        id: "top10", title: "Top 10 in your sources", kind: "", items: ranked, ranked: true
      });
    }

    state.rows = rows;
    state.items = [];
    rows.forEach(function (r) { state.items = state.items.concat(r.items); });

    var heroes = [];
    rows.forEach(function (r) {
      r.items.forEach(function (i) {
        if (!isPortrait(i) && i.poster !== undefined && heroes.indexOf(i) < 0) heroes.push(i);
      });
    });
    state.heroes = heroes.slice(0, 5);
    state.heroIdx = 0;

    var note = el("fun-note");
    if (note) {
      if (home.demo) {
        note.hidden = false;
        note.innerHTML = "<b>Nothing added yet.</b> These are placeholders so you can see the layout — " +
          "open <b>Sources</b> and add a Stremio addon, an RSS feed, or turn on MangaDex.";
      } else if (home.errors && home.errors.length) {
        note.hidden = false;
        note.textContent = home.errors.slice(0, 2).join(" · ");
      } else {
        note.hidden = true;
      }
    }

    paintHero();
    paintRows();
  }

  function isPortraitKind(kind) { return kind === "manga"; }

  function loadWall() {
    return invoke("fun_home")
      .then(applyHome)
      .catch(function () {
        // No backend (design preview) — show the layout rather than a blank wall.
        applyHome({ shelves: [], sources: [], demo: true, errors: [] });
      });
  }

  // ---------------------------------------------------------------- details

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function closeSheet() {
    var scrim = el("fun-sheet");
    if (scrim) scrim.hidden = true;
    var card = el("fun-sheet-card");
    if (card) card.innerHTML = "";
    state.detail = null;
    if (state.layer === "sheet" || state.layer === "sources" || state.layer === "profile") state.layer = null;
  }

  function sheetHost(narrow) {
    var scrim = el("fun-sheet");
    var card = el("fun-sheet-card");
    card.className = "fun-sheet" + (narrow ? " narrow" : "");
    scrim.hidden = false;
    return card;
  }

  function openItem(item, skipPlay) {
    if (!item) return;
    var id = item.id;
    if (String(id).indexOf("demo:") === 0) {
      toast("Sample card — add a source to play something real");
      return;
    }
    state.layer = "sheet";
    var card = sheetHost(false);
    card.innerHTML = '<div class="fun-plain"><h2>' + esc(item.title) + "</h2>" +
      '<p class="lead">Loading details…</p></div>';

    invoke("fun_details", { id: id, kind: item.kind || null })
      .then(function (payload) { renderDetails(item, payload, skipPlay); })
      .catch(function (err) { renderDetails(item, { details: { item: item, episodes: [] }, streams: [], progress: null }, skipPlay, err); });
  }

  function renderDetails(base, payload, skipPlay, err) {
    var d = (payload && payload.details) || { item: base, episodes: [] };
    var item = d.item || base;
    var episodes = d.episodes || [];
    var streams = payload.streams || [];
    var reading = isPortrait(item);
    state.detail = payload;

    var card = sheetHost(false);
    var bg = artBg(item.title);
    var img = item.backdrop || item.poster
      ? '<img src="' + esc(item.backdrop || item.poster) + '" alt="" onerror="this.style.display=\'none\'" />'
      : "";
    var genres = (item.genres || []).slice(0, 3).join(" · ");
    var chips;
    if (reading) {
      // A reader has chapters, not streams — say where they came from.
      chips = '<span class="fun-srcchip"><i></i>' + esc(item.subtitle || "MangaDex") +
        " · " + episodes.length + " chapters</span>" +
        '<span class="fun-srcchip warn"><i></i>pages load on open</span>';
    } else {
      chips = streams.slice(0, 3).map(function (s) {
        return '<span class="fun-srcchip' + (s.magnet ? " warn" : "") + '"><i></i>' +
          esc(s.provider || "source") + " · " + esc(s.label || "") + "</span>";
      }).join("");
      if (!chips) chips = '<span class="fun-srcchip warn"><i></i>No stream yet</span>';
    }

    var list;
    if (episodes.length) {
      list = '<h3 class="sub">' + (reading ? "Chapters" : "Episodes") +
        "<span>" + episodes.length + " available</span></h3><div class=\"fun-eps\">" +
        episodes.map(function (e, i) {
          return '<button type="button" class="fun-ep" data-ep="' + i + '">' +
            '<span class="n">' + esc(e.number != null ? e.number : i + 1) + "</span>" +
            '<span class="th" style="background:' + bg + '"></span>' +
            "<span><span class=\"tt\">" + esc(e.title || ("Episode " + (i + 1))) + "</span>" +
            '<span class="ts">' + [e.released ? esc(String(e.released).slice(0, 10)) : "",
              e.overview ? esc(String(e.overview).slice(0, 70)) : ""]
              .filter(Boolean).join(" · ") + "</span></span>" +
            '<span class="dur">' + (e.runtime ? e.runtime + (reading ? "p" : "m") : "") + "</span>" +
            "</button>";
        }).join("") + "</div>";
    } else {
      list = '<div class="fun-infogrid">' +
        "<div><div class=\"k\">SOURCE</div><div class=\"v\">" + esc(item.subtitle || kindWord(item.kind, item)) + "</div></div>" +
        "<div><div class=\"k\">FORMAT</div><div class=\"v\">" + (reading ? "Pages" : qualLabel(item.quality)) + "</div></div>" +
        "<div><div class=\"k\">STREAMS</div><div class=\"v\">" + streams.length + " found</div></div>" +
        "</div>";
    }

    card.innerHTML =
      '<div class="fun-sheet-head"><div class="art" style="background:' + bg + '">' + img +
      '<span class="mark">' + esc(initials(item.title)) + "</span></div>" +
      '<div class="fade"></div>' +
      '<button type="button" class="fun-sheet-close" data-close-sheet aria-label="Close">' +
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="fun-sheet-htxt"><h2>' + esc(item.title) + "</h2>" +
      '<div class="fun-sheet-meta">' +
      (item.score ? '<span class="score">★ ' + Number(item.score).toFixed(1) + "</span><span class=\"dot\"></span>" : "") +
      (item.year ? "<span>" + item.year + "</span><span class=\"dot\"></span>" : "") +
      "<span>" + esc(kindWord(item.kind, item)) + "</span>" +
      (genres ? '<span class="dot"></span><span>' + esc(genres) + "</span>" : "") +
      "</div></div></div>" +
      '<div class="fun-sheet-body">' +
      '<div class="fun-actions">' +
      '<button type="button" class="fun-btn is-play" data-play>' +
      '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg>' +
      (reading ? "Read" : (payload.progress && payload.progress.position ? "Resume" : "Play")) + "</button>" +
      '<button type="button" class="fun-icon-btn" data-mylist aria-label="Add to My List">' +
      '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>' +
      (reading ? "" : '<button type="button" class="fun-icon-btn" data-download aria-label="Download">' +
        '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg></button>') +
      "</div>" +
      (item.synopsis ? '<p class="syn">' + esc(item.synopsis) + "</p>" : "") +
      '<div class="fun-srcrow"><span class="lbl">SOURCES</span>' + chips + "</div>" +
      list +
      (err ? '<div class="fun-note-small">' + esc(String(err).slice(0, 110)) + "</div>" : "") +
      "</div>";

    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelector("[data-play]").addEventListener("click", function () {
      if (reading) {
        var first = episodes[pickChapterIndex(payload)] || episodes[0];
        if (first) openReader(item, first);
        else toast("No chapters for this one");
      } else {
        playFrom(payload, item, episodes[0] || null);
      }
    });
    var listBtn = card.querySelector("[data-mylist]");
    if (listBtn) listBtn.addEventListener("click", function () {
      var on = listBtn.classList.toggle("on");
      toast(on ? "Added “" + item.title + "” to My List" : "Removed “" + item.title + "” from My List");
    });
    var dl = card.querySelector("[data-download]");
    if (dl) dl.addEventListener("click", function () {
      if (!streams.length) { toast("No stream to download yet"); return; }
      var s = streams[0];
      if (s.magnet) { toast("Magnet downloads arrive with the torrent engine"); return; }
      // height 0 = "let the downloader pick the best" (see dl_start).
      invoke("dl_start", { url: s.url, height: 0, title: item.title })
        .then(function () { toast("Queued download · " + item.title); })
        .catch(function () { toast("The downloader is not available here"); });
    });
    card.querySelectorAll(".fun-ep").forEach(function (row) {
      row.addEventListener("click", function () {
        var ep = episodes[Number(row.getAttribute("data-ep"))];
        if (!ep) return;
        if (reading) openReader(item, ep);
        else playFrom(payload, item, ep);
      });
    });
    if (!skipPlay) card.scrollTop = 0;
  }

  function pickChapterIndex(payload) {
    var p = payload && payload.progress;
    return p && p.page ? 0 : 0;
  }

  // ---------------------------------------------------------------- playing

  function playFrom(payload, item, episode) {
    var streams = (payload && payload.streams) || [];
    if (!streams.length) {
      resolveThenPlay(item, episode);
      return;
    }
    startStream(streams[0], item, episode);
  }

  function resolveThenPlay(item, episode) {
    toast("Finding a stream…");
    var id = item.id;
    invoke("fun_streams", { id: id, kind: item.kind || null, episode: episode ? episode.id : null })
      .then(function (streams) {
        if (!streams || !streams.length) { toast("No sources for this one"); return; }
        startStream(streams[0], item, episode);
      })
      .catch(function (err) { toast(String(err || "No sources for this one").slice(0, 90)); });
  }

  function startStream(stream, item, episode) {
    if (stream.magnet) {
      toast("Magnet link — the torrent engine lands in the next release");
      return;
    }
    var b = bridge();
    closeSheet();
    hide();
    if (b && b.play) b.play(item.title, stream.url);
    else toast("Player unavailable");

    var sourceId = Number(String(item.id).split(":")[0]) || 0;
    var providerId = String(item.id).split(":").slice(1).join(":");
    invoke("fun_progress_save", {
      row: {
        source_id: sourceId,
        item_id: providerId,
        kind: item.kind || "movie",
        title: item.title,
        poster: item.poster || null,
        episode_id: episode ? episode.id : null,
        episode_title: episode ? episode.title : null,
        season: episode && episode.season != null ? episode.season : null,
        episode: episode && episode.number != null ? episode.number : null,
        position: 0,
        duration: 0,
        page: null,
        updated_at: ""
      }
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- reader

  function openReader(item, chapter) {
    state.layer = "reader";
    var host = el("fun-reader");
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<div class="fun-reader-top"><b>' + esc(item.title) + "</b>" +
      '<span class="sp" id="fun-reader-pos">loading…</span>' +
      '<span class="fun-pages"><button type="button" data-reader-close>Close</button></span></div>' +
      '<div class="fun-reader-stage" id="fun-reader-stage"><div class="fun-empty">Loading pages…</div></div>';

    host.querySelector("[data-reader-close]").addEventListener("click", closeReader);

    invoke("fun_pages", { id: item.id, chapter: chapter.id })
      .then(function (pages) {
        state.reader = { item: item, chapter: chapter, pages: pages, index: 0 };
        paintReader();
      })
      .catch(function (err) {
        var stage = el("fun-reader-stage");
        if (stage) stage.innerHTML = '<div class="fun-empty"><div class="big">Pages unavailable</div>' +
          esc(String(err || "").slice(0, 90)) + "</div>";
      });
  }

  function paintReader() {
    var r = state.reader;
    if (!r) return;
    var stage = el("fun-reader-stage");
    var pos = el("fun-reader-pos");
    if (pos) pos.textContent = r.chapter.title + " · " + r.pages.length + " pages";
    if (!stage) return;
    stage.innerHTML = r.pages.map(function (url, i) {
      return '<img src="' + esc(url) + '" alt="Page ' + (i + 1) + '" loading="' + (i < 3 ? "eager" : "lazy") +
        '" onerror="this.alt=\'Page failed to load\'" />';
    }).join("");
    closeSheet();
    saveReading(r);
  }

  function saveReading(r) {
    var sourceId = Number(String(r.item.id).split(":")[0]) || 0;
    var providerId = String(r.item.id).split(":").slice(1).join(":");
    invoke("fun_progress_save", {
      row: {
        source_id: sourceId, item_id: providerId, kind: "manga", title: r.item.title,
        poster: r.item.poster || null, episode_id: r.chapter.id, episode_title: r.chapter.title,
        season: null, episode: null, position: 0, duration: 0, page: 1, updated_at: ""
      }
    }).catch(function () {});
  }

  function closeReader() {
    var host = el("fun-reader");
    if (host) { host.hidden = true; host.innerHTML = ""; }
    state.reader = null;
    if (state.layer === "reader") state.layer = null;
  }

  // ---------------------------------------------------------------- sources

  function openSources() {
    state.layer = "sources";
    var card = sheetHost(true);
    card.innerHTML = '<div class="fun-plain"><h2>Sources</h2>' +
      '<p class="lead">G9 ships no catalogue. Add an addon, a feed, or turn on MangaDex.</p>' +
      '<div id="fun-source-list"><div class="fun-empty">Loading…</div></div>' +
      '<div class="fun-addrow"><input id="fun-add-url" placeholder="Paste an addon manifest.json or an RSS feed URL" />' +
      '<button type="button" class="fun-btn is-acc" id="fun-add-btn">Add</button></div>' +
      '<label class="fun-addrow" style="margin-top:7px">' +
      '<input id="fun-add-manga" placeholder="…or a MangaDex title ID (optional)" /></label>' +
      '<p class="fun-note-small">Addons use the open Stremio protocol. Feeds are read as RSS. ' +
      "Everything you add stays in G9's local database.</p>" +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-info" data-close-sheet>Done</button></div></div>';

    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelector("#fun-add-btn").addEventListener("click", addSourceFromInputs);
    card.querySelector("#fun-add-url").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") addSourceFromInputs();
    });
    paintSources();
  }

  function addSourceFromInputs() {
    var input = el("fun-add-url");
    if (!input) return;
    var url = String(input.value || "").trim();
    if (!url) { input.focus(); return; }
    input.value = "";
    toast("Checking source…");
    invoke("fun_source_add", { url: url, kind: null })
      .then(function (src) {
        toast("Added · " + src.name);
        paintSources();
        loadWall();
      })
      .catch(function (err) { toast(String(err || "Could not add that source").slice(0, 100)); });
  }

  function paintSources() {
    var host = el("fun-source-list");
    if (!host) return;
    invoke("fun_sources")
      .then(function (list) {
        var builtins = [
          { kind: "mangadex", name: "MangaDex", detail: "manga · manhwa · manhua", url: "https://api.mangadex.org" }
        ];
        var rows = [];
        (list || []).forEach(function (s) {
          rows.push({
            id: s.id, kind: s.kind, name: s.name, detail: s.detail || s.kind,
            on: s.enabled, removable: true, url: s.url
          });
        });
        builtins.forEach(function (b) {
          // Only offer the built-in when it is not already in the list.
          if ((list || []).some(function (s) { return s.kind === b.kind; })) return;
          rows.push({
            id: null, kind: b.kind, name: b.name, detail: b.detail,
            on: false, removable: false, url: b.url
          });
        });
        if (!rows.length) {
          host.innerHTML = '<div class="fun-empty">No sources yet — paste one below.</div>';
          return;
        }
        host.innerHTML = rows.map(function (r, i) {
          var ic = r.kind === "stremio" ? "ST" : r.kind === "rss" ? "RS" : r.kind === "mangadex" ? "MD" : "YT";
          return '<div class="fun-srcitem" data-i="' + i + '">' +
            '<div class="ic">' + ic + "</div>" +
            "<div><div class=\"nm\">" + esc(r.name) + "</div><div class=\"ds\">" + esc(r.detail) + "</div></div>" +
            '<button type="button" class="fun-switch" role="switch" aria-checked="' + r.on + '" aria-label="' + esc(r.name) + '"></button>' +
            (r.removable ? '<button type="button" class="fun-round" data-remove="' + r.id + '" aria-label="Remove">' +
              '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : "") +
            "</div>";
        }).join("");

        host.querySelectorAll(".fun-srcitem").forEach(function (row) {
          var r = rows[Number(row.getAttribute("data-i"))];
          row.querySelector(".fun-switch").addEventListener("click", function () {
            var next = !r.on;
            if (r.id == null) {
              // First time a built-in is switched on: add it as a real source.
              invoke("fun_source_add", { url: r.url, kind: r.kind })
                .then(function () { r.on = true; toast(r.name + " enabled"); paintSources(); loadWall(); })
                .catch(function (e) { toast(String(e || "Could not enable").slice(0, 90)); });
              return;
            }
            invoke("fun_source_toggle", { id: r.id, enabled: next })
              .then(function () {
                r.on = next;
                row.querySelector(".fun-switch").setAttribute("aria-checked", String(next));
                loadWall();
              })
              .catch(function () { toast("Could not change that source"); });
          });
          var rm = row.querySelector("[data-remove]");
          if (rm) rm.addEventListener("click", function () {
            invoke("fun_source_remove", { id: r.id })
              .then(function () { toast("Removed " + r.name); paintSources(); loadWall(); })
              .catch(function () { toast("Could not remove that source"); });
          });
        });
      })
      .catch(function () {
        host.innerHTML = '<div class="fun-empty">Sources need the desktop app.</div>';
      });
  }

  // ---------------------------------------------------------------- profile

  var PREFS = {
    quality: { label: "Preferred quality", desc: "Best stream that fits the connection.", options: [["auto", "Auto"], ["2160", "4K"], ["1080", "1080p"], ["720", "720p"]] },
    subs: { label: "Subtitles", desc: "Auto-matched from your subtitle sources.", options: [["auto", "Auto"], ["en", "English"], ["hi", "Hindi"], ["off", "Off"]] },
    autoplay: { label: "Autoplay next episode", desc: "Start the next episode after a 10 s card.", options: [["on", "On"], ["off", "Off"]] },
    fallback: { label: "Fallback to next source", desc: "When a stream 403s or stalls, try the next one.", options: [["on", "On"], ["off", "Off"]] }
  };
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem("g9.fun.prefs") || "{}"); } catch (e) { prefs = {}; }

  function openProfile() {
    state.layer = "profile";
    var card = sheetHost(true);
    card.innerHTML = '<div class="fun-plain"><h2>Playback</h2>' +
      '<p class="lead">Applies to every Fun Mode source. Stored on this device.</p>' +
      Object.keys(PREFS).map(function (k) {
        var cur = prefs[k] || PREFS[k].options[0][0];
        return '<div class="fun-pref" data-k="' + k + '">' +
          "<div><div class=\"pn\">" + PREFS[k].label + "</div><div class=\"pd\">" + PREFS[k].desc + "</div></div>" +
          '<div class="pc">' + PREFS[k].options.map(function (o) {
            return '<button type="button" class="fun-seg" data-v="' + o[0] + '" aria-pressed="' +
              (cur === o[0]) + '">' + o[1] + "</button>";
          }).join("") + "</div></div>";
      }).join("") +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-info" data-close-sheet>Done</button></div></div>';

    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelectorAll(".fun-pref").forEach(function (row) {
      var k = row.getAttribute("data-k");
      row.querySelectorAll(".fun-seg").forEach(function (b) {
        b.addEventListener("click", function () {
          prefs[k] = b.getAttribute("data-v");
          try { localStorage.setItem("g9.fun.prefs", JSON.stringify(prefs)); } catch (e) {}
          row.querySelectorAll(".fun-seg").forEach(function (x) {
            x.setAttribute("aria-pressed", String(x === b));
          });
          toast(PREFS[k].label + " · " + b.textContent);
        });
      });
    });
  }

  // ---------------------------------------------------------------- browse + search

  function openBrowse(rowId) {
    var row = null;
    for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === rowId) row = state.rows[i];
    if (!row) return;
    state.browse = { title: row.title, items: row.items.slice() };
    el("fun-browse-title").textContent = row.title;
    paintBrowse();
    el("fun-browse").hidden = false;
  }

  var SORTS = {
    quality: function (a, b) { return rankQ(b.quality) - rankQ(a.quality) || (b.score || 0) - (a.score || 0); },
    year: function (a, b) { return (b.year || 0) - (a.year || 0) || (b.score || 0) - (a.score || 0); },
    score: function (a, b) { return (b.score || 0) - (a.score || 0) || (b.year || 0) - (a.year || 0); }
  };
  function rankQ(q) { return { uhd: 4, fhd: 3, hd: 2, sd: 1 }[q] || 0; }

  function paintBrowse() {
    if (!state.browse) return;
    var items = state.browse.items.slice().sort(SORTS[state.sort] || SORTS.quality);
    var sub = el("fun-browse-sub");
    if (sub) {
      sub.textContent = items.length + " title" + (items.length === 1 ? "" : "s") + " · " +
        (state.sort === "year" ? "newest first" : state.sort === "score" ? "top rated first" : "best quality first");
    }
    el("fun-browse-grid").innerHTML = items.length
      ? items.map(function (i) { return cardHTML(i, {}); }).join("")
      : '<div class="fun-empty"><div class="big">Nothing here</div>Add a source to fill this shelf.</div>';
  }

  function closeBrowse() {
    el("fun-browse").hidden = true;
    state.browse = null;
  }

  function runSearch() {
    var q = String(state.query || "").trim();
    var host = el("fun-searchview");
    if (!host) return;
    if (q.length < 2) { host.hidden = true; el("fun-search-grid").innerHTML = ""; return; }
    host.hidden = false;
    el("fun-search-head").innerHTML = "Searching…";
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(function () {
      invoke("fun_search", { q: q })
        .then(function (items) {
          if (!items || !items.length) {
            var local = state.items.filter(function (i) {
              return String(i.title).toLowerCase().indexOf(q.toLowerCase()) >= 0;
            });
            items = local;
          }
          el("fun-search-head").textContent = items.length
            ? items.length + " result" + (items.length === 1 ? "" : "s") + " for “" + q + "”"
            : "No results for “" + q + "”";
          el("fun-search-grid").innerHTML = items.length
            ? items.map(function (i) { return cardHTML(i, {}); }).join("")
            : '<div class="fun-empty"><div class="big">Nothing matched</div>Try a genre, or add a source that carries it.</div>';
        })
        .catch(function () { el("fun-search-head").textContent = "Search needs the desktop app"; });
    }, 260);
  }

  // ---------------------------------------------------------------- open/close

  function visible() { return !fun.hidden; }

  function show() {
    if (visible()) return;
    var b = bridge();
    if (b && b.hideTv) b.hideTv();
    if (b && b.hideGate) b.hideGate();
    fun.hidden = false;
    state.open = true;
    var btn = el("btn-fun");
    if (btn) { btn.classList.add("on"); btn.setAttribute("aria-pressed", "true"); }
    var tvBtn = el("btn-tv");
    if (tvBtn) tvBtn.classList.remove("on");
    if (b && b.showChrome) b.showChrome();
    loadWall();
  }

  function hide() {
    if (!visible()) return;
    fun.hidden = true;
    state.open = false;
    closeSheet();
    closeReader();
    closeBrowse();
    var sv = el("fun-searchview");
    if (sv) sv.hidden = true;
    var btn = el("btn-fun");
    if (btn) { btn.classList.remove("on"); btn.setAttribute("aria-pressed", "false"); }
  }

  function toggle() { if (visible()) hide(); else show(); }

  // ---------------------------------------------------------------- events

  function wire() {
    var btn = el("btn-fun");
    if (btn) btn.addEventListener("click", toggle);
    var close = el("fun-close");
    if (close) close.addEventListener("click", hide);
    var sources = el("fun-sources");
    if (sources) sources.addEventListener("click", openSources);
    var profile = el("fun-profile");
    if (profile) profile.addEventListener("click", openProfile);

    var tabs = el("fun-tabs");
    if (tabs) tabs.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-tab]");
      if (!b) return;
      state.tab = b.getAttribute("data-tab");
      tabs.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-selected", String(x === b));
      });
      closeBrowse();
      paintRows();
      fun.scrollTo({ top: 0, behavior: "smooth" });
    });

    var q = el("fun-q");
    if (q) q.addEventListener("input", function () {
      state.query = q.value;
      runSearch();
    });

    // Cards, See all, rail arrows — one delegated listener for the whole wall.
    var rows = el("fun-rows");
    if (rows) rows.addEventListener("click", function (ev) {
      var arrow = ev.target.closest(".fun-rail-btn");
      if (arrow) {
        var rail = arrow.parentElement.querySelector(".fun-rail");
        var dir = Number(arrow.getAttribute("data-dir")) || 1;
        rail.scrollBy({ left: dir * rail.clientWidth * 0.85, behavior: "smooth" });
        return;
      }
      var seeAll = ev.target.closest("[data-see-all]");
      if (seeAll) { openBrowse(seeAll.getAttribute("data-see-all")); return; }
      var card = ev.target.closest(".fun-card");
      if (card) openItem(findItem(card.getAttribute("data-item")) || cardItem(card));
    });

    var grid = el("fun-browse-grid");
    if (grid) grid.addEventListener("click", function (ev) {
      var card = ev.target.closest(".fun-card");
      if (card) openItem(findItem(card.getAttribute("data-item")) || cardItem(card));
    });
    var sgrid = el("fun-search-grid");
    if (sgrid) sgrid.addEventListener("click", function (ev) {
      var card = ev.target.closest(".fun-card");
      if (card) openItem(cardItem(card));
    });

    var back = el("fun-browse-back");
    if (back) back.addEventListener("click", closeBrowse);
    var sort = el("fun-sort");
    if (sort) sort.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-sort]");
      if (!b) return;
      state.sort = b.getAttribute("data-sort");
      sort.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
      paintBrowse();
    });

    var scrim = el("fun-sheet");
    if (scrim) scrim.addEventListener("click", function (ev) {
      if (ev.target === scrim) closeSheet();
    });

    document.addEventListener("keydown", function (ev) {
      if (!visible()) return;
      if (ev.key === "Escape") {
        if (state.layer === "reader") { closeReader(); ev.preventDefault(); return; }
        if (state.layer === "sheet" || state.layer === "sources" || state.layer === "profile") {
          closeSheet(); ev.preventDefault(); return;
        }
        if (!el("fun-browse").hidden) { closeBrowse(); ev.preventDefault(); return; }
        if (!el("fun-searchview").hidden) { el("fun-searchview").hidden = true; if (q) q.value = ""; ev.preventDefault(); return; }
        hide();
        ev.preventDefault();
      }
      if (ev.key === "/" && document.activeElement !== q && q) {
        q.focus();
        ev.preventDefault();
      }
    });

    // Pause the hero carousel while a dialog is open.
    window.setInterval(function () {
      if (!visible() || state.layer) return;
      if (state.heroes.length < 2) return;
      state.heroIdx = (state.heroIdx + 1) % state.heroes.length;
      paintHero();
    }, 11000);
  }

  function cardItem(node) {
    // Rebuild a minimal item when a card lives in a list we do not keep around
    // (search results that came straight from the backend).
    var title = node.querySelector(".c-title");
    return {
      id: node.getAttribute("data-item"),
      title: title ? title.textContent : "",
      kind: node.classList.contains("port") ? "manga" : "movie"
    };
  }

  window.G9Fun = { show: show, hide: hide, toggle: toggle, visible: visible };
  wire();
})();
