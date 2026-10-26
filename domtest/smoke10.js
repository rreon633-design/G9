/* Smoke test for the v0.13.0 GPU picture pipeline: neutral settings keep the
   plain <video> (so "off" stays pixel-identical), sharpening/deband/grade build
   the right pass chain, one upload per presented frame, frame-pacing falls back
   from requestVideoFrameCallback to rAF, a broken custom shader does not take
   the picture down, and no WebGL at all falls back to CSS filters.

   jsdom has no WebGL, so this file stubs a WebGL2 context that records calls. */
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(REPO, "ui/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const appJs = fs.readFileSync(path.join(REPO, "ui/app.js"), "utf8");
const funJs = fs.readFileSync(path.join(REPO, "ui/fun.js"), "utf8");

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

/* ---------------- a WebGL2 context that records what it is asked to do ---------------- */
const gl = {
  calls: { uploads: 0, draws: 0, programs: 0, viewports: [], pixelStore: [] },
  failCompile: [],            // shader sources that should fail to compile
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  TRIANGLE_STRIP: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8,
  TEXTURE_2D: 9, RGBA: 10, UNSIGNED_BYTE: 11, TEXTURE0: 12,
  TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, TEXTURE_MIN_FILTER: 15, TEXTURE_MAG_FILTER: 16,
  LINEAR: 17, CLAMP_TO_EDGE: 18, FRAMEBUFFER: 19, COLOR_ATTACHMENT0: 20,
  UNPACK_FLIP_Y_WEBGL: 21,
  pixelStorei: (p, v) => gl.calls.pixelStore.push([p, v]),
  createShader: () => ({}),
  shaderSource: (sh, src) => { sh.src = src; },
  compileShader: (sh) => { sh.ok = !gl.failCompile.some((f) => (sh.src || "").includes(f)); },
  getShaderParameter: (sh) => !!sh.ok,
  getShaderInfoLog: () => "synthetic compile error",
  deleteShader: () => {},
  createProgram: () => ({ id: ++gl.calls.programs }),
  attachShader: () => {},
  bindAttribLocation: () => {},
  linkProgram: () => {},
  getProgramParameter: () => true,
  getProgramInfoLog: () => "",
  deleteProgram: () => {},
  getUniformLocation: (p, n) => ({ p, n }),
  useProgram: () => {},
  createBuffer: () => ({}),
  bindBuffer: () => {},
  bufferData: () => {},
  createTexture: () => ({}),
  bindTexture: () => {},
  texParameteri: () => {},
  texImage2D: (...a) => { if (a.length > 6) gl.calls.uploads++; },
  activeTexture: () => {},
  texImage2DFromVideo: () => {},
  createFramebuffer: () => ({}),
  bindFramebuffer: () => {},
  framebufferTexture2D: () => {},
  deleteFramebuffer: () => {},
  deleteTexture: () => {},
  viewport: (x, y, w, h) => gl.calls.viewports.push([w, h]),
  getAttribLocation: () => 0,
  enableVertexAttribArray: () => {},
  vertexAttribPointer: () => {},
  uniform1i: () => {},
  uniform1f: () => {},
  uniform2f: () => {},
  uniform3f: () => {},
  drawArrays: () => { gl.calls.draws++; },
};
// texImage2D(video) — 6 args is the upload form, everything else is allocation.
const realTexImage2D = gl.texImage2D;
gl.texImage2D = function (...a) {
  if (a.length === 6) gl.calls.uploads++;
  return realTexImage2D(...a);
};
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind === "webgl2" || kind === "webgl" || kind === "experimental-webgl") return gl;
  return null;
};

