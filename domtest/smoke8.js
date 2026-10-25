/* Smoke test for Fun Mode v0.10.0: My List + Watching tabs, watched/hidden flags,
   browse filters, merged search with recents, context menu, keyboard nav,
   sleep timer, mini player, settings hub + data, first-run wizard, g9:// links
   and the quality cap. Runs in jsdom against the real ui/ files. */
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const appJs = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8");
const funJs = fs.readFileSync(path.join(REPO, "ui/fun.js"), "utf8");

const errors = [];
const calls = [];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const proto = window.HTMLMediaElement.prototype;
Object.defineProperties(proto, {
  play: { value: function () { this.dispatchEvent(new window.Event("play")); return Promise.resolve(); } },
  pause: { value: function () { this.dispatchEvent(new window.Event("pause")); } },
  load: { value: function () {} },
  duration: { get() { return 300; }, configurable: true },
  currentTime: { get() { return 0; }, set() {}, configurable: true },
  volume: { get() { return 1; }, set() {}, configurable: true },
  muted: { get() { return false; }, set() {}, configurable: true },
});
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollTo = function () {};
window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

/* ---------------- stub backend ---------------- */
const mkItem = (id, title, kind, extra) =>
  Object.assign({
    id, title, kind, year: 2024, score: 8.2, genres: ["Thriller"], poster: null, backdrop: null,
    synopsis: "A short synopsis.", subtitle: kind === "manga" ? "Manhwa" : null,
    quality: kind === "manga" ? "unknown" : "fhd", badge: "NEW", cast: [],
  }, extra || {});

const ITEMS = {
  movie: [
    mkItem("1:m1", "Nightfall Protocol", "movie", { cast: ["Ada One", "Bo Two"] }),
    mkItem("1:m2", "Iron Meridian", "movie", { genres: ["Action"] }),
    mkItem("1:m3", "Vantablack", "movie", { genres: ["Horror"] }),
    mkItem("1:m4", "Salt & Static", "movie"),
    mkItem("1:m5", "Cold Orbit", "movie"),
    mkItem("1:m6", "Harbour Lights", "movie"),
    mkItem("1:m7", "Seventh Signal", "movie"),
  ],
  series: [mkItem("1:s1", "The Longest Winter", "series", { cast: ["Ada One"] })],
  anime: [mkItem("2:a1", "Kagerou Requiem", "anime")],
  manga: [mkItem("3:g1", "Shadow Sovereign", "manga", { subtitle: "Manhwa" })],
};
/* Same film on two different sources — the search must merge them. */
const DUPE = mkItem("2:m1", "Nightfall Protocol", "movie");
const HOME = {
  demo: false, errors: [],
  sources: [
    { id: 1, kind: "stremio", name: "Demo Addon", url: "https://addon.example/manifest.json", enabled: true, detail: "movie · series" },
    { id: 2, kind: "rss", name: "Feed", url: "https://feed.example/rss", enabled: true, detail: "magnet feed" },
    { id: 3, kind: "mangadex", name: "MangaDex", url: "https://api.mangadex.org", enabled: true, detail: "manga" },
  ],
  shelves: [
    { id: "1:movie:top", title: "Popular movies", source_id: 1, kind: "movie", items: ITEMS.movie },
    { id: "1:series:top", title: "Trending series", source_id: 1, kind: "series", items: ITEMS.series },
    { id: "2:feed", title: "Feed", source_id: 2, kind: "anime", items: ITEMS.anime.concat([DUPE]) },
    { id: "3:popular", title: "Manga · Manhwa · Manhua", source_id: 3, kind: "manga", items: ITEMS.manga },
  ],
};
const EPISODES = [
  { id: "1:s1:1:1", number: 1, season: 1, title: "Cold Open", overview: null, thumb: null, runtime: 48, released: "2025-10-12T00:00:00Z" },
  { id: "1:s1:1:2", number: 2, season: 1, title: "The Thaw", overview: null, thumb: null, runtime: 48, released: null },
];
const STREAMS = [
  { url: "https://cdn/uhd.mp4", label: "2160p", provider: "Demo Addon", quality: "uhd", size: null, seeds: null, magnet: false, headers: [], subtitles: [] },
  { url: "https://cdn/fhd.mp4", label: "1080p Hindi", provider: "Feed", quality: "fhd", size: null, seeds: null, magnet: false, headers: [], subtitles: [] },
];

const PROGRESS = [
  {
    source_id: 1, item_id: "s1", kind: "series", title: "The Longest Winter", poster: null,
    episode_id: "1:s1:1:2", episode_title: "The Thaw", season: 1, episode: 2,
    position: 600, duration: 2400, page: null, updated_at: "2026-10-24 10:00:00",
  },
];
const LIB = { list: [], follow: [], watched: [], hidden: [] };

