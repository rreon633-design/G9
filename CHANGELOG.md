# Changelog

All notable changes to G9. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
G9 uses `MAJOR.MINOR.PATCH` and the Windows installers are always built from a `v*` tag.

## [Unreleased]

- Nothing yet.

- Dismissing a Save dialog no longer falls back to a browser download (save results are now
  `path` / `cancelled` / `unsupported`).

## [0.7.0] — 2026-10-25

GIF out, TV mode in.

### Removed

- **GIF export is gone** — the toolbar button, the Media → Tools entry and `ui/gif.js` are removed,
  and CI no longer expects the encoder. Save frame, recording and webcam recording stay.

### Added

- **Now-playing bar in the channel wall.** While browsing, a bar at the bottom shows the channel
  that is actually playing — logo, name, country · group · language, and its current programme —
  with **Play/Pause** and **Watch** (back to full screen).
- **RECENT row** — the channels you actually watched, newest first, straight from history. Hidden
  while a filter is on.
- **What's on** — the `⋯` on a channel card opens the next programmes for that channel with
  times and a **NOW** marker; click a row to tune. (`epg_upcoming` command.)
- **Guide button** in the wall: loads the guide the playlist points at, or asks for an address,
  and shows how many channels it covers.
- **Paging** — the wall asks for 120 channels at a time and offers **Show more**, so a
  5,000-channel playlist paints instantly. The header says *showing 120 of 5,000*.
  (`channel_total` command shares the filter builder with `list_channels`.)
- **Keyboard and remote control** — arrows walk the wall (2-D, so left/right stays in the row),
  Enter tunes the focused channel, digits jump to a channel number, `F` toggles the favourite,
  `/` jumps to search, `G` reloads the guide. `Esc` now backs out one level: popover first,
  then the wall.

### Fixed

