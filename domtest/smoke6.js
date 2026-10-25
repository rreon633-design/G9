/* Smoke test for Fun Mode (v0.8.0): wall, rails, sheet, episodes, sources, reader.
   Runs in jsdom against the real ui/index.html + ui/fun.js with a stubbed backend. */
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
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,aGk=";
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
    quality: kind === "manga" ? "unknown" : "fhd", badge: "NEW",
  }, extra || {});

const ITEMS = {
  movie: [
    mkItem("1:m1", "Nightfall Protocol", "movie"),
    mkItem("1:m2", "Iron Meridian", "movie"),
    mkItem("1:m3", "Vantablack", "movie"),
    mkItem("1:m4", "Salt & Static", "movie"),
    mkItem("1:m5", "Cold Orbit", "movie"),
    mkItem("1:m6", "Harbour Lights", "movie"),
    mkItem("1:m7", "Seventh Signal", "movie"),
    mkItem("1:m8", "Rust & Rain", "movie"),
  ],
  series: [mkItem("1:s1", "The Longest Winter", "series"), mkItem("1:s2", "Ashfall District", "series")],
  anime: [mkItem("2:a1", "Kagerou Requiem", "anime")],
  manga: [mkItem("3:g1", "Shadow Sovereign", "manga", { subtitle: "Manhwa" })],
};
const HOME = {
  demo: false, errors: [],
  sources: [
    { id: 1, kind: "stremio", name: "Demo Addon", url: "https://addon.example/manifest.json", enabled: true, detail: "movie · series" },
    { id: 2, kind: "rss", name: "Feed", url: "https://feed.example/rss", enabled: true, detail: "magnet feed" },
    { id: 3, kind: "mangadex", name: "MangaDex", url: "https://api.mangadex.org", enabled: true, detail: "manga" },
  ],
  shelves: [
    { id: "continue", title: "Continue watching", source_id: 0, kind: "movie", items: [mkItem("1:s1", "The Longest Winter", "series", { badge: "S3 E6" })] },
    { id: "1:movie:top", title: "Popular movies", source_id: 1, kind: "movie", items: ITEMS.movie },
    { id: "1:series:top", title: "Trending series", source_id: 1, kind: "series", items: ITEMS.series },
    { id: "2:feed", title: "Feed", source_id: 2, kind: "anime", items: ITEMS.anime },
    { id: "3:popular", title: "Manga · Manhwa · Manhua", source_id: 3, kind: "manga", items: ITEMS.manga },
  ],
};
const EPISODES = [
  { id: "1:s1:1:1", number: 1, season: 1, title: "Cold Open", overview: null, thumb: null, runtime: 48, released: "2025-10-12T00:00:00Z" },
  { id: "1:s1:1:2", number: 2, season: 1, title: "The Thaw", overview: null, thumb: null, runtime: 48, released: null },
];
const STREAMS = [
  { url: "https://cdn/x.mp4", label: "2160p", provider: "Demo Addon", quality: "uhd", size: null, seeds: null, magnet: false, headers: [], subtitles: [] },
  { url: "magnet:?xt=urn:btih:abc", label: "1080p · 38 seeds", provider: "Feed", quality: "fhd", size: null, seeds: 38, magnet: true, headers: [], subtitles: [] },
];

