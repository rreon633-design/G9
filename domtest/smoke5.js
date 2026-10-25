/* Smoke test for the v0.5.0 downloader + guide UI. */
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8");
const js = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8");

const errors = [];
const calls = [];
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
const proto = window.HTMLMediaElement.prototype;
Object.defineProperties(proto, {
  play: { value: function () { this.dispatchEvent(new window.Event("play")); return Promise.resolve(); } },
  pause: { value: function () { this.dispatchEvent(new window.Event("pause")); } },
  load: { value: function () {} },
  duration: { get() { return 300; }, configurable: true },
  currentTime: { get() { return 20; }, set() {}, configurable: true },
  videoWidth: { get() { return 1280; }, configurable: true },
  videoHeight: { get() { return 720; }, configurable: true },
  volume: { get() { return 1; }, set() {}, configurable: true },
  muted: { get() { return false; }, set() {}, configurable: true },
});
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
const ctx2d = {
  drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  stroke() {}, fill() {}, arc() {}, fillText() {}, measureText: () => ({ width: 10 }),
  save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, closePath() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(90) }),
};
window.HTMLCanvasElement.prototype.getContext = function (k) {
  return k === "webgl" || k === "webgl2" ? null : ctx2d;
};
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,aGk=";
window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason))
);

/* ---- Tauri stub ---- */
let toolInstalled = false;
let engineMissing = true;
let jobs = [];
const listeners = {};
const MEDIA = {
  title: "A Test Clip",
  uploader: "Test Channel",
  duration: 642,
  site: "YouTube",
  choices: [
    { height: 1080, label: "1080p", ext: "mp4", fps: 30, size: 184_000_000, audio_only: false },
    { height: 720, label: "720p", ext: "mp4", fps: 30, size: 96_000_000, audio_only: false },
    { height: 0, label: "Audio only", ext: "m4a", fps: null, size: 4_000_000, audio_only: true },
  ],
};
const CHANNELS = [
  { id: 1, source_id: 1, number: 1, name: "BBC One HD", group_name: "UK", logo_url: null, stream_url: "http://x/1", tvg_id: "bbcone.uk", country: "UK", language: "English", quality: "HD", is_favourite: false, is_hidden: false },
  { id: 2, source_id: 1, number: 2, name: "Sky News", group_name: "UK", logo_url: null, stream_url: "http://x/2", tvg_id: null, country: "US", language: "English", quality: "FHD", is_favourite: false, is_hidden: false },
];
const makeJob = (over) => Object.assign({
  id: "j1", url: "https://youtu.be/x", title: "A Test Clip", height: 1080, status: "running",
  percent: 0, downloaded: 0, total: 184_000_000, speed: 0, eta: 0,
  path: null, error: null, site: "YouTube",
}, over || {});