- **One-line XMLTV programmes were dropped.** `<programme …><title>X</title></programme>` on a
  single line lost every entry but the last, because the parser only closed a programme when
  `</programme>` started a line. Multi-entry guides (now/next and what's on) now list correctly;
  covered by a test.
- `scrollIntoView` is guarded, so keyboard focus works in engines without it.

## [0.6.0] — 2026-10-25

A download that downloads, and a TV mode you can browse.

### Fixed

- **Downloads failed on every video.** YouTube (and most sites now) publish video and audio as
  separate streams, and G9's no-FFmpeg fallback asked for a single muxed file that no longer
  exists — `Requested format is not available`. G9 now **installs its managed FFmpeg on first
  use** (the same one Settings → FFmpeg manages) and always merges, with the progress shown in the
  Downloads panel. Verified end to end against YouTube: 360p/720p mp4 with both streams, plus
  audio-only.
- **The reason was hidden.** A failed job showed only “download stopped”, because the child exits
  before its stderr is drained. The last line is now kept with the job and shown, shortened and
  freed of extractor noise (`That video offers no downloadable format`, `This site wants a sign-in
  for that video`, …).
- **No way to try again.** Failed and stopped jobs get a **Retry** button that resumes from the
  partial file instead of starting over.
- Four-way DASH connections (`-N 4`) so long videos do not crawl.

### Added

- **TV Mode is a channel browser.** Full-screen, YouTube-shaped: logo cards, a search box,
  **Favourites / Country / Language / Quality** chips with counts, and sorting by channel order,
  name, country, quality or group. Every card shows now/next from the guide. Cards that are
  playing are outlined; the star on a card toggles favourites.
- **It tunes itself.** Entering TV Mode (or starting G9 in it) starts the last channel you watched,
  or the first one in the list. A **Channels** pill stays on screen while watching to bring the
  browser back; `Esc` closes it.
- **Channels carry the metadata the filters need.** The M3U parser keeps `tvg-country`,
  `tvg-language` and derives `4K / FHD / HD / SD` from the name; the SQLite schema migrates to
  v2 with `country`, `language` and `quality`, indexed for filtering.
- Filtering lives in SQL (`list_channels` takes country/language/quality/sort), with a
  `channel_facets` command for the chip counts, so a 5,000-channel playlist stays responsive.

### Changed

- Media → Live opens the channel browser while TV Mode is on, and the old list sheet still serves
  windowed mode.

## [0.5.0] — 2026-10-25

Downloads and live guides.

### Added

- **Download videos from the web** — the welcome screen now takes a link to a video page.
  G9 asks the page what it has, lists each quality with an estimated size (4K down to 360p, plus
  audio-only), and downloads the one you pick into `Videos\G9`. YouTube, Instagram, Facebook and
  the other sites `yt-dlp` understands are all fair game; only download what you have the rights to.
- **Downloads panel** — runs in the background while you watch something else, shows percent,
  transferred size, speed and time left, and gives each job **Play**, **Pause/Resume**,
  **Folder** and **Delete**. Deleting can take the file with it. Finished jobs raise a Windows
  notification. Unfinished jobs resume from their `.part` files, and a job that was running when
  G9 closed comes back paused instead of silently restarting.
- **Managed downloader** — Settings → Video downloads (or the prompt on the welcome card) installs
  `yt-dlp.exe` into the app data folder with one click; a copy on `PATH` is used if present, and
  a managed FFmpeg (0.3.0) is preferred for merging high-quality video and audio.
- **IPTV guide (XMLTV)** — the live sheet loads the guide a playlist points at (`url-tvg`) or one
  you paste, then shows **now / next** under every channel. Guides are gzipped in place, so a
  `.xml.gz` works, and the parsed guide is kept between launches. Now/next refreshes every minute
  while the list is open. Channels match on `tvg-id` and fall back to the display name, so
  playlists without ids still work.
- **Xtream Codes** — a portal URL, username and password import the same way an M3U does; G9
  builds the playlist from the portal, so groups, logos and channel numbers all come through.

### Changed

- The welcome screen is a launcher now: link box, downloads, and the note that G9 ships nothing.

### Fixed

- Settings gained a **Video downloads** row so the downloader is reachable while something plays.
- `--print` in the downloader would have implied `--simulate`; the job now downloads, reports
  progress against the real total, and cleans up its `.part` files on delete.

## [0.4.0] — 2026-10-25

Desktop-integration and layout pass.

### Added

- **Windows "Open with"** — the installer registers G9 as a Viewer for video (mp4, mkv, webm,
  m4v, mov, avi, ts, m2ts, mpg, mpeg, wmv, flv), audio (mp3, m4a, aac, flac, wav, ogg, opus,
  wma) and playlist (m3u, m3u8) files. G9 also reads the file it was launched with, so a
  double-click opens and plays it. `Show in folder` in Media info reveals the current file.
  *(Reinstall with this version's installer — associations come from the NSIS/MSI bundle, not
  the portable zip.)*
- **Split screen / snap** — snap left/right from the two new caption buttons (appear on hover),
  or `Ctrl+Alt+←/→` for halves and `Ctrl+Alt+↑` for full screen. Windows' own `Win+←/→` keeps
  working because the window is resizable.
- **Responsive layout** — breakpoints at 1180 / 1000 / 860 / 700 px and a short-window rule:
  the volume slider collapses to the mute button, secondary transport buttons fold away, panels
  and dialogs become full-width, the title overlay shrinks instead of clipping.
- Settings is now a **centred dialog** in the same family as Media info (Display / Engine /
  Playlists + Export / Import), not a sliding panel.

### Fixed

- **GIF export was corrupt.** The LZW stage bumped its code width one code too early, so every
  frame with more than a handful of colours produced a stream decoders reject. Rewritten to the
  compress/GIFCOMPR ordering; verified against Pillow (multi-frame, noisy content). Palette now
  uses 4×4 ordered dithering, and GIFs save through the same file dialog as frames/recordings
  instead of a browser download.
- **The alert dialog** now has an icon, separated actions, a default-choice highlight,
  Tab/Enter/Escape handling and a warning variant — it no longer looks like a browser popup.
  (Native `tauri.localhost says` boxes were gone as of 0.3.1; every prompt is in-app.)
- **No native browser chrome inside the app**: WebView2's media controls, context menu, scroll
  bars, text selection and drag ghosts are suppressed; the visualizer no longer draws under the
  transport bar.

### Removed

- Picture-in-picture button (and the code behind it) from Settings, as requested.

## [0.3.1] — 2026-10-25

Fixes for playback sound, captures, and the seek bar.

### Fixed

- **No sound on some files.** The equaliser chain built a Web Audio graph as soon as a file
  opened; a suspended context then muted the element permanently. The graph is now built only
  when you touch EQ / boost / visualizer, resumes on any gesture, and always reaches the speakers.
- **Autoplay refused by the engine** no longer fails silently: WebView2 starts with
  `--autoplay-policy=no-user-gesture-required`, a failure shows a one-tap **Press to play** gate,
  and a source whose audio codec the engine cannot decode says so instead of playing silently.
- **Screenshots now save files.** Save frame asks for a location (Pictures by default) and writes
  through the backend; if the canvas is protected, a local file falls back to FFmpeg.
- **Screen recording works.** MediaRecorder was recording the desktop through an API WebView2 does
  not implement. It now records the playback stream (picture + sound) or the webcam, and streams
  the WebM to disk in 512 KB chunks instead of one giant blob download.
- **Subtitle errors** are one short line — "No subtitles found" — and no longer list which services
  were tried, URLs, or API details. Provider names are logged only to the console.
- Toast messages are smaller and clamped to a single line.

### Changed

- **Removed the seek-bar preview**: no storyboard strip, no hover thumbnail, no second decoder.
  The bar is a plain scrub bar again.
- Volume is a pill with mute, slider, live percentage, wheel and keyboard support.
- Audio-only files open in **music mode** with a title, duration and level meter.
- Open-file dialog also accepts mp3, m4a, aac, flac, wav, ogg, opus, wma.

### Removed

- Region screen recording (needed desktop capture, which WebView2 does not expose).

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

[0.7.0]: https://github.com/rreon633-design/G9/releases/tag/v0.7.0
[0.6.0]: https://github.com/rreon633-design/G9/releases/tag/v0.6.0
[0.5.0]: https://github.com/rreon633-design/G9/releases/tag/v0.5.0
[0.4.0]: https://github.com/rreon633-design/G9/releases/tag/v0.4.0
[0.3.1]: https://github.com/rreon633-design/G9/releases/tag/v0.3.1
[0.3.0]: https://github.com/rreon633-design/G9/releases/tag/v0.3.0
[0.2.0]: https://github.com/rreon633-design/G9/releases/tag/v0.2.0
[0.1.2]: https://github.com/rreon633-design/G9/releases/tag/v0.1.2
[0.1.1]: https://github.com/rreon633-design/G9/releases/tag/v0.1.1
[0.1.0]: https://github.com/rreon633-design/G9/releases/tag/v0.1.0
