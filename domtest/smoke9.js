/* Smoke test for Fun Mode v0.12.0 "Sources you control": source health in the
   Sources sheet, the Test button, the per-source headers editor, addon-declared
   filters in See all, and paging that keeps the chosen filter.
   Runs in jsdom against the real ui/ files. */
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

/* ---------------- fixture ---------------- */
const mkItem = (id, title, extra) =>
  Object.assign({
    id, title, kind: "movie", year: 2024, score: 7.9, genres: ["Action"], poster: null, backdrop: null,
    synopsis: "A short synopsis.", subtitle: null, quality: "fhd", badge: "NEW", cast: [],
  }, extra || {});

const SHELF_ITEMS = [
  mkItem("1:m1", "Nightfall Protocol"), mkItem("1:m2", "Iron Meridian"),
  mkItem("1:m3", "Vantablack"), mkItem("1:m4", "Salt & Static"),
  mkItem("1:m5", "Cold Orbit"), mkItem("1:m6", "Harbour Lights"),
  mkItem("1:m7", "Seventh Signal"),
];
const HOME = {
  demo: false, errors: [],
  sources: [
    { id: 1, kind: "stremio", name: "Demo Addon", url: "https://addon.example/manifest.json", enabled: true, detail: "movie · series", last_ms: 120, headers: null },
    { id: 2, kind: "rss", name: "Slow feed", url: "https://feed.example/rss", enabled: true, detail: "magnet feed", last_ms: 1800, headers: '{"Accept-Language":"hi"}' },
    { id: 3, kind: "archive", name: "Broken addon", url: "https://broken.example/manifest.json", enabled: true, detail: "addon", last_ms: null, last_error: "Could not reach that source" },
  ],
  shelves: [
    { id: "1:movie:top", title: "Popular movies", source_id: 1, kind: "movie", items: SHELF_ITEMS, more: true },
    { id: "2:feed", title: "Feed", source_id: 2, kind: "anime", items: [mkItem("2:a1", "Kagerou Requiem")] },
  ],
};

const handlers = {
  app_info: () => ({ name: "G9", version: "0.12.0" }),
  stats: () => ({ sources: 3, channels: 0, groups: 0, favourites: 0, history: 0 }),
  list_sources: () => [], list_groups: () => [], list_history: () => [], list_channels: () => [],
  channel_total: () => 0, epg_status: () => ({ loaded: false, programmes: 0 }),
  channel_facets: () => ({ countries: [], languages: [], qualities: [] }),
  fun_home: () => HOME,
  fun_sources: () => HOME.sources.map((s) => Object.assign({}, s)),
  fun_search: () => [],
  fun_details: (a) => {
    const item = SHELF_ITEMS.find((i) => i.id === a.id) || mkItem(a.id, "Unknown");
    return { details: { item, episodes: [], season: null, seasons: [] }, streams: [], progress: null };
  },
  fun_streams: () => [],
  fun_pages: () => ["https://cdn/p1.jpg"],
  fun_progress_list: () => [],
  fun_progress_save: () => null,
  fun_lib_list: () => [],
  fun_lib_set: () => null,
  fun_lib_remove: () => null,
  fun_lib_flags: () => [],
  fun_source_test: (a) => { calls.push(["fun_source_test", a]); return { ok: true, ms: 42, error: null, id: a.id }; },
  fun_source_headers: (a) => {
    calls.push(["headers", a.id, a.headers]);
    const row = HOME.sources.find((s) => s.id === a.id);
    if (row) row.headers = a.headers;
    return null;
  },
  fun_catalog_filters: (a) => { calls.push(["filters", a.id]); return { genres: ["Action", "Drama"], years: ["2024", "2023"] }; },
  fun_catalog: (a) => {
    calls.push(["catalog", a.id, a.skip, a.genre || "", a.year || ""]);
    if (a.skip > 0) return [mkItem("1:m9", "Last Man Standing")];
    return [mkItem("1:m7", "Drama Pick " + (a.genre || "all"))];
  },
  fun_cache_clear: () => 0,
  fun_source_add: () => ({ id: 9, kind: "stremio", name: "New", url: "u", enabled: true, detail: "added" }),
  fun_source_toggle: () => null,
  fun_source_remove: () => null,
  get_setting: () => null,
  ffmpeg_status: () => ({ available: true, managed: false, version: "6.0" }),
  pictures_dir: () => "C:/Pictures",
  add_history: () => null,
  startup_file: () => null,
};
window.__TAURI__ = {
  core: {
    invoke: (cmd, args) => {
      const h = handlers[cmd];
      if (!h) return Promise.reject(new Error("no stub for " + cmd));
      try { return Promise.resolve(h(args || {})); } catch (e) { return Promise.reject(e); }
    },
    convertFileSrc: (p) => "asset://localhost/" + encodeURIComponent(p),
  },
  event: { listen: () => Promise.resolve(() => {}) },
};