const handlers = {
  app_info: () => ({ name: "G9", version: "0.5.0", content_policy: "Bring your own sources." }),
  stats: () => ({ sources: 1, channels: 2, groups: 1, favourites: 0, history: 0 }),
  list_sources: () => [{ id: 1, name: "My playlist", kind: "url", channel_count: 2, url: "http://x/p.m3u" }],
  list_groups: () => [{ name: "UK", channel_count: 2 }],
  list_channels: (a) => {
    let list = CHANNELS.slice();
    if (a && a.country) list = list.filter((c) => c.country === a.country);
    if (a && a.quality) list = list.filter((c) => c.quality === a.quality);
    if (a && a.query) list = list.filter((c) => c.name.toLowerCase().includes(String(a.query).toLowerCase()));
    if (a && a.sort === "quality") list.sort((x, y) => (x.quality === "FHD" ? -1 : 1));
    return list;
  },
  channel_total: (a) => {
    let list = CHANNELS.slice();
    if (a && a.country) list = list.filter((c) => c.country === a.country);
    return list.length;
  },
  epg_upcoming: (a) => a.ids.map((k) => ({
    channel: k,
    slots: [
      { title: "Now Show", description: "One line about it", start: 1, stop: 2 },
      { title: "Later Show", description: null, start: 2, stop: 3 },
    ],
  })),
  list_history: () => [
    { title: "BBC One HD", url: "http://x/1", kind: "live", position: 0, duration: 0, played_at: "now" },
    { title: "Sky News", url: "http://x/2", kind: "live", position: 0, duration: 0, played_at: "now" },
  ],
  channel_facets: () => ({
    countries: [{ value: "UK", count: 1 }, { value: "US", count: 1 }],
    languages: [{ value: "English", count: 1 }, { value: "Hindi", count: 1 }],
    qualities: [{ value: "HD", count: 1 }, { value: "FHD", count: 1 }],
  }),
  neighbours: () => [null, null],
  ffmpeg_status: () => ({
    available: !engineMissing, managed: engineMissing, version: "6.0",
    dir: engineMissing ? null : "/usr/bin", ffmpeg: engineMissing ? null : "/usr/bin/ffmpeg",
  }),
  dl_tool: () => ({
    available: toolInstalled, managed: toolInstalled, version: toolInstalled ? "2026.10.01" : null,
    dir: toolInstalled ? "C:\\app\\downloader" : null, download_dir: "C:\\Users\\me\\Videos\\G9",
  }),
  dl_install: () => { toolInstalled = true; return handlers.dl_tool(); },
  dl_probe: () => MEDIA,
  dl_start: (a) => {
    const job = makeJob({ id: "j" + (jobs.length + 1), height: a.height, total: MEDIA.choices.find((c) => c.height === a.height).size });
    jobs.push(job);
    return job;
  },
  dl_list: () => jobs,
  dl_toggle: (a) => {
    const j = jobs.find((x) => x.id === a.id);
    j.status = j.status === "paused" ? "running" : "paused";
    return j;
  },
  dl_remove: (a) => {
    jobs = jobs.filter((x) => x.id !== a.id);
    calls.push(["dl_remove", a.id, a.deleteFile]);
    return null;
  },
  dl_play: () => "C:\\Users\\me\\Videos\\G9\\A Test Clip [x].mp4",
  dl_reveal: () => null,
  reveal_in_folder: () => "Opened in Explorer",
  epg_status: () => ({ loaded: true, programmes: 4242, channels: 2, source: "http://x/g.xml", fetched: "2026-10-25 10:00Z" }),
  epg_load_source: () => ({ loaded: true, programmes: 100, channels: 2, source: "s", fetched: "now" }),
  epg_load: () => ({ loaded: true, programmes: 100, channels: 2, source: "s", fetched: "now" }),
  epg_now: (a) => a.ids.map((k) => ({
    channel: k,
    now_title: k === "bbcone.uk" || k === "BBC One HD" ? "The Six O'Clock News" : k === "Sky News" ? "Live Bulletin" : null,
    now_desc: null, next_title: "Weather", start: 0, stop: 1, progress: 0.4,
  })),
  xtream_import: (a) => {
    calls.push(["xtream_import", a.server, a.user]);
    return { source_id: 2, channel_count: 42, group_count: 5, stripped_extvlcopt: 0, skipped_dangerous: 0 };
  },
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
  event: {
    listen: (name, cb) => { listeners[name] = cb; return Promise.resolve(() => {}); },
  },
};
window.eval(js);
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

