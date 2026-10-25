# Changelog

All notable changes to G9. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
G9 uses `MAJOR.MINOR.PATCH` and the Windows installers are always built from a `v*` tag.

## [0.3.0] — 2026-10-25

Closing part of the gap list without turning G9 into a second media core.

### Added

- **Managed FFmpeg** (`Settings → FFmpeg engine`): one click downloads a static Windows build of
  `ffmpeg` + `ffprobe` (~100 MB) into app data, with progress. Every tool — convert, extract,
  remux/repair, chapters, inspect, RTMP, embedded subtitles — prefers that copy and falls back to
  PATH. Nothing is bundled in the installer; **Remove** deletes it.
- **Extra player windows** (`Open in new window`): a second independent window with its own file,
  queue and state; close it like any window.
- **Transcript pane**: the loaded captions as scrollable text, highlight follows playback, click a
  line to seek. Works with searched, sidecar and generated captions.
- **WebGL shader effects**: Sharpen / Vivid / Mono / Night over the video frame, plus any `*.frag`
  dropped into `<app data>/shaders`.
- **PC shutdown timer**: the sleep timer can also schedule a Windows shutdown (`shutdown /s`), with
  `Cancel PC shutdown` in Settings.

### Changed

- `tools.rs` / `subs.rs` no longer hard-code `ffmpeg` / `ffprobe`: both go through `ffmpeg.rs`
- New capability window pattern `player-*` so extra windows may call the same commands
- Popup windows hide the menu bar and poster

### Docs

- `FEATURE-LIST.md`: four items moved out of the gap list; GLSL is now "partial" (WebGL effects,
  not Anime4K/FSRCNNX); managed FFmpeg and the shutdown timer are documented
- `docs/USER.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `README.md` updated for 0.3.0

### Still not in this release

On-device whisper models, libass karaoke, Chromecast/AirPlay **out**, Plex/Jellyfin/Emby clients,
cloud drives, watch sync, skins marketplace, disc menus, DVB tuners, NVDEC/QSV picker. See the gap
list in `FEATURE-LIST.md` — each has a reason, not a stub.

## [0.2.0] — 2026-10-25

The "webview can do more than you think" release. Playback is still WebView2 `<video>`;
nothing here pretends to be mpv.

### Added

**Playback**
- File playlist queue (View → Playlist); plays the next file when one ends
- Chapters from `ffprobe` (if on PATH) with jump-to-chapter
- Picture-in-picture, always-on-top
- Sleep timer, pause-after-N-minutes
- Keyboard frame step (`,` / `.`) and bookmarks (`M`)
- Touch gestures: horizontal seek, vertical volume
- Background audio while minimized

**Picture**
- Hover scrub preview and storyboard strip on the seek bar
- 360° look-around for equirectangular video (WebGL, drag)
- Export GIF (A–B range or ~2.4 s around now), save frame
- Region screen capture and webcam recording (MediaRecorder → WebM)
- Spectrum visualizer, scene poster (3×2 stills)

**Subtitles**
- TheSubDB and Podnapisi alongside OpenSubtitles; embedded track via `ffmpeg`
- Subtitle browser (click a line to seek) and pause-after-each-line
- Live translation of the current cue while playing

**Library / live**
- DLNA / UPnP MediaServer discover + browse
- Podcast RSS subscribe and episode play
- Live TV sheet, favourites, groups, search

**Tools (ffmpeg / ffprobe on PATH)**
- Convert / Save (MP4 / WebM / MP3), extract audio, remux / repair
- Inspect (ffprobe JSON in Diagnostics), RTMP broadcast

**Chrome**
- Cinema chrome: Media · Settings · TV Mode · About G9 (About lives inside Settings)
- Settings export / import (JSON)
- JSON IPC on `127.0.0.1:18765`
- Diagnostics with dropped-frame counter

### Changed

- Settings menu no longer scrolls; Playback was removed from the top bar
- Mute moved to the transport; play/pause fills blue
- Media info is a centred rectangle, not a vertical list
- "Load demo clips" removed — G9 ships no sample channel pack
- Version stamped in every package file, so installers are named `G9_0.2.0_*`

### Fixed

- Windows release build: `reqwest` was compiled without the `json` feature, so
  `Translate captions` (`tools.rs`) did not compile off Linux — every `v0.2.0` release run
  failed until the feature was enabled
- CI now compiles the app crate on **windows-latest**, so a Windows-only compile error fails
  CI instead of a release tag
- Installer filenames carry the real version (`G9_0.2.0_*`)

### Docs

- `FEATURE-LIST.md` now separates **shipped** from **requested but not implemented**
- Added `docs/USER.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/SECURITY.md`, `CHANGELOG.md`

### Not in this release

Bundled Whisper / Argos models, GLSL/Anime4K, RTX HDR/SR, OpenCodec, DVB, disc menus,
Chromecast/AirPlay **output**, cloud drives, watch sync, Plex/Jellyfin/Emby clients, skins,
multi-window, independent pitch shift. See the gap list in `FEATURE-LIST.md`.

## [0.1.2] — 2026-10-25

### Added
- Online subtitle search (OpenSubtitles: moviehash + title) with auto-apply of the best match
- Media info dialog
- Cinema chrome pass: menu bar, title overlay, circular transport, blue seek
- Settings consolidation and TV Mode
- About G9 dialog

### Fixed
- Installers are now named with the real version (`G9_0.1.2_*`, was `G9_0.1.0_*`)
- Mute/unmute moved next to the transport; Settings scrollbar hidden

## [0.1.1] — 2026-10-24

### Added
- First automated Windows release artifacts: NSIS setup, MSI, portable `G9.exe` zip

### Fixed
- Release workflow could not create a GitHub Release (`403`) until workflow permissions
  were set to *Read and write*

## [0.1.0] — 2026-10-24

### Added
- Tauri 2 shell, vanilla `ui/` (HTML/CSS/JS only)
- `g9-core` (version, policy, DTOs), `g9-iptv` (M3U parser, injection strip),
  `g9-store` (SQLite: sources, channels, history, settings)
- Local files, URL / HLS, M3U / IPTV import, Live TV sheet
- Diagnostics overlay, keyboard map

[0.3.0]: https://github.com/rreon633-design/G9/releases/tag/v0.3.0
[0.2.0]: https://github.com/rreon633-design/G9/releases/tag/v0.2.0
[0.1.2]: https://github.com/rreon633-design/G9/releases/tag/v0.1.2
[0.1.1]: https://github.com/rreon633-design/G9/releases/tag/v0.1.1
[0.1.0]: https://github.com/rreon633-design/G9/releases/tag/v0.1.0