/* ---------------- backend stubs ---------------- */
const handlers = {
  app_info: () => ({ name: "G9", version: "0.13.0" }),
  stats: () => ({ sources: 0, channels: 0, groups: 0, favourites: 0, history: 0 }),
  list_sources: () => [], list_groups: () => [], list_history: () => [], list_channels: () => [],
  channel_total: () => 0, epg_status: () => ({ loaded: false, programmes: 0 }),
  channel_facets: () => ({ countries: [], languages: [], qualities: [] }),
  fun_home: () => ({ demo: false, errors: [], shelves: [], sources: [] }),
  fun_sources: () => [],
  fun_lib_list: () => [],
  fun_progress_list: () => [],
  get_setting: () => null,
  ffmpeg_status: () => ({ available: true, managed: false, version: "6.1" }),
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
    convertFileSrc: (p) => p,
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
  await tick(160);
  const video = $("video");
  // A decoded frame needs a size before anything can be presented.
  Object.defineProperty(video, "videoWidth", { get: () => 1920, configurable: true });
  Object.defineProperty(video, "videoHeight", { get: () => 1080, configurable: true });

  /* 1. the plan function is pure and correct on its own */
  const plan = window.G9GL.plan;
  const off = plan({ brightness: 100, contrast: 100, saturation: 100, sharpen: 0 });
  if (off.active) errors.push("neutral settings planned an active pipeline");
  if (plan({ brightness: 110 }).passes.join() !== "grade") errors.push("brightness did not plan a grade pass");
  if (plan({ sharpen: 4 }).passes.join() !== "grade") errors.push("sharpening did not plan a grade pass");
  if (plan({ deband: true }).passes.join() !== "deband") errors.push("deband alone did not plan one deband pass");
  if (plan({ sharpen: 2, deband: true }).passes.join() !== "grade,deband")
    errors.push("sharpen + deband did not plan grade→deband");
  if (plan({ sharpe: 9 }).active) errors.push("a typo'd key activated the pipeline");
  if (plan({ custom: "void main(){}" }).passes.join() !== "custom") errors.push("a custom shader did not plan a pass");
  if (Math.abs(plan({ brightness: 120 }).brightness - 1.2) > 0.001) errors.push("brightness was not normalised to 0..2");

  /* 2. the video is flipped once at upload, never in the vertex stage: a chain
        that flips per pass comes out upside down from the second pass on (found
        by the pixel test, kept here so it cannot come back) */
  if (/1\.0 - \(p\.y/.test(window.G9GL.sources.vert))
    errors.push("the vertex stage still flips vUv; every offscreen pass would double-flip");

  /* 3. neutral settings leave the plain video on screen (off == no pipeline) */
  const before = gl.calls.draws;
  window.G9GL.apply();
  if (!$("glsl").hidden) errors.push("the pipeline canvas was shown with neutral settings");
  if (video.style.visibility === "hidden") errors.push("the video was hidden with neutral settings");
  if (gl.calls.draws !== before) errors.push("neutral settings still drew something");

  /* 4. sharpening with no media loaded: armed, but nothing to present */
  $("fx-sh").value = "4";
  $("fx-sh").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(60);
  if (!$("glsl").hidden) errors.push("no media yet, but the canvas was shown");
  if (video.style.visibility === "hidden") errors.push("the video was hidden before any media");

  /* 5. with media loaded the canvas takes over */
  window.G9Bridge.play("Test film", "https://cdn.example/movie.mp4");
  video.dispatchEvent(new window.Event("loadeddata"));
  await tick(120);
  const st = window.G9GL.state();
  if (!st.context) errors.push("no WebGL context was created");
  if (!gl.calls.pixelStore.some((c) => c[0] === gl.UNPACK_FLIP_Y_WEBGL && c[1] === true))
    errors.push("the video was not uploaded flipped, so chained passes come out upside down");
  if (!st.active) errors.push("sharpening did not activate the pipeline once media existed");

  /* 6. draw accounting: one upload per presented frame */
  const u0 = gl.calls.uploads, d0 = gl.calls.draws;
  window.G9GL.render();
  const u1 = gl.calls.uploads, d1 = gl.calls.draws;
  if (u1 - u0 !== 1) errors.push("a frame was uploaded " + (u1 - u0) + " times instead of once");
  if (d1 - d0 !== 1) errors.push("grade alone drew " + (d1 - d0) + " passes instead of one");

  /* 7. deband adds a second pass, still one upload */
  $("fx-deband").checked = true;
  $("fx-deband").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(60);
  const uA = gl.calls.uploads, dA = gl.calls.draws;
  window.G9GL.render();
  if (gl.calls.draws - dA !== 2) errors.push("deband did not add exactly one pass");
  if (gl.calls.uploads - uA !== 1) errors.push("deband re-uploaded the frame");

  /* 8. a custom shader composes after the grade */
  window.G9GL.shader("Test", "void main(){ gl_FragColor = texture2D(tex, vUv); }");
  await tick(60);
  let st7 = window.G9GL.state();
  if (st7.passes.join() !== "grade,deband,custom")
    errors.push("the custom pass was not appended in order: " + st7.passes.join());
  const uB = gl.calls.uploads, dB = gl.calls.draws;
  window.G9GL.render();
  if (gl.calls.draws - dB !== 3) errors.push("three passes did not draw three times");
  if (gl.calls.uploads - uB !== 1) errors.push("three passes re-uploaded the frame");

  /* 8. a custom shader that will not compile is dropped, not fatal */
  gl.failCompile = ["this shader is broken"];
  window.G9GL.shader("Broken", "void main(){ this shader is broken }");
  await tick(80);
  gl.failCompile = [];
  const st8 = window.G9GL.state();
  if (st8.passes.indexOf("custom") >= 0) errors.push("a broken shader stayed in the chain");
  const dC = gl.calls.draws;
  const survived = window.G9GL.render();
  if (!survived) errors.push("the picture stopped after a broken shader");
  if (gl.calls.draws - dC < 1) errors.push("nothing was drawn after a broken shader");

  /* 9. back to neutral: the canvas goes away again */
  $("fx-sh").value = "0";
  $("fx-deband").checked = false;
  doc.querySelectorAll("#fx-br, #fx-ct, #fx-sat").forEach((el) => { el.value = "100"; });
  window.G9GL.apply();
  await tick(60);
  if (!$("glsl").hidden) errors.push("the canvas stayed on after going neutral");
  if (video.style.visibility === "hidden") errors.push("the video stayed hidden after going neutral");
  if (video.style.filter) errors.push("a CSS filter was left on the video: " + video.style.filter);

  /* 10. geometry: the canvas follows the picture controls */
  $("fx-sh").value = "2";
  window.G9GL.apply();
  await tick(40);
  video.style.objectFit = "cover";
  video.style.transform = "scale(1.25)";
  window.G9GL.sync();
  if ($("glsl").style.objectFit !== "cover") errors.push("the canvas did not take the fit mode");
  if ($("glsl").style.transform !== "scale(1.25)") errors.push("the canvas did not take the zoom transform");

  /* 11. the panel says what is happening */
  const chip = $("fx-gpu");
  if (!chip || !/GPU|fallback/.test(chip.textContent)) errors.push("the picture panel has no pipeline readout");

  /* 12. frame pacing: requestVideoFrameCallback is preferred when there is one,
        and presents exactly once per decoded frame */
  let rvfc = 0;
  video.requestVideoFrameCallback = (cb) => { rvfc++; window.setTimeout(cb, 4); return rvfc; };
  video.cancelVideoFrameCallback = () => {};
  Object.defineProperty(video, "paused", { get: () => false, configurable: true });
  window.G9GL.apply();
  await tick(50);
  if (window.G9GL.state().loop !== "rvfc") errors.push("rVFC was available but the loop used rAF");
  if (rvfc < 1) errors.push("no frame callbacks were scheduled");
  const d5 = gl.calls.draws, u5 = gl.calls.uploads;
  await tick(40);
  const drawn = gl.calls.draws - d5, uploaded = gl.calls.uploads - u5;
  if (uploaded < 1) errors.push("the paced loop presented nothing");
  if (uploaded !== drawn) errors.push("presented " + drawn + " passes for " + uploaded + " frames");

  /* 13. no WebGL at all: the CSS fallback takes over, honestly labelled */
  window.G9GL.reset();
  const realGet = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.G9GL.apply();
  await tick(40);
  if ($("fx-gpu").className.indexOf("is-cpu") < 0) errors.push("the CPU fallback was not labelled");
  if (!/brightness/.test(video.style.filter || "")) errors.push("no CSS filter in the fallback path");
  if (!$("glsl").hidden) errors.push("the canvas was shown without a WebGL context");
  window.HTMLCanvasElement.prototype.getContext = realGet;

  /* 14. the import sheet offers public indexes, and nothing is fetched by choosing one */
  const presetRow = $("imp-presets-row");
  if (!presetRow) errors.push("the import sheet has no public index shortcuts");
  else {
    const buttons = Array.from(presetRow.querySelectorAll("[data-preset]"));
    if (buttons.length < 5) errors.push("too few public indexes: " + buttons.length);
    const before = window.__fetchCount || 0;
    const first = buttons[0];
    if (!first) errors.push("no preset button was drawn");
    else {
      first.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await tick(20);
      const url = $("imp-url");
      if (!url || url.value.indexOf("iptv-org.github.io") < 0) {
        errors.push("a preset did not fill the playlist URL: " + (url && url.value));
      }
      if (!first.classList.contains("on")) errors.push("the chosen preset is not marked");
      const marked = buttons.filter((b) => b.classList.contains("on")).length;
      if (marked !== 1) errors.push(marked + " presets are marked at once");
      if ((window.__fetchCount || 0) !== before) errors.push("choosing a preset fetched something");
      // and the second one replaces the first, it does not add to it
      const second = buttons[1];
      if (second) {
        second.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await tick(20);
        if ($("imp-url").value !== second.getAttribute("title")) {
          errors.push("the second preset did not replace the first: " + $("imp-url").value);
        }
        if (buttons.filter((b) => b.classList.contains("on")).length !== 1) {
          errors.push("two presets are marked after picking the second");
        }
      }
    }
  }

  if (errors.length) {
    console.log("SMOKE10 FAIL");
    errors.slice(0, 14).forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  console.log("SMOKE10 OK");
  process.exit(0);
})();