window.localStorage.setItem("g9.fun.wizard", "1");
window.eval(appJs);
window.eval(funJs);

const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

(async () => {
  await tick(150);
  click($("btn-fun"));
  await tick(250);
  if ($("fun").hidden) errors.push("Fun Mode did not open");

  /* ---- 1. the Sources sheet shows how each source answered ---- */
  click($("fun-sources"));
  await tick(200);
  const list = $("fun-source-list");
  const text = list.textContent;
  if (!/120 ms/.test(text)) errors.push("a fast source did not show its timing");
  if (!/1\.8 s — slow/.test(text)) errors.push("a slow source was not called slow");
  if (!/Could not reach that source/.test(text)) errors.push("a failed source did not show its error");
  if (!/own headers/.test(text)) errors.push("a source with headers did not say so");

  /* ---- 2. Test button asks the backend and reports ---- */
  const testBtn = list.querySelector("[data-test='1']");
  click(testBtn);
  await tick(120);
  if (!calls.some((c) => c[0] === "fun_source_test" && c[1].id === 1)) errors.push("Test did not call fun_source_test");

  /* ---- 3. headers editor: prefilled, parsed, saved ---- */
  const headBtn = list.querySelector("[data-headers='1']");
  click(headBtn);
  await tick(80);
  const editor = doc.querySelector(".fun-srchead");
  if (!editor) errors.push("headers editor did not open");
  else {
    const lang = editor.querySelector("input[data-h='accept-language']");
    const ua = editor.querySelector("input[data-h='user-agent']");
    const extra = editor.querySelector("textarea[data-h-extra]");
    lang.value = "hi,en;q=0.8";
    ua.value = "G9/1.0";
    extra.value = "Cookie: session=abc\nX-Trace: 7";
    click(editor.querySelector("[data-h-save]"));
    await tick(120);
    const saved = calls.find((c) => c[0] === "headers");
    if (!saved) errors.push("Save did not call fun_source_headers");
    else {
      const json = JSON.parse(saved[2]);
      if (json["accept-language"] !== "hi,en;q=0.8") errors.push("Accept-Language was not saved");
      if (json["user-agent"] !== "G9/1.0") errors.push("User-Agent was not saved");
      if (json["Cookie"] !== "session=abc") errors.push("an extra Cookie header was not parsed");
      if (json["X-Trace"] !== "7") errors.push("a second extra header was not parsed");
    }
  }

  /* a prefilled editor shows what the source already has */
  click(list.querySelector("[data-headers='1']"));
  await tick(80);
  const pref = doc.querySelector(".fun-srchead input[data-h='accept-language']");
  if (pref && pref.value !== "hi,en;q=0.8") errors.push("the editor did not prefill the saved header");
  const cancel = doc.querySelector(".fun-srchead [data-h-cancel]");
  click(cancel);
  await tick(60);
  if (doc.querySelector(".fun-srchead")) errors.push("Cancel left the headers editor open");

  /* ---- 4. See all on an addon shelf asks the addon for its filters ---- */
  click($("fun-sources-close") || doc.querySelector("#fun-sources [data-close-sheet]"));
  await tick(120);
  const seeAll = doc.querySelector("#fun-rows [data-see-all]");
  if (!seeAll) errors.push("no See all button on the wall");
  else {
    click(seeAll);
    await tick(200);
    if (!calls.some((c) => c[0] === "filters")) errors.push("See all did not ask for the addon's filters");
    const bar = $("fun-filters");
    if (!bar || !/From this addon/.test(bar.textContent)) errors.push("the addon filter group did not render");
    const drama = [...bar.querySelectorAll("[data-ag]")].find((b) => b.getAttribute("data-ag") === "Drama");
    if (!drama) errors.push("the addon's Drama chip is missing");
    else {
      click(drama);
      await tick(200);
      const call = calls.filter((c) => c[0] === "catalog").pop();
      if (!call || call[3] !== "Drama" || call[2] !== 0) errors.push("choosing a genre did not requery the addon");
      const grid = $("fun-browse-grid").textContent;
      if (!/Drama Pick Drama/.test(grid)) errors.push("the filtered results did not paint");
    }

    /* ---- 5. paging keeps the filter ---- */
    const more = doc.querySelector("#fun-browse-more [data-more]");
    if (!more) errors.push("no Load more button on an addon shelf");
    else {
      click(more);
      await tick(200);
      const call = calls.filter((c) => c[0] === "catalog").pop();
      if (!call || call[2] !== 1) errors.push("Load more did not ask for the next page");
      if (call && call[3] !== "Drama") errors.push("Load more dropped the chosen genre");
    }
  }

  if (errors.length) {
    console.log("SMOKE9 FAIL");
    errors.slice(0, 12).forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  console.log("SMOKE9 OK");
  process.exit(0);
})();
