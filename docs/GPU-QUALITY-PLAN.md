# GPU, quality and rendering — 12 features

Plan for putting the GPU to work on the actual picture, not just on the UI. Written against
the code as it stands in **v0.12.0**.

## Where G9 is today

| Piece | State |
|---|---|
| `#glsl` canvas + shader pack | Real WebGL program: `texImage2D(video)` → fragment shader → `drawArrays`, with four built-in looks (Sharpen, Vivid, Mono, Night) and a folder for `.frag` files |
| `#view360` canvas | Second WebGL program: equirectangular → perspective, drawn on `requestAnimationFrame`, re-uploading the frame every tick |
| Picture controls | `brightness() contrast() saturate()` **CSS filters** on `<video>`; "sharpen" is faked as `contrast + sharp × 0.04` |
| Frame timing | `requestAnimationFrame` only — no `requestVideoFrameCallback`, so shaders run at display rate even on 24 fps content |
| Decode | WebView2 does hardware H.264/VP9/AV1 where Windows provides it; the diagnostics panel **claims** "DXVA / D3D11" without checking |
| Stats | `getVideoPlaybackQuality()` read in the diagnostics sheet (dropped frames), nowhere else |

So: a GPU path exists, it is optional, it is not frame-paced, and the picture controls are
the weakest link (CSS filters are a compositor pass with no neighbourhood sampling, which is
why "sharpen" looks like contrast).

---

## The twelve

| # | Feature | What it buys | GPU path | Effort |
|---|---|---|---|---|
| 1 | **WebGL2 pipeline as the default renderer** | Every other filter becomes possible; removes the CSS-filter hack | One program, `texImage2D` upload, ping-pong FBOs, `precision highp` on WebGL2 | 3–4 d |
| 2 | **FSR 1.0 upscaling (EASU + RCAS)** | 720p IPTV looks like 1080p; 1080p looks clean at 1440p | MIT, ~150 lines GLSL, two passes, no weights to ship | 2–3 d |
| 3 | **Real sharpening (CAS/RCAS) with a slider** | Honest sharpness instead of a contrast bump; no halos | Single pass, 5 taps, adaptive per-pixel gain | 1 d |
| 4 | **Deband + ordered dither** | Kills the stepping in skies and dark gradients of 8-bit streams | 2-tap gradient blur + 8×8 blue-noise dither, one pass | 1 d |
| 5 | **Temporal denoise (3-frame history)** | Mosquito noise and block edges on low-bitrate anime/drama disappear | Two extra FBOs, motion-aware clamp between frames | 3 d |
| 6 | **Colour pipeline + HDR→SDR tone map** | Fixes crushed blacks / washed-out IPTV; HDR10 files stop clipping | Limited→full range, BT.601/709/2020 matrix, PQ/HLG transfer, Reinhard/ACES-lite; needs colour metadata from Rust | 3 d + 2 d Rust |
| 7 | **3D LUT grading (.cube)** | "Cinema", "Night", "Vivid" become real grades the viewer can add to | 33³ LUT in a `TEXTURE_3D`, trilinear lookup, presets as files | 2 d |
| 8 | **Frame-paced presentation (`requestVideoFrameCallback`)** | Half the GPU work on 24 fps content; exact frame timing for everything else | rVFC loop, present once per decoded frame, fall back to rAF when absent | 1–2 d |
| 9 | **Hardware-decode assurance + honest GPU panel** | 4K stops being a slideshow; the panel tells the truth about the decode path | Rust: Media Foundation / DXVA probe, codec support, adapter name; JS: `UNMASKED_RENDERER_WEBGL`, dropped-frame rate, "prefer hardware" toggle | 2–3 d |
| 10 | **Adaptive performance governor** | Keeps integrated GPUs (and 4K) smooth by spending the frame budget where it shows | Rolling frame-time average → auto-downgrade chain (upscale+sharpen → sharpen → off), shader update cap, disable `backdrop-filter` under load | 2 d |
| 11 | **Judder handling for 23.976/24p on 60 Hz** | Slow pans stop stuttering; optional motion smoothing | rVFC timestamps → detected source rate; optional frame-blend pass (honest "soap opera" label) | 3 d |
| 12 | **GPU overlay compositing (subtitles, OSD)** | Heavy ASS subtitles stop costing a DOM layout per cue | Rasterise cues to a glyph atlas, draw in the same pass as the video; OSD as a second layer | 3 d |

