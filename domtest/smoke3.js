const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8");
const js = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8") + "\n" + "";
const errors = [];
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const proto = window.HTMLMediaElement.prototype;
Object.defineProperties(proto, {
  play: { value: function () { this.dispatchEvent(new window.Event("play")); return Promise.resolve(); } },
  pause: { value: function () { this.dispatchEvent(new window.Event("pause")); } },
  load: { value: function () {} },
  duration: { get() { return 300; }, configurable: true },
  currentTime: { get() { return 12; }, set() {}, configurable: true },
  videoWidth: { get() { return 1280; }, configurable: true },
  videoHeight: { get() { return 720; }, configurable: true },
  volume: { get() { return 1; }, set() {}, configurable: true },
  muted: { get() { return false; }, set() {}, configurable: true },
});
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
const ctx2d = { drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, fillText() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, closePath() {}, createLinearGradient: () => ({ addColorStop() {} }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(120) }) };
window.HTMLCanvasElement.prototype.getContext = function (kind) { return kind === "webgl" || kind === "webgl2" ? null : ctx2d; };
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,aGk=";
window.HTMLCanvasElement.prototype.captureStream = () => { const t = { kind: "video", stop() {} }; return { getTracks: () => [t], getVideoTracks: () => [t], getAudioTracks: () => [], addEventListener() {} }; };
window.addEventListener("error", (e) => errors.push("error: " + (e.error && e.error.stack || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
window.eval(js);
const doc = window.document;
const check = (n, c) => { if (!c) errors.push("FAIL: " + n); };

// every data-act has a handler
const acts = [...doc.querySelectorAll("[data-act]")].map(e => e.getAttribute("data-act"));
check("no pip action", !acts.includes("pip"));
check("pip gone from DOM", !/Picture-in-picture/.test(html));

// settings dialog
doc.getElementById("btn-gear").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const sm = doc.getElementById("settings-modal");
check("settings dialog opens", sm.hidden === false);
check("settings groups rendered", doc.querySelectorAll("#settings-body .settings-row").length >= 3);
check("settings is not a sheet", doc.getElementById("sheet").hidden === true);
doc.getElementById("settings-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("settings closes", sm.hidden === true);

// snap buttons + dialog exist
check("snap left exists", !!doc.getElementById("win-snap-left"));
check("snap right exists", !!doc.getElementById("win-snap-right"));
doc.getElementById("win-snap-left").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

// ask dialog has an icon now
doc.getElementById("btn-url").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("ask icon present", !!doc.querySelector("#ask-icon svg"));
check("ask has default choice styling helper", typeof doc.getElementById("ask-choices") === "object");
doc.getElementById("ask-cancel").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));


setTimeout(() => { console.log(errors.length ? errors.join("\n") : "SMOKE3 OK"); process.exit(errors.length ? 1 : 0); }, 700);
