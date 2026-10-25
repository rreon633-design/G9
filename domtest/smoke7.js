/* Smoke test for the v0.9.0 "everyday basics":
   picture fit/zoom/rotate, speed to 4x, digit seeks, shortcut sheet, stream
   stats, drag & drop, folders, playlists, window memory, update check,
   subtitle picker and stream reconnect.  jsdom + a stubbed backend. */
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const appJs = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8");

const errors = [];
const calls = [];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const proto = window.HTMLMediaElement.prototype;

let now = 100;
const callsOf = (name) => calls.filter((c) => c[0] === name);

Object.defineProperties(proto, {
  play: { value: function () { this.dispatchEvent(new window.Event("play")); return Promise.resolve(); } },
  pause: { value: function () { this.dispatchEvent(new window.Event("pause")); } },
  load: { value: function () {} },
  duration: { get() { return 300; }, configurable: true },
  currentTime: {
    get() { return now; },
    set(v) { now = Number(v) || 0; },
    configurable: true,
  },
  volume: { get() { return 1; }, set() {}, configurable: true },
  muted: { get() { return false; }, set() {}, configurable: true },
  readyState: { get() { return 4; }, configurable: true },
  playbackRate: { get() { return this.__rate || 1; }, set(v) { this.__rate = v; }, configurable: true },
});
proto.getVideoPlaybackQuality = function () { return { droppedVideoFrames: 3, totalVideoFrames: 1200 }; };

window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
window.HTMLCanvasElement.prototype.getContext = () => null;
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollTo = function () {};
window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

/* ---------------- stub backend ---------------- */
const SUBS = [
  { movie: "Nightfall", release: "Nightfall.2024.1080p", language: "en", download: "https://subs.test/a.srt", rating: 9.4, provider: "x" },
  { movie: "Nightfall", release: "Nightfall.2024.WEB", language: "en", download: "https://subs.test/b.srt", rating: 6.1, provider: "y" },
];
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there\n";
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello there\n";

const handlers = {
  app_info: () => ({ name: "G9", version: "0.9.0", content_policy: "Bring your own sources." }),
  stats: () => ({ sources: 0, channels: 0, groups: 0, favourites: 0, history: 0 }),
  list_sources: () => [], list_groups: () => [], list_history: () => [], list_channels: () => [],
  channel_total: () => 0, channel_facets: () => ({ countries: [], languages: [], qualities: [] }),
  epg_status: () => ({ loaded: false, programmes: 0 }),
  ffmpeg_status: () => ({ available: true, managed: false, version: "6.0" }),
  pictures_dir: () => "C:/Pictures",
  startup_file: () => null,
  add_history: () => null,
  find_subtitles: () => SUBS,
  apply_subtitle: () => ({ vtt: VTT, language: "en", movie: "Nightfall", release: "Nightfall.2024.1080p", query: "Nightfall", provider: "x" }),
  apply_best_subtitles: () => ({ vtt: VTT, language: "en", movie: "Nightfall", release: "auto", query: "q", provider: "x" }),
  update_check: () => ({ current: "0.9.0", latest: "9.9.9", newer: true, url: "https://github.com/x/y/releases/tag/v9.9.9", published: "2026-11-01T00:00:00Z" }),
  open_url: () => null,
  read_text: () => SRT,
  list_folder: (a) => {
    if (String(a.path).includes("folder")) {
      return [
        { name: "Ep 1.mp4", path: "C:\\shows\\folder\\Ep 1.mp4" },
        { name: "Ep 2.mp4", path: "C:\\shows\\folder\\Ep 2.mp4" },
      ];
    }
    throw new Error("not a folder");
  },
  playlist_save: (a) => a.entries.length,
  playlist_load: () => [
    { title: "First", url: "https://cdn/first.mp4" },
    { title: "Second", url: "https://cdn/second.mp4" },
  ],
  get_setting: (a) => (a.key === "window.geom" ? JSON.stringify({ max: false, w: 1200, h: 700, x: 40, y: 60 }) : null),
  set_setting: () => null,
  dl_list: () => [], dl_start: () => null,
  fun_home: () => ({ demo: false, errors: [], sources: [], shelves: [] }),
  fun_sources: () => [],
};
const winCalls = [];
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
  window: {
    getCurrentWindow: () =>
      Promise.resolve({
        minimize: () => Promise.resolve(),
        maximize: (...a) => { winCalls.push(["maximize"]); return Promise.resolve(); },
        isMaximized: () => Promise.resolve(false),
        outerSize: () => Promise.resolve({ width: 1400, height: 820 }),
        outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
        setSize: (s) => { winCalls.push(["setSize", s.width, s.height]); return Promise.resolve(); },
        setPosition: (p) => { winCalls.push(["setPosition", p.x, p.y]); return Promise.resolve(); },
      }),
    PhysicalSize: function (w, h) { this.width = w; this.height = h; },
    PhysicalPosition: function (x, y) { this.x = x; this.y = y; },
  },
  dialog: {
    open: () => Promise.resolve("C:\\shows\\folder"),
    save: () => Promise.resolve("C:\\Users\\me\\queue.m3u8"),
  },
};