### 1 — WebGL2 pipeline as the default renderer
Today the shader pack is a mode you enter; the video is otherwise composited by Chromium.
Make the canvas the normal presentation path when a filter is on: upload the frame once,
run the chain, present. Keeps a "direct" path for when nothing is enabled, so untouched
playback costs nothing. This is the platform the rest of the list stands on.

### 2 — FSR 1.0 upscaling
AMD's FidelityFX Super Resolution 1.0 is two shader passes (EASU edge-adaptive upscale, then
RCAS sharpening) and needs no model file. It is the best quality-per-millisecond available
without shipping weights. Add a toggle plus a "scale target" (display size, or 1080p cap).

### 3 — Real sharpening
Replace the `contrast + sharp × 0.04` hack with contrast-adaptive sharpening. Same slider,
different result: no halos, no crushed highlights.

### 4 — Deband + dither
Most IPTV and low-bitrate HLS is 8-bit with visible stepping. A cheap gradient-aware blur
plus a blue-noise dither before present removes it at almost no cost.

### 5 — Temporal denoise
Three-frame history with a motion-aware clamp: where the frame changed a lot, trust the
current frame; where it barely changed, average. Removes encoder noise without smearing
motion. This is the one that needs care around cuts and scene changes.

### 6 — Colour pipeline and tone mapping
Two problems today: HLS/IPTV feeds often declare BT.709 range metadata WebView2 ignores, so
blacks lift or crush; and HDR10 files are clipped rather than tone-mapped. Do the matrix and
transfer in the shader, fed by metadata the Rust side reads from the container. Ship "Auto"
plus manual overrides (range, matrix, peak brightness).

### 7 — 3D LUT grading
Replace the four hardcoded looks with `.cube` files: presets ship, viewers can drop their
own in the shaders folder (the folder already exists). One 3D texture lookup per pixel.

### 8 — Frame-paced presentation
`requestVideoFrameCallback` gives the presentation time of each decoded frame. Drawing once
per frame instead of once per display refresh halves the work on 24 fps video and gives the
governor real numbers to act on.

### 9 — Hardware decode, told honestly
The diagnostics sheet currently *asserts* "DXVA / D3D11" without checking. Probe it: adapter
name and driver from Media Foundation, whether the active decoder is hardware, and which
codecs the WebView2 build supports (HEVC and AV1 are not free). Add a "prefer hardware decode"
switch and a warning when the app falls back to software at 4K.

### 10 — Adaptive performance governor
A rolling frame-time average decides how much chain the GPU can afford. Over budget: drop
the upscaler first, then sharpening, then everything, and say so in the status line rather
than silently stuttering. Also disable `backdrop-filter` surfaces while video plays on weak
adapters — blur is the most expensive thing in the current UI.

### 11 — Judder handling
Most displays are 60 Hz; most film is 23.976. Detect the source rate from rVFC timestamps and
offer a frame-blend smoothing pass (clearly labelled), plus a "match display" hint when the
monitor supports 24 Hz.

### 12 — GPU overlay compositing
Subtitle cues are DOM nodes today; ASS-heavy releases with karaoke and typesetting can cost a
layout per cue. Rasterise text into a glyph atlas once per cue and draw it in the same pass
as the video, together with the OSD. Also makes "burn filters into a saved frame" exact.

---

## Rollout

