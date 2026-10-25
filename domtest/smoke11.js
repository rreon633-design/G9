/* Smoke test for the v0.14.0 appearance work: themes, accent, personalisation,
   profile, notification centre, start-screen widgets and the Settings entries.

   ui/theme.js is a plain script with no dependencies, so jsdom can run it as-is;
   the player (ui/app.js) is loaded after it exactly as index.html does. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const REPO = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const themeJs = fs.readFileSync(path.join(REPO, "ui/theme.js"), "utf8");
const appJs = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8");

const errors = [];
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
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollTo = function () {};
window.addEventListener("error", (e) => errors.push("error: " + ((e.error && e.error.stack) || e.message)));
window.addEventListener("unhandledrejection", (e) =>
  errors.push("rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

window.localStorage.setItem("g9.fun.wizard", "1");
window.__TAURI__ = {
  core: {
    convertFileSrc: (p) => p,
    invoke: (cmd) => {
      if (cmd === "app_info") return Promise.resolve({ name: "G9", version: "0.14.0" });
      if (cmd === "stats") return Promise.resolve({ sources: 1, channels: 12, groups: 0, favourites: 0, history: 3 });
      if (cmd === "ffmpeg_status") return Promise.resolve({ available: false });
      return Promise.resolve([]);
    },
  },
  event: { listen: () => Promise.resolve(() => {}) },
  window: { getCurrent: () => ({ minimize() {}, toggleMaximize() {}, close() {}, startDragging() {}, setAlwaysOnTop() {} }) },
};

window.eval(themeJs);
window.eval(appJs);

const doc = window.document;
const $ = (id) => doc.getElementById(id);       // by id
const q = (sel) => doc.querySelector(sel);       // by selector
const root = doc.documentElement;
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 50));

(async () => {
  await tick(120);
  const T = window.G9Theme;
  const N = window.G9Notify;
  if (!T) errors.push("G9Theme was not exposed");
  if (!N) errors.push("G9Notify was not exposed");
  if (errors.length) return report();

  /* 1. default look */
  if (root.dataset.theme !== "dark") errors.push("the app did not start in the dark theme");
  if (root.dataset.font !== "geist") errors.push("the default font is not geist");
  if (T.get().accent.toLowerCase() !== "#4c9dff") errors.push("the default accent is not the G9 blue");

  /* 2. theme switch writes the attribute and survives a reload */
  T.set({ theme: "light" });
  if (root.dataset.theme !== "light") errors.push("switching to light did not reach the document");
  const stored = JSON.parse(window.localStorage.getItem("g9-appearance") || "{}");
  if (stored.theme !== "light") errors.push("the theme was not persisted");

  /* 3. accent: tokens move, and the ink on top flips with the colour */
  T.set({ accent: "#ffb454" });
  const accentVar = root.style.getPropertyValue("--accent-rgb").trim();
  if (accentVar !== "255, 180, 84") errors.push("the accent triplet was not written (" + accentVar + ")");
  if (root.style.getPropertyValue("--accent-ink").trim() !== "#0a1017")
    errors.push("a light accent kept white ink on top of it");
  T.set({ accent: "#4c9dff" });
  if (root.style.getPropertyValue("--accent-ink").trim() !== "#ffffff")
    errors.push("the blue accent should keep white ink");
  T.set({ accent: "not-a-colour" });
  if (root.style.getPropertyValue("--accent-rgb").trim() !== "76, 157, 255")
    errors.push("a malformed accent did not fall back to the default");
  T.set({ accent: "#4c9dff" });

  /* 4. shape, density, type, feel */
  T.set({ radius: 16, density: "compact", font: "serif", icons: "bold", motion: false, glass: false, scale: 1.1 });
  if (root.style.getPropertyValue("--radius").trim() !== "16px") errors.push("the corner radius was not applied");
  if (root.dataset.density !== "compact") errors.push("density was not applied");
  if (root.dataset.font !== "serif") errors.push("the font was not applied");
  if (root.dataset.icons !== "bold") errors.push("the icon weight was not applied");
  if (root.dataset.motion !== "off") errors.push("motion-off was not applied");
  if (root.dataset.glass !== "off") errors.push("glass-off was not applied");
  if (root.style.getPropertyValue("--scale").trim() !== "1.1") errors.push("text size was not applied");
  /* and the stylesheet actually uses those hooks */
  const css = fs.readFileSync(path.join(REPO, "ui/styles.css"), "utf8");
  for (const hook of ['[data-theme="light"]', '[data-font="serif"]', '[data-density="compact"]', '[data-motion="off"]', '[data-glass="off"]'])
    if (!css.includes(hook)) errors.push("styles.css has no rule for " + hook);

  /* 5. profile: initials, then a picture */
  const av = $("avatar-initials");
  T.set({ name: "Ada Lovelace" });
  if (av.textContent !== "AL") errors.push("initials were not derived from the name (" + av.textContent + ")");
  if ($("pop-name").textContent !== "Ada Lovelace") errors.push("the profile popover kept the old name");
  const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  T.set({ avatar: tiny });
  if ($("avatar-img").hidden) errors.push("the avatar picture stayed hidden");
  if ($("avatar-img").getAttribute("src") !== tiny) errors.push("the avatar picture was not used");
  T.set({ avatar: "" });
  if (!$("avatar-img").hidden) errors.push("clearing the avatar left the picture on screen");

  /* 6. notifications: push, badge, gating, read, clear */
  N.clear();
  N.push({ title: "Arrival.mp4 finished", body: "1.4 GB", cat: "download" });
  N.push({ title: "Stream dropped · reconnecting", cat: "playback" });
  N.push({ title: "No space left on the drive", cat: "error" });
  if (N.list().length !== 3) errors.push("notifications were not stored (" + N.list().length + ")");
  if (N.unread() !== 3) errors.push("unread count is wrong");
  if ($("notif-badge").hidden) errors.push("the badge did not appear");
  if ($("notif-badge").textContent !== "3") errors.push("the badge says " + $("notif-badge").textContent);
  if (!$("notif-list").innerHTML.includes("Arrival.mp4 finished")) errors.push("the list did not render the entries");
  if (!$("notif-list").querySelector('[data-cat="error"]')) errors.push("the error entry lost its category");
  const stored2 = JSON.parse(window.localStorage.getItem("g9-notifications") || "[]");
  if (stored2.length !== 3) errors.push("notifications were not persisted");

  N.readAll();
  if (N.unread() !== 0) errors.push("mark-all-read did not clear the count");
  if (!$("notif-badge").hidden) errors.push("the badge stayed after reading");

  /* a category can be switched off, and the centre itself can be */
  T.set({ notifications: { downloads: false } });
  N.push({ title: "Another download finished", cat: "download" });
  if (N.list().some((n) => n.title === "Another download finished"))
    errors.push("a switched-off category was still recorded");
  T.set({ notifications: { centre: false } });
  N.push({ title: "A toast nobody asked to keep" });
  if (N.list().some((n) => n.title === "A toast nobody asked to keep"))
    errors.push("the centre was off but entries still landed");
  T.set({ notifications: { centre: true, downloads: true } });

  /* toasts: captured by default, suppressed when switched off */
  const before = N.list().length;
  if (N.capture("Playback speed 1.25×") !== true) errors.push("capture() suppressed a toast that should show");
  if (N.list().length !== before + 1) errors.push("a toast was not mirrored into the centre");
  T.set({ notifications: { toasts: false } });
  if (N.capture("This should not appear") !== false) errors.push("capture() still allowed a toast with toasts off");
  T.set({ notifications: { toasts: true } });

  N.clear();
  if (N.list().length !== 0) errors.push("clear did not empty the centre");
  if (!$("notif-badge").hidden) errors.push("the badge survived a clear");

  /* opening the panel marks what is in it as read, after a moment */
  N.push({ title: "Something new" });
  click($("notif-btn"));
  if ($("notif-panel").hidden) errors.push("the bell did not open the centre");
  await tick(1000);
  if (N.unread() !== 0) errors.push("opening the centre did not mark it read");
  click($("notif-close"));
  if (!$("notif-panel").hidden) errors.push("the close button did not hide the centre");

  /* 7. start-screen widgets: clock, library counts, and the switches */
  T.refreshWidgets();
  if ($("w-clock-time").textContent === "—") errors.push("the clock widget was never painted");
  if (!$("w-lib-big").textContent.trim()) errors.push("the library widget is empty");
  T.set({ widgets: { clock: false } });
  T.refreshWidgets();
  const wClock = doc.querySelector('#start-widgets [data-widget="clock"]');
  const wNow = doc.querySelector('#start-widgets [data-widget="now"]');
  if (!wClock || !wNow) errors.push("the widget strip lost a card");
  else {
    if (!wClock.hidden) errors.push("switching the clock off left it on screen");
    if (wNow.hidden) errors.push("switching one widget off hid the others too");
  }
  T.set({ widgets: { clock: false, now: false, library: false } });
  T.refreshWidgets();
  if (!$("start-widgets").hidden) errors.push("with every widget off the strip stayed visible");
  T.set({ widgets: { clock: true, now: true, library: true } });
  T.refreshWidgets();
  if ($("start-widgets").hidden) errors.push("the widgets did not come back");

  /* 8. the appearance sheet and its entry points */
  T.open();
  if ($("appearance-modal").hidden) errors.push("the appearance sheet did not open");
  if (!$("appear-body").querySelector('[data-theme-pick="light"]')) errors.push("the sheet has no theme cards");
  if ($("appear-body").querySelectorAll("[data-accent]").length < 6) errors.push("the accent swatches are missing");
  if (!$("appear-body").querySelector("#ap-name")) errors.push("the profile name field is missing");
  click($('appear-body [data-theme-pick="light"]'));
  if (root.dataset.theme !== "light") errors.push("picking light in the sheet did not switch the theme");
  click(q("#appear-done"));
  if (!$("appearance-modal").hidden) errors.push("Done did not close the sheet");

  click($("profile-btn"));
  if ($("profile-pop").hidden) errors.push("the avatar did not open the profile card");
  click(q('#profile-pop [data-open="appearance"]'));
  if ($("appearance-modal").hidden) errors.push("the profile card could not reach appearance");
  click(q("#appear-close"));

  /* Settings carries both entries, and they are wired */
  click(q("#btn-gear"));
  const body = $("settings-body");
  if (!body.innerHTML.includes("Theme &amp; personalisation")) errors.push("Settings has no appearance entry");
  if (!body.querySelector('[data-set="appearance"]')) errors.push("the appearance entry is not wired");
  if (!body.querySelector('[data-set="notifications"]')) errors.push("the notifications entry is missing");
  click(body.querySelector('[data-set="appearance"]'));
  if (!$("settings-modal").hidden) errors.push("opening appearance left Settings behind it");
  if ($("appearance-modal").hidden) errors.push("the Settings entry did not open appearance");
  click(q("#appear-close"));

  /* 9. reset returns every value to the default */
  T.set({ theme: "light", accent: "#ff6b6b", radius: 20, font: "mono", name: "Someone" });
  T.reset();
  const a = T.get();
  if (a.theme !== "dark" || a.font !== "geist" || a.radius !== 10 || a.accent !== "#4c9dff")
    errors.push("reset left a non-default value behind");
  if (root.dataset.theme !== "dark") errors.push("reset did not repaint the document");

  /* 10. auto follows the system, and the sheet still says which one won */
  T.set({ theme: "auto" });
  const resolved = T.resolvedTheme();
  if (resolved !== "dark" && resolved !== "light") errors.push("auto did not resolve to a theme");
  if (root.dataset.theme !== resolved) errors.push("auto resolved to " + resolved + " but the document says " + root.dataset.theme);
  if (!T.settingsGroup().includes("Auto")) errors.push("the Settings summary does not name the auto theme");
  T.set({ theme: "dark" });

  report();

  function report() {
    if (errors.length) {
      console.log("SMOKE11 FAIL");
      errors.forEach((e) => console.log(" - " + e));
      process.exit(1);
    } else {
      console.log("SMOKE11 OK");
      process.exit(0);
    }
  }
})();