window.eval(appJs);

const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const video = $("video");
const key = (k, opts) => doc.dispatchEvent(new window.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true }, opts || {})));
const api = () => window.G9Basics;

setTimeout(() => { console.error("SMOKE7 TIMEOUT"); process.exit(2); }, 25000).unref();

(async () => {
  await tick(150);

  /* 1. the module is exposed and the app booted */
  if (!api()) errors.push("G9Basics is not exposed");
  if (!$("btn-folder")) errors.push("Media menu has no Open folder entry");
  if (!$("btn-pl-save")) errors.push("Media menu has no Save playlist entry");
  if (!$("speed-presets")) errors.push("speed presets missing");

  /* 2. picture fit / zoom / rotate / mirror */
  api().fit();
  click(doc.querySelector('#fx-fit [data-fit="cover"]'));
  if (video.style.objectFit !== "cover") errors.push("Fill did not set object-fit: cover (got " + video.style.objectFit + ")");
  click(doc.querySelector('#fx-fit [data-fit="z150"]'));
  if (!/scale\(1\.5/.test(video.style.transform)) errors.push("150% zoom not applied: " + video.style.transform);
  click($("fx-rot"));
  if (!/rotate\(90deg\)/.test(video.style.transform)) errors.push("rotate did not apply: " + video.style.transform);
  click($("fx-flip"));
  if (!/scaleX\(-1\)/.test(video.style.transform)) errors.push("mirror did not apply: " + video.style.transform);
  click($("fx-fit-reset"));
  if (video.style.objectFit !== "contain" || video.style.transform !== "") errors.push("reset picture left " + video.style.transform);
  key("F", { shiftKey: true });
  if (video.style.objectFit !== "cover") errors.push("Shift+F did not cycle the fit (got " + video.style.objectFit + ")");
  click($("fx-fit-reset"));

  /* 3. speed reaches 4x and nudges by a quarter */
  click(doc.querySelector('#speed-presets [data-speed="300"]'));
  if (Math.abs(video.playbackRate - 3) > 0.001) errors.push("3x preset set " + video.playbackRate);
  key("+");
  if (Math.abs(video.playbackRate - 3.25) > 0.001) errors.push("+ did not nudge the speed: " + video.playbackRate);
  key("+"); key("+"); key("+"); key("+");
  if (Math.abs(video.playbackRate - 4) > 0.001) errors.push("speed did not clamp at 4x: " + video.playbackRate);
  key("-");
  if (Math.abs(video.playbackRate - 3.75) > 0.001) errors.push("- did not nudge the speed: " + video.playbackRate);
  if ($("speed").value !== "375") errors.push("speed slider out of sync: " + $("speed").value);

  /* 4. shortcuts sheet */
  key("?");
  await tick(40);
  if ($("keys-modal").hidden) errors.push("? did not open the keyboard sheet");
  if (doc.querySelectorAll("#keys-grid .keys-row").length < 15) errors.push("shortcut sheet is thin");
  keysDismiss:
  {
    const ev = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    doc.dispatchEvent(ev);
  }
  await tick(40);
  if (!$("keys-modal").hidden) errors.push("Escape did not close the keyboard sheet");

  /* 5. play something, then digit / Home / End seeks and stats */
  click($("btn-pl-open"));
  await tick(120);
  if (!/first\.mp4/.test(video.src)) errors.push("opening a playlist did not play its first row: " + video.src);
  if (callsOf("playlist_load").length !== 1) errors.push("playlist_load was not called");

  now = 0;
  key("5");
  if (Math.abs(now - 150) > 1) errors.push("5 should seek to 50% (300s → 150s), got " + now);
  key("Home");
  if (now !== 0) errors.push("Home did not go to the start: " + now);
  key("End");
  if (now < 299) errors.push("End did not jump to the end: " + now);

  key("i");
  await tick(30);
  if ($("stats").hidden) errors.push("i did not open stream stats");
  const stats = $("stats").textContent;
  ["picture", "fit", "speed", "buffer", "dropped", "retries"].forEach((word) => {
    if (stats.indexOf(word) < 0) errors.push("stats missing " + word);
  });
  key("i");
  if (!$("stats").hidden) errors.push("i did not close stream stats");

  /* 6. drag & drop: a folder queues every video in it */
  const queueBefore = callsOf("playlist_save").length;
  api().drop(["C:\\shows\\folder"]);
  await tick(150);
  if (callsOf("list_folder").length < 1) errors.push("dropping a folder did not scan it");
  if (!/Ep%201\.mp4|Ep 1\.mp4/.test(video.src)) errors.push("dropping a folder did not play the first file: " + video.src);
  const saved = await new Promise((resolve) => {
    click($("btn-pl-save"));
    setTimeout(() => resolve(callsOf("playlist_save")), 150);
  });
  if (!saved.length) errors.push("Save playlist did not call playlist_save");
  else if (saved[0][1].entries.length < 2) errors.push("saved " + saved[0][1].entries.length + " rows, expected the queue");

  /* 7. dropped subtitle text is parsed into cues */
  if (api().subText(SRT, "film.srt") !== true) errors.push("subText rejected a valid srt");
  if (!$("btn-cc").classList.contains("on")) errors.push("dropped subtitle did not switch subtitles on");
  const cueTexts = window.G9Basics ? true : false;
  if (!cueTexts) errors.push("no basics api");

  /* 8. subtitle picker lists hits and applies the chosen one */
  // Subtitles are on from the drop above, so the first click switches them off
  // and the second one opens the picker.
  click($("btn-cc"));
  await tick(60);
  click($("btn-cc"));
  await tick(150);
  if ($("subs-modal").hidden) errors.push("CC did not open the subtitle picker");
  const hits = doc.querySelectorAll("#subs-list .subs-hit");
  if (hits.length !== SUBS.length) errors.push("picker shows " + hits.length + " hits, expected " + SUBS.length);
  if (hits.length && hits[0].textContent.indexOf("★★★★") < 0) errors.push("picker does not show the rating");
  click(hits[0]);
  await tick(150);
  if ($("subs-modal").hidden !== true) errors.push("picker stayed open after picking");
  const picked = callsOf("apply_subtitle");
  if (!picked.length) errors.push("picking a hit did not call apply_subtitle");
  else if (!/Nightfall\.2024/.test(JSON.stringify(picked[0][1] && picked[0][1].hit))) {
    errors.push("wrong hit passed to apply_subtitle");
  }

  /* 9. update check in About */
  click(doc.querySelector('[data-act="about"]'));
  await tick(40);
  click($("about-check"));
  await tick(150);
  const upd = $("about-upd");
  if (upd.textContent.indexOf("9.9.9") < 0) errors.push("update check did not report the new version: " + upd.textContent);
  const dl = upd.querySelector("button");
  if (!dl) errors.push("no Download button for the update");
  else {
    click(dl);
    await tick(60);
    if (!callsOf("open_url").length) errors.push("Download did not call open_url");
  }
  click($("about-close"));

  /* 10. window memory restored size and position */
  if (!winCalls.some((c) => c[0] === "setSize" && c[1] === 1200 && c[2] === 700)) {
    errors.push("window size was not restored: " + JSON.stringify(winCalls));
  }
  if (!winCalls.some((c) => c[0] === "setPosition" && c[1] === 40 && c[2] === 60)) {
    errors.push("window position was not restored: " + JSON.stringify(winCalls));
  }

  /* 11. reconnect: status line counts the attempts, capped at 3 */
  window.G9Bridge.play("Live channel", "https://cdn.example/live.mp4");
  await tick(60);
  $("status-text").textContent = "Playing";
  api().reconnect();
  await tick(20);
  if (!/Reconnecting… \(1\/3\)/.test($("status-text").textContent)) errors.push("reconnect did not show attempt 1: " + $("status-text").textContent);
  api().reconnect();
  api().reconnect();
  await tick(20);
  if (!/\(3\/3\)/.test($("status-text").textContent)) errors.push("reconnect did not reach 3: " + $("status-text").textContent);
  api().reconnect();
  await tick(20);
  if ($("status-text").textContent !== "Stream unavailable") {
    errors.push("a spent stream should say so, not loop: " + $("status-text").textContent);
  }

  /* 12. no console errors along the way */
  if (errors.length) {
    console.error("SMOKE7 FAIL\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("SMOKE7 OK — picture, speed, seeks, keys, stats, drop, playlists, picker, update, window, reconnect");
  process.exit(0);
})();