(async () => {
  await tick(80);

  /* 1. downloader not installed: the card offers the install button */
  $("dl-url").value = "https://youtu.be/abc123";
  click($("dl-fetch"));
  await tick();
  if (!$("dl-result").textContent.includes("not installed"))
    errors.push("expected install prompt, got: " + $("dl-result").textContent);
  if (!$("dl-install-inline")) errors.push("missing inline install button");

  /* 2. install, then probe and pick a quality */
  click($("dl-install-inline"));
  await tick(40);
  if (!toolInstalled) errors.push("install was not invoked");
  click($("dl-fetch"));
  await tick(60);
  const picks = [...doc.querySelectorAll(".dl-pick")];
  if (picks.length !== 3) errors.push("expected 3 quality chips, got " + picks.length);
  if (!doc.querySelector(".dl-pick.on")) errors.push("no quality preselected");
  let p720 = picks.find((p) => p.getAttribute("data-h") === "720");
  click(p720);
  await tick();
  p720 = [...doc.querySelectorAll(".dl-pick")].find((p) => p.getAttribute("data-h") === "720");
  if (!p720 || !p720.classList.contains("on")) errors.push("720p chip did not select");
  if (!$("dl-start").textContent.includes("720p"))
    errors.push("start button did not track the pick: " + $("dl-start").textContent);
  const engineNote = doc.querySelector(".dl-engine");
  if (!engineNote) errors.push("engine preparation is not announced before the first download");

  /* 3. start: panel opens with a running job (engine already present) */
  engineMissing = false;
  click($("dl-start"));
  await tick(80);
  if ($("dl-panel").hidden) errors.push("downloads panel did not open");
  const started = calls.filter((c) => c[0] === "dl_start").pop();
  if (!started || started[1].height !== 720) errors.push("dl_start got the wrong height: " + JSON.stringify(started));
  if (!doc.querySelector('[data-job="j1"]')) errors.push("job row missing");

  /* 4. progress event repaints percent + speed */
  listeners["dl-progress"]({
    payload: { id: "j1", job: makeJob({ percent: 42.5, downloaded: 78_000_000, speed: 2_400_000, eta: 44 }) },
  });
  await tick(400);
  const info = doc.querySelector('[data-job="j1"] .dl-job-info').textContent;
  if (!/43%/.test(info)) errors.push("progress percent missing: " + info);
  if (!/MB\/s/.test(info)) errors.push("speed missing: " + info);

  /* 5. pause toggles */
  click(doc.querySelector('[data-job="j1"] [data-dl-toggle]'));
  await tick(60);
  if (!calls.some((c) => c[0] === "dl_toggle")) errors.push("pause did not call dl_toggle");

  /* 6. delete asks, then keeps the file */
  click(doc.querySelector('[data-job="j1"] [data-dl-del]'));
  await tick(40);
  if ($("ask-back").hidden) errors.push("delete did not ask");
  const keep = [...doc.querySelectorAll("#ask-choices button")].find((b) => b.textContent === "Keep the file");
  click(keep);
  await tick(60);
  const rm = calls.filter((c) => c[0] === "dl_remove").pop();
  if (!rm || rm[2] !== false) errors.push("dl_remove should keep the file: " + JSON.stringify(rm));

  /* 7. IPTV guide: now/next lands in the channel rows */
  click(doc.querySelector('[data-view="live"]'));
  await tick(80);
  click(doc.querySelector('[data-view="live"]'));
  await tick(120);
  const rows = [...doc.querySelectorAll("[data-ch]")];
  if (rows.length !== 2) errors.push("expected 2 channel rows, got " + rows.length);
  const epg = doc.querySelector('[data-ch="1"] .epg-now');
  if (!epg) errors.push("no now/next in the channel row");
  else if (!epg.textContent.includes("Six O'Clock")) errors.push("wrong now title: " + epg.textContent);
  if (!$("guide-state").textContent.includes("4242"))
    errors.push("guide bar did not show the guide: " + $("guide-state").textContent);

  /* 8. Xtream portal import */
  click($("btn-import"));
  await tick();
  $("xt-server").value = "http://portal.example:8080";
  $("xt-user").value = "me";
  $("xt-pass").value = "secret";
  click($("xt-go"));
  await tick(80);
  const xt = calls.filter((c) => c[0] === "xtream_import").pop();
  if (!xt) errors.push("xtream_import was not called");
  else if (xt[1] !== "http://portal.example:8080") errors.push("xtream server mangled: " + xt[1]);
  if (!$("import-modal").hidden) errors.push("import dialog stayed open after a portal import");

  /* 9. TV mode: the browser, its filters and auto-tune */
  click(doc.getElementById("btn-tv"));
  await tick(120);
  const tv = doc.getElementById("tv");
  if (tv.hidden) errors.push("TV mode did not open the browser");
  const cards = [...doc.querySelectorAll("[data-tv-ch]")];
  if (cards.length !== 2) errors.push("expected 2 channel cards, got " + cards.length);
  if (!doc.querySelector(".tv-thumb .initials")) errors.push("cards have no logo fallback");
  const lastCall = calls.filter((c) => c[0] === "list_channels").pop();
  if (!lastCall || lastCall[1].sort !== "number") errors.push("channel list not requested for TV mode");
  if (!doc.getElementById("tv-count").textContent.includes("2"))
    errors.push("channel count missing: " + doc.getElementById("tv-count").textContent);
  const chipRow = doc.getElementById("tv-chips").textContent;
  ["Country", "Language", "Quality", "Sort:"].forEach((label) => {
    if (!chipRow.includes(label)) errors.push("missing filter chip: " + label);
  });
  if (!doc.querySelector('[data-tv-ch="1"].playing')) errors.push("auto-tune did not mark the first channel");

  /* 10. Country filter narrows the grid */
  const countryChip = [...doc.querySelectorAll("[data-tv-open]")].find((b) => b.getAttribute("data-tv-open") === "country");
  click(countryChip);
  await tick(40);
  if (doc.getElementById("tv-pop").hidden) errors.push("country popover did not open");
  const usBtn = [...doc.querySelectorAll("#tv-pop-list button")].find((b) => b.textContent.includes("United States"));
  if (!usBtn) errors.push("United States not offered in the country filter");
  click(usBtn || doc.body);
  await tick(80);
  const filtered = [...doc.querySelectorAll("[data-tv-ch]")];
  if (filtered.length !== 1 || filtered[0].getAttribute("data-tv-ch") !== "2")
    errors.push("country filter did not narrow the grid: " + filtered.length);
  const filteredCall = calls.filter((c) => c[0] === "list_channels").pop();
  if (!filteredCall || filteredCall[1].country !== "US")
    errors.push("country filter not sent to the backend: " + JSON.stringify(filteredCall && filteredCall[1]));

  /* 11. recents, paging, schedule popover, now bar, keyboard */
  // the country filter from step 10 is still on; clear it first
  const clearChip = [...doc.querySelectorAll("[data-tv-f]")].find((b) => b.getAttribute("data-tv-f") === "clear");
  if (!clearChip) errors.push("no Clear filters chip");
  else {
    click(clearChip);
    await tick(90);
  }
  if (doc.querySelectorAll("[data-tv-ch]").length !== 2) errors.push("clearing filters did not restore the wall");
  if (doc.getElementById("tv-recents").hidden) errors.push("recent channels row is missing");
  if (doc.querySelectorAll("[data-tv-recent]").length !== 2) errors.push("recents did not list the history");
  if (!doc.getElementById("tv-count").textContent.includes("2"))
    errors.push("count does not show the total: " + doc.getElementById("tv-count").textContent);
  if (!doc.getElementById("tv-more").hidden) errors.push("Show more should hide when everything fits");

  const schedBtn = doc.querySelector('[data-tv-ch="1"] [data-tv-sched]');
  if (!schedBtn) errors.push("cards have no what's-on button");
  else {
    click(schedBtn);
    await tick(80);
    if (doc.getElementById("tv-sched").hidden) errors.push("what's-on popover did not open");
    if (!doc.getElementById("tv-sched-list").textContent.includes("Later Show"))
      errors.push("what's-on did not list upcoming programmes");
  }
  const schedCall = calls.filter((c) => c[0] === "epg_upcoming").pop();
  if (!schedCall || !schedCall[1].ids.length) errors.push("epg_upcoming was not asked for the channel");

  // keyboard: focus the first card, move right, tune with Enter
  const firstCard = doc.querySelector('[data-tv-ch="1"]');
  firstCard.focus();
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await tick(20);
  if (!doc.activeElement || !doc.activeElement.getAttribute("data-tv-ch"))
    errors.push("arrow keys did not move focus across the wall");
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await tick(20);
  if (doc.activeElement !== doc.getElementById("tv-q")) errors.push("/ did not focus the search box");
  doc.getElementById("tv-q").blur();

  // guide button loads/refreshes
  const guideBtn = doc.getElementById("tv-guide");
  if (!guideBtn) errors.push("TV mode has no guide button");
  else {
    click(guideBtn);
    await tick(80);
    if (!calls.some((c) => c[0] === "epg_status")) errors.push("guide button did not check the guide");
  }

  /* 12. picking a card tunes it and closes the browser */
  click(doc.querySelector('[data-tv-ch="2"]'));
  await tick(80);
  if (!doc.getElementById("tv").hidden) errors.push("browser stayed open after tuning");

  /* 13. the now-playing bar brings you back */
  click(doc.getElementById("tv-open"));
  await tick(100);
  const bar = doc.getElementById("tv-nowbar");
  if (bar.hidden) errors.push("now-playing bar is missing while browsing");
  if (!doc.getElementById("tv-now-name").textContent.includes("Sky"))
    errors.push("now bar does not name the tuned channel: " + doc.getElementById("tv-now-name").textContent);
  click(doc.getElementById("tv-now-watch"));
  await tick(60);
  if (!doc.getElementById("tv").hidden) errors.push("Watch did not return to the player");

  console.log(errors.length ? errors.join("\n") : "SMOKE5 OK");
  process.exit(errors.length ? 1 : 0);
})();