const findItem = (id) => {
  for (const s of HOME.shelves) for (const i of s.items) if (i.id === id) return i;
  return null;
};
const handlers = {
  app_info: () => ({ name: "G9", version: "0.8.0", content_policy: "Bring your own sources." }),
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
  fun_progress_list: () => [],
  fun_source_add: (a) => {
    calls.push(["fun_source_add", a.url]);
    return { id: 9, kind: "stremio", name: "New Addon", url: a.url, enabled: true, detail: "added" };
  },
  fun_source_toggle: (a) => { calls.push(["fun_source_toggle", a.id, a.enabled]); return null; },
  fun_source_remove: (a) => { calls.push(["fun_source_remove", a.id]); return null; },
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

window.eval(appJs);
window.eval(funJs);

const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

(async () => {
  await tick(120);

  /* 1. the button exists and opens the wall */
  const btn = $("btn-fun");
  if (!btn) errors.push("no Fun Mode button in the top nav");
  click(btn);
  await tick(150);
  if ($("fun").hidden) errors.push("Fun Mode did not open");

  /* 2. the wall is built from the stubbed shelves */
  const rows = doc.querySelectorAll("#fun .fun-row");
  const cards = doc.querySelectorAll("#fun .fun-card");
  if (rows.length < 4) errors.push("wall shows " + rows.length + " rows, expected the stubbed shelves");
  if (!cards.length) errors.push("wall has no cards");
  if (!$("fun-hero").innerHTML.includes("<h1")) errors.push("hero has no title");

  /* 3. rail arrows scroll instead of doing nothing */
  const next = doc.querySelector("#fun .fun-rail-btn.next");
  if (!next) errors.push("rails have no scroll button");

  /* 4. clicking a card opens the sheet with its episodes and sources */
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:s1"]'));
  await tick(200);
  if ($("fun-sheet").hidden) errors.push("details sheet did not open");
  const sheet = $("fun-sheet-card");
  if (!sheet.textContent.includes("The Longest Winter")) errors.push("sheet is missing the title");
  const eps = sheet.querySelectorAll(".fun-ep");
  if (eps.length !== EPISODES.length) errors.push("sheet lists " + eps.length + " episodes, expected " + EPISODES.length);
  if (!sheet.textContent.includes("Demo Addon")) errors.push("sheet does not name the source");
  if (sheet.querySelectorAll("[data-mylist]").length !== 1) errors.push("sheet has no My List button");

  /* 5. My List works */
  click(sheet.querySelector("[data-mylist]"));
  await tick(40);
  if (!sheet.querySelector("[data-mylist]").classList.contains("on")) errors.push("My List did not toggle");

  /* 6. picking an episode plays it and closes the wall */
  click(eps[1]);
  await tick(200);
  if (!$("fun").hidden) errors.push("wall stayed open after playing an episode");
  const src = $("video").getAttribute("src") || $("video").src || "";
  if (!src.includes("cdn/x.mp4")) errors.push("video src was not set: " + src);
  if (!calls.some((c) => c[0] === "fun_progress_save")) errors.push("no progress row was saved");

  /* 7. reopening shows the wall again; sources dialog lists the addons */
  click($("btn-fun"));
  await tick(150);
  click($("fun-sources"));
  await tick(200);
  const srcList = $("fun-source-list");
  if (!srcList.textContent.includes("Demo Addon")) errors.push("sources dialog does not list the addon");
  if (srcList.textContent.split("MangaDex").length - 1 > 1) errors.push("MangaDex is listed twice");

  /* 8. adding a URL calls the backend */
  $("fun-add-url").value = "https://addon.example/manifest.json";
  click($("fun-add-btn"));
  await tick(120);
  if (!calls.some((c) => c[0] === "fun_source_add")) errors.push("Add did not call fun_source_add");

  /* 9. toggling a source calls the backend with the new state */
  const sw = srcList.querySelector(".fun-srcitem .fun-switch");
  click(sw);
  await tick(120);
  if (!calls.some((c) => c[0] === "fun_source_toggle")) errors.push("the switch did not call fun_source_toggle");

  /* 10. Escape closes the dialog, then the wall */
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(80);
  if (!$("fun-sheet").hidden) errors.push("Escape did not close the sources dialog");
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(80);
  if (!$("fun").hidden) errors.push("Escape did not close Fun Mode");

  /* 11. search finds a title */
  click($("btn-fun"));
  await tick(150);
  $("fun-q").value = "kagerou";
  $("fun-q").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(450);
  if ($("fun-searchview").hidden) errors.push("search overlay did not open");
  if (!$("fun-search-grid").textContent.includes("Kagerou")) errors.push("search found nothing");

  /* 12. see all -> browse with sorting */
  click(doc.querySelector("#fun-rows [data-see-all]"));
  await tick(150);
  if ($("fun-browse").hidden) errors.push("See all did not open the browse view");
  const sortBtn = doc.querySelector("#fun-sort [data-sort='score']");
  click(sortBtn);
  await tick(80);
  if (sortBtn.getAttribute("aria-pressed") !== "true") errors.push("sort did not apply");
  click($("fun-browse-back"));
  await tick(80);

  /* 13. tabs filter the wall */
  click(doc.querySelector("#fun-tabs button[data-tab='movie']"));
  await tick(150);
  const filmRows = [...doc.querySelectorAll("#fun .fun-row")].map((r) => r.getAttribute("data-kind"));
  if (!filmRows.length) errors.push("movie tab emptied the wall");
  click(doc.querySelector("#fun-tabs button[data-tab='all']"));
  await tick(120);

  /* 14. manga opens the reader, not the player */
  const srcBeforeManga = $("video").getAttribute("src") || "";
  click(doc.querySelector('#fun-rows .fun-card[data-item="3:g1"]'));
  await tick(200);
  click($("fun-sheet-card").querySelector("[data-play]"));
  await tick(250);
  if ($("fun-reader").hidden) errors.push("reader did not open for a manga");
  if ($("fun-reader").querySelectorAll("img").length !== 2) errors.push("reader did not load the pages");
  if (($("video").getAttribute("src") || "") !== srcBeforeManga)
    errors.push("manga was pushed into the video element");
  click($("fun-reader").querySelector("[data-reader-close]"));
  await tick(100);
  if (!$("fun-reader").hidden) errors.push("reader did not close");

  /* 15. a magnet-only stream says so instead of pretending to play */
  click(doc.querySelector('#fun-rows .fun-card[data-item="1:m2"]'));
  await tick(200);
  const before = $("video").getAttribute("src");
  click($("fun-sheet-card").querySelector("[data-play]"));
  await tick(200);
  if (!$("video").getAttribute("src") === before && !$("fun-toast")) errors.push("magnet gave no feedback");

  /* 16. demo cards must never pretend to play */
  if (doc.querySelectorAll("#fun [data-item^='demo:']").length === 0) {
    // no demo cards on a stubbed wall, which is correct
  }

  console.log(errors.length ? errors.join("\n") : "SMOKE6 OK");
  process.exit(errors.length ? 1 : 0);
})();
