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
    timer: 0,
    // library flags per kind, progress per item, watching rows
    lib: { list: [], follow: [], watched: [], hidden: [] },
    prog: {},
    watching: [],
    flags: {},
    filters: { genre: "", year: "", quality: "" },
    scope: "all",
    libSort: "added",
    sleepAt: 0,
    now: null,
    playCtx: null,
    posTimer: 0,
    autoCount: 0,
    miniTimer: 0,
    timerTick: 0,
    recents: [],
    updatedAt: 0,
    ctxItem: null
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
    if (opts.sources && opts.sources.length > 1) {
      meta += (meta ? " · " : "") + '<i class="c-srcs">' + opts.sources.length + " sources</i>";
    } else if (opts.sources && opts.sources.length === 1 && !portrait) {
      meta += (meta ? " · " : "") + '<i class="c-srcs">' + esc(opts.sources[0]) + "</i>";
    }
    var watched = state.flags[item.id] && state.flags[item.id].indexOf("watched") >= 0;
    var following = state.flags[item.id] && state.flags[item.id].indexOf("follow") >= 0;
    var pctVal = opts.progress != null ? opts.progress : state.prog[item.id];
    var progress = pctVal
      ? '<div class="fun-prog"><i style="width:' + Math.round(Math.min(1, pctVal) * 100) + '%"></i></div>'
      : "";
    var marks = (watched ? '<span class="fun-watched" title="Watched">✓</span>' : "") +
      (following ? '<span class="fun-following" title="Following">•</span>' : "");

    return '<button type="button" class="fun-card ' + (portrait ? "port" : "land") + '"' +
      ' data-item="' + esc(item.id) + '" data-title="' + esc(item.title) + '" aria-label="' + esc(item.title) + '">' +
      '<span class="art" style="background:' + bg + '"><span class="rings"></span>' + img +
      '<span class="mark">' + esc(initials(item.title)) + "</span></span>" +
      '<span class="scrim"></span>' +
      '<span class="hoverplay"><span class="b"><svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg></span></span>' +
      '<span class="top">' + badgeHTML + right + "</span>" + marks +
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
    if (state.tab === "list" || state.tab === "watching") {
      var hero = el("fun-hero");
      if (hero) { hero.hidden = true; hero.innerHTML = ""; }
      paintLibView(state.tab);
      var note = el("fun-note");
      if (note) note.hidden = true;
      return;
    }
    if (el("fun-hero").hidden) paintHero();
    var hidden = {};
    (state.lib.hidden || []).forEach(function (r) { hidden[r.item_id] = 1; });
    var rows = state.rows.filter(function (r) {
      if (state.tab !== "all" && (r.kind || "") !== state.tab && (r.kinds || []).indexOf(state.tab) < 0) return false;
      return true;
    }).map(function (r) {
      if (!Object.keys(hidden).length) return r;
      var items = (r.items || []).filter(function (i) { return !hidden[i.id]; });
      return Object.assign({}, r, { items: items });
    }).filter(function (r) {
      return (r.items || []).length > 0;
    });
    if (!rows.length) {
      host.innerHTML = '<div class="fun-empty"><div class="big">Nothing here yet</div>' +
        "Add a source to fill this shelf — Sources, top right.</div>";
      return;
    }
    host.innerHTML = rows.map(railHTML).join("");
    paintHiddenNote();
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
    state.updatedAt = Date.now();
    var hidden = {};
    (state.lib.hidden || []).forEach(function (r) { hidden[r.item_id] = 1; });
    var rows = [];
    (home.shelves || []).forEach(function (s) {
      var items = (s.items || []).filter(function (i) { return !hidden[i.id]; });
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
    } else {
      rows = smartRows(rows);
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
            '<span class="th" style="background:' + bg + '">' +
            (e.thumb ? '<img src="' + esc(e.thumb) + '" alt="" loading="lazy" onerror="this.remove()" />' : "") + "</span>" +
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
      '<button type="button" class="fun-icon-btn" data-flag="watched" aria-label="Mark watched" title="Mark watched">' +
      '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></button>' +
      '<button type="button" class="fun-icon-btn" data-flag="follow" aria-label="Follow" title="Follow for new episodes">' +
      '<svg viewBox="0 0 24 24"><path d="M12 4a5 5 0 015 5c0 4 1.5 5.5 2 6H5c.5-.5 2-2 2-6a5 5 0 015-5zM9.5 18a2.5 2.5 0 005 0"/></svg></button>' +
      '<button type="button" class="fun-icon-btn" data-more aria-label="More like this" title="More like this">' +
      '<svg viewBox="0 0 24 24"><path d="M4 6h11M4 12h11M4 18h7M17 13.5l3 2.5-3 2.5"/></svg></button>' +
      '<button type="button" class="fun-icon-btn" data-share aria-label="Copy link" title="Copy link">' +
      '<svg viewBox="0 0 24 24"><path d="M9 15l6-6M8.5 11.5L6.8 13.2a3.5 3.5 0 005 5l1.7-1.7M15.5 12.5l1.7-1.7a3.5 3.5 0 00-5-5l-1.7 1.7"/></svg></button>' +
      '<button type="button" class="fun-icon-btn is-quiet" data-flag="hidden" aria-label="Not interested" title="Not interested">' +
      '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M5 19L19 5"/></svg></button>' +
      "</div>" +
      (item.synopsis ? '<p class="syn">' + esc(item.synopsis) + "</p>" : "") +
      '<div class="fun-srcrow"><span class="lbl">SOURCES</span>' + chips + "</div>" +
      ((item.genres || []).length ? '<div class="fun-genrerow">' + item.genres.slice(0, 8).map(function (g) {
        return '<button type="button" class="fun-tag" data-genre="' + esc(g) + '">' + esc(g) + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="fun-castbox" data-cast hidden><h3 class="sub">Cast</h3><div class="fun-cast-row"></div></div>' +
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
    if (listBtn) {
      if (flagOn("list", item.id)) listBtn.classList.add("on");
      listBtn.addEventListener("click", function () {
        var on = !flagOn("list", item.id);
        setFlag("list", item, on);
        listBtn.classList.toggle("on", on);
        toast(on ? "In My List · " + item.title : "Removed from My List");
      });
    }
    // Watched / Following / Not interested / More like this / Share.
    card.querySelectorAll("[data-flag]").forEach(function (b) {
      var kind = b.getAttribute("data-flag");
      if (flagOn(kind, item.id)) b.classList.add("is-on");
      b.addEventListener("click", function () {
        var on = !flagOn(kind, item.id);
        setFlag(kind, item, on);
        b.classList.toggle("is-on", on);
        if (kind === "hidden") {
          toast(on ? "Hidden — undo from the wall" : "Back on the wall");
          if (on) closeSheet();
        } else if (kind === "watched") {
          toast(on ? "Marked watched" : "Marked unwatched");
        } else if (kind === "follow") {
          toast(on ? "Following · new episodes show on the wall" : "Stopped following");
        }
        if (kind === "hidden") { paintRows(); }
      });
    });
    var more = card.querySelector("[data-more]");
    if (more) more.addEventListener("click", function () {
      var like = moreLikeThis(item);
      if (!like.length) { toast("Nothing similar in your sources yet"); return; }
      closeSheet();
      openBrowseItems("More like " + item.title, like, { genre: "" });
    });
    var share = card.querySelector("[data-share]");
    if (share) share.addEventListener("click", function () {
      var url = item.url || (streams[0] && streams[0].url) || "";
      if (!url) { toast("Nothing to copy for this one"); return; }
      copyText(url, "Link copied");
    });
    // Cast row: only when the source listed people.
    var cast = item.cast || [];
    if (cast.length) {
      var castHost = card.querySelector("[data-cast]");
      if (castHost) {
        castHost.hidden = false;
        castHost.querySelector(".fun-cast-row").innerHTML = cast.map(function (name) {
          return '<button type="button" class="fun-person" data-person="' + esc(name) + '">' +
            '<span class="av">' + esc(initials(name)) + "</span><span>" + esc(name) + "</span></button>";
        }).join("");
        castHost.querySelectorAll("[data-person]").forEach(function (b) {
          b.addEventListener("click", function () { openPerson(b.getAttribute("data-person")); });
        });
      }
    }
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
    card.querySelectorAll("[data-genre]").forEach(function (b) {
      b.addEventListener("click", function () { openGenre(b.getAttribute("data-genre")); });
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
    var eps = (payload && payload.details && payload.details.episodes) || [];
    var at = -1;
    for (var i = 0; i < eps.length; i++) if (episode && eps[i].id === episode.id) at = i;
    state.playCtx = {
      payload: payload, item: item, list: eps, index: at,
      resume: payload && payload.progress && at >= 0 &&
        payload.progress.episode_id === episode.id ? payload.progress.position : 0
    };
    startStream(pickStream(streams), item, episode, state.playCtx.resume);
  }

  /// Best stream for this viewer: language preference, then the quality cap.
  function pickStream(streams) {
    var ranked = rankStreams(streams);
    var wanted = null;
    for (var i = 0; i < ranked.length; i++) {
      if (languageHit(ranked[i])) { wanted = ranked[i]; break; }
    }
    return wanted || ranked[0];
  }

  function resolveThenPlay(item, episode) {
    toast("Finding a stream…");
    var id = item.id;
    invoke("fun_streams", { id: id, kind: item.kind || null, episode: episode ? episode.id : null })
      .then(function (streams) {
        if (!streams || !streams.length) { toast("No sources for this one"); return; }
        startStream(pickStream(streams), item, episode);
      })
      .catch(function (err) { toast(String(err || "No sources for this one").slice(0, 90)); });
  }

  function startStream(stream, item, episode, resumeAt) {
    if (stream.magnet) {
      toast("Magnet link — the torrent engine lands in the next release");
      return;
    }
    var b = bridge();
    closeSheet();
    hide();
    if (b && b.play) b.play(item.title, stream.url);
    else toast("Player unavailable");
    if (resumeAt && resumeAt > 5) {
      window.setTimeout(function () {
        var b = bridgeOrNull();
        if (b && b.seek) { b.seek(resumeAt); toast("Resumed where you stopped"); }
      }, 400);
    }
    state.now = { item: item, episode: episode };
    startProgressTicker();
    paintMini();

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
    fallback: { label: "Fallback to next source", desc: "When a stream 403s or stalls, try the next one.", options: [["on", "On"], ["off", "Off"]] },
    audio: { label: "Audio language", desc: "Picks the stream whose label matches.", options: [["any", "Any"], ["hindi", "Hindi"], ["english", "English"], ["japanese", "Japanese"]] }
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
      '<div class="fun-pref" data-k="sleep"><div><div class="pn">Sleep timer</div>' +
      '<div class="pd">Pauses playback when the countdown runs out.</div></div>' +
      '<div class="pc">' + [[0, "Off"], [30, "30 min"], [60, "60 min"], [90, "90 min"]].map(function (o) {
        return '<button type="button" class="fun-seg" data-sleep="' + o[0] + '" aria-pressed="' +
          (o[0] === 0 ? !state.sleepAt : false) + '">' + o[1] + "</button>";
      }).join("") + "</div></div>" +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-info" data-close-sheet>Done</button></div></div>';

    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelectorAll("[data-sleep]").forEach(function (b) {
      b.addEventListener("click", function () {
        var mins = Number(b.getAttribute("data-sleep")) || 0;
        setSleepTimer(mins);
        card.querySelectorAll("[data-sleep]").forEach(function (x) {
          x.setAttribute("aria-pressed", String(Number(x.getAttribute("data-sleep")) === mins));
        });
      });
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
    state.filters = { genre: "", year: "", quality: "" };
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
    var all = state.browse.items;
    var items = applyFilters(all).sort(SORTS[state.sort] || SORTS.quality);
    var sub = el("fun-browse-sub");
    if (sub) {
      sub.textContent = items.length + " of " + all.length + " title" + (all.length === 1 ? "" : "s") + " · " +
        (state.sort === "year" ? "newest first" : state.sort === "score" ? "top rated first" : "best quality first");
    }
    paintFilters();
    el("fun-browse-grid").innerHTML = items.length
      ? items.map(function (i) { return cardHTML(i, { sources: i.sources }); }).join("")
      : '<div class="fun-empty"><div class="big">Nothing here</div>' +
        (all.length ? "No title matches those filters." : "Add a source to fill this shelf.") + "</div>";
  }

  function closeBrowse() {
    el("fun-browse").hidden = true;
    state.browse = null;
  }

  function paintRecents() {
    var host = el("fun-recents");
    if (!host) return;
    if (!state.recents.length || String(state.query || "").length >= 2) { host.innerHTML = ""; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = '<span class="lbl">Recent</span>' + state.recents.map(function (r) {
      return '<button type="button" class="fun-tag" data-recent="' + esc(r) + '">' + esc(r) + "</button>";
    }).join("") + '<button type="button" class="fun-tag is-quiet" data-recent-clear>Clear</button>';
    host.querySelectorAll("[data-recent]").forEach(function (b) {
      b.addEventListener("click", function () {
        var q = el("fun-q");
        if (q) q.value = b.getAttribute("data-recent");
        state.query = b.getAttribute("data-recent");
        runSearch();
      });
    });
    var clear = host.querySelector("[data-recent-clear]");
    if (clear) clear.addEventListener("click", function () {
      state.recents = [];
      try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
      paintRecents();
    });
  }

  function paintResults(items, q) {
    el("fun-search-head").textContent = items.length
      ? items.length + " result" + (items.length === 1 ? "" : "s") + " for “" + q + "”"
      : "No results for “" + q + "”";
    el("fun-search-grid").innerHTML = items.length
      ? items.map(function (i) { return cardHTML(i, { sources: i.sources }); }).join("")
      : '<div class="fun-empty"><div class="big">Nothing matched</div>Try a genre, or add a source that carries it.</div>';
  }

  function localMatches(q) {
    return dedupe(state.items.filter(function (i) { return fuzzyHit(i, q); }));
  }

  function runSearch() {
    var q = String(state.query || "").trim();
    var host = el("fun-searchview");
    if (!host) return;
    if (q.length < 2) {
      host.hidden = true;
      el("fun-search-grid").innerHTML = "";
      paintRecents();
      return;
    }
    host.hidden = false;
    paintRecents();

    if (state.scope === "local") {
      var mine = localMatches(q);
      paintResults(mine, q);
      return;
    }

    el("fun-search-head").textContent = "Searching…";
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(function () {
      invoke("fun_search", { q: q })
        .then(function (items) {
          var merged = dedupe(items || []);
          if (!merged.length) merged = localMatches(q);
          paintResults(merged, q);
          if (merged.length) pushRecent(q);
        })
        .catch(function () {
          var mine = localMatches(q);
          if (mine.length) { paintResults(mine, q); return; }
          el("fun-search-head").textContent = "Search needs the desktop app";
        });
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
    loadRecents();
    sync().then(function () { paintRows(); });
    maybeWizard();
    startMiniWatch();
    paintTimerChip();
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
    window.clearInterval(state.miniTimer);
    closeCardMenu();
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
    var refresh = el("fun-refresh");
    if (refresh) refresh.addEventListener("click", function () {
      refresh.classList.add("is-spin");
      invoke("fun_cache_clear").catch(function () {});
      state.updatedAt = 0;
      loadWall();
      window.setTimeout(function () { refresh.classList.remove("is-spin"); }, 900);
      toast("Refreshing the wall…");
    });
    var profile = el("fun-profile");
    if (profile) profile.addEventListener("click", openHub);

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
    if (q) {
      q.addEventListener("input", function () {
        state.query = q.value;
        runSearch();
      });
      q.addEventListener("focus", paintRecents);
      q.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        var first = document.querySelector("#fun-search-grid .fun-card");
        if (first) { pushRecent(state.query); first.click(); }
      });
    }

    var scope = el("fun-scope");
    if (scope) scope.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-scope]");
      if (!b) return;
      state.scope = b.getAttribute("data-scope");
      scope.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
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
      if (card) {
        var id = card.getAttribute("data-item");
        if (state.tab === "watching") {
          var row = null;
          for (var i = 0; i < state.watching.length; i++) {
            if (state.watching[i].source_id + ":" + state.watching[i].item_id === id) row = state.watching[i];
          }
          if (row) { resumeRow(row); return; }
        }
        openItem(findItem(id) || cardItem(card));
        return;
      }
    });

    // Right-click anywhere on a card: the same actions, without leaving the wall.
    if (rows) rows.addEventListener("contextmenu", function (ev) {
      var card = ev.target.closest(".fun-card");
      if (!card) return;
      ev.preventDefault();
      var item = findItem(card.getAttribute("data-item")) || cardItem(card);
      openCardMenu(item, ev.clientX, ev.clientY);
    });

    var menu = el("fun-menu");
    if (menu) menu.addEventListener("click", function (ev) {
      if (ev.target === menu || !ev.target.closest(".fun-menu-card")) closeCardMenu();
    });

    // Arrow keys walk the wall row by row; Enter opens the focused card.
    document.addEventListener("keydown", function (ev) {
      if (!visible() || state.layer) return;
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        var focused = document.activeElement && document.activeElement.classList.contains("fun-card");
        if (!focused) return;
        moveFocus(ev.key === "ArrowRight" ? 1 : -1);
        ev.preventDefault();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        var card = document.activeElement && document.activeElement.classList.contains("fun-card")
          ? document.activeElement : null;
        if (!card) return;
        var rail = card.closest(".fun-rail");
        if (!rail) return;
        var all = visibleCards();
        var idx = all.indexOf(card);
        var nextIdx = ev.key === "ArrowDown" ? idx + 5 : idx - 5;
        if (nextIdx >= 0 && nextIdx < all.length) all[nextIdx].focus();
        ev.preventDefault();
      } else if (ev.key === "Enter") {
        var on = document.activeElement;
        if (on && on.classList && on.classList.contains("fun-card")) { on.click(); ev.preventDefault(); }
      }
    });

    var grid = el("fun-browse-grid");
    if (grid) grid.addEventListener("click", function (ev) {
      var card = ev.target.closest(".fun-card");
      if (card) openItem(findItem(card.getAttribute("data-item")) || cardItem(card));
    });
    [grid, el("fun-search-grid")].forEach(function (g) {
      if (!g) return;
      g.addEventListener("contextmenu", function (ev) {
        var card = ev.target.closest(".fun-card");
        if (!card) return;
        ev.preventDefault();
        openCardMenu(findItem(card.getAttribute("data-item")) || cardItem(card), ev.clientX, ev.clientY);
      });
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
        var menuEl = el("fun-menu");
        if (menuEl && !menuEl.hidden) { closeCardMenu(); ev.preventDefault(); return; }
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


  // ======================================================================
  // v0.10.0 — Library, watching, discovery, controls.
  // Everything below keeps the wall's data in step with four flags per
  // title (list / follow / watched / hidden) held in SQLite, and turns the
  // mode into something you can actually run a series in.
  // ======================================================================

  var LIB_KINDS = ["list", "follow", "watched", "hidden"];
  var YEAR_NOW = new Date().getFullYear();
  var RECENT_KEY = "g9.fun.recents";

  function loadRecents() {
    try { state.recents = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") || []; } catch (e) { state.recents = []; }
    if (!Array.isArray(state.recents)) state.recents = [];
  }
  function pushRecent(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    state.recents = [q].concat(state.recents.filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); })).slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(state.recents)); } catch (e) {}
  }

  function splitId(id) {
    var parts = String(id || "").split(":");
    return { source: Number(parts[0]) || 0, rest: parts.slice(1).join(":") };
  }

  function libRow(kind, item) {
    var id = splitId(item.id);
    return {
      kind: kind,
      item_id: item.id,
      source_id: id.source,
      title: item.title || item.id,
      item_kind: item.kind || null,
      poster: item.poster || null,
      meta: null,
      added_at: ""
    };
  }

  function flagOn(kind, itemId) {
    return !!(state.flags[itemId] && state.flags[itemId].indexOf(kind) >= 0);
  }

  function recomputeFlags() {
    state.flags = {};
    LIB_KINDS.forEach(function (k) {
      (state.lib[k] || []).forEach(function (r) {
        if (r && r.item_id) (state.flags[r.item_id] = state.flags[r.item_id] || []).push(k);
      });
    });
  }

  /// Pull the four flag lists and the resume map in one go.
  function sync() {
    var jobs = LIB_KINDS.map(function (k) {
      return invoke("fun_lib_list", { kind: k })
        .then(function (rows) { state.lib[k] = rows || []; })
        .catch(function () { state.lib[k] = []; });
    });
    jobs.push(
      invoke("fun_progress_list", { limit: 60 })
        .then(function (rows) {
          state.watching = rows || [];
          state.prog = {};
          (rows || []).forEach(function (r) {
            var id = r.source_id + ":" + r.item_id;
            var pct = r.duration > 0 ? r.position / r.duration : 0;
            if (pct > 0.001 && pct < 0.995) state.prog[id] = pct;
          });
        })
        .catch(function () { state.watching = []; })
    );
    return Promise.all(jobs).then(recomputeFlags);
  }

  /// Turn a flag on or off. The UI is updated first so a click feels instant.
  function setFlag(kind, item, on) {
    var row = libRow(kind, item);
    var list = state.lib[kind] || (state.lib[kind] = []);
    if (on) {
      if (!list.some(function (r) { return r.item_id === row.item_id; })) list.unshift(row);
    } else {
      state.lib[kind] = list.filter(function (r) { return r.item_id !== row.item_id; });
    }
    recomputeFlags();
    var call = on
      ? invoke("fun_lib_set", { row: row })
      : invoke("fun_lib_remove", { kind: kind, item_id: row.item_id });
    return call.catch(function () { toast("Saved on this device only"); });
  }

  function libItems(kind) {
    return (state.lib[kind] || []).map(function (r) {
      return {
        id: r.item_id,
        title: r.title,
        kind: r.item_kind || "movie",
        poster: r.poster || null,
        subtitle: null
      };
    });
  }

  function sourceName(item) {
    var id = splitId(item.id);
    var list = (state.home && state.home.sources) || [];
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].id) === id.source) return list[i].name;
    }
    return "";
  }

  // ---------------------------------------------------------------- smart rows

  /// Rows built from what the viewer has been doing, local only.
  function smartRows(rows) {
    var pool = [];
    var seen = {};
    rows.forEach(function (r) {
      if (isPortraitKind(r.kind)) return;
      (r.items || []).forEach(function (i) {
        if (seen[i.id]) return;
        seen[i.id] = 1;
        pool.push(i);
      });
    });
    if (!pool.length) return rows;

    var out = rows.slice();
    var insertAt = Math.min(1, out.length);

    // "Because you watched" — the kinds you actually start, then genre overlap.
    if (state.watching.length) {
      var kindCount = {};
      state.watching.forEach(function (w) { kindCount[w.kind] = (kindCount[w.kind] || 0) + 1; });
      var topKind = Object.keys(kindCount).sort(function (a, b) { return kindCount[b] - kindCount[a]; })[0];
      var wanted = {};
      state.watching.slice(0, 4).forEach(function (w) {
        if (w.kind === topKind) wanted[w.title] = 1;
      });
      var taste = [];
      pool.forEach(function (i) {
        if (i.kind === topKind && taste.length < 12) taste.push(i);
      });
      if (taste.length >= 4) {
        var label = state.watching[0] && state.watching[0].title ? "Because you watched “" + state.watching[0].title + "”" : "Because you keep watching";
        out.splice(insertAt, 0, {
          id: "because", title: label, kind: topKind, items: taste, more: false, tag: "PICKED FOR YOU"
        });
        insertAt += 1;
      }
    }

    // "New this week" — a NEW badge, or a release year that just started.
    var fresh = pool.filter(function (i) {
      return /NEW/i.test(String(i.badge || "")) || Number(i.year) >= YEAR_NOW;
    }).slice(0, 14);
    if (fresh.length >= 3) {
      out.splice(insertAt, 0, {
        id: "new", title: "New this week", kind: fresh[0].kind, items: fresh, more: fresh.length > 6, tag: "FRESH"
      });
    }

    // "Following" — everything the viewer asked to be told about.
    var follows = libItems("follow").filter(function (i) { return !isPortrait(i); });
    if (follows.length) {
      out.splice(out.length, 0, {
        id: "following", title: "Following", kind: "", items: follows, more: follows.length > 6, tag: "NEW EPISODES"
      });
    }
    return out;
  }

  function openBrowseItems(title, items, opts) {
    state.browse = Object.assign({ title: title, items: items.slice() }, opts || {});
    state.filters = { genre: (opts && opts.genre) || "", year: "", quality: "" };
    el("fun-browse-title").textContent = title;
    paintBrowse();
    el("fun-browse").hidden = false;
  }

  function openGenre(genre) {
    var items = state.items.filter(function (i) {
      return (i.genres || []).some(function (g) {
        return String(g).toLowerCase() === String(genre).toLowerCase();
      });
    });
    if (!items.length) { toast("Nothing else tagged " + genre); return; }
    closeSheet();
    openBrowseItems(genre, items, { genre: genre });
  }


  // ---------------------------------------------------------------- helpers

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || "Copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done); });
      return;
    }
    legacyCopy(text, done);
  }

  function legacyCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); }
    catch (e) { toast("Could not copy"); }
    document.body.removeChild(ta);
  }

  function normTitle(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  }

  /// Cheap edit distance, capped — enough to forgive one typo in a search.
  function near(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[b.length];
  }

  function fuzzyHit(item, q) {
    var words = normTitle(q).split(" ").filter(Boolean);
    var hay = normTitle(item.title);
    if (!words.length) return false;
    return words.every(function (w) {
      if (hay.indexOf(w) >= 0) return true;
      return hay.split(" ").some(function (t) { return near(w, t) <= 1; });
    });
  }

  /// Merge the same title coming from several sources into one card.
  function dedupe(items) {
    var out = [], map = {};
    (items || []).forEach(function (i) {
      if (!i || !i.id) return;
      if (flagOn("hidden", i.id)) return;
      var key = normTitle(i.title) + "|" + (i.year || "");
      var seen = map[key];
      if (seen) {
        var nm = sourceName(i);
        if (nm && seen.sources.indexOf(nm) < 0) seen.sources.push(nm);
        return;
      }
      var copy = Object.assign({}, i);
      copy.sources = [sourceName(i) || "source"];
      map[key] = copy;
      out.push(copy);
    });
    return out;
  }

  /// Titles that share a genre or a cast member with the one on screen.
  function moreLikeThis(item) {
    var genres = (item.genres || []).map(function (g) { return String(g).toLowerCase(); });
    var cast = (item.cast || []).map(function (c) { return String(c).toLowerCase(); });
    var scored = [];
    var seen = {};
    state.items.forEach(function (i) {
      if (i.id === item.id || seen[i.id] || flagOn("hidden", i.id)) return;
      var shared = (i.genres || []).filter(function (g) { return genres.indexOf(String(g).toLowerCase()) >= 0; }).length;
      var same = isPortrait(i) === isPortrait(item) ? 1 : -2;
      var people = (i.cast || []).filter(function (c) { return cast.indexOf(String(c).toLowerCase()) >= 0; }).length;
      var score = shared * 2 + people * 3 + same;
      if (score <= 0) return;
      seen[i.id] = 1;
      scored.push({ item: i, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 18).map(function (x) { return x.item; });
  }

  function openPerson(name) {
    var who = String(name).toLowerCase();
    var hits = state.items.filter(function (i) {
      return (i.cast || []).some(function (c) { return String(c).toLowerCase() === who; });
    });
    closeSheet();
    if (!hits.length) { toast("Nothing else with " + name + " in your sources"); return; }
    openBrowseItems("With " + name, hits, {});
  }

  // ---------------------------------------------------------------- browse filters

  function facetOf(items, key) {
    var seen = {}, out = [];
    items.forEach(function (i) {
      var v = i[key];
      if (v == null || v === "") return;
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }

  function paintFilters() {
    var host = el("fun-filters");
    if (!host || !state.browse) return;
    var items = state.browse.items;
    // Genres need flattening: an item can carry several.
    var genres = [];
    var gseen = {};
    items.forEach(function (i) {
      (i.genres || []).forEach(function (g) { if (!gseen[g]) { gseen[g] = 1; genres.push(g); } });
    });
    genres.sort();
    var years = facetOf(items, "year").sort(function (a, b) { return b - a; });
    var quals = facetOf(items, "quality").filter(function (q) { return q && q !== "unknown"; });

    var f = state.filters;
    if (!genres.length && !years.length && !quals.length) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.innerHTML =
      (genres.length ? '<div class="fun-fgroup"><span>Genre</span><div class="fun-fchips">' +
        '<button type="button" data-fg="" aria-pressed="' + !f.genre + '">All</button>' +
        genres.slice(0, 12).map(function (g) {
          return '<button type="button" data-fg="' + esc(g) + '" aria-pressed="' + (f.genre === g) + '">' + esc(g) + "</button>";
        }).join("") + "</div></div>" : "") +
      (years.length > 1 ? '<div class="fun-fgroup"><span>Year</span><div class="fun-fchips">' +
        '<button type="button" data-fy="" aria-pressed="' + !f.year + '">Any</button>' +
        years.slice(0, 8).map(function (y) {
          return '<button type="button" data-fy="' + y + '" aria-pressed="' + (String(f.year) === String(y)) + '">' + y + "</button>";
        }).join("") + "</div></div>" : "") +
      (quals.length ? '<div class="fun-fgroup"><span>Quality</span><div class="fun-fchips">' +
        '<button type="button" data-fq="" aria-pressed="' + !f.quality + '">Any</button>' +
        quals.map(function (q) {
          return '<button type="button" data-fq="' + esc(q) + '" aria-pressed="' + (f.quality === q) + '">' +
            esc(qualLabel(q)) + "</button>";
        }).join("") + "</div></div>" : "");

    host.querySelectorAll("[data-fg]").forEach(function (b) {
      b.addEventListener("click", function () { state.filters.genre = b.getAttribute("data-fg"); paintBrowse(); });
    });
    host.querySelectorAll("[data-fy]").forEach(function (b) {
      b.addEventListener("click", function () { state.filters.year = b.getAttribute("data-fy"); paintBrowse(); });
    });
    host.querySelectorAll("[data-fq]").forEach(function (b) {
      b.addEventListener("click", function () { state.filters.quality = b.getAttribute("data-fq"); paintBrowse(); });
    });
  }

  function applyFilters(items) {
    var f = state.filters;
    return items.filter(function (i) {
      if (f.genre && !(i.genres || []).some(function (g) { return String(g) === f.genre; })) return false;
      if (f.year && String(i.year || "") !== String(f.year)) return false;
      if (f.quality && i.quality !== f.quality) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------- My List / Watching

  function paintLibView(tab) {
    var host = el("fun-rows");
    if (!host) return;
    var kind = tab === "list" ? "list" : "";
    var rows = tab === "list" ? libItems("list") : state.watching.map(function (w) {
      return {
        id: w.source_id + ":" + w.item_id,
        title: w.title,
        kind: w.kind,
        poster: w.poster || null,
        __row: w
      };
    });
    var sort = state.libSort || "added";
    if (sort === "az") rows.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
    else if (sort === "year") rows.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });

    var head = '<div class="fun-libhead"><h2>' + (tab === "list" ? "My List" : "Continue watching") +
      '</h2><span class="sub">' + rows.length + (rows.length === 1 ? " title" : " titles") + '</span>' +
      '<div class="fun-libsort"><button type="button" data-libsort="added" aria-pressed="' + (sort === "added") + '">Added</button>' +
      '<button type="button" data-libsort="az" aria-pressed="' + (sort === "az") + '">A–Z</button>' +
      '<button type="button" data-libsort="year" aria-pressed="' + (sort === "year") + '">Newest</button></div></div>';

    if (!rows.length) {
      host.innerHTML = head + '<div class="fun-empty"><div class="big">' +
        (tab === "list" ? "My List is empty" : "Nothing in progress") + "</div>" +
        (tab === "list" ? "Use the + on any title to keep it here." : "Start an episode and it will show up here.") + "</div>";
      wireLibSort(host);
      return;
    }
    host.innerHTML = head + '<div class="fun-grid fun-libgrid">' + rows.map(function (i) {
      var opts = {};
      if (tab === "watching" && i.__row && i.__row.duration > 0) opts.progress = i.__row.position / i.__row.duration;
      return cardHTML(i, opts);
    }).join("") + "</div>";
    wireLibSort(host);
  }

  function wireLibSort(host) {
    host.querySelectorAll("[data-libsort]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.libSort = b.getAttribute("data-libsort");
        paintLibView(state.tab);
      });
    });
  }

  /// A quiet line under the wall when something was hidden, with a way back.
  function paintHiddenNote() {
    var note = el("fun-note");
    if (!note) return;
    var n = (state.lib.hidden || []).length;
    if (!n) { note.hidden = true; note.innerHTML = ""; return; }
    note.hidden = false;
    note.innerHTML = '<span>' + n + " hidden title" + (n === 1 ? "" : "s") + "</span>" +
      '<button type="button" class="fun-btn mini-btn" data-undo-hide>Undo</button>';
    note.querySelector("[data-undo-hide]").addEventListener("click", function () {
      var all = (state.lib.hidden || []).slice();
      state.lib.hidden = [];
      recomputeFlags();
      all.forEach(function (r) {
        invoke("fun_lib_remove", { kind: "hidden", item_id: r.item_id }).catch(function () {});
      });
      toast("Hidden titles are back");
      loadWall();
    });
  }

  /// Continue watching from a saved row: open the title and start the episode.
  function resumeRow(row) {
    var id = row.source_id + ":" + row.item_id;
    toast("Resuming " + row.title);
    invoke("fun_details", { id: id, kind: row.kind })
      .then(function (payload) {
        var eps = (payload.details && payload.details.episodes) || [];
        var ep = null;
        for (var i = 0; i < eps.length; i++) if (eps[i].id === row.episode_id) ep = eps[i];
        if (!ep && eps.length) ep = eps[0];
        var item = payload.details.item || { id: id, title: row.title, kind: row.kind };
        if (isPortrait(item)) { if (ep) openReader(item, ep); return; }
        playFrom(payload, item, ep);
      })
      .catch(function () { toast("Could not resume that one"); });
  }


  // ---------------------------------------------------------------- playback rules

  /// Quality cap from the playback prefs, as a ranked ceiling.
  function capRank() {
    var q = prefs.quality;
    if (q === "1080") return 3; // no 4K
    if (q === "720") return 2; // no 4K, no 1080p
    return 4;
  }

  /// Order streams for this viewer: under the data cap first, then the best.
  function rankStreams(streams) {
    var cap = capRank();
    var fits = [], over = [];
    (streams || []).forEach(function (s) {
      (rankQ(s.quality) > cap ? over : fits).push(s);
    });
    var byQ = function (a, b) { return rankQ(b.quality) - rankQ(a.quality); };
    fits.sort(byQ);
    over.sort(byQ);
    return fits.concat(over);
  }

  /// Subtitle/audio language the viewer asked for, matched against stream labels.
  function languageHit(stream) {
    var want = prefs.audio;
    if (!want || want === "any") return false;
    var text = (String(stream.label || "") + " " + String(stream.provider || "")).toLowerCase();
    return text.indexOf(String(want).toLowerCase()) >= 0;
  }

  // ---------------------------------------------------------------- mini player

  function bridgeOrNull() {
    var b = bridge();
    return b && typeof b.nowPlaying === "function" ? b : null;
  }

  function paintMini() {
    var host = el("fun-mini");
    if (!host) return;
    var b = bridgeOrNull();
    var now = b ? b.nowPlaying() : null;
    if (!now || !now.url) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.innerHTML = '<span class="mini-live' + (now.live ? "" : " is-quiet") + '">' + (now.live ? "LIVE" : "PLAYING") + "</span>" +
      '<span class="mini-title">' + esc(now.title || "Stream") + "</span>" +
      '<button type="button" class="fun-btn is-info mini-btn" data-mini-pause>' + (now.paused ? "Resume" : "Pause") + "</button>" +
      '<button type="button" class="fun-btn mini-btn" data-mini-open>Player</button>' +
      '<button type="button" class="fun-round" data-mini-stop aria-label="Stop">' +
      '<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg></button>';
    host.querySelector("[data-mini-pause]").addEventListener("click", function () {
      if (now.paused) b.resume(); else b.pause();
      window.setTimeout(paintMini, 60);
    });
    host.querySelector("[data-mini-stop]").addEventListener("click", function () {
      b.stop();
      window.setTimeout(paintMini, 60);
    });
    host.querySelector("[data-mini-open]").addEventListener("click", function () {
      var btn = el("btn-fun");
      if (btn) hide();
      if (window.G9Bridge && window.G9Bridge.showChrome) window.G9Bridge.showChrome();
    });
  }

  function startMiniWatch() {
    window.clearInterval(state.miniTimer);
    state.miniTimer = window.setInterval(function () {
      if (!visible()) return;
      paintMini();
    }, 1200);
    paintMini();
  }

  // ---------------------------------------------------------------- sleep timer

  function paintTimerChip() {
    var chip = el("fun-timer");
    if (!chip) return;
    if (!state.sleepAt) { chip.hidden = true; return; }
    var left = Math.max(0, Math.round((state.sleepAt - Date.now()) / 1000));
    if (left <= 0) {
      var b = bridgeOrNull();
      if (b) b.pause();
      state.sleepAt = 0;
      chip.hidden = true;
      toast("Sleep timer — paused");
      return;
    }
    chip.hidden = false;
    chip.textContent = "SLEEP " + Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2);
  }

  function setSleepTimer(minutes) {
    state.sleepAt = minutes ? Date.now() + minutes * 60000 : 0;
    window.clearInterval(state.timerTick);
    if (state.sleepAt) {
      state.timerTick = window.setInterval(paintTimerChip, 1000);
      toast("Sleep timer · " + minutes + " min");
    } else {
      toast("Sleep timer off");
    }
    paintTimerChip();
  }

  /// Ask before letting a long autoplay run continue while nobody is there.
  function stillWatching(after) {
    var host = el("fun-still");
    if (!host) return;
    host.hidden = false;
    host.innerHTML = '<div class="still-card"><b>Still watching?</b>' +
      "<span>Playback is about to continue with the next episode.</span>" +
      '<div class="still-row"><button type="button" class="fun-btn is-acc" data-still="yes">Keep going</button>' +
      '<button type="button" class="fun-btn" data-still="no">Pause</button></div></div>';
    var closer = function (keep) {
      host.hidden = true;
      host.innerHTML = "";
      var b = bridgeOrNull();
      if (!keep && b) b.pause();
      if (typeof after === "function") after(keep);
    };
    host.querySelectorAll("[data-still]").forEach(function (b) {
      b.addEventListener("click", function () { closer(b.getAttribute("data-still") === "yes"); });
    });
    host.querySelector(".still-card").addEventListener("click", function (ev) { ev.stopPropagation(); });
    host.addEventListener("click", function (ev) { if (ev.target === host) closer(false); });
    window.setTimeout(function () { if (!host.hidden) closer(false); }, 20000);
  }


  // ---------------------------------------------------------------- progress + up next

  var SAVE_EVERY = 8000;

  function progressRow(item, episode, pos, dur) {
    var id = splitId(item.id);
    return {
      source_id: id.source,
      item_id: id.rest,
      kind: item.kind || "movie",
      title: item.title,
      poster: item.poster || null,
      episode_id: episode ? episode.id : null,
      episode_title: episode ? episode.title : null,
      season: episode && episode.season != null ? episode.season : null,
      episode: episode && episode.number != null ? episode.number : null,
      position: Math.max(0, Number(pos) || 0),
      duration: Math.max(0, Number(dur) || 0),
      page: null,
      updated_at: ""
    };
  }

  /// Every few seconds, write where the viewer actually is — that is what makes
  /// the resume bar, the Watching tab and the 90 % watched mark true.
  function saveProgressNow() {
    var ctx = state.now;
    var b = bridgeOrNull();
    if (!ctx || !b) return false;
    var now = b.nowPlaying();
    if (!now || !now.duration) return false;
    var pct = now.time / now.duration;
    if (pct < 0.02) return false;
    var row = progressRow(ctx.item, ctx.episode, now.time, now.duration);
    invoke("fun_progress_save", { row: row }).catch(function () {});
    state.prog[ctx.item.id] = pct;
    if (pct >= 0.9 && !flagOn("watched", ctx.item.id)) {
      setFlag("watched", ctx.item, true);
      toast("Marked watched");
    }
    return true;
  }

  function startProgressTicker() {
    window.clearInterval(state.posTimer);
    state.posTimer = window.setInterval(function () {
      var now = bridgeOrNull() && bridgeOrNull().nowPlaying();
      if (now && now.paused) return; // paused: nothing new to record
      saveProgressNow();
    }, SAVE_EVERY);
  }

  /// Called by the player when a stream runs out. Returns true when Fun Mode
  /// takes over with the next-episode card.
  function onEnded() {
    var ctx = state.playCtx;
    window.clearInterval(state.posTimer);
    if (!ctx || !ctx.list || ctx.index < 0) return false;
    var next = ctx.list[ctx.index + 1];
    if (!next) return false;
    if (prefs.autoplay === "off") return false;
    if (state.now && state.now.episode) {
      var row = progressRow(ctx.item, state.now.episode, 1, 1);
      invoke("fun_progress_save", { row: row }).catch(function () {});
    }
    state.autoCount = (state.autoCount || 0) + 1;
    if (state.autoCount >= 3) {
      state.autoCount = 0;
      stillWatching(function (keep) {
        if (keep) showUpNext(ctx, next);
        else state.playCtx = null;
      });
      return true;
    }
    showUpNext(ctx, next);
    return true;
  }

  function showUpNext(ctx, next) {
    var host = el("fun-still");
    if (!host) return;
    var left = 10;
    host.hidden = false;
    var paint = function () {
      host.innerHTML = '<div class="still-card"><b>Up next · ' + esc(next.title || ("Episode " + next.number)) + "</b>" +
        "<span>" + esc(ctx.item.title) + " · starting in " + left + " s</span>" +
        '<div class="still-row"><button type="button" class="fun-btn is-acc" data-next="now">Play now</button>' +
        '<button type="button" class="fun-btn" data-next="no">Not now</button></div></div>';
      host.querySelector("[data-next='now']").addEventListener("click", play);
      host.querySelector("[data-next='no']").addEventListener("click", stop);
    };
    var ticker = window.setInterval(function () {
      left -= 1;
      if (left <= 0) { play(); return; }
      paint();
    }, 1000);
    var play = function () {
      window.clearInterval(ticker);
      host.hidden = true;
      host.innerHTML = "";
      state.playCtx.index = ctx.index + 1;
      state.playCtx.resume = 0;
      resolveThenPlay(ctx.item, next);
    };
    var stop = function () {
      window.clearInterval(ticker);
      host.hidden = true;
      host.innerHTML = "";
      state.playCtx = null;
      var b = bridgeOrNull();
      if (b) b.pause();
    };
    paint();
  }

  // ---------------------------------------------------------------- context menu

  function openCardMenu(item, x, y) {
    var host = el("fun-menu");
    if (!host) return;
    state.ctxItem = item;
    var inList = flagOn("list", item.id);
    var watched = flagOn("watched", item.id);
    host.innerHTML = '<div class="fun-menu-card" role="menu">' +
      '<div class="mm-head">' + esc(item.title) + "</div>" +
      '<button type="button" role="menuitem" data-mm="open">Open</button>' +
      '<button type="button" role="menuitem" data-mm="play">' + (isPortrait(item) ? "Read" : "Play") + "</button>" +
      '<button type="button" role="menuitem" data-mm="list">' + (inList ? "Remove from My List" : "Add to My List") + "</button>" +
      '<button type="button" role="menuitem" data-mm="watched">' + (watched ? "Mark unwatched" : "Mark watched") + "</button>" +
      '<button type="button" role="menuitem" data-mm="follow">' + (flagOn("follow", item.id) ? "Unfollow" : "Follow") + "</button>" +
      '<button type="button" role="menuitem" data-mm="more">More like this</button>' +
      '<button type="button" role="menuitem" data-mm="copy">Copy link</button>' +
      '<button type="button" role="menuitem" data-mm="hide">Not interested</button>' +
      "</div>";
    host.hidden = false;
    var card = host.querySelector(".fun-menu-card");
    var w = card.offsetWidth || 210, h = card.offsetHeight || 260;
    card.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
    card.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + "px";
    card.focus();
    host.querySelectorAll("[data-mm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var what = b.getAttribute("data-mm");
        closeCardMenu();
        if (what === "open") openItem(item);
        else if (what === "play") { openItem(item, true); }
        else if (what === "list") { setFlag("list", item, !inList); toast(inList ? "Removed from My List" : "In My List"); paintRows(); }
        else if (what === "watched") { setFlag("watched", item, !watched); toast(watched ? "Marked unwatched" : "Marked watched"); paintRows(); }
        else if (what === "follow") { setFlag("follow", item, !flagOn("follow", item.id)); paintRows(); }
        else if (what === "more") {
          var like = moreLikeThis(item);
          if (!like.length) toast("Nothing similar in your sources");
          else openBrowseItems("More like " + item.title, like, {});
        } else if (what === "copy") {
          copyText(g9Link(item), "Link copied");
        } else if (what === "hide") {
          setFlag("hidden", item, true);
          paintRows();
          toast("Hidden — undo from the wall note");
        }
      });
    });
  }

  function closeCardMenu() {
    var host = el("fun-menu");
    if (host) { host.hidden = true; host.innerHTML = ""; }
    state.ctxItem = null;
  }

  function g9Link(item) {
    return "g9://title/" + encodeURIComponent(item.id) + "?kind=" + encodeURIComponent(item.kind || "movie") +
      "&title=" + encodeURIComponent(item.title || "");
  }

  /// Accept a `g9://title/…` link (pasted, or handed over by the shell later).
  function openLink(raw) {
    var str = String(raw || "").trim();
    if (!str) return false;
    if (str.indexOf("g9://") !== 0) {
      // A bare title id works too, which is what the copy button produces.
      if (/^\d+:.+/.test(str)) { openItem({ id: str, title: str.split(":").slice(1).join(":"), kind: "movie" }); return true; }
      return false;
    }
    var m = str.match(/^g9:\/\/title\/([^?]+)(?:\?(.*))?$/);
    if (!m) { toast("That link is not a G9 title link"); return false; }
    var id = decodeURIComponent(m[1]);
    var qs = {};
    (m[2] || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      qs[p[0]] = decodeURIComponent(p[1] || "");
    });
    openItem({ id: id, title: qs.title || id, kind: qs.kind || "movie" });
    return true;
  }

  // ---------------------------------------------------------------- keyboard on the wall

  function visibleCards() {
    return Array.prototype.slice.call(document.querySelectorAll(".fun-card")).filter(function (c) {
      return !c.closest("[hidden]");
    });
  }

  function moveFocus(dir) {
    var cards = visibleCards();
    if (!cards.length) return;
    var at = cards.indexOf(document.activeElement);
    var next = at < 0 ? 0 : at + dir;
    if (next < 0) next = 0;
    if (next >= cards.length) next = cards.length - 1;
    cards[next].focus();
  }

  // ---------------------------------------------------------------- settings hub

  function openHub() {
    state.layer = "profile";
    var card = sheetHost(true);
    card.innerHTML = '<div class="fun-plain"><h2>Fun Mode</h2>' +
      '<p class="lead">Playback, what you keep, and the sources behind it.</p>' +
      '<div class="hub-grid">' +
      hubTile("playback", "Playback", "Quality cap, languages, autoplay, sleep timer") +
      hubTile("library", "My List & history", state.lib.list.length + " saved · " + state.watching.length + " in progress") +
      hubTile("sources", "Sources", "Addons, feeds and MangaDex") +
      hubTile("data", "Data", "Back up or restore what G9 knows") +
      "</div>" +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-info" data-close-sheet>Done</button></div></div>';
    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelectorAll("[data-hub]").forEach(function (b) {
      b.addEventListener("click", function () {
        var what = b.getAttribute("data-hub");
        closeSheet();
        if (what === "playback") openProfile();
        else if (what === "sources") openSources();
        else if (what === "library") {
          state.tab = "list";
          var tabs = el("fun-tabs");
          if (tabs) tabs.querySelectorAll("button").forEach(function (x) {
            x.setAttribute("aria-selected", String(x.getAttribute("data-tab") === "list"));
          });
          paintRows();
        } else openData();
      });
    });
  }

  function hubTile(id, title, sub) {
    return '<button type="button" class="hub-tile" data-hub="' + id + '">' +
      "<b>" + esc(title) + "</b><span>" + esc(sub) + "</span></button>";
  }

  function openData() {
    state.layer = "profile";
    var card = sheetHost(true);
    card.innerHTML = '<div class="fun-plain"><h2>Data</h2>' +
      '<p class="lead">Everything here lives in G9\u2019s local database on this PC.</p>' +
      '<div class="data-row"><button type="button" class="fun-btn" id="data-export">Back up to JSON</button>' +
      '<span class="fun-note-small">Sources, My List, continuing and watched marks.</span></div>' +
      '<div class="data-row"><button type="button" class="fun-btn" id="data-import">Restore from a backup</button>' +
      '<span class="fun-note-small">Merges — nothing already saved is removed.</span></div>' +
      '<div class="data-row"><button type="button" class="fun-btn" id="data-cache">Clear source cache</button>' +
      '<span class="fun-note-small">Forces the wall to refetch next time.</span></div>' +
      '<div class="data-row"><input id="data-link" placeholder="Paste a g9://title/… link" />' +
      '<button type="button" class="fun-btn" id="data-openlink">Open</button></div>' +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-info" data-close-sheet>Done</button></div></div>';
    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelector("#data-export").addEventListener("click", exportData);
    card.querySelector("#data-import").addEventListener("click", importData);
    card.querySelector("#data-cache").addEventListener("click", function () {
      invoke("fun_cache_clear")
        .then(function (n) { toast(n ? "Cleared " + n + " cached answers" : "Cache was already empty"); })
        .catch(function () { toast("Cache needs the desktop app"); });
    });
    card.querySelector("#data-openlink").addEventListener("click", function () {
      var input = el("data-link");
      if (!input || !String(input.value).trim()) return;
      if (openLink(input.value)) closeSheet();
    });
  }

  var BACKUP_KEYS = ["sources", "progress"];

  function exportData() {
    var payload = {
      app: "g9",
      version: 1,
      exported: new Date().toISOString(),
      sources: (state.home && state.home.sources) || [],
      progress: state.watching || [],
      lib: state.lib
    };
    var text = JSON.stringify(payload, null, 2);
    copyText(text, "Backup copied to the clipboard");
  }

  function importData() {
    var card = sheetHost(true);
    card.innerHTML = '<div class="fun-plain"><h2>Restore</h2>' +
      '<p class="lead">Paste a backup made by G9.</p>' +
      '<textarea id="data-paste" rows="8" placeholder="{ &quot;app&quot;: &quot;g9&quot; … }"></textarea>' +
      '<div class="fun-rowend"><button type="button" class="fun-btn is-acc" id="data-apply">Restore</button>' +
      '<button type="button" class="fun-btn" data-close-sheet>Cancel</button></div></div>';
    card.querySelectorAll("[data-close-sheet]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    card.querySelector("#data-apply").addEventListener("click", function () {
      var raw = String((el("data-paste") || {}).value || "").trim();
      var data;
      try { data = JSON.parse(raw); } catch (e) { toast("That is not a G9 backup"); return; }
      if (!data || data.app !== "g9") { toast("That is not a G9 backup"); return; }
      var jobs = [];
      (data.sources || []).forEach(function (s) {
        if (s && s.url) jobs.push(invoke("fun_source_add", { url: s.url, kind: s.kind || null }).catch(function () {}));
      });
      (data.progress || []).forEach(function (p) {
        if (!p || !p.item_id) return;
        jobs.push(invoke("fun_progress_save", { row: p }).catch(function () {}));
      });
      LIB_KINDS.forEach(function (k) {
        ((data.lib && data.lib[k]) || []).forEach(function (r) {
          if (!r || !r.item_id) return;
          jobs.push(invoke("fun_lib_set", { row: Object.assign({}, r, { kind: k }) }).catch(function () {}));
        });
      });
      Promise.all(jobs).then(function () {
        closeSheet();
        toast("Restored " + jobs.length + " entries");
        sync().then(loadWall);
      });
    });
  }

  // ---------------------------------------------------------------- first run

  function maybeWizard() {
    var done = null;
    try { done = localStorage.getItem("g9.fun.wizard"); } catch (e) {}
    if (done) return;
    var host = el("fun-wizard");
    if (!host) return;
    host.hidden = false;
    var step = 0;
    var paint = function () {
      host.innerHTML = '<div class="wiz-card">' +
        '<div class="wiz-dots">' + [0, 1, 2].map(function (i) {
          return '<i class="' + (i === step ? "on" : "") + '"></i>';
        }).join("") + "</div>" +
        (step === 0
          ? "<h2>Welcome to Fun Mode</h2><p>G9 ships no catalogue. You point it at the addons, feeds and manga sources you already trust, and it builds the wall from them. Nothing is suggested by us.</p>"
          : step === 1
            ? "<h2>Add your first source</h2><p>A Stremio addon manifest, an RSS feed, or the built-in MangaDex. You can add more later from Sources.</p>" +
              '<div class="wiz-row"><input id="wiz-url" placeholder="https://…/manifest.json" />' +
              '<button type="button" class="fun-btn is-acc" id="wiz-add">Add</button></div>'
            : "<h2>Set the defaults</h2><p>Quality cap keeps mobile tethering in check; languages pick the best-matching stream label. Change any of it later in settings.</p>" +
              '<label class="wiz-row"><span>Data cap</span><select id="wiz-q">' +
              '<option value="auto">Best available</option><option value="1080">Up to 1080p</option><option value="720">Up to 720p</option></select></label>') +
        '<div class="wiz-row end">' + (step > 0 ? '<button type="button" class="fun-btn" data-wiz="back">Back</button>' : "") +
        (step < 2 ? '<button type="button" class="fun-btn is-acc" data-wiz="next">Next</button>' : '<button type="button" class="fun-btn is-acc" data-wiz="done">Start browsing</button>') +
        "</div>" +
        '<button type="button" class="wiz-skip" data-wiz="skip">Skip</button></div>';

      host.querySelectorAll("[data-wiz]").forEach(function (b) {
        b.addEventListener("click", function () {
          var what = b.getAttribute("data-wiz");
          if (what === "next") { step = Math.min(2, step + 1); paint(); return; }
          if (what === "back") { step = Math.max(0, step - 1); paint(); return; }
          if (what === "done") {
            var sel = el("wiz-q");
            if (sel && sel.value) {
              prefs.quality = sel.value;
              try { localStorage.setItem("g9.fun.prefs", JSON.stringify(prefs)); } catch (e) {}
            }
          }
          finish();
        });
      });
      var add = host.querySelector("#wiz-add");
      if (add) add.addEventListener("click", function () {
        var url = String((el("wiz-url") || {}).value || "").trim();
        if (!url) { toast("Paste a manifest or feed URL"); return; }
        invoke("fun_source_add", { url: url, kind: null })
          .then(function (src) { toast("Added · " + src.name); loadWall(); step = 2; paint(); })
          .catch(function (e) { toast(String(e || "Could not add that source").slice(0, 90)); });
      });
    };
    var finish = function () {
      host.hidden = true;
      host.innerHTML = "";
      try { localStorage.setItem("g9.fun.wizard", "1"); } catch (e) {}
    };
    paint();
  }

  window.G9Fun = {
    show: show, hide: hide, toggle: toggle, visible: visible,
    openItem: openItem, openLink: openLink, search: function (q) { state.query = q; runSearch(); },
    setSleepTimer: setSleepTimer, sync: sync, onEnded: onEnded,
    saveProgress: saveProgressNow, state: state
  };
  wire();
})();