const findItem = (id) => {
  for (const s of HOME.shelves) for (const i of s.items) if (i.id === id) return i;
  return null;
};
const handlers = {
  app_info: () => ({ name: "G9", version: "0.10.0" }),
  stats: () => ({ sources: 0, channels: 0, groups: 0, favourites: 0, history: 0 }),
  list_sources: () => [], list_groups: () => [], list_history: () => [], list_channels: () => [],
  channel_total: () => 0, epg_status: () => ({ loaded: false, programmes: 0 }),
  channel_facets: () => ({ countries: [], languages: [], qualities: [] }),
  ffmpeg_status: () => ({ available: true, managed: false, version: "6.0" }),
  pictures_dir: () => "C:/Pictures",
  fun_home: () => HOME,
  fun_sources: () => HOME.sources,
  fun_search: (a) => {
    const q = String(a.q || "").toLowerCase();
    return HOME.shelves.flatMap((s) => s.items).filter((i) => i.title.toLowerCase().includes(q));
  },
  fun_details: (a) => {
    const item = findItem(a.id) || mkItem(a.id, "Unknown", "movie");
    const eps = item.kind === "manga"
      ? [{ id: "3:g1:c1", number: 1, season: null, title: "Ch. 1 — The Weakest", runtime: 22, released: null }]
      : item.kind === "movie" ? [] : EPISODES;
    return { details: { item, episodes: eps, season: item.kind === "movie" ? null : 1, seasons: [] }, streams: STREAMS, progress: null };
  },
  fun_streams: () => STREAMS,
  fun_pages: () => ["https://cdn/p1.jpg", "https://cdn/p2.jpg"],
  fun_progress_save: (a) => { calls.push(["fun_progress_save", a.row && a.row.item_id]); return null; },
  fun_progress_list: () => PROGRESS.slice(),
  fun_progress_remove: () => null,
  fun_lib_list: (a) => LIB[a.kind].slice(),
  fun_lib_set: (a) => {
    const row = a.row;
    const list = LIB[row.kind];
    const at = list.findIndex((r) => r.item_id === row.item_id);
    const saved = Object.assign({ added_at: "2026-10-25 09:00:00" }, row);
    if (at >= 0) list[at] = saved; else list.unshift(saved);
    calls.push(["fun_lib_set", row.kind, row.item_id]);
    return null;
  },
  fun_lib_remove: (a) => {
    LIB[a.kind] = LIB[a.kind].filter((r) => r.item_id !== a.item_id);
    calls.push(["fun_lib_remove", a.kind, a.item_id]);
    return null;
  },
  fun_lib_flags: (a) => Object.keys(LIB).filter((k) => LIB[k].some((r) => r.item_id === a.item_id)),
  fun_cache_clear: () => { calls.push(["fun_cache_clear"]); return 7; },
  fun_source_add: (a) => {
    calls.push(["fun_source_add", a.url]);
    return { id: 9, kind: "stremio", name: "New Addon", url: a.url, enabled: true, detail: "added" };
  },
  fun_source_toggle: () => null,
  fun_source_remove: () => null,
  dl_start: () => ({ id: "j1", status: "running" }),
  add_history: () => null,
  startup_file: () => null,
  get_setting: () => null,
};
window.__TAURI__ = {
  core: {
    invoke: (cmd, args) => {
      calls.push([cmd, args]);
      const h = handlers[cmd];
      if (!h) return Promise.reject(new Error("no stub for " + cmd));
      try { return Promise.resolve(h(args || {})); } catch (e) { return Promise.reject(e); }
    },
    convertFileSrc: (p) => "asset://localhost/" + encodeURIComponent(p),
  },
  event: { listen: () => Promise.resolve(() => {}) },
};

/* Skip the first-run wizard for the main flow; a dedicated block tests it. */
window.localStorage.setItem("g9.fun.wizard", "1");

window.eval(appJs);
window.eval(funJs);

/* Spy on the subtitle/failure hooks app.js exposes to Fun Mode. */
const bridgeCalls = [];
if (window.G9Bridge) {
  const realLang = window.G9Bridge.setSubLanguage;
  const realAuto = window.G9Bridge.setAutoSubs;
  window.G9Bridge.setSubLanguage = (l) => { bridgeCalls.push(["subLang", l]); return realLang && realLang(l); };
  window.G9Bridge.setAutoSubs = (on) => { bridgeCalls.push(["autoSubs", on]); return realAuto && realAuto(on); };
}

