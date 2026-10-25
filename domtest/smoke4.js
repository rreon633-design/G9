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
  currentTime: { get() { return 20; }, set() {}, configurable: true },
  videoWidth: { get() { return 1280; }, configurable: true },
  videoHeight: { get() { return 720; }, configurable: true },
  volume: { get() { return 1; }, set() {}, configurable: true },
  muted: { get() { return false; }, set() {}, configurable: true },
});
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
const ctx2d = { drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, fillText() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, closePath() {}, createLinearGradient: () => ({ addColorStop() {} }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(90) }) };
window.HTMLCanvasElement.prototype.getContext = function (k) { return (k === "webgl" || k === "webgl2") ? null : ctx2d; };
window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,aGk=";
window.HTMLCanvasElement.prototype.captureStream = () => { const t = { kind: "video", stop() {} }; return { getTracks: () => [t], getVideoTracks: () => [t], getAudioTracks: () => [], addEventListener() {} }; };
window.addEventListener("error", (e) => errors.push("error: " + (e.error && e.error.stack || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
window.eval(js);
const doc = window.document;

const acts = [...doc.querySelectorAll("[data-act]")].map((e) => e.getAttribute("data-act"));
for (const act of acts) {
  const btn = doc.querySelector(`[data-act="${act}"]`);
  try { btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
  catch (e) { errors.push("click " + act + ": " + e.message); }
  // close any dialog opened
  ["ask-back", "settings-modal", "info-modal", "about-modal", "import-modal"].forEach((id) => {
    const el = doc.getElementById(id);
    if (el && !el.hidden) el.hidden = true;
  });
  ["eq-panel","sub-panel","fx-panel","speed-panel","mark-panel","cue-panel","ff-panel","transcript-panel","shader-panel"].forEach((id)=>{
    const el = doc.getElementById(id); if (el) el.hidden = true;
  });
}
const controls = ["play","seek-back","seek-fwd","btn-mute","btn-cc","btn-info","btn-gear","btn-tv","btn-snap","btn-repeat","btn-shuffle","btn-ab","win-min","win-max","win-snap-left","win-snap-right","fs"];
for (const id of controls) {
  const el = doc.getElementById(id);
  if (!el) { errors.push("missing control " + id); continue; }
  try { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
  catch (e) { errors.push("click " + id + ": " + e.message); }
}
// key handlers
for (const key of ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","m","s","a","e","d","f",",",".","[","]","Escape"]) {
  try { doc.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })); } catch (e) { errors.push("key " + key + ": " + e.message); }
}
setTimeout(() => { console.log(errors.length ? errors.join("\n") : "SMOKE4 OK (" + acts.length + " actions)"); process.exit(errors.length ? 1 : 0); }, 900);