| Release | Features | Why this order |
|---|---|---|
| **0.13.0 — Pipeline ✅ shipped** | 1, 3, 4, 8 | The foundation plus the three cheapest visible wins (sharpening, deband, frame pacing) — see "What 0.13.0 actually is" below |
| **0.14.0 — Scale** | 2, 9, 10 | Upscaling, honest decode reporting and the governor that keeps it honest on weak GPUs |
| **0.15.0 — Colour** | 6, 7, 11 | Colour management, LUTs and motion, the ones that need container metadata and careful defaults |
| **0.16.0 — Extras** | 5, 12 | Temporal denoise and GPU subtitles: highest complexity, smallest audience |

## What 0.13.0 actually is

The three items landed, with three deviations worth writing down:

- **1 — WebGL2 pipeline.** One grade pass (brightness, contrast, saturation *and* sharpening,
  because they act on the same taps) plus a deband pass, chained through two RGBA8 FBOs with a
  single `texImage2D(video)` per presented frame. WebGL2 is asked for first; the shaders are
  WebGL1-safe, so an old context still runs the whole chain. `#glsl` is now the *only* shader
  surface — the old named "looks" became the custom-shader slot, which still accepts `.frag`
  files and now composes after the grade instead of replacing it.
- **3 — Sharpening.** Not CAS: a 5-tap unsharp with a per-pixel gain that falls off where the
  neighbourhood disagrees (`clamp(1 - (max-min) × 1.75, 0.15, 1)`), which is what stops halos
  on edges while still lifting texture. CAS proper needs the *source* resolution and a scaling
  ratio, and item 2 (EASU/RCAS) is where that belongs; the slider and the pass will not change.
- **4 — Deband.** The sketch said "2-tap gradient blur + 8×8 blue noise". Two taps cannot cross
  a quantisation boundary — measured: 0.51 vs a source of 0.38 on an 8-px banding pattern — so
  the shipped version is a nine-tap ring at radius `clamp(min(w,h)/60, 6, 24)` texels plus one
  bit of ordered dither. Measured on the same pattern: hard band steps 8.1% of pixels → 0.0%,
  with the picture's mean and range unchanged and real edges (the colour bars) still 80 levels
  apart.
- **8 — Frame pacing.** `requestVideoFrameCallback` where it exists, `requestAnimationFrame`
  otherwise, re-armed after every presentation. The loop only runs while media is playing, so a
  paused player costs nothing.

It also flushed out a bug the CSS-filter era could not have: the vertex stage flipped `vUv`,
which is right for the direct video→canvas pass and wrong for every pass reading an offscreen
target, so *any* two-pass chain (grade + deband, the common case) presented upside down. The
video is now flipped once, at upload; `domtest/smoke10.js` and the browser pixel test both
guard it.

## Explicitly not proposed

- **AI super-resolution models** (Real-ESRGAN class): hundreds of MB of weights, vendor
  specific runtime, and a 4–8× frame cost. FSR + sharpening gets most of the visible win.
- **Frame generation** (interpolating two frames to double the rate): artifacts on live
  action and sport, and it fights the video's own timestamps.
- **GPU encoding** for the recorder: the recorder already uses the platform encoder through
  FFmpeg; moving it in-process buys nothing.
- **WebGPU first**: it is the right long-term target (compute passes, async upload), but
  WebGL2 works on every WebView2 build Windows 10 still ships. Keep the pipeline
  WebGL2-shaped so a WebGPU backend can slot in later.

## How we will measure it

- **Frame time** — rolling average and p95 from rVFC deltas, shown in the status line and the
  diagnostics sheet; the governor's input.
- **Dropped frames** — `getVideoPlaybackQuality()` before/after each toggle, on a 4K H.264
  file and a 720p HLS stream.
- **Visual A/B** — save two frames with `Save frame` (one plain, one filtered), keep them in
  `preview/quality/` so each release can be compared against the last.
- **Honesty check** — every filter has an "off" position that must be pixel-identical to the
  direct path; that is a test, not an opinion.