const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const rclick = (el) => el && el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 140 }));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

(async () => {
  await tick(150);

  /* 1. open the wall */
  click($("btn-fun"));
  await tick(200);
  if ($("fun").hidden) errors.push("Fun Mode did not open");

  /* 2. library sync ran: progress rows become the Watching list */
  if (!calls.some((c) => c[0] === "fun_lib_list")) errors.push("open did not read the library flags");
  if (!calls.some((c) => c[0] === "fun_progress_list")) errors.push("open did not read progress");

  /* 3. resume bar on a card that has progress */
  const withProgress = doc.querySelector("#fun .fun-card .fun-prog");
  if (!withProgress) errors.push("no resume bar on a card with progress");

  /* 4. My List tab renders the empty state, then a saved title */
  click(doc.querySelector("#fun-tabs button[data-tab='list']"));
  await tick(120);
  if (!$("fun-rows").textContent.includes("My List")) errors.push("My List tab did not paint its header");

  click(doc.querySelector("#fun-tabs button[data-tab='all']"));
  await tick(120);
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:m1"]'));
  await tick(200);
  const sheet = $("fun-sheet-card");
  const listBtn = sheet.querySelector("[data-mylist]");
  click(listBtn);
  await tick(120);
  if (!calls.some((c) => c[0] === "fun_lib_set" && c[1] === "list" && c[2] === "1:m1"))
    errors.push("My List button did not save to the library");
  if (!listBtn.classList.contains("on")) errors.push("My List button did not show as on");

  /* 5. watched + follow flags from the sheet */
  click(sheet.querySelector("[data-flag='watched']"));
  await tick(80);
  if (!LIB.watched.some((r) => r.item_id === "1:m1")) errors.push("watched flag was not saved");
  click(sheet.querySelector("[data-flag='follow']"));
  await tick(80);
  if (!LIB.follow.some((r) => r.item_id === "1:m1")) errors.push("follow flag was not saved");

  /* 6. cast row lists the people and opens a person page */
  const castRow = sheet.querySelector(".fun-cast-row");
  if (!castRow || !castRow.textContent.includes("Ada One")) errors.push("cast row did not render");
  click(castRow.querySelector("[data-person]"));
  await tick(150);
  if ($("fun-browse").hidden) errors.push("person page did not open");
  if (!$("fun-browse-title").textContent.includes("Ada One")) errors.push("person page has no title");
  click($("fun-browse-back"));
  await tick(80);

  /* 7. shelf with filters: open See all, filter by genre */
  click(doc.querySelector("#fun-rows [data-see-all]"));
  await tick(150);
  const filters = $("fun-filters");
  if (filters.hidden) errors.push("browse has no filter row");
  const genreBtn = filters.querySelector("[data-fg='Action']");
  if (!genreBtn) errors.push("no genre facet for Action");
  else {
    const before = doc.querySelectorAll("#fun-browse-grid .fun-card").length;
    click(genreBtn);
    await tick(100);
    const after = doc.querySelectorAll("#fun-browse-grid .fun-card").length;
    if (!(after < before)) errors.push("genre filter did not narrow the grid (" + before + " → " + after + ")");
    if (!$("fun-browse-sub").textContent.includes(" of ")) errors.push("browse subtitle does not show the filter count");
    click(filters.querySelector("[data-fg='']"));
    await tick(100);
  }
  click($("fun-browse-back"));
  await tick(80);

  /* 8. search merges the same title from two sources and keeps a recent */
  $("fun-q").value = "nightfall";
  $("fun-q").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(500);
  const cards = doc.querySelectorAll("#fun-search-grid .fun-card");
  if (cards.length !== 1) errors.push("merged search showed " + cards.length + " cards for one title");
  if (!cards[0].textContent.includes("2 sources")) errors.push("merged search did not say 2 sources");
  $("fun-q").value = "";
  $("fun-q").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(100);
  if (!$("fun-recents").textContent.includes("nightfall")) errors.push("search did not keep a recent");

  /* 9. scope switch to "what I added" */
  click(doc.querySelector("#fun-scope [data-scope='local']"));
  $("fun-q").value = "winter";
  $("fun-q").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(150);
  if (!$("fun-search-grid").textContent.includes("Longest Winter")) errors.push("local scope found nothing");
  click(doc.querySelector("#fun-scope [data-scope='all']"));
  $("fun-q").value = "";
  $("fun-q").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(80);

  /* 10. right-click menu adds to My List without opening the sheet */
  rclick(doc.querySelector('#fun-rows .fun-card[data-item="1:m3"]'));
  await tick(100);
  if ($("fun-menu").hidden) errors.push("context menu did not open");
  click(doc.querySelector("#fun-menu [data-mm='list']"));
  await tick(120);
  if (!LIB.list.some((r) => r.item_id === "1:m3")) errors.push("context menu did not save to My List");
  if (!$("fun-menu").hidden) errors.push("context menu stayed open");

  /* 11. not interested removes the card and offers undo */
  rclick(doc.querySelector('#fun-rows .fun-card[data-item="1:m4"]'));
  await tick(80);
  click(doc.querySelector("#fun-menu [data-mm='hide']"));
  await tick(150);
  if (doc.querySelector('#fun-rows .fun-card[data-item="1:m4"]')) errors.push("hidden title is still on the wall");
  if ($("fun-note").hidden) errors.push("no undo note after hiding");
  click($("fun-note").querySelector("[data-undo-hide]"));
  await tick(400);
  if (!doc.querySelector('#fun-rows .fun-card[data-item="1:m4"]')) errors.push("undo did not bring the title back");

  /* 12. keyboard: focus a card, ArrowRight moves focus */
  const first = doc.querySelector("#fun-rows .fun-card");
  first.focus();
  key(first, "ArrowRight");
  await tick(60);
  if (doc.activeElement === first) errors.push("ArrowRight did not move focus between cards");

  /* 13. quality cap: set "Up to 1080p" in the settings hub, then play */
  click($("fun-profile"));
  await tick(150);
  click(doc.querySelector(".hub-tile[data-hub='playback']"));
  await tick(180);
  const capSeg = doc.querySelector('.fun-pref[data-k="quality"] [data-v="1080"]');
  if (!capSeg) errors.push("playback sheet has no 1080p cap option");
  click(capSeg);
  await tick(100);
  if (!JSON.parse(window.localStorage.getItem("g9.fun.prefs") || "{}").quality)
    errors.push("quality cap was not stored");
  click(doc.querySelector("#fun-sheet-card [data-close-sheet]"));
  await tick(100);
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:m5"]'));
  await tick(200);
  click($("fun-sheet-card").querySelector("[data-play]"));
  await tick(250);
  const src = $("video").getAttribute("src") || "";
  if (!src.includes("fhd.mp4")) errors.push("quality cap did not pick the 1080p stream: " + src);

  /* 14. mini player follows the real player */
  click($("btn-fun"));
  await tick(200);
  if ($("fun-mini").hidden) errors.push("mini player did not appear while a stream is open");
  if (!$("fun-mini").textContent.includes("PLAYING") && !$("fun-mini").textContent.includes("LIVE"))
    errors.push("mini player has no state chip");
  click($("fun-mini").querySelector("[data-mini-stop]"));
  await tick(120);
  if (!$("fun-mini").hidden) errors.push("mini player did not hide after Stop");

  /* 15. sleep timer chip */
  window.G9Fun.setSleepTimer(30);
  await tick(60);
  if ($("fun-timer").hidden) errors.push("sleep timer chip is hidden after setting it");
  if (!$("fun-timer").textContent.includes("SLEEP")) errors.push("sleep chip has no countdown");
  window.G9Fun.setSleepTimer(0);
  await tick(60);
  if (!$("fun-timer").hidden) errors.push("sleep timer did not clear");

  /* 16. settings hub + data sheet + cache clear */
  click($("fun-profile"));
  await tick(150);
  if (!doc.querySelector(".hub-tile")) errors.push("settings hub has no tiles");
  click(doc.querySelector(".hub-tile[data-hub='data']"));
  await tick(150);
  click($("data-cache"));
  await tick(120);
  if (!calls.some((c) => c[0] === "fun_cache_clear")) errors.push("Clear cache did not call the backend");

  /* 17. g9:// links open a title */
  $("data-link").value = "g9://title/1%3As1?kind=series&title=The%20Longest%20Winter";
  click($("data-openlink"));
  await tick(250);
  if ($("fun-sheet").hidden) errors.push("g9:// link did not open the sheet");
  else if (!$("fun-sheet-card").textContent.includes("The Longest Winter"))
    errors.push("g9:// link opened the wrong title");
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(80);

  /* 18. first-run wizard: never gates a wall that already has sources, and when
     it is needed (no sources at all) it shows once, then stays away. */
  window.localStorage.removeItem("g9.fun.wizard");
  click($("fun-close"));
  await tick(80);
  click($("btn-fun"));
  await tick(250);
  if (!$("fun-wizard").hidden) errors.push("the wizard blocked a wall that already has sources");

  const keepSources = window.G9Fun.state.home.sources;
  window.G9Fun.state.home.sources = [];
  click($("fun-close"));
  await tick(80);
  click($("btn-fun"));
  await tick(250);
  if ($("fun-wizard").hidden) errors.push("first-run wizard did not show when there were no sources");
  if (!$("fun-wizard").textContent.includes("Welcome to Fun Mode")) errors.push("wizard is missing its first step");
  window.G9Fun.state.home.sources = keepSources;
  click($("fun-wizard").querySelector("[data-wiz='skip']"));
  await tick(120);
  if (!$("fun-wizard").hidden) errors.push("wizard did not close on skip");
  if (!window.localStorage.getItem("g9.fun.wizard")) errors.push("wizard did not remember being seen");

  /* 19. Watching tab lists progress rows */
  click(doc.querySelector("#fun-tabs button[data-tab='watching']"));
  await tick(150);
  if (!$("fun-rows").textContent.includes("The Longest Winter")) errors.push("Watching tab did not list the in-progress title");

  /* 20. progress is written with the real position, and 90 % marks watched */
  const v = $("video");
  Object.defineProperty(v, "duration", { get() { return 2400; }, configurable: true });
  Object.defineProperty(v, "currentTime", { get() { return 2280; }, set() {}, configurable: true });
  click(doc.querySelector("#fun-tabs button[data-tab='all']"));
  await tick(120);
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:s1"]'));
  await tick(220);
  const epRows = $("fun-sheet-card").querySelectorAll(".fun-ep");
  click(epRows[0]);
  await tick(260);
  if (!window.G9Fun.saveProgress()) errors.push("saveProgress did not record a position");
  await tick(120);
  const saved = calls.filter(
    (c) => c[0] === "fun_progress_save" && c[1] && c[1].row && c[1].row.position > 2000
  );
  if (!saved.length) errors.push("no progress row carried the real position");
  if (!LIB.watched.some((r) => r.item_id === "1:s1")) errors.push("90 % did not mark the title watched");

  /* 21. the player's ended hook offers the next episode, and it can be skipped */
  click($("btn-fun"));
  await tick(220);
  const tookOver = window.G9Fun.onEnded();
  if (!tookOver) errors.push("onEnded did not take over to offer the next episode");
  await tick(80);
  if ($("fun-still").hidden) errors.push("no up-next card after the stream ended");
  if (!$("fun-still").textContent.includes("Up next")) errors.push("up-next card has no title");
  click($("fun-still").querySelector("[data-next='no']"));
  await tick(120);
  if (!$("fun-still").hidden) errors.push("up-next card did not close on Not now");

  /* 22. a dead source falls through to the next one when fallback is on */
  click(doc.querySelector("#fun-tabs button[data-tab='all']"));
  await tick(120);
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:s1"]'));
  await tick(220);
  click($("fun-sheet-card").querySelectorAll(".fun-ep")[0]);
  await tick(260);
  const beforeFallback = $("video").getAttribute("src") || "";
  const took = window.G9Fun.onPlaybackError("403");
  await tick(220);
  if (!took) errors.push("onPlaybackError did not try another source");
  const after = $("video").getAttribute("src") || "";
  if (!after || after === beforeFallback) errors.push("fallback did not switch streams: " + after);
  if (!/\.mp4$/.test(after)) errors.push("fallback landed on something unplayable: " + after);

  /* 23. the subtitle preference reaches the real player */
  window.localStorage.setItem("g9.fun.prefs", JSON.stringify({ subs: "hi", quality: "auto" }));
  window.G9Fun.state.open = true;
  click($("fun-profile"));
  await tick(150);
  click(doc.querySelector(".hub-tile[data-hub='playback']"));
  await tick(180);
  const hiBtn = doc.querySelector('.fun-pref[data-k="subs"] [data-v="hi"]');
  if (!hiBtn) errors.push("playback sheet has no Hindi subtitle option");
  click(hiBtn);
  await tick(120);
  if (!bridgeCalls.some((c) => c[0] === "subLang" && c[1] === "hi"))
    errors.push("subtitle language never reached the player");
  const offBtn = doc.querySelector('.fun-pref[data-k="subs"] [data-v="off"]');
  click(offBtn);
  await tick(120);
  if (!bridgeCalls.some((c) => c[0] === "autoSubs" && c[1] === false))
    errors.push("subtitles off never reached the player");

  /* 24. no console errors anywhere along the way */
  const real = errors.filter((e) => !/ERR_NAME_NOT_RESOLVED|ERR_UNKNOWN_URL_SCHEME/.test(e));
  console.log(real.length ? real.join("\n") : "SMOKE8 OK");
  process.exit(real.length ? 1 : 0);
})();
